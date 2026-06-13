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

To sign out, click your avatar in the top-right corner and choose **🚪 Log out**.

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

## Stale Ticket Reminders (NEW)

If a customer is left waiting too long for a reply, TicketDesk will gently nudge your staff so nobody falls through the cracks.

How it works:
- A background poller checks all open tickets every minute.
- If the **last message in a ticket was from the customer** (or no one has replied at all yet) and it's been longer than `STALE_TICKET_MINUTES` (default **30**), the bot posts a reminder embed in the ticket channel and pings your support roles:

  > ⏰ **Väntar på svar**
  > Den här ticketen har väntat på ett svar från staff i **45m**. Kunden sitter och väntar — kika in när du har en stund! 🙏

- Once staff reply, the timer resets — no more pings until the customer is waiting again.
- To avoid spam, the same ticket won't be pinged again more often than `STALE_REMINDER_COOLDOWN_MINUTES` (default **30**), even if it's still unanswered.
- Reminders are also written to your `MOD_LOG_CHANNEL_ID` (if configured) as a `StaleTicketReminder` log entry.

Tune both values in `.env` to fit your team — e.g. lower `STALE_TICKET_MINUTES` for a faster-paced support team.

---

## Saved Reply Templates (NEW)

Manage canned responses from the panel → Settings → **💬 Saved Reply Templates**:

- ➕ Add a template with a title, category, and message content
- ✏️ Edit, ✅ enable/disable, or 🗑 delete any template
- Usage count is tracked so you can see which templates staff actually use

In Discord, staff run `/template` inside a ticket channel and pick from an autocomplete dropdown of enabled templates (filterable by title or category). The bot posts the template's content as a normal reply in the ticket — visible to the customer — and logs it to the ticket's transcript and activity feed.

Placeholders available in template content:
- `{user}` — mentions the ticket's creator
- `{staff}` — mentions the staff member running the command
- `{ticket}` — the short ticket reference (e.g. `#a1b2c3d4`)

---

## Ticket Assignment (NEW)

Hand off a ticket to a teammate with `/assign @staff` inside a ticket channel:

- Only staff can be assigned (the target must have one of `SUPPORT_ROLE_IDS` or `ManageChannels`).
- Sets `assigned_to` / `assigned_to_tag` on the ticket.
- Updates the channel topic with `| Tilldelad: <tag>` (replacing any previous assignment).
- Posts a message in the channel and sends the new owner a DM so they know they've got a ticket waiting.

From the panel, use the **📌 Assign** button on a ticket to set/update the displayed assignee, and filter Live Tickets by **Assigned to** (or the **Unassigned** quick filter) to see who's working on what. Note: assigning from the panel only updates the label shown in the panel — the Discord notification happens via `/assign`.

---

## Discord Commands


| Command | Who | What |
|---------|-----|------|
| `/refreshpanel` | Staff | Force-refresh panel embed |
| `/close <id>` | Staff | Close ticket by ID |
| `/add <user>` | Staff | Add a user to the current ticket channel |
| `/remove <user>` | Staff | Remove a user from the current ticket channel |
| `/claim` | Staff | Claim the current ticket |
| `/assign @staff` | Staff | Hand the ticket to another staff member, updates topic & notifies them |
| `/priority <low|normal|urgent>` | Staff | Set priority on the current ticket |
| `/ticket ban <user>` | Mods | Ban user from tickets |
| `/ticket unban <user>` | Mods | Unban user |
| `/note` | Staff | Add an internal staff-only note (private thread, searchable from panel) |
| `/template <name>` | Staff | Send a saved reply template to the customer (autocomplete) |
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
| `STALE_TICKET_MINUTES` | — | Minutes a customer can wait before staff get a reminder ping (default 30) |
| `STALE_REMINDER_COOLDOWN_MINUTES` | — | Minimum gap between repeat reminders for the same ticket (default 30) |
