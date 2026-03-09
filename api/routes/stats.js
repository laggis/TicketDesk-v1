const express = require('express');
const router  = express.Router();
const pool    = require('../../db/pool');
const { authenticateToken } = require('../middleware/auth');

// GET /api/stats
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const [[overview]] = await pool.query(`
      SELECT
        COUNT(*)                                              AS total_all_time,
        SUM(status = 'open' OR status = 'Öppen')                                 AS total_open,
        SUM(status = 'closed' OR status = 'Stängd')                               AS total_closed,
        SUM((status = 'open' OR status = 'Öppen') AND priority = 'urgent')         AS open_urgent,
        SUM(DATE(opened_at) = CURDATE())                     AS opened_today,
        SUM(DATE(closed_at) = CURDATE())                     AS closed_today,
        ROUND(AVG(CASE WHEN closed_at IS NOT NULL
          THEN TIMESTAMPDIFF(HOUR, opened_at, closed_at) END), 1) AS avg_close_hours,
        ROUND(AVG(rating), 2)                                AS avg_rating,
        ROUND(AVG(CASE WHEN first_response_at IS NOT NULL
          THEN TIMESTAMPDIFF(MINUTE, opened_at, first_response_at) END), 0) AS avg_first_response_minutes
      FROM tickets
    `);

    const [by_category] = await pool.query(`
      SELECT category, COUNT(*) AS count FROM tickets GROUP BY category
    `);

    const [by_status] = await pool.query(`
      SELECT status, COUNT(*) AS count FROM tickets GROUP BY status
    `);

    const [top_staff] = await pool.query(`
      SELECT claimed_by_tag AS staff_tag, COUNT(*) AS tickets_closed
      FROM tickets WHERE (status = 'closed' OR status = 'Stängd') AND claimed_by IS NOT NULL
      GROUP BY claimed_by ORDER BY tickets_closed DESC LIMIT 5
    `);

    res.json({ overview, by_category, by_status, top_staff });
  } catch (err) { next(err); }
});

// GET /api/stats/daily?days=30
router.get('/daily', authenticateToken, async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days || '14'), 90);
    const [data] = await pool.query(`
      SELECT DATE(opened_at) AS date, COUNT(*) AS opened
      FROM tickets
      WHERE opened_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE(opened_at)
      ORDER BY date ASC
    `, [days]);
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/stats/staff
router.get('/staff', authenticateToken, async (req, res, next) => {
  try {
    const [data] = await pool.query(`
      SELECT
        claimed_by AS staff_id,
        claimed_by_tag AS staff_tag,
        COUNT(*) AS tickets_claimed,
        SUM(status = 'closed' OR status = 'Stängd') AS tickets_closed,
        ROUND(AVG(rating), 2) AS avg_rating,
        MAX(closed_at) AS last_action
      FROM tickets
      WHERE claimed_by IS NOT NULL
      GROUP BY claimed_by
      ORDER BY tickets_closed DESC
    `);
    res.json({ data });
  } catch (err) { next(err); }
});

module.exports = router;
