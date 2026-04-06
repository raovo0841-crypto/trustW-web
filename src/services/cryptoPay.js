/**
 * src/services/cryptoPay.js
 * Crypto Bot (Crypto Pay) API integration
 * Docs: https://help.crypt.bot/crypto-pay-api
 */
const crypto = require('crypto');

const API_TOKEN = process.env.CRYPTO_PAY_TOKEN || process.env.CRYPTOBOT_TOKEN || '';
const API_BASE = 'https://pay.crypt.bot/api';

async function apiCall(method, params = {}) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) query.append(k, String(v));
  }
  const url = `${API_BASE}/${method}?${query.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Crypto-Pay-API-Token': API_TOKEN
    }
  });
  const data = await res.json();
  if (!data.ok) {
    const errMsg = data.error?.message || data.error?.name || JSON.stringify(data.error) || `CryptoPay API error: ${method}`;
    throw new Error(errMsg);
  }
  return data.result;
}

/**
 * Create an invoice for the user to pay
 * @param {Object} opts
 * @param {string} opts.asset - USDT, BTC, ETH, TON
 * @param {string} opts.amount - Amount to pay
 * @param {string} opts.description - Invoice description
 * @param {string} opts.payload - Custom payload (JSON string with user_id, etc.)
 * @returns {Object} invoice - { invoice_id, bot_invoice_url, ... }
 */
async function createInvoice({ asset, amount, description, payload }) {
  return apiCall('createInvoice', {
    currency_type: 'crypto',
    asset,
    amount: String(amount),
    description,
    payload,
    expires_in: 3600 // 1 hour
  });
}

/**
 * Get available currencies/assets
 */
async function getCurrencies() {
  return apiCall('getCurrencies');
}

/**
 * Verify webhook signature from Crypto Pay
 * @param {string} rawBody - Raw request body as string
 * @param {string} signature - Value of crypto-pay-api-signature header
 * @returns {boolean}
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!API_TOKEN || !signature) return false;
  const secret = crypto.createHash('sha256').update(API_TOKEN).digest();
  const checkString = rawBody;
  const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  return hmac === signature;
}

module.exports = {
  createInvoice,
  getCurrencies,
  verifyWebhookSignature
};
