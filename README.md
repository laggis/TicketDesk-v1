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
- `DB_*` — your MySQL connection details
- `JWT_SECRET` — any long random string

### 3. Run MySQL migration (first time only)
If upgrading from v1, run this to add new columns:
```sql
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pending_close TINYINT(1) DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal';
ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);
CREATE TABLE IF NOT EXISTS ticket_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  emoji VARCHAR(10) DEFAULT '🎫',
  description VARCHAR(255),
  discord_category_id VARCHAR(20),
  color VARCHAR(7) DEFAULT '#6366f1',
  sort_order INT DEFAULT 0,
  enabled TINYINT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

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

Open `http://localhost:6012` in your browser.

First time: create an admin account at `http://localhost:6012/login`

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
| `/ticket ban <user>` | Mods | Ban user from tickets |
| `/ticket unban <user>` | Mods | Unban user |
| `/summarise` | Staff | AI summary of current ticket |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Discord bot token |
| `GUILD_ID` | ✅ | Your Discord server ID |
| `TICKET_CHANNEL_ID` | ✅ | Channel for the panel embed |
| `TRANSCRIPT_CHANNEL_ID` | — | Channel for transcripts |
| `MOD_LOG_CHANNEL_ID` | — | Channel for mod logs |
| `SUPPORT_ROLE_IDS` | ✅ | Comma-separated staff role IDs |
| `DB_HOST/PORT/USER/PASSWORD/NAME` | ✅ | MySQL config |
| `PORT` | — | API port (default 6012) |
| `JWT_SECRET` | ✅ | Secret for panel login tokens |
| `SERVER_NAME` | — | Shown in embeds (default TicketDesk) |
| `GROQ_API_KEY` | — | Enables AI features |
| `TICKET_DELETE_DELAY_MS` | — | Delete delay after close (default 5000) |
