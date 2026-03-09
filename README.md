# 🎫 TicketDesk v2

Unified Discord ticket bot + admin panel for **PenguinHosting**. One process. One config file. One folder.

## Quick Start

### 1. Install
```bash
npm install
```

### 2. Configure
Copy `.env` and fill in your values. Required fields:

- `BOT_TOKEN` — your Discord bot token
- `GUILD_ID` — your Discord server ID
- `TICKET_CHANNEL_ID` — channel where the panel embed goes
- `SUPPORT_ROLE_IDS` — comma-separated staff role IDs
- `DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME` — MySQL config
- `JWT_SECRET` — any long random string
- `SETUP_SECRET` — used for initial admin account creation

### 3. Database
Tables are **created automatically on startup** — no manual migration needed for fresh installs.

If upgrading from v1, the schema auto-applies safe `ALTER TABLE` migrations on boot. No manual SQL required.

### 4. Start
```bash
node index.js
# or in dev mode:
npm run dev   # requires nodemon
```

That's it. One terminal, one process.

---

## File Structure

```
ticketdesk/
├── index.js              ← entry point (starts everything)
├── .env                  ← ONE config file for everything
├── package.json
├── panel_state.json      ← auto-created, tracks panel embed message ID
│
├── bot/
│   ├── bot.js            ← Discord bot (all interactions, slash commands)
│   └── ai.js             ← Groq AI integration (optional)
│
├── api/
│   ├── server.js         ← Express API server (also serves panel static files)
│   ├── middleware/
│   │   ├── auth.js       ← JWT auth middleware
│   │   └── errorHandler.js
│   └── routes/
│       ├── tickets.js    ← ticket CRUD + replies
│       ├── categories.js ← category management + auto-create Discord channels
│       ├── login.js      ← admin panel login/register
│       └── stats.js      ← dashboard statistics
│
├── db/
│   ├── pool.js           ← shared MySQL connection pool
│   └── schema.js         ← auto-creates all tables + runs migrations on startup
│
└── panel/
    ├── index.html        ← admin panel UI
    └── login.html        ← login page
```

---

## Admin Panel

Open `http://127.0.0.1:6012` in your browser (bound to localhost only).

- Login page: `http://127.0.0.1:6012/login`
- First-time setup: create an admin account via the login page using your `SETUP_SECRET`

---

## Category Management

From the panel → Settings → **Ticket Categories**:

- ➕ Add category with name, emoji, description, colour
- 🤖 **Auto-create Discord channel category** — tick the checkbox and TicketDesk creates the Discord category automatically, no copy-pasting IDs needed
- ✏️ Edit any category
- 🤖 Toggle AI suggestions per category (`ai_enabled` flag)
- ✅ Enable / disable categories
- 🗑️ Delete categories

After any change the Discord panel embed **updates automatically**.

**Default categories** (seeded on first run if the table is empty):

| Emoji | Name    | Description                     |
|-------|---------|--------------------------------------|
| 🛠    | Support | Teknisk hjälp & generella frågor |
| 🛒    | Köp     | Köpfrågor & beställningar        |
| ❓    | Övrigt  | Allt annat                       |
| 🎤    | Panel   | Paneldiskussioner                |

---

## Discord Commands

| Command | Who | What |
|---------|-----|------|
| `/refreshpanel` | Staff | Force-refresh the panel embed |
| `/close <ticket_id>` | Staff | Close a ticket by its ID |
| `/ticket ban <user> [reason]` | Users with Ban Members permission | Ban a user from opening tickets |
| `/ticket unban <user>` | Users with Ban Members permission | Remove a ticket ban |
| `/summarise` | Staff | AI-generated summary of the current ticket channel |

---

## Ticket Flow

1. User clicks a category button in the panel embed
2. A modal appears asking for **Subject** and **Description**
3. A private channel is created under the matching Discord category
4. Staff are pinged and an embed with a **Close** button is posted
5. All messages in the channel are saved to the DB and appear in the panel chat
6. Closing sends an HTML transcript to the transcript channel, DMs the opener, removes their view permission, and deletes the channel after `TICKET_DELETE_DELAY_MS`

---

## AI Features (optional)

Powered by **Groq** (`llama-3.3-70b-versatile`). Enable by setting `GROQ_API_KEY` in `.env`.

| Feature | Description |
|---------|-------------|
| Suggested reply | When a ticket is created, an AI draft reply is posted with **Send** / **Dismiss** buttons |
| Priority detection | Classifies tickets as `low`, `normal`, or `urgent` automatically |
| `/summarise` | Summarises a ticket conversation into 3–5 bullet points |

AI replies are generated per category and can be disabled per category via the `ai_enabled` flag in the panel.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Discord bot token |
| `GUILD_ID` | ✅ | Your Discord server ID |
| `TICKET_CHANNEL_ID` | ✅ | Channel for the panel embed |
| `TRANSCRIPT_CHANNEL_ID` | — | Channel where HTML transcripts are posted |
| `MOD_LOG_CHANNEL_ID` | — | Channel for mod-action logs |
| `SUPPORT_ROLE_IDS` | ✅ | Comma-separated staff role IDs |
| `SUPPORT_CATEGORY_ID` | — | Fallback Discord category ID for Support tickets |
| `KOP_CATEGORY_ID` | — | Fallback Discord category ID for Köp tickets |
| `OVRIGT_CATEGORY_ID` | — | Fallback Discord category ID for Övrigt tickets |
| `PANEL_CATEGORY_ID` | — | Fallback Discord category ID for Panel tickets |
| `TICKET_DELETE_DELAY_MS` | — | Delay before channel is deleted after closing (default `5000`) |
| `DB_HOST` | ✅ | MySQL host |
| `DB_PORT` | ✅ | MySQL port (default `3307`) |
| `DB_USER` | ✅ | MySQL user |
| `DB_PASSWORD` | ✅ | MySQL password |
| `DB_NAME` | ✅ | MySQL database name |
| `TICKETDESK_PORT` | — | API/panel port (default `6012`) |
| `JWT_SECRET` | ✅ | Secret for signing panel login tokens |
| `SETUP_SECRET` | ✅ | Secret for creating the first admin account |
| `SERVER_NAME` | — | Displayed in embeds and footers (default `TicketDesk`) |
| `GROQ_API_KEY` | — | Enables AI features (Groq) |

> **Note:** The Discord category ID env vars (`SUPPORT_CATEGORY_ID`, etc.) are fallbacks only. The preferred way to manage these is through the panel's category settings, which stores them in the database.

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `tickets` | One row per ticket, includes status, priority, subject, channel ID |
| `ticket_messages` | Every message sent in a ticket channel |
| `ticket_categories` | Categories shown in the panel embed |
| `ticket_logs` | Staff action audit log |
| `banned_users` | Users banned from opening tickets |
| `admin_users` | Panel login accounts |
| `panel_config` | Per-user panel configuration |
| `user_emails` | Optional user email mapping |

All tables use `utf8mb4` for full Unicode support (Swedish characters å ä ö).
