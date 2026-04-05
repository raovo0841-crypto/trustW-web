/**
 * src/app.js
 * Express application — web version (no Telegram)
 */
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const exchangeRoutes = require('./routes/exchange');
const userRoutes = require('./routes/user');
const tradesRoutes = require('./routes/trades');
const reviewsRoutes = require('./routes/reviews');
const securityRoutes = require('./routes/security');
const adminRoutes = require('./routes/admin');
const newsRoutes = require('./routes/news');
const cryptoPayRoutes = require('./routes/cryptoPay');

const app = express();

// Gzip
app.use(compression({ level: 6, threshold: 1024 }));

// CORS
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));

// CryptoPay webhook needs raw body for signature verification — mount BEFORE express.json()
app.post('/api/crypto-pay/webhook', express.raw({ type: '*/*' }), cryptoPayRoutes);

app.use(express.json());

// CryptoPay invoice creation (JSON parsed)
app.use('/api/crypto-pay', cryptoPayRoutes);

// Static files
app.use(express.static(path.join(__dirname, '../public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (filePath.match(/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }
  }
}));

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/exchange', exchangeRoutes);
app.use('/api/profile', userRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/news', newsRoutes);

// SPA catch-all — serve index.html for non-API routes
app.get('/{*splat}', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('❌ Error:', { message: err.message, status, path: req.path, method: req.method });
  }
  res.status(status).json({ error: err.message || 'Ошибка сервера' });
});

module.exports = app;
