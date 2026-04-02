/**
 * src/routes/news.js
 * Public news API routes
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// GET /api/news — list published news (newest first)
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const category = req.query.category;

    let query = 'SELECT id, title, content, category, created_at FROM news WHERE is_published = TRUE';
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += ' ORDER BY created_at DESC';
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const { rows } = await pool.query(query, params);

    const countQuery = category
      ? 'SELECT COUNT(*) FROM news WHERE is_published = TRUE AND category = $1'
      : 'SELECT COUNT(*) FROM news WHERE is_published = TRUE';
    const countParams = category ? [category] : [];
    const total = parseInt((await pool.query(countQuery, countParams)).rows[0].count);

    res.json({ success: true, news: rows, total });
  } catch (e) {
    console.error('News list error:', e);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

// GET /api/news/:id — single news item
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, content, category, created_at FROM news WHERE id = $1 AND is_published = TRUE',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Новость не найдена' });
    res.json({ success: true, item: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

module.exports = router;
