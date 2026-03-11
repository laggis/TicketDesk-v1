const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const path       = require('path');
const crypto     = require('crypto');
const pool       = require('../db/pool');

const ticketsRouter    = require('./routes/tickets');
const categoriesRouter = require('./routes/categories');
const loginRouter      = require('./routes/login');
const statsRouter      = require('./routes/stats');
const { errorHandler } = require('./middleware/errorHandler');
const { rateLimit }    = require('./middleware/rateLimit');

async function startAPI() {
  const app  = express();
  const PORT = parseInt(process.env.TICKETDESK_PORT || '52007'); // Use TICKETDESK_PORT to avoid conflicts
  const HOST = (process.env.TICKETDESK_HOST || '0.0.0.0').trim();

  app.use(helmet({ contentSecurityPolicy: false }));
  const origin = (process.env.PANEL_ORIGIN || '').trim();
  app.use(cors(origin ? { origin } : undefined));
  app.use(express.json());

  app.use((req, res, next) => {
    const started = Date.now();
    req.id = crypto.randomBytes(8).toString('hex');
    res.setHeader('X-Request-Id', req.id);
    res.on('finish', () => {
      const ms = Date.now() - started;
      console.log(`[API] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms id=${req.id}`);
    });
    next();
  });

  // ── API routes ──────────────────────────────────────────────────────────────
  app.get('/api/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.use('/api/tickets',    ticketsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/login',      rateLimit({ windowMs: 60_000, max: 20, message: 'Too many login requests' }), loginRouter);
  app.use('/api/stats',      statsRouter);

  // ── Panel static files ──────────────────────────────────────────────────────
  const panelDir = path.join(__dirname, '..', 'panel');
  app.use(express.static(panelDir));
  app.get('/login', (req, res) => res.sendFile(path.join(panelDir, 'login.html')));
  app.get('*',      (req, res) => res.sendFile(path.join(panelDir, 'index.html')));

  app.use(errorHandler);

  const server = app.listen(PORT, HOST, () => {
    console.log('[API] Server running on http://' + HOST + ':' + PORT);
  });

  app.server = server;
  return app;
}

module.exports = { startAPI };
