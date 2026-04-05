/**
 * src/routes/transactions.js
 * Deposit/withdraw/history — web version (JWT auth, no Telegram bots)
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authMiddleware } = require('../middlewares/auth');

/**
 * GET /api/transactions/rates
 */
router.get('/rates', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT key, value FROM platform_settings WHERE key IN ('rub_usdt_rate', 'eur_usdt_rate', 'byn_usdt_rate')"
    );
    const rates = {};
    result.rows.forEach(r => { rates[r.key] = r.value; });
    res.json({ success: true, data: rates });
  } catch (error) {
    console.error('❌ Rates error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/transactions/withdraw
 */
router.post('/withdraw', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, wallet, currency } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Некорректная сумма' });
    }
    if (!wallet || !wallet.trim()) {
      return res.status(400).json({ error: 'Укажите номер карты' });
    }

    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT * FROM users WHERE id = $1 FOR UPDATE',
      [req.user.id]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = userResult.rows[0];
    const cur = (currency || 'USDT').toUpperCase();
    const balanceField = {
      USDT: 'balance_usdt', RUB: 'balance_rub', EUR: 'balance_eur',
      BTC: 'balance_btc', ETH: 'balance_eth', TON: 'balance_ton', BYN: 'balance_byn'
    }[cur];

    if (!balanceField) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Некорректная валюта' });
    }

    const balance = parseFloat(user[balanceField]) || 0;
    if (parsedAmount > balance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Недостаточно средств' });
    }

    // Check min withdraw
    const minWithdraw = parseFloat(user.min_withdraw) || 0;
    if (cur === 'USDT' && parsedAmount < minWithdraw && minWithdraw > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Минимальная сумма вывода: ${minWithdraw} USDT` });
    }

    // Deduct balance
    await client.query(
      `UPDATE users SET ${balanceField} = ${balanceField} - $1, updated_at = NOW() WHERE id = $2`,
      [parsedAmount, user.id]
    );

    // Create withdraw request
    await client.query(
      `INSERT INTO withdraw_requests (user_id, amount, wallet, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())`,
      [user.id, parsedAmount, wallet.trim()]
    );

    // Transaction record
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, currency, description, created_at)
       VALUES ($1, 'withdraw', $2, $3, $4, NOW())`,
      [user.id, parsedAmount, cur, `Вывод ${parsedAmount} ${cur} → ${wallet.trim()}`]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Заявка на вывод создана' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Withdraw error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/transactions/deposit
 */
router.post('/deposit', authMiddleware, async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Некорректная сумма' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = userResult.rows[0];
    const minDeposit = parseFloat(user.min_deposit) || 0;
    if (parsedAmount < minDeposit && minDeposit > 0) {
      return res.status(400).json({ error: `Минимальная сумма пополнения: ${minDeposit} USDT` });
    }

    // Create deposit request (admin approves manually)
    await pool.query(
      `INSERT INTO deposit_requests (user_id, amount, currency, status, created_at)
       VALUES ($1, $2, $3, 'pending', NOW())`,
      [user.id, parsedAmount, (currency || 'USDT').toUpperCase()]
    );

    res.json({ success: true, message: 'Заявка на пополнение создана' });
  } catch (error) {
    console.error('❌ Deposit error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/transactions/history
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type;

    let query = 'SELECT id, type, amount, currency, description, created_at FROM transactions WHERE user_id = $1';
    const params = [req.user.id];

    if (type && ['deposit', 'withdraw', 'exchange', 'trade_open', 'trade_win', 'trade_loss'].includes(type)) {
      query += ' AND type = $' + (params.length + 1);
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ History error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
