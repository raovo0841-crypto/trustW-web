/**
 * src/routes/admin.js
 * Admin API routes for TrustEx Web
 * Auth: admin token from Telegram WebApp or query param
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { notifyDepositCompleted } = require('../admin-bot');

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// ── Simple admin auth middleware ──
function adminAuth(req, res, next) {
  const adminId = req.query.adminId || req.headers['x-admin-id'];
  if (String(adminId) !== String(ADMIN_CHAT_ID)) {
    return res.status(403).json({ success: false, error: 'Доступ запрещён' });
  }
  next();
}

router.use(adminAuth);

function formatNum(n) {
  return parseFloat(n || 0).toFixed(2);
}

// ═══════════════════════════════════════
// GET /stats — Dashboard statistics
// ═══════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const users = (await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE trade_mode = 'win') as win_mode,
             COUNT(*) FILTER (WHERE COALESCE(trade_mode,'loss') = 'loss') as loss_mode,
             COUNT(*) FILTER (WHERE is_blocked) as blocked,
             COUNT(*) FILTER (WHERE verified) as verified_count,
             COALESCE(SUM(balance_usdt), 0) as total_usdt,
             COALESCE(SUM(balance_rub), 0) as total_rub
      FROM users
    `)).rows[0];

    const pending = (await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM deposit_requests WHERE status = 'pending') as dep_pending,
        (SELECT COUNT(*) FROM withdraw_requests WHERE status = 'pending') as wd_pending
    `)).rows[0];

    res.json({
      success: true,
      data: {
        totalUsers: parseInt(users.total),
        totalBalance: formatNum(users.total_usdt),
        totalRub: formatNum(users.total_rub),
        winModeCount: parseInt(users.win_mode),
        lossModeCount: parseInt(users.loss_mode),
        blockedCount: parseInt(users.blocked),
        verifiedCount: parseInt(users.verified_count),
        pendingDeposits: parseInt(pending.dep_pending),
        pendingWithdrawals: parseInt(pending.wd_pending)
      }
    });
  } catch (e) {
    console.error('Admin stats error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// GET /users — List all users
// ═══════════════════════════════════════
router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, email, first_name, last_name,
             balance_usdt, balance_rub, balance_eur, balance_byn,
             balance_btc, balance_eth, balance_ton,
             COALESCE(trade_mode, 'loss') as trade_mode,
             is_blocked, is_deleted, verified, created_at
      FROM users ORDER BY created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    console.error('Admin users error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// GET /user/:id — Detailed user info
// ═══════════════════════════════════════
router.get('/user/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find by UUID or email
    let user;
    const byId = await pool.query('SELECT * FROM users WHERE id::text = $1', [id]);
    if (byId.rows.length) {
      user = byId.rows[0];
    } else {
      const byEmail = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [id.toLowerCase()]);
      if (byEmail.rows.length) user = byEmail.rows[0];
    }

    if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    // Trade stats
    const stats = (await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE result = 'win') as wins,
             COUNT(*) FILTER (WHERE result = 'loss') as losses,
             COALESCE(SUM(CASE WHEN result = 'win' THEN profit ELSE 0 END), 0) as total_profit
      FROM orders WHERE user_id = $1 AND status = 'closed'
    `, [user.id])).rows[0];

    user.trades_count = parseInt(stats.total);
    user.trades_wins = parseInt(stats.wins);
    user.trades_losses = parseInt(stats.losses);
    user.trades_profit = formatNum(stats.total_profit);

    res.json({ success: true, data: user });
  } catch (e) {
    console.error('Admin user detail error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// PUT /user/:id — Update user
// ═══════════════════════════════════════
router.put('/user/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const updates = req.body;

    await client.query('BEGIN');

    // Lock user row
    const lockResult = await client.query(
      'SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]
    );
    if (!lockResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }

    const user = lockResult.rows[0];

    // Build SET clause dynamically — only update changed fields
    const allowed = [
      'balance_usdt', 'balance_rub', 'balance_eur', 'balance_byn',
      'balance_btc', 'balance_eth', 'balance_ton',
      'trade_mode', 'is_blocked', 'verified', 'needs_verification',
      'verification_pending', 'verification_rejected',
      'trading_blocked', 'min_deposit', 'min_withdraw',
      'min_withdraw_rub', 'min_withdraw_byn',
      'profit_multiplier', 'first_name', 'last_name',
      'show_agreement_to_user', 'notifications_enabled',
      'bank_verif_amount'
    ];

    const setClauses = [];
    const values = [];
    let paramIdx = 1;

    for (const field of allowed) {
      if (updates[field] !== undefined) {
        // Optimistic check for balance fields
        if (field.startsWith('balance_') && updates[`expected_${field}`] !== undefined) {
          const expected = parseFloat(updates[`expected_${field}`]);
          const actual = parseFloat(user[field] || 0);
          if (Math.abs(expected - actual) > 0.001) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              success: false,
              error: `Баланс ${field} был изменён другим админом. Ожидалось: ${expected}, на самом деле: ${actual}. Обновите страницу.`
            });
          }
        }
        setClauses.push(`${field} = $${paramIdx}`);
        values.push(updates[field]);
        paramIdx++;
      }
    }

    if (setClauses.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: true, message: 'Нечего обновлять' });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    await client.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      values
    );
    await client.query('COMMIT');

    res.json({ success: true, message: 'Пользователь обновлён' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin update user error:', e);
    res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════
// POST /user/:id/block — Toggle block
// ═══════════════════════════════════════
router.post('/user/:id/block', async (req, res) => {
  try {
    const { id } = req.params;
    const user = (await pool.query('SELECT is_blocked FROM users WHERE id = $1', [id])).rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'Не найден' });

    const newBlocked = !user.is_blocked;
    await pool.query('UPDATE users SET is_blocked = $1, updated_at = NOW() WHERE id = $2', [newBlocked, id]);
    res.json({ success: true, blocked: newBlocked });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// GET /user/:id/history — Activity history
// ═══════════════════════════════════════
router.get('/user/:id/history', async (req, res) => {
  try {
    const { id } = req.params;

    // Get deposits
    const deposits = (await pool.query(`
      SELECT id, 'deposit' as type, amount, currency, status, created_at, approved_at
      FROM deposit_requests WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50
    `, [id])).rows;

    // Get withdrawals
    const withdrawals = (await pool.query(`
      SELECT id, 'withdrawal' as type, amount, wallet, status, created_at, processed_at
      FROM withdraw_requests WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50
    `, [id])).rows;

    // Get trades
    const trades = (await pool.query(`
      SELECT id, 'trade' as type, direction, amount, profit, result, status, symbol, duration, created_at, closed_at
      FROM orders WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50
    `, [id])).rows;

    // Get transactions
    const transactions = (await pool.query(`
      SELECT type, amount, currency, description, created_at
      FROM transactions WHERE user_id = $1
      ORDER BY created_at DESC LIMIT 50
    `, [id])).rows;

    // Merge and sort
    const all = [...deposits, ...withdrawals, ...trades].sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );

    res.json({ success: true, data: all, transactions });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// GET /deposits — Pending deposits
// ═══════════════════════════════════════
router.get('/deposits', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, u.email, u.first_name
      FROM deposit_requests d
      JOIN users u ON u.id = d.user_id
      WHERE d.status = 'pending'
      ORDER BY d.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// POST /deposits/:id/approve — Approve deposit
// ═══════════════════════════════════════
router.post('/deposits/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dep = (await client.query(
      'SELECT * FROM deposit_requests WHERE id = $1 AND status = $2 FOR UPDATE',
      [req.params.id, 'pending']
    )).rows[0];

    if (!dep) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Уже обработан или не найден' });
    }

    const cur = (dep.currency || 'USDT').toUpperCase();
    const fieldMap = { USDT: 'balance_usdt', RUB: 'balance_rub', EUR: 'balance_eur', BYN: 'balance_byn', BTC: 'balance_btc', ETH: 'balance_eth', TON: 'balance_ton' };
    const field = fieldMap[cur] || 'balance_usdt';

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [dep.user_id]);
    await client.query(
      `UPDATE users SET ${field} = ${field} + $1, updated_at = NOW() WHERE id = $2`,
      [dep.amount, dep.user_id]
    );
    await client.query(
      'UPDATE deposit_requests SET status = $1, approved_at = NOW() WHERE id = $2',
      ['approved', dep.id]
    );
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, currency, description) VALUES ($1, 'deposit', $2, $3, $4)`,
      [dep.user_id, dep.amount, cur, 'Пополнение одобрено']
    );

    await client.query('COMMIT');

    notifyDepositCompleted(dep.user_id, dep.amount, cur, 'manual')
      .catch(e => console.error('Admin approve notify error:', e.message));

    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════
// POST /deposits/:id/reject — Reject deposit
// ═══════════════════════════════════════
router.post('/deposits/:id/reject', async (req, res) => {
  try {
    await pool.query(
      'UPDATE deposit_requests SET status = $1 WHERE id = $2 AND status = $3',
      ['rejected', req.params.id, 'pending']
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// GET /withdrawals — Pending withdrawals
// ═══════════════════════════════════════
router.get('/withdrawals', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*, u.email, u.first_name
      FROM withdraw_requests w
      JOIN users u ON u.id = w.user_id
      WHERE w.status = 'pending'
      ORDER BY w.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// POST /withdrawals/:id/approve
// ═══════════════════════════════════════
router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const wd = (await pool.query(
      'SELECT * FROM withdraw_requests WHERE id = $1 AND status = $2',
      [req.params.id, 'pending']
    )).rows[0];

    if (!wd) return res.status(404).json({ success: false, error: 'Не найден' });

    await pool.query(
      'UPDATE withdraw_requests SET status = $1, processed_at = NOW() WHERE id = $2',
      ['approved', wd.id]
    );
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, currency, description) VALUES ($1, 'withdrawal', $2, 'USDT', $3)`,
      [wd.user_id, wd.amount, `Вывод одобрен на ${wd.wallet}`]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// POST /withdrawals/:id/reject — Return balance
// ═══════════════════════════════════════
router.post('/withdrawals/:id/reject', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const wd = (await client.query(
      'SELECT * FROM withdraw_requests WHERE id = $1 AND status = $2 FOR UPDATE',
      [req.params.id, 'pending']
    )).rows[0];

    if (!wd) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Не найден' });
    }

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [wd.user_id]);
    await client.query(
      'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2',
      [wd.amount, wd.user_id]
    );
    await client.query(
      'UPDATE withdraw_requests SET status = $1, processed_at = NOW() WHERE id = $2',
      ['rejected', wd.id]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: e.message });
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════
// GET /chats — Support chats list
// ═══════════════════════════════════════
router.get('/chats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.first_name,
             (SELECT COUNT(*) FROM support_messages sm WHERE sm.user_id = u.id AND sm.sender = 'user' AND sm.is_read = FALSE) as unread,
             (SELECT MAX(created_at) FROM support_messages sm WHERE sm.user_id = u.id) as last_message_at
      FROM users u
      WHERE EXISTS (SELECT 1 FROM support_messages sm WHERE sm.user_id = u.id)
      ORDER BY last_message_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// GET /chat/:id — Get chat messages
// ═══════════════════════════════════════
router.get('/chat/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get user info
    const user = (await pool.query(
      'SELECT id, email, first_name, last_name FROM users WHERE id = $1',
      [id]
    )).rows[0];
    if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

    // Mark messages as read
    await pool.query(
      `UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'user' AND is_read = FALSE`,
      [id]
    );

    const messages = (await pool.query(
      'SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC',
      [id]
    )).rows;

    res.json({
      success: true,
      data: {
        user: { id: user.id, name: user.first_name || user.email.split('@')[0], email: user.email },
        messages
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// PUT /chat/message/:id — Edit admin message
// ═══════════════════════════════════════
router.put('/chat/message/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Пустое сообщение' });
    }
    const msg = (await pool.query(
      "SELECT * FROM support_messages WHERE id = $1 AND sender = 'admin'",
      [id]
    )).rows[0];
    if (!msg) return res.status(404).json({ success: false, error: 'Сообщение не найдено' });

    await pool.query(
      'UPDATE support_messages SET message = $1, edited_at = NOW() WHERE id = $2',
      [message.trim().substring(0, 2000), id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// POST /chat/:id — Send admin message
// ═══════════════════════════════════════
router.post('/chat/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, error: 'Пустое сообщение' });
    }

    await pool.query(
      `INSERT INTO support_messages (user_id, sender, message) VALUES ($1, 'admin', $2)`,
      [id, message.trim().substring(0, 2000)]
    );

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// GET /rates — Exchange rates
// ═══════════════════════════════════════
router.get('/rates', async (req, res) => {
  try {
    const result = await pool.query("SELECT key, value FROM platform_settings WHERE key LIKE '%_rate'");
    const rates = {};
    for (const r of result.rows) rates[r.key] = r.value;
    res.json({ success: true, data: rates });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// PUT /rates — Update exchange rates
// ═══════════════════════════════════════
router.put('/rates', async (req, res) => {
  try {
    const { rub_usdt_rate, eur_usdt_rate, byn_usdt_rate } = req.body;

    if (rub_usdt_rate) await pool.query("UPDATE platform_settings SET value = $1, updated_at = NOW() WHERE key = 'rub_usdt_rate'", [String(rub_usdt_rate)]);
    if (eur_usdt_rate) await pool.query("UPDATE platform_settings SET value = $1, updated_at = NOW() WHERE key = 'eur_usdt_rate'", [String(eur_usdt_rate)]);
    if (byn_usdt_rate) await pool.query("UPDATE platform_settings SET value = $1, updated_at = NOW() WHERE key = 'byn_usdt_rate'", [String(byn_usdt_rate)]);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═══════════════════════════════════════
// POST /user/:id/delete — Soft delete user with snapshot
// ═══════════════════════════════════════
router.post('/user/:id/delete', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = (await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!user) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Не найден' }); }
    if (user.is_deleted) { await client.query('ROLLBACK'); return res.json({ success: true, message: 'Уже удалён' }); }

    // Build snapshot
    const trades = (await client.query('SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE result=\'win\') as wins, COUNT(*) FILTER(WHERE result=\'loss\') as losses FROM orders WHERE user_id=$1 AND status=\'closed\'', [user.id])).rows[0];
    const txCount = (await client.query('SELECT COUNT(*) as c FROM transactions WHERE user_id=$1', [user.id])).rows[0];
    const msgCount = (await client.query('SELECT COUNT(*) as c FROM support_messages WHERE user_id=$1', [user.id])).rows[0];

    const snapshot = {
      balances: { usdt: user.balance_usdt, rub: user.balance_rub, eur: user.balance_eur, byn: user.balance_byn, btc: user.balance_btc, eth: user.balance_eth, ton: user.balance_ton },
      trades: { total: parseInt(trades.total), wins: parseInt(trades.wins), losses: parseInt(trades.losses) },
      transactions: { total: parseInt(txCount.c) },
      support_messages: parseInt(msgCount.c)
    };

    await client.query(
      'UPDATE users SET is_deleted = true, deleted_at = NOW(), balance_usdt = 0, balance_rub = 0, balance_eur = 0, balance_byn = 0, balance_btc = 0, balance_eth = 0, balance_ton = 0, verification_data = $1 WHERE id = $2',
      [JSON.stringify({ deletion_snapshot: snapshot }), user.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, snapshot });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: e.message });
  } finally { client.release(); }
});

// ═══════════════════════════════════════
// POST /withdrawals/:id/return — Return withdrawal to balance
// ═══════════════════════════════════════
router.post('/withdrawals/:id/return', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const wd = (await client.query('SELECT * FROM withdraw_requests WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!wd) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Не найден' }); }
    if (wd.status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Уже обработан' }); }

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [wd.user_id]);
    await client.query('UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2', [wd.amount, wd.user_id]);
    await client.query('UPDATE withdraw_requests SET status = $1, processed_at = NOW() WHERE id = $2', ['returned', wd.id]);
    await client.query("INSERT INTO transactions (user_id, type, amount, currency, description) VALUES ($1, 'deposit', $2, 'USDT', 'Возврат вывода')", [wd.user_id, wd.amount]);

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ success: false, error: e.message });
  } finally { client.release(); }
});

module.exports = router;
