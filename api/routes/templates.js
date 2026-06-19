const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../../db/pool');

const router = express.Router();

function cleanShortcut(shortcut) {
  const s = String(shortcut || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return s || null;
}

function normalizeRow(row) {
  const label = row.label || row.title || row.shortcut || `Template #${row.id}`;
  const text  = row.text  || row.content || '';
  return {
    ...row,
    label,
    text,
    title: row.title || label,
    content: row.content || text,
    enabled: row.enabled === undefined ? 1 : row.enabled,
  };
}

const selectTemplates = `
  SELECT
    id,
    COALESCE(NULLIF(label,''), NULLIF(title,''), shortcut, CONCAT('Template #', id)) AS label,
    COALESCE(NULLIF(text,''), NULLIF(content,''), '') AS text,
    title,
    content,
    category,
    shortcut,
    sort_order,
    enabled,
    created_by_id,
    created_by_tag,
    created_at,
    updated_at
  FROM reply_templates
`;

// GET /api/templates — all templates used by panel + /template autocomplete
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { category, search, enabled } = req.query;
    const where = [];
    const params = [];

    if (category) { where.push('category = ?'); params.push(category); }
    if (enabled !== undefined) { where.push('enabled = ?'); params.push(enabled === '0' ? 0 : 1); }
    if (search) {
      where.push('(label LIKE ? OR title LIKE ? OR text LIKE ? OR content LIKE ? OR shortcut LIKE ?)');
      const q = `%${search}%`;
      params.push(q, q, q, q, q);
    }

    const rows = await db(`${selectTemplates} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort_order ASC, category ASC, label ASC`, params);
    res.json(rows.map(normalizeRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/templates — create a new template
router.post('/', authenticateToken, async (req, res) => {
  const label = (req.body.label ?? req.body.title ?? '').toString().trim();
  const text  = (req.body.text  ?? req.body.content ?? '').toString().trim();
  const category = (req.body.category || 'General').toString().trim() || 'General';
  const shortcut = cleanShortcut(req.body.shortcut);
  const enabled  = req.body.enabled === undefined ? 1 : (req.body.enabled ? 1 : 0);
  const sortOrder = Number.isFinite(parseInt(req.body.sort_order)) ? parseInt(req.body.sort_order) : 0;

  if (!label || !text) return res.status(400).json({ error: 'label and text are required' });

  try {
    const result = await db(
      `INSERT INTO reply_templates
        (label, text, title, content, category, shortcut, sort_order, enabled, created_by_id, created_by_tag)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        label,
        text,
        label,
        text,
        category,
        shortcut,
        sortOrder,
        enabled,
        req.user?.discord_id || req.user?.id?.toString() || null,
        req.user?.discord_tag || req.user?.username || null,
      ]
    );
    const rows = await db(`${selectTemplates} WHERE id = ?`, [result.insertId]);
    res.json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT/PATCH /api/templates/:id — update a template
async function updateTemplate(req, res) {
  const updates = [];
  const vals = [];

  const hasLabel = req.body.label !== undefined || req.body.title !== undefined;
  const hasText  = req.body.text  !== undefined || req.body.content !== undefined;

  if (hasLabel) {
    const label = (req.body.label ?? req.body.title ?? '').toString().trim();
    if (!label) return res.status(400).json({ error: 'label cannot be empty' });
    updates.push('label=?', 'title=?'); vals.push(label, label);
  }
  if (hasText) {
    const text = (req.body.text ?? req.body.content ?? '').toString().trim();
    if (!text) return res.status(400).json({ error: 'text cannot be empty' });
    updates.push('text=?', 'content=?'); vals.push(text, text);
  }
  if (req.body.category !== undefined) { updates.push('category=?'); vals.push((req.body.category || 'General').toString().trim() || 'General'); }
  if (req.body.shortcut !== undefined) { updates.push('shortcut=?'); vals.push(cleanShortcut(req.body.shortcut)); }
  if (req.body.sort_order !== undefined) { updates.push('sort_order=?'); vals.push(parseInt(req.body.sort_order) || 0); }
  if (req.body.enabled !== undefined) { updates.push('enabled=?'); vals.push(req.body.enabled ? 1 : 0); }

  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  updates.push('updated_at=NOW()');
  vals.push(req.params.id);

  try {
    await db(`UPDATE reply_templates SET ${updates.join(', ')} WHERE id=?`, vals);
    const rows = await db(`${selectTemplates} WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json(normalizeRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.put('/:id', authenticateToken, updateTemplate);
router.patch('/:id', authenticateToken, updateTemplate);

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
