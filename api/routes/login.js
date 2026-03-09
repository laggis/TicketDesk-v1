const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const pool     = require('../../db/pool');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
require('dotenv').config();

// ── GET /api/login/has-admins ─── public, used by login page ─────────────────
router.get('/has-admins', async (req, res) => {
  try {
    const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM admin_users');
    res.json({ hasAdmins: count > 0 });
  } catch { res.json({ hasAdmins: true }); } // fail safe
});

// ── POST /api/login ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const [[user]] = await pool.query('SELECT * FROM admin_users WHERE username = ?', [username.toLowerCase().trim()]);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    await pool.query('UPDATE admin_users SET last_login = NOW() WHERE id = ?', [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, discord_tag: user.discord_tag || user.username, discord_id: user.id.toString(), role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({ token, user: { username: user.username, role: user.role, discord_tag: user.discord_tag } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// ── POST /api/login/setup ─── first-time admin creation only ─────────────────
router.post('/setup', async (req, res) => {
  try {
    const { username, password, discord_tag, first_time } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM admin_users');

    // Block setup if admins already exist (must use admin panel to add users)
    if (count > 0) {
      return res.status(403).json({ error: 'Accounts already exist. Ask an admin to create your account from inside the panel.' });
    }

    const [[existing]] = await pool.query('SELECT id FROM admin_users WHERE username = ?', [username.toLowerCase().trim()]);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO admin_users (username, password_hash, discord_tag, role) VALUES (?, ?, ?, "admin")',
      [username.toLowerCase().trim(), hash, discord_tag || username]
    );
    console.log(`[Login] First admin created: ${username}`);
    res.json({ ok: true, message: `Admin account "${username}" created!` });
  } catch (err) {
    res.status(500).json({ error: 'Setup failed: ' + err.message });
  }
});

// ── GET /api/login/me ─────────────────────────────────────────────────────────
router.get('/me', authenticateToken, (req, res) => res.json(req.user));

// ── GET /api/login/users ─── admin only: list all panel users ────────────────
router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, username, discord_tag, role, last_login, created_at FROM admin_users ORDER BY created_at ASC'
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/login/users ─── admin only: create a new user ──────────────────
router.post('/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, discord_tag, role = 'staff' } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!['admin','staff'].includes(role)) return res.status(400).json({ error: 'Role must be admin or staff' });

    const [[existing]] = await pool.query('SELECT id FROM admin_users WHERE username = ?', [username.toLowerCase().trim()]);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO admin_users (username, password_hash, discord_tag, role) VALUES (?, ?, ?, ?)',
      [username.toLowerCase().trim(), hash, discord_tag || username, role]
    );
    console.log(`[Login] New ${role} created by ${req.user.username}: ${username}`);
    res.json({ ok: true, message: `Account "${username}" created as ${role}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/login/users/:id ─── admin only: delete a user ────────────────
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: "You can't delete your own account" });
    }
    await pool.query('DELETE FROM admin_users WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/login/users/:id ─── admin only: change role ───────────────────
router.patch('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin','staff'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: "Can't change your own role" });
    await pool.query('UPDATE admin_users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/login/change-password ──────────────────────────────────────────
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Min 6 characters' });

    const [[user]] = await pool.query('SELECT * FROM admin_users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is wrong' });

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
