const express = require('express');
const router  = express.Router();
const db      = require('../../db/pool');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/categories — public
router.get('/', async (req, res, next) => {
  try {
    const rows = await db('SELECT * FROM ticket_categories ORDER BY sort_order ASC, id ASC');
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/categories — admin: create (optionally auto-create Discord channel category)
router.post('/', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { name, emoji = '🎫', description = '', discord_category_id = null, color = '#6366f1', sort_order = 0, auto_create_discord = false, ai_enabled = 1 } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

    let catId = discord_category_id || null;

    // Auto-create Discord category if requested
    if (auto_create_discord) {
      try {
        const { client } = require('../../bot/bot');
        const guildId = process.env.GUILD_ID;
        const guild   = guildId ? await client.guilds.fetch(guildId).catch(() => null) : client.guilds.cache.first();
        if (guild) {
          const { ChannelType, PermissionsBitField } = require('discord.js');
          const discordCat = await guild.channels.create({
            name:   emoji + ' ' + name,
            type:   ChannelType.GuildCategory,
            permissionOverwrites: [
              { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            ],
          });
          catId = discordCat.id;
          console.log('[Categories] Created Discord category: ' + discordCat.name + ' (' + catId + ')');
        }
      } catch (err) {
        console.error('[Categories] Auto-create Discord failed:', err.message);
        return res.status(500).json({ error: 'Failed to create Discord category: ' + err.message });
      }
    }

    const [result] = await db.pool.execute(
      'INSERT INTO ticket_categories (name, emoji, description, discord_category_id, color, sort_order, ai_enabled) VALUES (?,?,?,?,?,?,?)',
      [name.trim(), emoji, description, catId, color, sort_order, ai_enabled ? 1 : 0]
    );

    // Refresh panel embed automatically
    try {
      const { postOrRefreshPanel } = require('../../bot/bot');
      await postOrRefreshPanel(null);
    } catch {}

    res.json({ ok: true, id: result.insertId, discord_category_id: catId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Category name already exists' });
    next(err);
  }
});

// PATCH /api/categories/:id — admin: update
router.patch('/:id', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { name, emoji, description, discord_category_id, color, sort_order, enabled, ai_enabled } = req.body;
    const fields = [], vals = [];
    if (name               !== undefined) { fields.push('name=?');                vals.push(name); }
    if (emoji              !== undefined) { fields.push('emoji=?');               vals.push(emoji); }
    if (description        !== undefined) { fields.push('description=?');         vals.push(description); }
    if (discord_category_id !== undefined) { fields.push('discord_category_id=?'); vals.push(discord_category_id || null); }
    if (color              !== undefined) { fields.push('color=?');               vals.push(color); }
    if (sort_order         !== undefined) { fields.push('sort_order=?');          vals.push(sort_order); }
    if (enabled            !== undefined) { fields.push('enabled=?');             vals.push(enabled ? 1 : 0); }
    if (ai_enabled         !== undefined) { fields.push('ai_enabled=?');          vals.push(ai_enabled ? 1 : 0); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await db('UPDATE ticket_categories SET ' + fields.join(',') + ' WHERE id=?', vals);

    // Refresh panel
    try { const { postOrRefreshPanel } = require('../../bot/bot'); await postOrRefreshPanel(null); } catch {}

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// DELETE /api/categories/:id — admin
router.delete('/:id', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    await db('DELETE FROM ticket_categories WHERE id=?', [req.params.id]);
    try { const { postOrRefreshPanel } = require('../../bot/bot'); await postOrRefreshPanel(null); } catch {}
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
