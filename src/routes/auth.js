/**
 * src/routes/auth.js
 * Email/password authentication with email verification
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../config/database');
const { generateToken } = require('../utils/jwt');
const { authMiddleware } = require('../middlewares/auth');

const SALT_ROUNDS = 12;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * Creates user and logs in immediately (no email verification)
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
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [emailLower]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
    }

    // New user
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
       RETURNING id, email, first_name, last_name, verified`,
      [emailLower, passwordHash, firstName || null, lastName || null]
    );

    const user = result.rows[0];
    const token = generateToken({
      userId: user.id,
      email: user.email,
      isAdmin: false
    });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        verified: true
      }
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
    res.status(410).json({ error: 'Подтверждение email отключено' });
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
    res.status(410).json({ error: 'Повторная отправка кода отключена' });
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

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    if (!user.verified) {
      await pool.query('UPDATE users SET verified = TRUE, updated_at = NOW() WHERE id = $1', [user.id]);
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
        verified: true
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

/**
 * POST /api/auth/change-password
 * Change password (requires current password)
 */
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Введите текущий и новый пароль' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });
    }

    const result = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Неверный текущий пароль' });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newHash, req.user.id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Change password error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
