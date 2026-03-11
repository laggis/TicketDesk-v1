# 🎫 TicketDesk v2

Unified Discord ticket bot + admin panel. **One process. One config file. One folder.**

## Quick Start

### 1. Install
```bash
npm install
```

### 2. Configure
Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

Only required fields:
- `BOT_TOKEN` — your Discord bot token
- `TICKET_CHANNEL_ID` — channel where the panel embed goes
- `SUPPORT_ROLE_IDS` — comma-separated role IDs treated as staff
- `DB_*` — your MySQL connection details
- `JWT_SECRET` (or `JWT_SECRETS`) — panel login signing secret(s)

### 3. Database setup
On startup, TicketDesk will auto-create tables and run safe “add missing columns/indexes” migrations.

### 4. Start
```bash
node index.js
```

That's it. One terminal, one process.

---

## File Structure

```
ticketdesk/
├── index.js              ← entry point (starts everything)
├── .env                  ← ONE config file for everything
├── package.json
├── panel_state.json      ← auto-created, tracks panel embed
│
├── bot/
│   ├── bot.js            ← Discord bot (all interactions)
│   └── ai.js             ← Groq AI (optional)
│
├── api/
│   ├── server.js         ← Express API server
│   ├── middleware/
│   │   ├── auth.js
│   │   └── errorHandler.js
│   └── routes/
│       ├── tickets.js
│       ├── categories.js ← includes auto-create Discord channel
│       ├── login.js
│       └── stats.js
│
├── db/
│   ├── pool.js           ← shared MySQL connection
│   └── schema.js         ← auto-creates all tables on startup
│
└── panel/
    ├── index.html        ← admin panel UI
    └── login.html        ← login page
```

---

## Panel

Open `http://localhost:52007` in your browser (or whatever you set in `TICKETDESK_PORT`).

First time: create an admin account at `http://localhost:52007/login`

Health check: `GET /api/health`

---

## Category Management (NEW in v2)

From the panel → Settings → **Ticket Categories**:

- ➕ Add category with name, emoji, description
- 🤖 **Auto-create Discord channel category** — tick the checkbox and TicketDesk creates the Discord category automatically, no copy-pasting IDs needed
- ✏️ Edit any category
- ✅ Enable/disable categories
- 🗑️ Delete categories

After any change the Discord panel embed **updates automatically**.

---

## Discord Commands

| Command | Who | What |
|---------|-----|------|
| `/refreshpanel` | Staff | Force-refresh panel embed |
| `/close <id>` | Staff | Close ticket by ID |
| `/add <user>` | Staff | Add a user to the current ticket channel |
| `/remove <user>` | Staff | Remove a user from the current ticket channel |
| `/claim` | Staff | Claim the current ticket |
| `/priority <low|normal|urgent>` | Staff | Set priority on the current ticket |
| `/ticket ban <user>` | Mods | Ban user from tickets |
| `/ticket unban <user>` | Mods | Unban user |
| `/summarise` | Staff | AI summary of current ticket |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Discord bot token |
| `GUILD_ID` | — | If set, registers slash commands to this guild only |
| `TICKET_CHANNEL_ID` | ✅ | Channel for the panel embed |
| `TRANSCRIPT_CHANNEL_ID` | — | Channel for transcripts |
| `MOD_LOG_CHANNEL_ID` | — | Channel for mod logs |
| `SUPPORT_ROLE_IDS` | ✅ | Comma-separated staff role IDs |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | ✅ | MySQL config |
| `TICKETDESK_PORT` | — | API port (default 52007) |
| `TICKETDESK_HOST` | — | API bind host (default `0.0.0.0`) |
| `PANEL_ORIGIN` | — | If set, enables CORS only for this origin |
| `JWT_SECRET` | ✅ | Single JWT signing secret (simplest option) |
| `JWT_SECRETS` | — | Comma-separated secrets (first is active, rest are accepted) |
| `JWT_EXPIRES_IN` | — | JWT expiry (default `30d`) |
| `SERVER_NAME` | — | Shown in embeds (default TicketDesk) |
| `GROQ_API_KEY` | — | Enables AI features |
| `TICKET_DELETE_DELAY_MS` | — | Delete delay after close (default 5000) |
| `MAX_OPEN_TICKETS_PER_USER` | — | Ticket limit per user (default 5) |
| `CLEANUP_DAYS` | — | Auto-archive closed tickets older than N days |
