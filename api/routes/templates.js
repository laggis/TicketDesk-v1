const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../../db/pool');

const router = express.Router();

// GET /api/templates — all templates (used by the panel and bot autocomplete)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { category, search } = req.query;
    let where = [];
    let params = [];
    if (category) { where.push('category = ?'); params.push(category); }
    if (search)   { where.push('(title LIKE ? OR content LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await db(`SELECT * FROM reply_templates ${whereStr} ORDER BY category, title`, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/templates — create a new template
router.post('/', authenticateToken, async (req, res) => {
  const { title, content, category = 'general', shortcut = null, enabled = 1 } = req.body;
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: 'title and content required' });
  try {
    const result = await db(
      'INSERT INTO reply_templates (title, content, category, shortcut, enabled, created_by_id, created_by_tag) VALUES (?,?,?,?,?,?,?)',
      [
        title.trim(),
        content.trim(),
        (category || 'general').trim() || 'general',
        shortcut?.trim() ? shortcut.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : null,
        enabled ? 1 : 0,
        req.user?.discord_id || null,
        req.user?.discord_tag || req.user?.username || null,
      ]
    );
    const [row] = await db('SELECT * FROM reply_templates WHERE id = ?', [result.insertId]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/templates/:id — update a template
router.put('/:id', authenticateToken, async (req, res) => {
  const { title, content, category, shortcut, enabled } = req.body;
  const updates = [];
  const vals = [];
  if (title    !== undefined) { updates.push('title=?');    vals.push(title.trim()); }
  if (content  !== undefined) { updates.push('content=?');  vals.push(content.trim()); }
  if (category !== undefined) { updates.push('category=?'); vals.push((category || 'general').trim() || 'general'); }
  if (shortcut !== undefined) { updates.push('shortcut=?'); vals.push(shortcut?.trim() ? shortcut.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : null); }
  if (enabled  !== undefined) { updates.push('enabled=?');  vals.push(enabled ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  vals.push(req.params.id);
  try {
    await db('UPDATE reply_templates SET ' + updates.join(', ') + ' WHERE id=?', vals);
    const [row] = await db('SELECT * FROM reply_templates WHERE id=?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Template not found' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/templates/:id — delete a template
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await db('DELETE FROM reply_templates WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
