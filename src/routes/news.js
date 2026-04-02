/**
 * src/routes/news.js
 * Crypto news feed — auto-fetched from RSS (CoinTelegraph, CoinDesk)
 */
const express = require('express');
const router = express.Router();
const { fetchCryptoNews } = require('../services/newsService');

// GET /api/news — list crypto news (auto-fetched)
router.get('/', async (req, res) => {
  try {
    const articles = await fetchCryptoNews();
    const category = (req.query.category || '').trim();

    let filtered = articles;
    if (category) {
      const cat = category.toLowerCase();
      filtered = articles.filter(a =>
        a.categories.some(c => c.toLowerCase().includes(cat)) ||
        a.title.toLowerCase().includes(cat)
      );
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    res.json({
      success: true,
      news: filtered.slice(offset, offset + limit),
      total: filtered.length
    });
  } catch (e) {
    console.error('News route error:', e);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

module.exports = router;
