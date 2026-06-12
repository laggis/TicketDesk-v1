const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const db = require('../../db/pool');

const router = express.Router();

// GET /api/ai-channels
router.get('/', authenticateToken, async (req, res) => {
  try {
    const rows = await db('SELECT * FROM ai_channels ORDER BY channel_name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/ai-channels
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  const { channel_id, channel_name } = req.body;
  if (!channel_id?.trim()) return res.status(400).json({ error: 'channel_id required' });
  try {
    await db(
      'INSERT INTO ai_channels (channel_id, channel_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE channel_name=VALUES(channel_name), enabled=1',
      [channel_id.trim(), (channel_name || 'unknown').trim()]
    );
    const [row] = await db('SELECT * FROM ai_channels WHERE channel_id=?', [channel_id.trim()]);
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/ai-channels/:id
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { enabled } = req.body;
  try {
    await db('UPDATE ai_channels SET enabled=? WHERE id=?', [enabled ? 1 : 0, req.params.id]);
    const [row] = await db('SELECT * FROM ai_channels WHERE id=?', [req.params.id]);
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/ai-channels/:id
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await db('DELETE FROM ai_channels WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
