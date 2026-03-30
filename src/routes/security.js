/**
 * src/routes/security.js
 * PIN & biometric security — web version (JWT auth)
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/database');
const { authMiddleware } = require('../middlewares/auth');

const PIN_ITERATIONS = 10000;
const PIN_KEYLEN = 64;
const PIN_DIGEST = 'sha512';
const SESSION_TIMEOUT = 15 * 60 * 1000; // 15 min

function hashPin(pin, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(pin, salt, PIN_ITERATIONS, PIN_KEYLEN, PIN_DIGEST, (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
}

/**
 * GET /api/security/status
 */
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT security_enabled, security_pin, biometric_enabled, last_security_auth FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });

    const user = result.rows[0];
    const hasPin = !!user.security_pin;
    const needsAuth = user.security_enabled && hasPin &&
      (!user.last_security_auth || Date.now() - new Date(user.last_security_auth).getTime() > SESSION_TIMEOUT);

    res.json({
      success: true,
      data: {
        has_pin: hasPin,
        security_enabled: user.security_enabled,
        biometric_enabled: user.biometric_enabled,
        requires_auth: needsAuth
      }
    });
  } catch (error) {
    console.error('❌ Security status error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/security/pin/setup
 */
router.post('/pin/setup', authMiddleware, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || !/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN должен быть 4-6 цифр' });
    }

    const salt = crypto.randomBytes(32).toString('hex');
    const hashed = await hashPin(pin, salt);
    const stored = salt + ':' + hashed;

    await pool.query(
      'UPDATE users SET security_pin = $1, security_enabled = TRUE, last_security_auth = NOW(), updated_at = NOW() WHERE id = $2',
      [stored, req.user.id]
    );

    res.json({ success: true, message: 'PIN установлен' });
  } catch (error) {
    console.error('❌ PIN setup error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/security/pin/verify
 */
router.post('/pin/verify', authMiddleware, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN обязателен' });

    const result = await pool.query('SELECT security_pin FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });

    const stored = result.rows[0].security_pin;
    if (!stored) return res.status(400).json({ error: 'PIN не установлен' });

    const [salt, hash] = stored.split(':');
    const inputHash = await hashPin(pin, salt);

    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(inputHash, 'hex'))) {
      return res.status(401).json({ error: 'Неверный PIN' });
    }

    await pool.query('UPDATE users SET last_security_auth = NOW() WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ PIN verify error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/security/disable
 */
router.post('/disable', authMiddleware, async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'Для отключения нужен текущий PIN' });

    const result = await pool.query('SELECT security_pin FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });

    const stored = result.rows[0].security_pin;
    if (stored) {
      const [salt, hash] = stored.split(':');
      const inputHash = await hashPin(pin, salt);
      if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(inputHash, 'hex'))) {
        return res.status(401).json({ error: 'Неверный PIN' });
      }
    }

    await pool.query(
      'UPDATE users SET security_enabled = FALSE, security_pin = NULL, biometric_enabled = FALSE, biometric_credential_id = NULL, biometric_public_key = NULL, updated_at = NOW() WHERE id = $1',
      [req.user.id]
    );

    res.json({ success: true, message: 'Защита отключена' });
  } catch (error) {
    console.error('❌ Security disable error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
