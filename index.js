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
  await startBot(app);

  console.log('\n✅ TicketDesk fully online!\n');
}

main().catch(err => {
  console.error('[Fatal] Startup failed:', err.message);
  process.exit(1);
});
