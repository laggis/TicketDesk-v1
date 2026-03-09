const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const path       = require('path');

const ticketsRouter    = require('./routes/tickets');
const categoriesRouter = require('./routes/categories');
const loginRouter      = require('./routes/login');
const statsRouter      = require('./routes/stats');
const { errorHandler } = require('./middleware/errorHandler');

async function startAPI() {
  const app  = express();
  const PORT = parseInt(process.env.TICKETDESK_PORT || '6012'); // Use TICKETDESK_PORT to avoid conflicts

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json());

  // ── API routes ──────────────────────────────────────────────────────────────
  app.use('/api/tickets',    ticketsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/login',      loginRouter);
  app.use('/api/stats',      statsRouter);

  // ── Panel static files ──────────────────────────────────────────────────────
  const panelDir = path.join(__dirname, '..', 'panel');
  app.use(express.static(panelDir));
  app.get('/login', (req, res) => res.sendFile(path.join(panelDir, 'login.html')));
  app.get('*',      (req, res) => res.sendFile(path.join(panelDir, 'index.html')));

  app.use(errorHandler);

  app.listen(PORT, '127.0.0.1', () => {
    console.log('[API] Server running on http://127.0.0.1:' + PORT);
  });

  return app;
}

module.exports = { startAPI };
