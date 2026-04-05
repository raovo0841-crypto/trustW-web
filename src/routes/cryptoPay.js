/**
 * src/routes/cryptoPay.js
 * Crypto Pay invoice creation + webhook for auto-crediting
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const authMiddleware = require('../middlewares/auth');
const { createInvoice, verifyWebhookSignature } = require('../services/cryptoPay');

// Supported crypto assets via Crypto Pay
const SUPPORTED_ASSETS = ['USDT', 'BTC', 'ETH', 'TON'];

/**
 * POST /api/crypto-pay/create-invoice
 * User creates an invoice to pay via Crypto Bot
 */
router.post('/create-invoice', authMiddleware, async (req, res) => {
  try {
    const { asset, amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!asset || !SUPPORTED_ASSETS.includes(asset.toUpperCase())) {
      return res.status(400).json({ error: 'Неподдерживаемая валюта. Доступны: ' + SUPPORTED_ASSETS.join(', ') });
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Некорректная сумма' });
    }

    const upperAsset = asset.toUpperCase();

    // Create invoice via Crypto Pay API
    const payload = JSON.stringify({ user_id: req.user.id, asset: upperAsset });
    const invoice = await createInvoice({
      asset: upperAsset,
      amount: parsedAmount,
      description: `Пополнение TrustEx — ${parsedAmount} ${upperAsset}`,
      payload
    });

    // Save invoice to DB
    await pool.query(
      `INSERT INTO crypto_pay_invoices (invoice_id, user_id, asset, amount, status, bot_invoice_url, created_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
      [String(invoice.invoice_id), req.user.id, upperAsset, parsedAmount, invoice.bot_invoice_url]
    );

    res.json({
      success: true,
      invoice_url: invoice.bot_invoice_url,
      invoice_id: invoice.invoice_id
    });
  } catch (error) {
    console.error('❌ CryptoPay create invoice error:', error.message);
    res.status(500).json({ error: 'Ошибка создания счёта: ' + error.message });
  }
});

/**
 * POST /api/crypto-pay/webhook
 * Callback from Crypto Pay when invoice is paid
 * Auto-credits user balance
 * Note: raw body parsing is handled at app.js level for this route
 */
router.post('/webhook', async (req, res) => {
  const client = await pool.connect();
  try {
    const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf8');
    const signature = req.headers['crypto-pay-api-signature'];

    if (!verifyWebhookSignature(rawBody, signature)) {
      console.error('❌ CryptoPay webhook: invalid signature');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const data = JSON.parse(rawBody);

    if (data.update_type !== 'invoice_paid') {
      return res.json({ ok: true });
    }

    const invoice = data.payload;
    const invoiceId = String(invoice.invoice_id);
    const paidAsset = (invoice.asset || '').toUpperCase();
    const paidAmount = parseFloat(invoice.amount);

    // Parse custom payload
    let customPayload;
    try {
      customPayload = JSON.parse(invoice.payload || '{}');
    } catch (_) {
      customPayload = {};
    }

    const userId = customPayload.user_id;
    if (!userId) {
      console.error('❌ CryptoPay webhook: no user_id in payload');
      return res.status(400).json({ error: 'No user_id' });
    }

    await client.query('BEGIN');

    // Check if already processed
    const existing = await client.query(
      'SELECT id, status FROM crypto_pay_invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (existing.rows.length && existing.rows[0].status === 'paid') {
      await client.query('ROLLBACK');
      return res.json({ ok: true }); // Already processed
    }

    // Determine balance field
    const fieldMap = {
      USDT: 'balance_usdt', BTC: 'balance_btc', ETH: 'balance_eth', TON: 'balance_ton'
    };
    const balanceField = fieldMap[paidAsset];
    if (!balanceField) {
      await client.query('ROLLBACK');
      console.error('❌ CryptoPay webhook: unknown asset', paidAsset);
      return res.status(400).json({ error: 'Unknown asset' });
    }

    // Lock user and credit balance
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    await client.query(
      `UPDATE users SET ${balanceField} = ${balanceField} + $1, updated_at = NOW() WHERE id = $2`,
      [paidAmount, userId]
    );

    // Mark invoice paid
    if (existing.rows.length) {
      await client.query(
        'UPDATE crypto_pay_invoices SET status = $1, paid_at = NOW() WHERE invoice_id = $2',
        ['paid', invoiceId]
      );
    } else {
      await client.query(
        `INSERT INTO crypto_pay_invoices (invoice_id, user_id, asset, amount, status, paid_at, created_at)
         VALUES ($1, $2, $3, $4, 'paid', NOW(), NOW())`,
        [invoiceId, userId, paidAsset, paidAmount]
      );
    }

    // Transaction record
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, currency, description, created_at)
       VALUES ($1, 'deposit', $2, $3, $4, NOW())`,
      [userId, paidAmount, paidAsset, `Пополнение через Crypto Bot — ${paidAmount} ${paidAsset}`]
    );

    await client.query('COMMIT');
    console.log(`✅ CryptoPay: credited ${paidAmount} ${paidAsset} to user ${userId}`);
    res.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ CryptoPay webhook error:', error.message);
    res.status(500).json({ error: 'Internal error' });
  } finally {
    client.release();
  }
});

module.exports = router;
