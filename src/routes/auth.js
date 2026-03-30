/**
 * src/routes/auth.js
 * Email/password authentication with email verification
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../config/database');
const { generateToken } = require('../utils/jwt');
const { authMiddleware } = require('../middlewares/auth');
const { sendVerificationCode } = require('../utils/mailer');

const SALT_ROUNDS = 12;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_EXPIRY_MINUTES = 10;
const MAX_VERIFY_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60000; // 1 minute

function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * POST /api/auth/register
 * Creates user (unverified) + sends verification code to email
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Некорректный email' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    }

    const emailLower = email.toLowerCase().trim();

    // Check if email already taken
    const existing = await pool.query('SELECT id, verified FROM users WHERE email = $1', [emailLower]);
    if (existing.rows.length > 0 && existing.rows[0].verified) {
      return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
    }

    let userId;

    if (existing.rows.length > 0 && !existing.rows[0].verified) {
      // User exists but not verified — update password, resend code
      userId = existing.rows[0].id;
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      await pool.query(
        'UPDATE users SET password_hash = $1, first_name = $2, last_name = $3, updated_at = NOW() WHERE id = $4',
        [passwordHash, firstName || null, lastName || null, userId]
      );
    } else {
      // New user
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, NOW(), NOW())
         RETURNING id`,
        [emailLower, passwordHash, firstName || null, lastName || null]
      );
      userId = result.rows[0].id;
    }

    // Generate and save verification code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60000);

    // Delete old codes for this user
    await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [userId]);

    await pool.query(
      `INSERT INTO email_verifications (user_id, email, code, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, emailLower, code, expiresAt]
    );

    // Send email
    try {
      await sendVerificationCode(emailLower, code);
    } catch (mailErr) {
      console.error('❌ Mail send error:', mailErr.message);
      return res.status(500).json({ error: 'Не удалось отправить письмо. Проверьте email.' });
    }

    res.status(201).json({
      success: true,
      needsVerification: true,
      email: emailLower,
      message: 'Код подтверждения отправлен на вашу почту'
    });
  } catch (error) {
    console.error('❌ Register error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/auth/verify
 * Verify email with 6-digit code
 */
router.post('/verify', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email и код обязательны' });
    }

    const emailLower = email.toLowerCase().trim();

    const result = await pool.query(
      `SELECT ev.*, u.id as uid, u.email as uemail, u.first_name, u.last_name, u.is_admin, u.verified
       FROM email_verifications ev
       JOIN users u ON u.id = ev.user_id
       WHERE ev.email = $1 AND ev.verified_at IS NULL
       ORDER BY ev.created_at DESC LIMIT 1`,
      [emailLower]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Код не найден. Запросите новый.' });
    }

    const verification = result.rows[0];

    if (verification.attempts >= MAX_VERIFY_ATTEMPTS) {
      return res.status(429).json({ error: 'Слишком много попыток. Запросите новый код.' });
    }

    // Increment attempts
    await pool.query(
      'UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1',
      [verification.id]
    );

    if (new Date() > new Date(verification.expires_at)) {
      return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
    }

    if (verification.code !== code.trim()) {
      const left = MAX_VERIFY_ATTEMPTS - verification.attempts - 1;
      return res.status(400).json({ error: `Неверный код. Осталось попыток: ${left}` });
    }

    // Mark email as verified
    await pool.query('UPDATE email_verifications SET verified_at = NOW() WHERE id = $1', [verification.id]);
    await pool.query('UPDATE users SET verified = TRUE, updated_at = NOW() WHERE id = $1', [verification.uid]);

    // Generate token — user is now logged in
    const token = generateToken({
      userId: verification.uid,
      email: verification.uemail,
      isAdmin: verification.is_admin || false
    });

    res.json({
      success: true,
      token,
      user: {
        id: verification.uid,
        email: verification.uemail,
        first_name: verification.first_name,
        last_name: verification.last_name,
        verified: true
      }
    });
  } catch (error) {
    console.error('❌ Verify error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/auth/resend
 * Resend verification code (1 min cooldown)
 */
router.post('/resend', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email обязателен' });

    const emailLower = email.toLowerCase().trim();

    const userRes = await pool.query('SELECT id, verified FROM users WHERE email = $1', [emailLower]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if (userRes.rows[0].verified) {
      return res.status(400).json({ error: 'Email уже подтверждён' });
    }

    const userId = userRes.rows[0].id;

    // Check cooldown
    const lastCode = await pool.query(
      'SELECT created_at FROM email_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    if (lastCode.rows.length > 0) {
      const elapsed = Date.now() - new Date(lastCode.rows[0].created_at).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({ error: `Подождите ${wait} сек. перед повторной отправкой` });
      }
    }

    // Generate new code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60000);

    await pool.query('DELETE FROM email_verifications WHERE user_id = $1', [userId]);
    await pool.query(
      'INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES ($1, $2, $3, $4)',
      [userId, emailLower, code, expiresAt]
    );

    try {
      await sendVerificationCode(emailLower, code);
    } catch (mailErr) {
      console.error('❌ Resend mail error:', mailErr.message);
      return res.status(500).json({ error: 'Не удалось отправить письмо' });
    }

    res.json({ success: true, message: 'Новый код отправлен' });
  } catch (error) {
    console.error('❌ Resend error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_deleted = FALSE',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const user = result.rows[0];

    if (user.is_blocked) {
      return res.status(403).json({ error: 'Аккаунт заблокирован', blocked: true });
    }

    if (!user.verified) {
      return res.status(403).json({ error: 'Email не подтверждён', needsVerification: true, email: user.email });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      isAdmin: user.is_admin || false
    });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        verified: user.verified || false
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, verified, is_admin,
              balance_usdt, balance_btc, balance_rub, balance_eur, balance_eth, balance_ton, balance_byn,
              created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error('❌ Auth me error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
