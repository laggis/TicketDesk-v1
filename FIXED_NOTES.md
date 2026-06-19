# TicketDesk AI / Template Restore

This build restores the missing AI/template/reply features.

## What was fixed

- Mounted the missing API routes:
  - `/api/templates`
  - `/api/faq`
  - `/api/ai-channels`
- Added missing database setup/migrations for:
  - `reply_templates`
  - `ai_faq`
  - `ai_channels`
- Added default Swedish reply templates again.
- Made the template code backwards-compatible with both old `label/text` templates and newer `title/content` templates.
- Restored template usage in:
  - Panel canned reply dropdown
  - Discord `/template` command with autocomplete
- Added a new **Reply Templates** page in the admin panel.
- Added a new **AI Tools** page in the admin panel for FAQ/knowledge and AI channels.
- Added a **🤖 AI draft** button inside the ticket reply composer. It creates a draft only; it does not send automatically.
- Added `/api/tickets/:id/ai-reply` to generate a staff reply draft using Groq.

## Important

For AI to work, your `.env` must contain:

```env
GROQ_API_KEY=your_key_here
```

Then restart TicketDesk:

```bash
npm install
npm start
```

On first start after this fix, TicketDesk will create/migrate the missing database tables automatically.
