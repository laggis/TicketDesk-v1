const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const db = require('../../db/pool');

const router = express.Router();

// GET /api/faq — all enabled FAQs (used by bot AI)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const rows = await db('SELECT * FROM ai_faq ORDER BY category, title');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/faq — create FAQ entry (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { title, content, category = 'general', enabled = 1 } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'title and content required' });
  try {
    const result = await db(
      'INSERT INTO ai_faq (title, content, category, enabled) VALUES (?, ?, ?, ?)',
      [title.trim(), content.trim(), category.trim() || 'general', enabled ? 1 : 0]
    );
    const [row] = await db('SELECT * FROM ai_faq WHERE id = ?', [result.insertId]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/faq/:id — update FAQ entry (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { title, content, category, enabled } = req.body;
  const updates = [];
  const vals = [];
  if (title     !== undefined) { updates.push('title=?');    vals.push(title.trim()); }
  if (content   !== undefined) { updates.push('content=?');  vals.push(content.trim()); }
  if (category  !== undefined) { updates.push('category=?'); vals.push(category.trim()); }
  if (enabled   !== undefined) { updates.push('enabled=?');  vals.push(enabled ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  vals.push(req.params.id);
  try {
    await db('UPDATE ai_faq SET ' + updates.join(', ') + ' WHERE id=?', vals);
    const [row] = await db('SELECT * FROM ai_faq WHERE id=?', [req.params.id]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/faq/:id — delete FAQ entry (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await db('DELETE FROM ai_faq WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
