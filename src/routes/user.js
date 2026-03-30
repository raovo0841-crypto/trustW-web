/**
 * src/routes/user.js
 * User management routes (web version - uses JWT user id instead of telegram_id)
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authMiddleware } = require('../middlewares/auth');

/**
 * GET /api/profile
 * Get current user profile (authenticated)
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, verified, is_admin,
              balance_usdt, balance_btc, balance_rub, balance_eur, balance_eth, balance_ton, balance_byn,
              needs_verification, verification_pending, agreement_accepted_at,
              min_deposit, min_withdraw, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = result.rows[0];
    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        verified: user.verified,
        usdt: parseFloat(user.balance_usdt) || 0,
        btc: parseFloat(user.balance_btc) || 0,
        rub: parseFloat(user.balance_rub) || 0,
        eur: parseFloat(user.balance_eur) || 0,
        eth: parseFloat(user.balance_eth) || 0,
        ton: parseFloat(user.balance_ton) || 0,
        byn: parseFloat(user.balance_byn) || 0,
        needs_verification: user.needs_verification,
        verification_pending: user.verification_pending,
        agreement_accepted: !!user.agreement_accepted_at,
        min_deposit: parseFloat(user.min_deposit) || 0,
        min_withdraw: parseFloat(user.min_withdraw) || 0,
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('❌ Profile error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/profile/agreement/accept
 */
router.post('/agreement/accept', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET agreement_accepted_at = NOW(), updated_at = NOW() WHERE id = $1',
      [req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Agreement error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/profile/transactions
 * Get transaction history
 */
router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT id, type, amount, currency, description, created_at
       FROM transactions WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Transactions error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/profile/support/messages
 */
router.get('/support/messages', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, sender, message, is_read, created_at, edited_at
       FROM support_messages WHERE user_id = $1
       ORDER BY created_at ASC`,
      [req.user.id]
    );

    // Mark admin messages as read
    await pool.query(
      `UPDATE support_messages SET is_read = TRUE
       WHERE user_id = $1 AND sender = 'admin' AND is_read = FALSE`,
      [req.user.id]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Support messages error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/profile/support/send
 */
router.post('/support/send', authMiddleware, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Сообщение не может быть пустым' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'Максимум 2000 символов' });
    }

    await pool.query(
      `INSERT INTO support_messages (user_id, sender, message, created_at)
       VALUES ($1, 'user', $2, NOW())`,
      [req.user.id, message.trim()]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Support send error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
