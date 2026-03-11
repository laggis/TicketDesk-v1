/**
 * TicketDesk — Unified Bot + API
 * Single process, single config, single DB connection
 *
 * Start: node index.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { startBot }  = require('./bot/bot');
const { startAPI }  = require('./api/server');
const db            = require('./db/pool');

// Prevent crashes from unhandled rejections
process.on('unhandledRejection', err => {
  if (err && err.code === 10062) return; // Discord: unknown interaction (expired)
  console.error('[Error] Unhandled rejection:', err?.message || err);
});
process.on('uncaughtException', err => {
  console.error('[Error] Uncaught exception:', err.message);
});

async function main() {
  console.log('\n🎫 TicketDesk starting...\n');

  // 1. Setup DB tables
  await require('./db/schema').setup();

  // 2. Start API server (serves panel + REST)
  const app = await startAPI();

  // 3. Start Discord bot (passes shared db + app so bot can push events)
  const botClient = await startBot(app);

  const cleanupDays = parseInt(process.env.CLEANUP_DAYS || '0');
  async function cleanup() {
    if (!cleanupDays || cleanupDays < 1) return;
    await db(
      "UPDATE tickets SET status='Arkiverad' WHERE (status='Stängd' OR status='closed') AND closed_at IS NOT NULL AND closed_at < (NOW() - INTERVAL ? DAY)",
      [cleanupDays]
    ).catch(() => {});
  }
  await cleanup();
  setInterval(cleanup, 6 * 60 * 60 * 1000);

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] ${signal}`);
    try { if (app?.server) await new Promise(r => app.server.close(r)); } catch {}
    try { if (botClient?.destroy) await botClient.destroy(); } catch {}
    try { if (db?.pool?.end) await db.pool.end(); } catch {}
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log('\n✅ TicketDesk fully online!\n');
}

main().catch(err => {
  console.error('[Fatal] Startup failed:', err.message);
  process.exit(1);
});
