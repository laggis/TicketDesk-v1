const express = require('express');
const router  = express.Router();
const pool    = require('../../db/pool');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function redact(s) {
  const str = String(s || '');
  return str
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b\d{3,4}[-.\s]?\d{2,3}[-.\s]?\d{2,3}[-.\s]?\d{2,3}\b/g, '[redacted-number]')
    .replace(/\b(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g, '[redacted-jwt]')
    .replace(/\b([a-zA-Z0-9_-]{24,})\b/g, m => (m.length >= 40 ? '[redacted-token]' : m));
}

async function audit(req, { action, ticketId = null, details = null } = {}) {
  try {
    await pool.query(
      'INSERT INTO admin_audit_logs (staff_id, staff_tag, action, ticket_id, ip, user_agent, details) VALUES (?,?,?,?,?,?,?)',
      [
        req.user?.discord_id || req.user?.id?.toString() || null,
        req.user?.discord_tag || req.user?.username || null,
        action || null,
        ticketId,
        req.headers['x-forwarded-for']?.toString()?.split(',')?.[0]?.trim() || req.ip,
        (req.headers['user-agent'] || '').toString().slice(0, 500),
        details ? JSON.stringify(details) : null,
      ]
    );
  } catch {}
}

// ─── GET /api/tickets ─────────────────────────────────────────────────────────
// Filterable, paginated ticket list
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const {
      status, category, priority, user_id, search,
      page = 1, limit = 20, sort = 'opened_at', order = 'DESC',
      date_from, date_to,
    } = req.query;

    const allowed_sorts  = ['opened_at','closed_at','ticket_number','priority','status','rating'];
    const allowed_orders = ['ASC','DESC'];
    const safeSort  = allowed_sorts.includes(sort) ? sort : 'opened_at';
    const safeOrder = allowed_orders.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';

    let where = [];
    let params = [];

    if (status) {
      // Map English panel values to Swedish bot values and vice versa
      const statusMap = { 'open': 'Öppen', 'closed': 'Stängd', 'archived': 'Arkiverad' };
      const statusAlt = { 'Öppen': 'open', 'Stängd': 'closed', 'Arkiverad': 'archived' };
      const mapped = statusMap[status] || statusAlt[status] || status;
      where.push('(t.status = ? OR t.status = ?)');
      params.push(status, mapped);
    }
    if (category)  { where.push('t.category = ?'); params.push(category); }
    if (priority)  { where.push('t.priority = ?'); params.push(priority); }
    if (user_id)   { where.push('t.user_id = ?');  params.push(user_id); }
    if (date_from) { where.push('t.opened_at >= ?'); params.push(date_from); }
    if (date_to)   { where.push('t.opened_at <= ?'); params.push(date_to + ' 23:59:59'); }
    if (search) {
      where.push('(t.user_tag LIKE ? OR t.subject LIKE ? OR t.ticket_number LIKE ?)');
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset   = (parseInt(page) - 1) * parseInt(limit);

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM tickets t ${whereStr}`,
      params
    );

    const [tickets] = await pool.query(
      `SELECT t.* FROM tickets t ${whereStr} ORDER BY t.${safeSort} ${safeOrder} LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      data: tickets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) { next(err); }
});

// ─── GET /api/tickets/:id ──────────────────────────────────────────────────────
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const [[ticket]] = await pool.query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const [messages] = await pool.query(
      'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY sent_at ASC',
      [req.params.id]
    );
    const [logs] = await pool.query(
      'SELECT * FROM ticket_logs WHERE ticket_id = ? ORDER BY performed_at DESC',
      [req.params.id]
    );

    res.json({ ticket, messages, logs });
  } catch (err) { next(err); }
});

// ─── PATCH /api/tickets/:id ────────────────────────────────────────────────────
router.patch('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { status, priority, claimed_by, claimed_by_tag } = req.body;
    const fields = [];
    const vals   = [];

    if (status)       { fields.push('status = ?');       vals.push(status); }
    if (priority)     { fields.push('priority = ?');     vals.push(priority); }
    if (claimed_by)   { fields.push('claimed_by = ?');   vals.push(claimed_by); }
    if (claimed_by_tag){ fields.push('claimed_by_tag = ?'); vals.push(claimed_by_tag); }
    if (status === 'closed' || status === 'Stängd') { fields.push('closed_at = NOW()'); }

    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(req.params.id);
    await pool.query(`UPDATE tickets SET ${fields.join(', ')} WHERE id = ?`, vals);

    // Log it
    await pool.query(
      'INSERT INTO ticket_logs (ticket_id, staff_id, staff_tag, action, details) VALUES (?,?,?,?,?)',
      [req.params.id, req.user.discord_id, req.user.discord_tag, 'update', JSON.stringify(req.body)]
    );
    await audit(req, { action: 'ticket_update', ticketId: req.params.id, details: req.body });

    const [[ticket]] = await pool.query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    res.json(ticket);
  } catch (err) { next(err); }
});

