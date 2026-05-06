/**
 * src/routes/trades.js
 * Binary options trading — web version (JWT auth, no Telegram)
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authMiddleware, adminMiddleware } = require('../middlewares/auth');
const { notifyTradeCreated } = require('../admin-bot');

/**
 * POST /api/trades/create
 */
router.post('/create', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, direction, duration, symbol } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Некорректная сумма' });
    }
    if (!['up', 'down'].includes(direction)) {
      return res.status(400).json({ error: 'Некорректное направление' });
    }
    if (!Number.isInteger(duration) || duration < 30 || duration > 3600) {
      return res.status(400).json({ error: 'Некорректная длительность' });
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

    if (user.trading_blocked) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Торговля заблокирована' });
    }

    const balance = parseFloat(user.balance_usdt) || 0;
    if (parsedAmount > balance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Недостаточно средств' });
    }

    // Check for existing active trade
    const activeCheck = await client.query(
      "SELECT id FROM orders WHERE user_id = $1 AND status = 'active'",
      [user.id]
    );
    if (activeCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'У вас уже есть активная сделка' });
    }

    // Deduct balance
    await client.query(
      'UPDATE users SET balance_usdt = balance_usdt - $1, updated_at = NOW() WHERE id = $2',
      [parsedAmount, user.id]
    );

    // Create order
    const expiresAt = new Date(Date.now() + duration * 1000);
    const orderResult = await client.query(
      `INSERT INTO orders (user_id, amount, direction, duration, symbol, trade_mode, status, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), $7)
       RETURNING *`,
      [user.id, parsedAmount, direction, duration, symbol || 'BTC', user.trade_mode || 'loss', expiresAt]
    );

    // Transaction record
    await client.query(
      `INSERT INTO transactions (user_id, order_id, type, amount, currency, description, created_at)
       VALUES ($1, $2, 'trade_open', $3, 'USDT', $4, NOW())`,
      [user.id, orderResult.rows[0].id, parsedAmount, `Открытие сделки: ${direction.toUpperCase()} ${symbol || 'BTC'}`]
    );

    await client.query('COMMIT');

    notifyTradeCreated(user.id, parsedAmount, direction, symbol || 'BTC', duration)
      .catch(e => console.error('Trade notify error:', e.message));

    res.json({ success: true, data: orderResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Trade create error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/trades/close/:tradeId
 */
router.post('/close/:tradeId', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tradeResult = await client.query(
      "SELECT o.*, u.trade_mode, u.profit_multiplier FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = $1 AND o.status = 'active' FOR UPDATE",
      [req.params.tradeId]
    );

    if (tradeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Сделка не найдена' });
    }

    const trade = tradeResult.rows[0];

    // Verify ownership
    if (trade.user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const tradeMode = trade.trade_mode || 'loss';
    const multiplier = parseFloat(trade.profit_multiplier) || 0.015;
    const tradeAmount = parseFloat(trade.amount);
    let result, profit;

    if (tradeMode === 'win') {
      result = 'win';
      profit = tradeAmount * multiplier;
    } else {
      result = 'loss';
      profit = 0;
    }

    const returnAmount = result === 'win' ? tradeAmount + profit : 0;

    // Update order
    await client.query(
      "UPDATE orders SET status = 'closed', result = $1, profit = $2, closed_at = NOW() WHERE id = $3",
      [result, profit, trade.id]
    );

    // Return funds if win
    if (returnAmount > 0) {
      await client.query(
        'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2',
        [returnAmount, trade.user_id]
      );
    }

    // Transaction record
    await client.query(
      `INSERT INTO transactions (user_id, order_id, type, amount, currency, description, created_at)
       VALUES ($1, $2, $3, $4, 'USDT', $5, NOW())`,
      [trade.user_id, trade.id,
       result === 'win' ? 'trade_win' : 'trade_loss',
       result === 'win' ? profit : tradeAmount,
       result === 'win' ? `Выигрыш: +${profit.toFixed(2)} USDT` : `Проигрыш: -${tradeAmount.toFixed(2)} USDT`]
    );

    await client.query('COMMIT');

    const balResult = await pool.query('SELECT balance_usdt FROM users WHERE id = $1', [trade.user_id]);
    const newBalance = parseFloat(balResult.rows[0]?.balance_usdt) || 0;

    res.json({
      success: true,
      data: { result, profit, returnAmount, newBalance }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Trade close error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/trades/history
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = await pool.query(
      `SELECT id, amount, direction, duration, symbol, status, result, profit, created_at, closed_at
       FROM orders WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Trade history error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/trades/active
 */
router.get('/active', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      [req.user.id]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (error) {
    console.error('❌ Active trade error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/trades/stats
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
         COUNT(*) FILTER (WHERE result = 'win') as wins,
         COUNT(*) FILTER (WHERE result = 'loss') as losses,
         COALESCE(SUM(CASE WHEN result = 'win' THEN profit ELSE 0 END), 0) as total_profit,
         COALESCE(SUM(CASE WHEN result = 'loss' THEN amount ELSE 0 END), 0) as total_loss
       FROM orders WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ Trade stats error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/trades/analytics
 */
router.get('/analytics', authMiddleware, async (req, res) => {
  try {
    const period = req.query.period || 'week';
    let interval;
    switch (period) {
      case 'day': interval = '1 day'; break;
      case 'month': interval = '30 days'; break;
      default: interval = '7 days';
    }

    const result = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
         COUNT(*) FILTER (WHERE result = 'win') as wins,
         COUNT(*) FILTER (WHERE result = 'loss') as losses,
         COALESCE(SUM(CASE WHEN result = 'win' THEN profit ELSE 0 END), 0) as total_profit,
         COALESCE(SUM(CASE WHEN result = 'loss' THEN amount ELSE 0 END), 0) as total_loss,
         COALESCE(SUM(amount), 0) as total_volume
       FROM orders WHERE user_id = $1 AND created_at > NOW() - $2::interval`,
      [req.user.id, interval]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ Analytics error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/trades/pnl-history
 */
router.get('/pnl-history', authMiddleware, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const result = await pool.query(
      `SELECT
         DATE(closed_at) as date,
         SUM(CASE WHEN result = 'win' THEN profit ELSE -amount END) as pnl,
         COUNT(*) as trades
       FROM orders
       WHERE user_id = $1 AND status = 'closed' AND closed_at > NOW() - ($2 || ' days')::interval
       GROUP BY DATE(closed_at)
       ORDER BY date`,
      [req.user.id, days.toString()]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ PnL history error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
