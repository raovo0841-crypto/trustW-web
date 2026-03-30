/**
 * index.js — Entry point for TrustEx Web
 */
require('dotenv').config();
const app = require('./src/app');
const pool = require('./src/config/database');
const { startTradeCloser, stopTradeCloser } = require('./src/services/tradeCloser');
const { initAdminBot, stopAdminBot } = require('./src/admin-bot');

const PORT = process.env.PORT || 3001;

async function initDatabase() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ Database connected at', res.rows[0].now);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        balance_usdt NUMERIC(18,8) DEFAULT 0,
        balance_btc NUMERIC(18,8) DEFAULT 0,
        balance_rub NUMERIC(18,8) DEFAULT 0,
        balance_eur NUMERIC(18,8) DEFAULT 0,
        balance_eth NUMERIC(18,8) DEFAULT 0,
        balance_ton NUMERIC(18,8) DEFAULT 0,
        balance_byn NUMERIC(18,8) DEFAULT 0,
        verified BOOLEAN DEFAULT FALSE,
        status VARCHAR(20) DEFAULT 'active',
        is_admin BOOLEAN DEFAULT FALSE,
        is_blocked BOOLEAN DEFAULT FALSE,
        is_deleted BOOLEAN DEFAULT FALSE,
        deleted_at TIMESTAMP DEFAULT NULL,
        trade_mode VARCHAR(10) DEFAULT 'loss',
        profit_multiplier NUMERIC(5,4) DEFAULT 0.0150,
        trading_blocked BOOLEAN DEFAULT FALSE,
        needs_verification BOOLEAN DEFAULT FALSE,
        verification_pending BOOLEAN DEFAULT FALSE,
        verification_data JSONB DEFAULT NULL,
        verification_rejected BOOLEAN DEFAULT FALSE,
        bank_verif_amount NUMERIC(18,2) DEFAULT NULL,
        agreement_accepted_at TIMESTAMP DEFAULT NULL,
        show_agreement_to_user BOOLEAN DEFAULT FALSE,
        min_deposit NUMERIC(18,2) DEFAULT 0,
        min_withdraw NUMERIC(18,2) DEFAULT 0,
        security_pin VARCHAR(256) DEFAULT NULL,
        security_enabled BOOLEAN DEFAULT FALSE,
        biometric_enabled BOOLEAN DEFAULT FALSE,
        biometric_credential_id TEXT DEFAULT NULL,
        biometric_public_key TEXT DEFAULT NULL,
        last_security_auth TIMESTAMP DEFAULT NULL,
        notifications_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(18,8) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        duration INTEGER NOT NULL,
        symbol VARCHAR(20) DEFAULT 'BTC',
        trade_mode VARCHAR(10) DEFAULT 'loss',
        profit NUMERIC(18,8) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        result VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        closed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL,
        amount NUMERIC(18,8) NOT NULL,
        currency VARCHAR(10) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS deposit_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(18,8) NOT NULL,
        currency VARCHAR(10) DEFAULT 'USDT',
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        approved_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS withdraw_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(18,8) NOT NULL,
        wallet TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS platform_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS support_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender VARCHAR(10) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        edited_at TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        author_name VARCHAR(255) NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS email_verifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        code VARCHAR(6) NOT NULL,
        attempts INTEGER DEFAULT 0,
        expires_at TIMESTAMP NOT NULL,
        verified_at TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_email_verifications_code ON email_verifications(email, code);
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_status_expires ON orders(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

      -- Default settings
      INSERT INTO platform_settings (key, value) VALUES ('rub_usdt_rate', '83.33') ON CONFLICT (key) DO NOTHING;
      INSERT INTO platform_settings (key, value) VALUES ('eur_usdt_rate', '0.92') ON CONFLICT (key) DO NOTHING;
      INSERT INTO platform_settings (key, value) VALUES ('byn_usdt_rate', '3.27') ON CONFLICT (key) DO NOTHING;
    `);

    console.log('✅ Migrations applied');
  } catch (err) {
    console.error('⚠️ Database error:', err.message);
  }
}

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 TrustEx Web running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}\n`);

  await initDatabase();
  startTradeCloser(5000);
  initAdminBot();
});

function shutdown() {
  console.log('\n⏹️ Shutting down...');
  stopAdminBot();
  stopTradeCloser();
  pool.end(() => {
    console.log('✅ Database pool closed');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