// ─── POST /api/tickets/:id/close ──────────────────────────────────────────────
// Sets pending_close=1 so the bot picks it up and closes the Discord channel too
router.post('/:id/close', authenticateToken, async (req, res, next) => {
  try {
    const { reason } = req.body;

    // Mark as pending_close — bot will poll this and handle Discord side
    await pool.query(
      'UPDATE tickets SET pending_close = 1, close_reason = ?, close_requested_by = ? WHERE id = ?',
      [reason || null, req.user.discord_tag || req.user.username, req.params.id]
    );

    await pool.query(
      'INSERT INTO ticket_logs (ticket_id, staff_id, staff_tag, action, details) VALUES (?,?,?,?,?)',
      [req.params.id, req.user.discord_id || '0', req.user.discord_tag || req.user.username, 'close', reason || 'Closed via panel']
    ).catch(() => {});
    await audit(req, { action: 'ticket_close', ticketId: req.params.id, details: { reason } });

    res.json({ ok: true, message: 'Close request sent to bot' });
  } catch (err) { next(err); }
});

// ─── POST /api/tickets/:id/claim ──────────────────────────────────────────────
router.post('/:id/claim', authenticateToken, async (req, res, next) => {
  try {
    await pool.query(
      'UPDATE tickets SET claimed_by = ?, claimed_by_tag = ? WHERE id = ?',
      [req.user.discord_id, req.user.discord_tag, req.params.id]
    );
    await pool.query(
      'INSERT INTO ticket_logs (ticket_id, staff_id, staff_tag, action) VALUES (?,?,?,?)',
      [req.params.id, req.user.discord_id, req.user.discord_tag, 'claim']
    );
    await audit(req, { action: 'ticket_claim', ticketId: req.params.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── POST /api/tickets/:id/note ───────────────────────────────────────────────
router.post('/:id/note', authenticateToken, async (req, res, next) => {
  try {
    const { note } = req.body;
    if (!note) return res.status(400).json({ error: 'note required' });
    await pool.query(
      'INSERT INTO ticket_logs (ticket_id, staff_id, staff_tag, action, details) VALUES (?,?,?,?,?)',
      [req.params.id, req.user.discord_id, req.user.discord_tag, 'note', note]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── GET /api/tickets/:id/transcript ─────────────────────────────────────────
router.get('/:id/transcript', authenticateToken, rateLimit({ windowMs: 60_000, max: 120, message: 'Too many transcript requests' }), async (req, res, next) => {
  try {
    const [[ticket]]  = await pool.query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const [messages] = await pool.query(
      'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY sent_at ASC',
      [req.params.id]
    );
    const shouldRedact = req.query.redact === '1' || req.query.redact === 'true';

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Ticket #${ticket.ticket_number} Transcript</title>
<style>body{font-family:system-ui,sans-serif;background:#1a1a2e;color:#e0e0f0;padding:24px;max-width:700px;margin:0 auto}
h1{font-size:18px;border-bottom:1px solid #333;padding-bottom:12px}
.meta{font-size:12px;color:#888;margin-bottom:20px}
.msg{padding:10px 14px;margin:6px 0;border-radius:8px;font-size:13px}
.msg.staff{background:#1e3a5f;border-left:3px solid #5865f2}
.msg.user{background:#1e2d1e;border-left:3px solid #3ba55d}
.author{font-weight:700;font-size:11px;margin-bottom:4px}
.msg.staff .author{color:#5865f2}.msg.user .author{color:#3ba55d}
.time{font-size:10px;color:#666;margin-left:8px}
.att{display:block;max-width:100%;border-radius:8px;margin-top:8px;border:1px solid rgba(255,255,255,.08)}
a{color:#9aa5ff}
</style></head><body>
<h1>Ticket #${ticket.ticket_number} — ${ticket.category}</h1>
<div class="meta">User: ${escHtml(shouldRedact ? redact(ticket.user_tag) : ticket.user_tag)} | Status: ${escHtml(ticket.status)} | Opened: ${escHtml(ticket.opened_at)}</div>
${messages.map(m => {
  let attachments = [];
  try { if (m.attachments) attachments = JSON.parse(m.attachments); } catch {}
  const atts = attachments.map(a =>
    /\.(png|jpe?g|gif|webp)$/i.test(a.name || '') || (a.type || '').startsWith('image/')
      ? `<a href="${escHtml(a.url)}"><img class="att" src="${escHtml(a.url)}"></a>`
      : `<a href="${escHtml(a.url)}">${escHtml(a.name || 'file')}</a>`
  ).join('');
  const content = shouldRedact ? redact(m.content || '') : (m.content || '');
  return `
<div class="msg ${m.is_staff ? 'staff' : 'user'}">
  <div class="author">${escHtml(shouldRedact ? redact(m.author_tag) : m.author_tag)} <span class="time">${escHtml(m.sent_at)}</span></div>
  <div>${escHtml(content)}</div>${atts}
</div>`;
}).join('')}
</body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) { next(err); }
});

router.get('/:id/transcript.txt', authenticateToken, rateLimit({ windowMs: 60_000, max: 120, message: 'Too many transcript requests' }), async (req, res, next) => {
  try {
    const [[ticket]]  = await pool.query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const [messages] = await pool.query(
      'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY sent_at ASC',
      [req.params.id]
    );
    const shouldRedact = req.query.redact === '1' || req.query.redact === 'true';
    const header = `Ticket #${ticket.ticket_number} (${ticket.category})\nUser: ${ticket.user_tag}\nStatus: ${ticket.status}\nOpened: ${ticket.opened_at}\n\n`;
    const body = messages.map(m => {
      const author = shouldRedact ? redact(m.author_tag) : m.author_tag;
      const time = m.sent_at;
      const content = shouldRedact ? redact(m.content || '') : (m.content || '');
      let attachments = [];
      try { if (m.attachments) attachments = JSON.parse(m.attachments); } catch {}
      const atts = attachments.map(a => (a?.url ? `  - ${a.name || 'file'}: ${a.url}` : '')).filter(Boolean).join('\n');
      return `[${time}] ${author}\n${content}${atts ? `\n${atts}` : ''}\n`;
    }).join('\n');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(header + body);
  } catch (err) { next(err); }
});

router.get('/:id/transcript.json', authenticateToken, rateLimit({ windowMs: 60_000, max: 120, message: 'Too many transcript requests' }), async (req, res, next) => {
  try {
    const [[ticket]]  = await pool.query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const [messages] = await pool.query(
      'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY sent_at ASC',
      [req.params.id]
    );
    const shouldRedact = req.query.redact === '1' || req.query.redact === 'true';
    const safeTicket = shouldRedact
      ? { ...ticket, user_tag: redact(ticket.user_tag), description: redact(ticket.description || ''), subject: redact(ticket.subject || '') }
      : ticket;
    const safeMessages = shouldRedact
      ? messages.map(m => ({ ...m, author_tag: redact(m.author_tag), content: redact(m.content || '') }))
      : messages;
    res.json({ ticket: safeTicket, messages: safeMessages });
  } catch (err) { next(err); }
});

// ─── DELETE /api/tickets/:id ───────────────────────────────────────────────────
router.delete('/:id', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM tickets WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── GET /api/tickets/user/:discord_id ───────────────────────────────────────
router.get('/user/:discord_id', authenticateToken, async (req, res, next) => {
  try {
    const [tickets] = await pool.query(
      'SELECT * FROM tickets WHERE user_id = ? ORDER BY opened_at DESC',
      [req.params.discord_id]
    );
    const ratings  = tickets.filter(t => t.rating).map(t => t.rating);
    const avgRating = ratings.length ? (ratings.reduce((a,b) => a+b, 0) / ratings.length).toFixed(1) : null;
    res.json({ tickets, stats: { total: tickets.length, open: tickets.filter(t => t.status==='open' || t.status==='Öppen').length, avg_rating: avgRating } });
  } catch (err) { next(err); }
});


// ─── POST /api/tickets/:id/reply ──────────────────────────────────────────────
// Panel staff sends a message → saved to DB → bot picks it up and posts to Discord
router.post('/:id/reply', authenticateToken, rateLimit({ windowMs: 60_000, max: 60, message: 'Too many replies' }), async (req, res, next) => {
  try {
    const { message, image_urls } = req.body;
    if ((!message || !message.trim()) && (!image_urls || !image_urls.length))
      return res.status(400).json({ error: 'Message or image required' });

    // Get ticket to find channel_id
    const [[ticket]] = await pool.query('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.status === 'closed' || ticket.status === 'Stängd' || ticket.status === 'archived' || ticket.status === 'Arkiverad') {
      return res.status(400).json({ error: 'Cannot reply to a closed ticket' });
    }

    // Build attachments JSON for image URLs pasted/uploaded via panel
    const urls = Array.isArray(image_urls) ? image_urls : [];
    if (urls.length > 5) return res.status(400).json({ error: 'Too many images (max 5)' });
    const attachments = urls.map(url => ({ url, name: url.split('/').pop() || 'image', type: 'image/unknown' }));

    // Save message to DB with pending_discord flag
    await pool.query(
      `INSERT INTO ticket_messages 
        (ticket_id, author_id, author_tag, is_staff, content, discord_msg_id, attachments)
       VALUES (?, ?, ?, 1, ?, 'pending', ?)`,
      [req.params.id, req.user.id?.toString() || '0', req.user.username || req.user.discord_tag,
       (message || '').trim(), attachments.length ? JSON.stringify(attachments) : null]
    );
    await audit(req, { action: 'ticket_reply', ticketId: req.params.id, details: { has_text: !!(message || '').trim(), image_count: attachments.length } });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── GET /api/tickets/:id/messages ────────────────────────────────────────────
router.get('/:id/messages', authenticateToken, async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit || '200')));
    const order = (String(req.query.order || 'ASC').toUpperCase() === 'DESC') ? 'DESC' : 'ASC';
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) as total FROM ticket_messages WHERE ticket_id = ?',
      [req.params.id]
    );
    const [messages] = await pool.query(
      `SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY sent_at ${order} LIMIT ? OFFSET ?`,
      [req.params.id, limit, offset]
    );
    res.json({ data: messages, pagination: { page, limit, total, total_pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

module.exports = router;
