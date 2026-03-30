/**
 * src/routes/exchange.js
 * Currency exchange — supports 7 currencies, uses JWT auth
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authMiddleware } = require('../middlewares/auth');

const CURRENCIES = ['USDT', 'BTC', 'ETH', 'TON', 'RUB', 'EUR', 'BYN'];
const BALANCE_FIELD = {
  USDT: 'balance_usdt', BTC: 'balance_btc', ETH: 'balance_eth',
  TON: 'balance_ton', RUB: 'balance_rub', EUR: 'balance_eur', BYN: 'balance_byn'
};

const DEFAULT_RUB_PER_USDT = 1 / 0.012;
const DEFAULT_EUR_PER_USDT = 1 / 1.089;
const DEFAULT_BYN_PER_USDT = 3.27;
const DEFAULT_CRYPTO_RATES = { BTC: 84000, ETH: 3200, TON: 3.5 };

let cachedCryptoRates = null;
let cachedCryptoTime = 0;
const CRYPTO_CACHE_TTL = 60_000;
const CRYPTO_STALE_TTL = 60 * 60_000;

async function fetchCryptoPrices() {
  if (cachedCryptoRates && Date.now() - cachedCryptoTime < CRYPTO_CACHE_TTL) {
    return cachedCryptoRates;
  }

  const endpoints = [
    'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT","TONUSDT"]',
    'https://api1.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT","TONUSDT"]',
    'https://api2.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT","TONUSDT"]',
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json();
      const prices = {};
      for (const item of data) {
        if (item.symbol === 'BTCUSDT') prices.BTC = parseFloat(item.price);
        if (item.symbol === 'ETHUSDT') prices.ETH = parseFloat(item.price);
        if (item.symbol === 'TONUSDT') prices.TON = parseFloat(item.price);
      }
      if (prices.BTC && prices.ETH && prices.TON) {
        cachedCryptoRates = prices;
        cachedCryptoTime = Date.now();
        return prices;
      }
    } catch (e) { /* next */ }
  }

  // CoinGecko fallback
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,the-open-network&vs_currencies=usd',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const data = await res.json();
    const prices = {};
    if (data.bitcoin?.usd) prices.BTC = data.bitcoin.usd;
    if (data.ethereum?.usd) prices.ETH = data.ethereum.usd;
    if (data['the-open-network']?.usd) prices.TON = data['the-open-network'].usd;
    if (prices.BTC && prices.ETH && prices.TON) {
      cachedCryptoRates = prices;
      cachedCryptoTime = Date.now();
      return prices;
    }
  } catch (e) { /* next */ }

  if (cachedCryptoRates && Date.now() - cachedCryptoTime < CRYPTO_STALE_TTL) {
    return cachedCryptoRates;
  }

  cachedCryptoRates = { ...DEFAULT_CRYPTO_RATES };
  cachedCryptoTime = Date.now();
  return cachedCryptoRates;
}

async function getFiatRates(client) {
  const rates = { USDT: 1 };
  try {
    const q = client || pool;
    const result = await q.query(
      "SELECT key, value FROM platform_settings WHERE key IN ('rub_usdt_rate', 'eur_usdt_rate', 'byn_usdt_rate')"
    );
    const dbRates = {};
    result.rows.forEach(r => { dbRates[r.key] = parseFloat(r.value); });
    rates.RUB = 1 / (dbRates.rub_usdt_rate || DEFAULT_RUB_PER_USDT);
    rates.EUR = 1 / (dbRates.eur_usdt_rate || DEFAULT_EUR_PER_USDT);
    rates.BYN = 1 / (dbRates.byn_usdt_rate || DEFAULT_BYN_PER_USDT);
  } catch (e) {
    rates.RUB = 0.012;
    rates.EUR = 1.089;
    rates.BYN = 1 / 3.27;
  }
  return rates;
}

async function getAllRatesInUsdt(client) {
  const rates = await getFiatRates(client);
  const crypto = await fetchCryptoPrices();
  if (crypto) {
    rates.BTC = crypto.BTC;
    rates.ETH = crypto.ETH;
    rates.TON = crypto.TON;
  }
  return rates;
}

/**
 * POST /api/exchange — authenticated exchange
 */
router.post('/', authMiddleware, async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const client = await pool.connect();
  try {
    const amount = parseFloat(req.body.amount);
    let from = (req.body.from || '').toUpperCase();
    let to = (req.body.to || '').toUpperCase();

    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Некорректная сумма' });
    if (!CURRENCIES.includes(from) || !CURRENCIES.includes(to) || from === to) {
      return res.status(400).json({ error: 'Некорректная валютная пара' });
    }

    await client.query('BEGIN');
    const rates = await getAllRatesInUsdt(client);

    const userResult = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = userResult.rows[0];
    const fromBalance = parseFloat(user[BALANCE_FIELD[from]]) || 0;

    if (amount > fromBalance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Недостаточно ${from}` });
    }

    const fromInUsdt = amount * rates[from];
    if (!rates[to] || !Number.isFinite(fromInUsdt) || fromInUsdt <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Курс недоступен, попробуйте позже' });
    }
    const exchangedAmount = fromInUsdt / rates[to];

    const fromField = BALANCE_FIELD[from];
    const toField = BALANCE_FIELD[to];

    const updateResult = await client.query(
      `UPDATE users SET ${fromField} = ${fromField} - $1, ${toField} = ${toField} + $2, updated_at = NOW()
       WHERE id = $3
       RETURNING balance_rub, balance_eur, balance_usdt, balance_btc, balance_eth, balance_ton, balance_byn`,
      [amount, exchangedAmount, user.id]
    );

    const nb = updateResult.rows[0];
    const desc = `Обмен ${amount.toFixed(from === 'BTC' || from === 'ETH' ? 8 : 2)} ${from} → ${exchangedAmount.toFixed(to === 'BTC' || to === 'ETH' ? 8 : to === 'TON' ? 4 : 2)} ${to}`;

    await client.query(
      `INSERT INTO transactions (user_id, amount, currency, type, description, created_at) VALUES ($1, $2, $3, 'exchange', $4, NOW())`,
      [user.id, amount, from, desc]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Обмен выполнен!',
      data: {
        from, to,
        fromAmount: amount,
        toAmount: exchangedAmount,
        newBalances: {
          rub: parseFloat(nb.balance_rub) || 0,
          eur: parseFloat(nb.balance_eur) || 0,
          usdt: parseFloat(nb.balance_usdt) || 0,
          btc: parseFloat(nb.balance_btc) || 0,
          eth: parseFloat(nb.balance_eth) || 0,
          ton: parseFloat(nb.balance_ton) || 0,
          byn: parseFloat(nb.balance_byn) || 0
        }
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Exchange error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/exchange/history
 */
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const result = await pool.query(
      `SELECT amount, currency, description, created_at
       FROM transactions WHERE user_id = $1 AND type = 'exchange'
       ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Exchange history error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * GET /api/exchange/rate — public
 */
router.get('/rate', async (req, res) => {
  const rates = await getAllRatesInUsdt(null);
  res.json({
    success: true,
    data: {
      rates,
      rub_to_usdt: rates.RUB,
      eur_to_usdt: rates.EUR,
      byn_to_usdt: rates.BYN
    }
  });
});

module.exports = router;
