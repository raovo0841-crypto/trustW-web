/**
 * src/routes/reviews.js
 * User reviews — web version (JWT auth)
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authMiddleware } = require('../middlewares/auth');

/**
 * GET /api/reviews
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = await pool.query(
      `SELECT r.id, r.author_name, r.rating, r.text, r.created_at
       FROM reviews r ORDER BY r.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Reviews error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

/**
 * POST /api/reviews
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { rating, text } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Рейтинг от 1 до 5' });
    }
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: 'Отзыв минимум 10 символов' });
    }

    const userResult = await pool.query(
      'SELECT id, first_name, last_name, verified FROM users WHERE id = $1',
      [req.user.id]
    );
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'Пользователь не найден' });

    const user = userResult.rows[0];
    if (!user.verified) {
      return res.status(403).json({ error: 'Только верифицированные пользователи могут оставлять отзывы' });
    }

    const authorName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Пользователь';

    await pool.query(
      `INSERT INTO reviews (user_id, author_name, rating, text, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [user.id, authorName, rating, text.trim()]
    );

    res.json({ success: true, message: 'Отзыв добавлен' });
  } catch (error) {
    console.error('❌ Review create error:', error.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
