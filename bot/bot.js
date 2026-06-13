const {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, PermissionsBitField, ChannelType,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs   = require('fs');
const db   = require('../db/pool');
const ai   = require('./ai');

// ─── Config ────────────────────────────────────────────────────────────────────
const BOT_TOKEN          = process.env.BOT_TOKEN;
const TICKET_CHANNEL_ID  = process.env.TICKET_CHANNEL_ID;
const TRANSCRIPT_CHANNEL = process.env.TRANSCRIPT_CHANNEL_ID;
const MOD_LOG_CHANNEL    = process.env.MOD_LOG_CHANNEL_ID;
const GUILD_ID           = process.env.GUILD_ID;
const DELETE_DELAY             = parseInt(process.env.TICKET_DELETE_DELAY_MS || '5000');
const WEEKLY_SUMMARY_CHANNEL_ID = process.env.WEEKLY_SUMMARY_CHANNEL_ID || '';
const SUPPORT_ROLE_IDS   = (process.env.SUPPORT_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const SERVER_NAME        = process.env.SERVER_NAME || 'TicketDesk';
const MAX_OPEN_TICKETS_PER_USER = Math.max(1, parseInt(process.env.MAX_OPEN_TICKETS_PER_USER || '5'));

// Stale ticket reminders — settings loaded dynamically from bot_settings.json
const SETTINGS_PATH = path.join(__dirname, '..', 'bot_settings.json');
const DEFAULT_STALE_SETTINGS = {
  staleRemindersEnabled:        true,
  staleTicketMinutes:           30,
  staleReminderCooldownMinutes: 30,
};
function getStaleSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return { ...DEFAULT_STALE_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_STALE_SETTINGS };
  }
}

// Panel state (avoids duplicate on restart)
const STATE_PATH = path.join(__dirname, '..', 'panel_state.json');
const loadState  = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return null; } };
const saveState  = s  => { try { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch {} };

// ─── Discord client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// Export so API routes can access it
module.exports.client = client;

// ─── Helpers ───────────────────────────────────────────────────────────────────
const cooldowns = new Map();
const onCooldown    = (k, ms) => { const t = cooldowns.get(k); return t ? Date.now() - t < ms : false; };
const setCooldown   = k => cooldowns.set(k, Date.now());
const cooldownLeft  = (k, ms) => { const t = cooldowns.get(k); return t ? Math.max(0, Math.ceil((ms - (Date.now() - t)) / 1000)) : 0; };

function isStaff(member) {
  return SUPPORT_ROLE_IDS.some(id => member.roles.cache.has(id)) ||
         member.permissions.has(PermissionsBitField.Flags.ManageChannels);
}

async function modLog(guild, { action, actor, target, channel, ticketId, reason }) {
  if (!MOD_LOG_CHANNEL) return;
  try {
    const ch = guild.channels.cache.get(MOD_LOG_CHANNEL) || await guild.channels.fetch(MOD_LOG_CHANNEL).catch(() => null);
    if (!ch) return;
    const e = new EmbedBuilder().setTitle('Mod Log: ' + action).setColor('#ffcc00').setTimestamp();
    if (actor)    e.addFields({ name: 'By',      value: actor.tag  + ' (' + actor.id  + ')', inline: true });
    if (target)   e.addFields({ name: 'User',    value: target.tag + ' (' + target.id + ')', inline: true });
    if (channel)  e.addFields({ name: 'Channel', value: channel.name,                        inline: true });
    if (ticketId) e.addFields({ name: 'Ticket',  value: ticketId,                            inline: true });
    if (reason)   e.addFields({ name: 'Reason',  value: reason,                              inline: false });
    await ch.send({ embeds: [e] });
  } catch {}
}

// ─── Categories ────────────────────────────────────────────────────────────────
let CATEGORIES = [];

async function loadCategories() {
  try {
    CATEGORIES = await db('SELECT * FROM ticket_categories WHERE enabled = 1 ORDER BY sort_order ASC, id ASC');
    console.log('[Bot] Categories: ' + CATEGORIES.map(c => c.emoji + c.name).join(' · '));
  } catch (err) {
    console.error('[Bot] Failed to load categories:', err.message);
    CATEGORIES = [
      { name: 'Support', emoji: '🛠', description: 'Teknisk hjälp',    discord_category_id: process.env.SUPPORT_CATEGORY_ID },
      { name: 'Köp',     emoji: '🛒', description: 'Köpfrågor',         discord_category_id: process.env.KOP_CATEGORY_ID },
      { name: 'Övrigt',  emoji: '❓', description: 'Allt annat',         discord_category_id: process.env.OVRIGT_CATEGORY_ID },
      { name: 'Panel',   emoji: '🎤', description: 'Paneldiskussioner',  discord_category_id: process.env.PANEL_CATEGORY_ID },
    ];
  }
}

function buildPanelEmbed() {
  const embed = new EmbedBuilder()
    .setTitle('Ticket System')
    .setDescription('Välj en kategori för att skapa en ticket.\nVårt team hjälper dig så snart som möjligt!')
    .setColor('#6366f1')
    .setThumbnail(client.user.displayAvatarURL())
    .setImage('https://i.imgur.com/gybi9X5.jpg')
    .addFields(CATEGORIES.map(c => ({ name: c.emoji + ' ' + c.name, value: c.description || '—', inline: true })))
    .setFooter({ text: SERVER_NAME + ' Support', iconURL: client.user.displayAvatarURL() })
    .setTimestamp();

  const rows = [];
  for (let i = 0; i < CATEGORIES.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      CATEGORIES.slice(i, i + 5).map(c =>
        new ButtonBuilder()
          .setCustomId('ticket_' + c.name)
          .setLabel(c.emoji + ' ' + c.name)
          .setStyle(ButtonStyle.Primary)
      )
    ));
  }
  return { embed, rows };
}

async function postOrRefreshPanel(guild) {
  const ch = guild
    ? guild.channels.cache.get(TICKET_CHANNEL_ID)
    : await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);

  if (!ch) { console.error('[Bot] Ticket channel not found:', TICKET_CHANNEL_ID); return null; }

  await loadCategories();
  const { embed, rows } = buildPanelEmbed();

  // Try to edit existing panel message
  const state = loadState();
  if (state?.messageId) {
    try {
      const msg = await ch.messages.fetch(state.messageId);
      await msg.edit({ embeds: [embed], components: rows });
      console.log('[Bot] Panel refreshed in place.');
      return msg;
    } catch { /* deleted, post new */ }
  }

  const sent = await ch.send({ embeds: [embed], components: rows });
  saveState({ channelId: TICKET_CHANNEL_ID, messageId: sent.id });
  console.log('[Bot] Panel embed posted.');
  return sent;
}

// ─── Transcript ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

async function fetchAllMessages(channel) {
  const msgs = [];
  let lastId;
  while (msgs.length < 2000) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
    if (!batch || batch.size === 0) break;
    const arr = [...batch.values()];
    msgs.push(...arr);
    lastId = arr[arr.length - 1].id;
  }
  return msgs.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function buildTranscript(messages, ticketId, channel) {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Ticket ${esc(ticketId)}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e5e7eb;padding:20px;line-height:1.5}
  h1{color:#818cf8} .meta{color:#6b7280;font-size:13px;margin-bottom:24px}
  .msg{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #1f2937}
  .av{width:40px;height:40px;border-radius:50%;flex-shrink:0}
  .name{font-weight:700;color:#c7d2fe} .time{color:#6b7280;font-size:11px;margin-left:8px}
  .text{white-space:pre-wrap;margin-top:3px;color:#d1d5db}
  img.att{max-width:400px;border-radius:6px;margin-top:6px;display:block} a{color:#818cf8}
  .footer{margin-top:24px;color:#4b5563;font-size:12px;text-align:center}
</style></head><body>
<h1>🎫 Ticket ${esc(ticketId.slice(0,8))}</h1>
<div class="meta">Channel: ${esc(channel?.name)} &nbsp;|&nbsp; ${messages.length} messages</div>
${messages.map(m => {
  const atts = [...(m.attachments?.values() || [])].map(a =>
    /\.(png|jpe?g|gif|webp)$/i.test(a.name||'')
      ? '<img class="att" src="' + a.url + '">'
      : '<a href="' + a.url + '">' + esc(a.name||'file') + '</a>'
  ).join('');
  return '<div class="msg">' +
    (m.author?.displayAvatarURL() ? '<img class="av" src="' + m.author.displayAvatarURL({size:64,extension:'png'}) + '">' : '') +
    '<div><span class="name">' + esc(m.author?.tag||'Unknown') + '</span>' +
    '<span class="time">' + new Date(m.createdTimestamp).toLocaleString('sv-SE') + '</span>' +
    '<div class="text">' + esc(m.content||'') + '</div>' + atts + '</div></div>';
}).join('\n')}
<div class="footer">Generated ${new Date().toLocaleString('sv-SE')} by TicketDesk</div>
</body></html>`;
}

// ─── Close ticket ──────────────────────────────────────────────────────────────
async function closeTicket(channel, ticketId, closedBy) {
  try {
    const messages = await fetchAllMessages(channel);
    const html     = buildTranscript(messages, ticketId, channel);
    const buf      = Buffer.from(html, 'utf-8');
    const fname    = 'transcript-' + ticketId + '.html';

    const [ticket] = await db('SELECT * FROM tickets WHERE id = ? LIMIT 1', [ticketId]).catch(() => [[]]);
    const opener   = Array.isArray(ticket) ? ticket[0] : ticket;

    const dur = opener?.opened_at
      ? (() => { const s = Math.round((Date.now() - new Date(opener.opened_at)) / 1000); const m = Math.floor(s/60); return m > 0 ? m+'m '+(s%60)+'s' : s+'s'; })()
      : '—';

    const embed = new EmbedBuilder()
      .setTitle('🔒 Ticket Stängd')
      .setColor('#ff4d4f')
      .addFields(
        { name: 'Ticket',     value: '`' + ticketId.slice(0,8) + '`', inline: true },
        { name: 'Typ',        value: opener?.type || '—',              inline: true },
        { name: 'Ämne',       value: opener?.subject || '—',           inline: false },
        { name: 'Skapad av',  value: opener?.created_by || '—',        inline: true },
        { name: 'Stängd av',  value: closedBy?.tag || closedBy?.username || '—', inline: true },
        { name: 'Varaktighet',value: dur,                              inline: true },
      )
      .setFooter({ text: SERVER_NAME + ' Support' })
      .setTimestamp();

    // Transcript channel
    const tCh = TRANSCRIPT_CHANNEL
      ? await client.channels.fetch(TRANSCRIPT_CHANNEL).catch(() => null)
      : null;
    if (tCh) await tCh.send({ content: '📄 Transcript `' + ticketId.slice(0,8) + '`', files: [{ attachment: buf, name: fname }] });

    // DM opener — transcript + CSAT rating request
    if (opener?.created_by_id) {
      const u = await client.users.fetch(opener.created_by_id).catch(() => null);
      if (u) {
        // 1) Transcript DM
        await u.send({ content: '📄 Din ticket har stängts:', embeds: [embed], files: [{ attachment: buf, name: fname }] }).catch(() => {});

        // 2) CSAT rating DM (only if not already sent)
        const [csatCheck] = await db('SELECT csat_sent FROM tickets WHERE id=? LIMIT 1', [ticketId]).catch(() => [{}]);
        if (!csatCheck?.csat_sent) {
        await db('UPDATE tickets SET csat_sent=1 WHERE id=?', [ticketId]).catch(() => {});
        const csatEmbed = new EmbedBuilder()
          .setTitle('⭐ Hur nöjd var du med supporten?')
          .setDescription(
            'Vi skulle uppskatta om du tog en sekund och betygsatte din upplevelse med **' + SERVER_NAME + '** Support.\n\n' +
            'Klicka på en stjärna nedan för att lämna ditt omdöme.'
          )
          .setColor('#6366f1')
          .setFooter({ text: SERVER_NAME + ' Support • Ticket ' + ticketId.slice(0, 8) });

        const starRow = new ActionRowBuilder().addComponents(
          [1, 2, 3, 4, 5].map(n =>
            new ButtonBuilder()
              .setCustomId('csat_' + n + '_' + ticketId)
              .setLabel('★'.repeat(n))
              .setStyle(n <= 2 ? ButtonStyle.Danger : n === 3 ? ButtonStyle.Secondary : ButtonStyle.Success)
          )
        );

        await u.send({ embeds: [csatEmbed], components: [starRow] }).catch(() => {});
        } // end csat_sent guard
      }
    }

    await channel.send({ embeds: [embed] });

    // Update DB
    await db(
      'UPDATE tickets SET status=?, closed_by=?, closed_by_id=?, closed_at=NOW(), pending_close=0 WHERE id=?',
      ['Stängd', closedBy?.tag || closedBy?.username || '', closedBy?.id || '0', ticketId]
    ).catch(() => {});

    // Remove user permissions
    if (opener?.created_by_id) {
      await channel.permissionOverwrites.edit(opener.created_by_id, { ViewChannel: false }).catch(() => {});
    }

    const secs = Math.max(1, Math.round(DELETE_DELAY / 1000));
    await channel.send('🗑 Kanal tas bort om ' + secs + 's.').catch(() => {});
    setTimeout(() => channel.delete('Ticket closed').catch(() => {}), DELETE_DELAY);

  } catch (err) {
    console.error('[closeTicket] Error:', err.message);
  }
}

// ─── Pollers ───────────────────────────────────────────────────────────────────
async function pollCloseRequests() {
  try {
    const rows = await db("SELECT * FROM tickets WHERE pending_close=1 AND channel_id IS NOT NULL LIMIT 5");
    for (const t of rows) {
      await db('UPDATE tickets SET pending_close=0 WHERE id=?', [t.id]);
      const ch = await client.channels.fetch(t.channel_id).catch(() => null);
      if (!ch) {
        await db("UPDATE tickets SET status='Stängd', closed_at=NOW() WHERE id=?", [t.id]);
        continue;
      }
      console.log('[Poll] Closing ' + t.id.slice(0,8) + ' via panel request');
      await closeTicket(ch, t.id, { id: '0', tag: t.close_requested_by || 'Admin Panel' });
    }
  } catch (err) { console.error('[Poll:close]', err.message); }
}

async function pollPanelReplies() {
  try {
    const pending = await db(
      "SELECT tm.*, t.channel_id, t.ticket_number, t.category, t.subject, t.user_tag FROM ticket_messages tm JOIN tickets t ON t.id=tm.ticket_id WHERE tm.discord_msg_id='pending' LIMIT 10"
    );
    for (const msg of pending) {
      // Atomically claim this row before processing — prevents double-send on fast polls
      const claimed = await db(
        "UPDATE ticket_messages SET discord_msg_id='sending' WHERE id=? AND discord_msg_id='pending'",
        [msg.id]
      );
      if (!claimed.affectedRows) continue; // another poll iteration already claimed it

      if (!msg.channel_id) { await db('UPDATE ticket_messages SET discord_msg_id="no_channel" WHERE id=?', [msg.id]); continue; }
      const ch = await client.channels.fetch(msg.channel_id).catch(() => null);
      if (!ch) { await db('UPDATE ticket_messages SET discord_msg_id="gone" WHERE id=?', [msg.id]); continue; }
      // If there's a single image attachment, embed it directly
      let attachments = [];
      try { if (msg.attachments) attachments = JSON.parse(msg.attachments); } catch {}
      const images = attachments.filter(a => /\.(png|jpe?g|gif|webp)$/i.test(a.name || '') || (a.type || '').startsWith('image/'));
      const files  = attachments.filter(a => !images.includes(a));
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setAuthor({ name: msg.author_tag || 'Staff', iconURL: client.user.displayAvatarURL() })
        .setTitle('💬 Ticket Reply')
        .setDescription((msg.content && msg.content.trim()) ? msg.content : (attachments.length ? '*Attachment(s)*' : null))
        .addFields(
          { name: 'Ticket', value: msg.ticket_number ? `#${msg.ticket_number}` : (msg.ticket_id ? msg.ticket_id.slice(0, 8) : '—'), inline: true },
          { name: 'Category', value: msg.category || '—', inline: true },
          { name: 'User', value: msg.user_tag || '—', inline: true },
        )
        .setFooter({ text: 'via Admin Panel' })
        .setTimestamp();

      if (images[0]) embed.setImage(images[0].url);

      const sent = await ch.send({
        embeds: [embed],
        files: files.map(f => ({ attachment: f.url, name: f.name || 'file' })),
      }).catch(() => null);
      await db('UPDATE ticket_messages SET discord_msg_id=? WHERE id=?', [sent?.id || 'sent', msg.id]);
    }
  } catch (err) { console.error('[Poll:replies]', err.message); }
}

async function pollStaleTickets() {
  const cfg = getStaleSettings();
  if (!cfg.staleRemindersEnabled) return; // disabled via panel settings
  const STALE_TICKET_MINUTES           = cfg.staleTicketMinutes;
  const STALE_REMINDER_COOLDOWN_MINUTES = cfg.staleReminderCooldownMinutes;
  try {
    // Open tickets, along with the most recent message (if any) so we know
    // who spoke last and how long ago.
    const rows = await db(`
      SELECT t.*,
        (SELECT sent_at  FROM ticket_messages WHERE ticket_id = t.id ORDER BY sent_at DESC, id DESC LIMIT 1) AS last_msg_at,
        (SELECT is_staff FROM ticket_messages WHERE ticket_id = t.id ORDER BY sent_at DESC, id DESC LIMIT 1) AS last_msg_is_staff
      FROM tickets t
      WHERE (t.status = 'Öppen' OR t.status = 'open') AND t.channel_id IS NOT NULL
    `);

    for (const t of rows) {
      // If the last message was from staff, the ball is in the customer's
      // court — nothing to remind anyone about.
      if (t.last_msg_is_staff === 1) continue;

      // Reference point: last customer message, or ticket creation if no
      // messages have been logged yet (e.g. first response never sent).
      const refTime = t.last_msg_at ? new Date(t.last_msg_at) : new Date(t.opened_at);
      const minutesWaiting = (Date.now() - refTime.getTime()) / 60000;
      if (minutesWaiting < STALE_TICKET_MINUTES) continue;

      // Don't spam — only re-notify after the cooldown has passed.
      if (t.last_reminder_at) {
        const minutesSinceReminder = (Date.now() - new Date(t.last_reminder_at).getTime()) / 60000;
        if (minutesSinceReminder < STALE_REMINDER_COOLDOWN_MINUTES) continue;
      }

      const ch = await client.channels.fetch(t.channel_id).catch(() => null);
      if (!ch) continue;

      const waitedMins  = Math.floor(minutesWaiting);
      const waitedLabel = waitedMins >= 60
        ? Math.floor(waitedMins / 60) + 'h ' + (waitedMins % 60) + 'm'
        : waitedMins + 'm';

      const supportRoles = SUPPORT_ROLE_IDS.map(id => '<@&' + id + '>').join(' ');
      const embed = new EmbedBuilder()
        .setTitle('⏰ Väntar på svar')
        .setDescription('Den här ticketen har väntat på ett svar från staff i **' + waitedLabel + '**. Kunden sitter och väntar — kika in när du har en stund! 🙏')
        .setColor('#fbbf24')
        .addFields(
          { name: 'Ticket', value: t.ticket_number ? '#' + t.ticket_number : t.id.slice(0, 8), inline: true },
          { name: 'Kund',   value: t.user_tag || t.created_by || '—',                          inline: true },
          { name: 'Prio',   value: t.priority || 'normal',                                     inline: true },
        )
        .setTimestamp();

      await ch.send({ content: supportRoles || undefined, embeds: [embed] }).catch(() => {});
      await db('UPDATE tickets SET last_reminder_at = NOW() WHERE id = ?', [t.id]).catch(() => {});

      await modLog(ch.guild, {
        action: 'StaleTicketReminder',
        channel: ch,
        ticketId: t.id,
        reason: 'Ingen svar från staff på ' + waitedLabel,
      });
    }
  } catch (err) { console.error('[Poll:stale]', err.message); }
}

// ─── Ready ─────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log('\n✅ Bot logged in as ' + client.user.tag);

  await loadCategories();

  // Post or restore panel embed
  const ch = await client.channels.fetch(TICKET_CHANNEL_ID).catch(() => null);
  if (ch) {
    let alreadySent = false;
    const state = loadState();
    if (state?.messageId) {
      try { await ch.messages.fetch(state.messageId); alreadySent = true; console.log('[Bot] Panel found via state.'); } catch {}
    }
    if (!alreadySent) {
      const recent = await ch.messages.fetch({ limit: 20 }).catch(() => null);
      if (recent) {
        for (const msg of recent.values()) {
          if (msg.author?.id === client.user.id &&
              msg.components?.some(r => r.components?.some(c => c.customId?.startsWith('ticket_'))) &&
              msg.embeds?.some(e => e.title === 'Ticket System')) {
            alreadySent = true;
            saveState({ channelId: TICKET_CHANNEL_ID, messageId: msg.id });
            console.log('[Bot] Panel found in channel.');
            break;
          }
        }
      }
    }
    if (!alreadySent) {
      const { embed, rows } = buildPanelEmbed();
      const sent = await ch.send({ embeds: [embed], components: rows });
      saveState({ channelId: TICKET_CHANNEL_ID, messageId: sent.id });
      console.log('[Bot] Panel posted.');
    }
  }

  // Register slash commands
  const commands = [
    { name: 'ticket', description: 'Moderera tickets', options: [
      { name: 'ban',   description: 'Banna en användare',  type: 1, options: [
        { name: 'user',   type: 6, description: 'Användare', required: true },
        { name: 'reason', type: 3, description: 'Anledning', required: false },
      ]},
      { name: 'unban', description: 'Ta bort ban', type: 1, options: [
        { name: 'user', type: 6, description: 'Användare', required: true },
      ]},
    ]},
    { name: 'close',        description: 'Stäng ticket via ID', options: [{ name: 'ticket_id', type: 3, description: 'Ticket ID', required: true }] },
    { name: 'add',          description: 'Lägg till användare i ticket', options: [{ name: 'user', type: 6, description: 'Användare', required: true }] },
    { name: 'remove',       description: 'Ta bort användare från ticket', options: [{ name: 'user', type: 6, description: 'Användare', required: true }] },
    { name: 'claim',        description: 'Claima denna ticket' },
    { name: 'assign',       description: 'Tilldela denna ticket till en kollega', options: [
      { name: 'staff', type: 6, description: 'Vem ska ta över ticketen', required: true },
    ]},
    { name: 'priority',     description: 'Sätt prioritet på denna ticket', options: [{ name: 'level', type: 3, description: 'low / normal / urgent', required: true, choices: [{ name: 'low', value: 'low' }, { name: 'normal', value: 'normal' }, { name: 'urgent', value: 'urgent' }] }] },
    { name: 'summarise',    description: 'AI-sammanfattning av denna ticket (staff only)' },
    { name: 'note',         description: 'Add an internal staff-only note to this ticket', options: [
      { name: 'message', type: 3, description: 'The internal note content', required: true },
    ]},
    { name: 'template',     description: 'Send a saved reply template to this ticket', options: [
      { name: 'name', type: 3, description: 'Pick a saved template', required: true, autocomplete: true },
    ]},
    { name: 'refreshpanel', description: 'Uppdatera ticket-panelen (admin only)' },
  ];

  try {
    if (GUILD_ID) {
      const g = await client.guilds.fetch(GUILD_ID).catch(() => null);
      if (g) { await g.commands.set(commands); console.log('[Bot] Guild commands registered.'); }
      else   { await client.application.commands.set(commands); }
    } else {
      await client.application.commands.set(commands);
      console.log('[Bot] Global commands registered.');
    }
  } catch (err) { console.error('[Bot] Command registration failed:', err.message); }

  // Start pollers
  setInterval(pollCloseRequests, 10000);
  setInterval(pollPanelReplies, 5000);
  setInterval(pollStaleTickets, 60000);

  // SLA breach poller — runs every 2 minutes
  async function pollSlaBreaches() {
    try {
      // Find open tickets whose category has an SLA and first_response_at is still NULL
      const rows = await db(`
        SELECT t.id, t.channel_id, t.user_tag, t.category, t.opened_at, t.ticket_number,
               c.sla_minutes, c.name AS cat_name, c.emoji AS cat_emoji
        FROM tickets t
        JOIN ticket_categories c ON LOWER(c.name) = LOWER(t.category)
        WHERE (t.status = 'Öppen' OR t.status = 'open')
          AND t.channel_id IS NOT NULL
          AND t.first_response_at IS NULL
          AND c.sla_minutes IS NOT NULL
          AND TIMESTAMPDIFF(MINUTE, t.opened_at, NOW()) >= c.sla_minutes
          AND (t.sla_breached = 0 OR t.sla_breached IS NULL)
      `);

      for (const t of rows) {
        // Mark breached in DB
        await db('UPDATE tickets SET sla_breached = 1 WHERE id = ?', [t.id]).catch(() => {});

        // Post warning in the ticket channel
        const ch = await client.channels.fetch(t.channel_id).catch(() => null);
        if (!ch) continue;

        const overMins = Math.floor(
          (Date.now() - new Date(t.opened_at).getTime()) / 60000
        ) - t.sla_minutes;
        const overLabel = overMins >= 60
          ? Math.floor(overMins / 60) + 'h ' + (overMins % 60) + 'm'
          : overMins + 'm';

        const slaEmbed = new EmbedBuilder()
          .setTitle('⚠️ SLA Breach — No Response Yet')
          .setDescription(
            'This ticket has exceeded the **' + t.sla_minutes + ' min** first-response SLA for ' +
            (t.cat_emoji || '') + ' **' + t.cat_name + '** by **' + overLabel + '**.' +
            '\n\nPlease respond as soon as possible.'
          )
          .setColor('#ef4444')
          .addFields(
            { name: 'Customer', value: t.user_tag || '—', inline: true },
            { name: 'Ticket #', value: String(t.ticket_number || t.id.slice(0,8)), inline: true },
          )
          .setFooter({ text: SERVER_NAME + ' SLA Monitor' })
          .setTimestamp();

        const supportRoles = SUPPORT_ROLE_IDS
          .map(id => ch.guild?.roles.cache.get(id))
          .filter(Boolean);

        await ch.send({
          content: supportRoles.length ? supportRoles.map(r => r.toString()).join(' ') : undefined,
          embeds: [slaEmbed],
        }).catch(() => {});

        // Also mod-log
        await modLog(ch.guild, {
          action: 'SLABreach',
          ticketId: t.id,
          reason: 'No first response within ' + t.sla_minutes + ' min (category: ' + t.cat_name + ')',
        }).catch(() => {});

        console.log('[SLA] Breach: ticket', t.id.slice(0,8), 'category', t.cat_name);
      }
    } catch (err) {
      console.error('[SLA] Poller error:', err.message);
    }
  }

  pollSlaBreaches();
  setInterval(pollSlaBreaches, 2 * 60 * 1000);

  // ─── Weekly Summary ──────────────────────────────────────────────────────────
  // Sends a rich embed to WEEKLY_SUMMARY_CHANNEL_ID every 7 days.
  // Reuses the same queries as GET /api/stats — no additional DB queries.
  async function postWeeklySummary() {
    if (!WEEKLY_SUMMARY_CHANNEL_ID) return; // Not configured — skip silently

    const summaryChannel = client.channels.cache.get(WEEKLY_SUMMARY_CHANNEL_ID)
      || await client.channels.fetch(WEEKLY_SUMMARY_CHANNEL_ID).catch(() => null);
    if (!summaryChannel) {
      console.error('[Weekly] Channel not found:', WEEKLY_SUMMARY_CHANNEL_ID);
      return;
    }

    try {
      // ── Overview (mirrors /api/stats overview query, scoped to last 7 days) ──
      const [overview] = await db(`
        SELECT
          SUM(1)                                                                   AS total_opened,
          SUM(status = 'closed' OR status = 'Stängd')                             AS total_closed,
          ROUND(AVG(CASE WHEN closed_at IS NOT NULL
            THEN TIMESTAMPDIFF(HOUR, opened_at, closed_at) END), 1)               AS avg_close_hours,
          ROUND(AVG(CASE WHEN first_response_at IS NOT NULL
            THEN TIMESTAMPDIFF(MINUTE, opened_at, first_response_at) END), 0)     AS avg_first_response_minutes,
          ROUND(AVG(rating), 2)                                                    AS avg_rating,
          SUM(priority = 'urgent')                                                 AS urgent_count
        FROM tickets
        WHERE opened_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      `);

      // ── Top categories ────────────────────────────────────────────────────────
      const byCategory = await db(`
        SELECT category, COUNT(*) AS count
        FROM tickets
        WHERE opened_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY category
        ORDER BY count DESC
        LIMIT 5
      `);

      // ── Busiest days ──────────────────────────────────────────────────────────
      const byDay = await db(`
        SELECT DAYNAME(opened_at) AS day_name, COUNT(*) AS count
        FROM tickets
        WHERE opened_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        GROUP BY DAYNAME(opened_at), DAYOFWEEK(opened_at)
        ORDER BY DAYOFWEEK(opened_at)
      `);

      // ── Format helpers ────────────────────────────────────────────────────────
      const fmt = v => (v === null || v === undefined) ? '—' : String(v);

      const avgClose = overview.avg_close_hours !== null
        ? (overview.avg_close_hours >= 24
            ? (overview.avg_close_hours / 24).toFixed(1) + 'd'
            : overview.avg_close_hours + 'h')
        : '—';

      const avgResponse = overview.avg_first_response_minutes !== null
        ? (overview.avg_first_response_minutes >= 60
            ? Math.floor(overview.avg_first_response_minutes / 60) + 'h ' +
              (overview.avg_first_response_minutes % 60) + 'm'
            : overview.avg_first_response_minutes + 'm')
        : '—';

      const categoryLines = byCategory.length
        ? byCategory
            .map((r, i) => `\`${i + 1}.\` **${r.category || 'Unknown'}** — ${r.count} tickets`)
            .join('\n')
        : '_No data_';

      const dayRows = byDay;
      const maxDayCount = dayRows.reduce((m, r) => Math.max(m, Number(r.count)), 0) || 1;
      const dayLines = dayRows.length
        ? dayRows
            .map(r => {
              const pct  = Number(r.count) / maxDayCount;
              const bars = Math.round(pct * 10);
              const bar  = '█'.repeat(bars) + '░'.repeat(10 - bars);
              return `\`${(r.day_name || '').slice(0, 3)}\` ${bar} ${r.count}`;
            })
            .join('\n')
        : '_No data_';

      // ── Build embed ───────────────────────────────────────────────────────────
      const now    = new Date();
      const weekEnd = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000)
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

      const embed = new EmbedBuilder()
        .setTitle('📊 Weekly Ticket Summary')
        .setDescription(`**${weekStart} → ${weekEnd}**\nHere's how the support team performed this week.`)
        .setColor('#6366f1')
        .addFields(
          {
            name: '🎫 Tickets',
            value: [
              `**Opened:** ${fmt(overview.total_opened)}`,
              `**Closed:** ${fmt(overview.total_closed)}`,
              `**Urgent:** ${fmt(overview.urgent_count)}`,
            ].join('\n'),
            inline: true,
          },
          {
            name: '⏱️ Response Times',
            value: [
              `**Avg First Response:** ${avgResponse}`,
              `**Avg Resolution:** ${avgClose}`,
              `**Avg Rating:** ${overview.avg_rating !== null ? '⭐ ' + fmt(overview.avg_rating) : '—'}`,
            ].join('\n'),
            inline: true,
          },
          { name: '\u200b', value: '\u200b', inline: false }, // spacer
          {
            name: '🏷️ Top Categories',
            value: categoryLines,
            inline: true,
          },
          {
            name: '📅 Tickets by Day',
            value: dayLines,
            inline: true,
          },
        )
        .setFooter({ text: SERVER_NAME + ' · Auto-generated weekly summary' })
        .setTimestamp();

      await summaryChannel.send({ embeds: [embed] });
      console.log('[Weekly] Summary posted for week ending', weekEnd);
    } catch (err) {
      console.error('[Weekly] Failed to post summary:', err.message);
    }
  }

  // Schedule: fire once 7 days after bot starts, then every 7 days.
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  setInterval(postWeeklySummary, SEVEN_DAYS_MS);
  console.log('[Weekly] Summary scheduled every 7 days.');
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('[Bot] Pollers started.');
});

// ─── Message listener — save to DB for panel chat ──────────────────────────────
client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild) return;
  const match = (msg.channel.topic || '').match(/ID: ([a-f0-9-]{36})/);
  if (!match) return;

  // Collect attachments (images + files)
  const attachments = [...msg.attachments.values()].map(a => ({
    name: a.name,
    url:  a.url,
    type: a.contentType || '',
  }));

  const member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
  await db(
    'INSERT INTO ticket_messages (ticket_id, discord_msg_id, author_id, author_tag, avatar_url, is_staff, content, attachments) VALUES (?,?,?,?,?,?,?,?)',
    [match[1], msg.id, msg.author.id, msg.author.tag,
     msg.author.displayAvatarURL({ size: 64, extension: 'png' }),
     member && isStaff(member) ? 1 : 0,
     msg.content || '',
     attachments.length ? JSON.stringify(attachments) : null]
  ).catch(err => { if (err.code !== 'ER_DUP_ENTRY') console.error('[Msg] Save error:', err.message); });

  // Set first_response_at when staff sends the first reply in a ticket
  if (member && isStaff(member)) {
    db(
      'UPDATE tickets SET first_response_at = NOW() WHERE id = ? AND first_response_at IS NULL',
      [match[1]]
    ).catch(() => {});
  }

  // AI image analysis + reply — only for non-staff
  const member2 = member || await msg.guild.members.fetch(msg.author.id).catch(() => null);
  if (ai.enabled() && !isStaff(member2)) {
    const images = attachments.filter(a =>
      /\.(png|jpe?g|gif|webp)$/i.test(a.name || '') || (a.type || '').startsWith('image/')
    );
    for (const img of images) {
      ai.handleImageMessage(msg.channel, img.url, msg.author.tag).catch(err => console.error('[AI] image failed:', err.message));
    }

    if (msg.content?.trim()) {
      ai.replyInTicket(msg.channel, msg.content.trim(), msg.author.tag).catch(err => console.error('[AI] replyInTicket failed:', err.message));
    }
  }
});

// ─── AI: extra channels (non-ticket) ──────────────────────────────────────────
// Cached list of extra AI channel IDs — refreshed every 60s
let extraAiChannelIds = new Set();
async function refreshAiChannels() {
  try {
    const rows = await db('SELECT channel_id FROM ai_channels WHERE enabled = 1');
    extraAiChannelIds = new Set(rows.map(r => r.channel_id));
  } catch { /* keep old set */ }
}
refreshAiChannels();
setInterval(refreshAiChannels, 60_000);

client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild) return;
  if (!extraAiChannelIds.has(msg.channel.id)) return;
  if (!ai.enabled()) return;

  // Image analysis
  const attachments = [...msg.attachments.values()].map(a => ({
    name: a.name, url: a.url, type: a.contentType || '',
  }));
  const images = attachments.filter(a =>
    /\.(png|jpe?g|gif|webp)$/i.test(a.name || '') || (a.type || '').startsWith('image/')
  );
  for (const img of images) {
    ai.handleImageMessage(msg.channel, img.url, msg.author.tag).catch(err => console.error('[AI] image failed:', err.message));
  }

  // Text reply — only if the message has actual content and mentions the bot or starts with '?'
  const text = msg.content?.trim();
  if (!text) return;
  const mentioned = msg.mentions.has(client.user);
  const askPrefix = text.startsWith('?');
  if (!mentioned && !askPrefix) return;

  const question = text.replace(/<@!?\d+>/g, '').replace(/^\?\s*/, '').trim();
  if (!question) return;

  try {
    msg.channel.sendTyping().catch(() => {});
    const faqCtx = await (async () => {
      try {
        const rows = await db('SELECT title, content FROM ai_faq WHERE enabled = 1 ORDER BY category, title');
        if (!rows?.length) return '';
        return '\n\n---\nKNOWLEDGE BASE:\n' + rows.map(r => `### ${r.title}\n${r.content}`).join('\n\n') + '\n---';
      } catch { return ''; }
    })();
    const systemPrompt =
      'You are a helpful support assistant for a Discord server. ' +
      'Always reply in the SAME LANGUAGE the user wrote in (Swedish or English). ' +
      'Be friendly, professional and concise. Keep replies under 150 words. ' +
      'Never make up information. If the issue needs a human, say so clearly.' +
      faqCtx;
    const res = await ai.rawChat(systemPrompt, question);
    const reply = res.choices[0]?.message?.content?.trim();
    if (reply) await msg.reply({ content: reply });
  } catch (err) { console.error('[AI:channel]', err.message); }
});

// ─── Interactions ──────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

  // ── Autocomplete: /template name ───────────────────────────────────────────
  if (interaction.isAutocomplete() && interaction.commandName === 'template') {
    try {
      const focused = (interaction.options.getFocused() || '').toString().toLowerCase();
      const rows = await db('SELECT id, title, category FROM reply_templates WHERE enabled = 1 ORDER BY category, title LIMIT 100');
      const filtered = rows
        .filter(r => !focused || r.title.toLowerCase().includes(focused) || (r.category || '').toLowerCase().includes(focused))
        .slice(0, 25)
        .map(r => ({ name: `${r.title}${r.category ? ' · ' + r.category : ''}`.slice(0, 100), value: String(r.id) }));
      await interaction.respond(filtered).catch(() => {});
    } catch {
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  // ── Ticket button → show modal immediately ────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('ticket_') && !interaction.customId.startsWith('ticket_close')) {
    const type = interaction.customId.replace('ticket_', '');
    if (!CATEGORIES.find(c => c.name === type)) return;

    const cdKey = 'create:' + interaction.user.id;
    if (onCooldown(cdKey, 15000)) {
      return interaction.reply({ content: '⏳ Vänta ' + cooldownLeft(cdKey, 15000) + 's.', flags: 64 });
    }
    setCooldown(cdKey);

    const modal = new ModalBuilder().setCustomId('modal_ticket_' + type).setTitle(type + ' Ticket');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('subject').setLabel('Ämne').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('description').setLabel('Beskrivning').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)
      ),
    );
    await interaction.showModal(modal).catch(() => {});
    return;
  }

  // ── Modal submit → create ticket ──────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_ticket_')) {
    const type        = interaction.customId.replace('modal_ticket_', '');
    const subject     = interaction.fields.getTextInputValue('subject');
    const description = interaction.fields.getTextInputValue('description');
    const { guild, user } = interaction;

    try {
      await interaction.deferReply({ flags: 64 });

      const cat = CATEGORIES.find(c => c.name === type);
      if (!cat) return interaction.editReply({ content: '❌ Kategori hittades inte. Kör /refreshpanel.' });

      const discordCat = guild.channels.cache.get(cat.discord_category_id);
      if (!discordCat) return interaction.editReply({ content: '❌ Discord-kategorin för "' + type + '" saknas. Kontakta en admin.' });

      // Ban check
      const [banned] = await db('SELECT reason FROM banned_users WHERE user_id=?', [user.id]);
      if (banned) return interaction.editReply({ content: '🚫 Du är bannad. Orsak: ' + banned.reason });

      const openCountRows = await db(
        "SELECT COUNT(*) AS n FROM tickets WHERE created_by_id=? AND (status='Öppen' OR status='open')",
        [user.id]
      );
      const openCount = openCountRows?.[0]?.n || 0;
      if (openCount >= MAX_OPEN_TICKETS_PER_USER) {
        return interaction.editReply({ content: '⚠ Du kan ha max ' + MAX_OPEN_TICKETS_PER_USER + ' öppna tickets åt gången.' });
      }

      const ticketId     = uuidv4();
      const supportRoles = SUPPORT_ROLE_IDS.map(id => guild.roles.cache.get(id)).filter(Boolean);

      const ticketCh = await guild.channels.create({
        name:   ('ticket-' + user.username.toLowerCase().replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o').replace(/[^a-z0-9-]/g,'') + '-' + ticketId.slice(0, 4)) || ('ticket-user-' + ticketId.slice(0, 4)),
        type:   ChannelType.GuildText,
        parent: discordCat,
        topic:  'ID: ' + ticketId + ' | Typ: ' + type + ' | Ämne: ' + subject,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          ...supportRoles.map(r => ({ id: r.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] })),
        ],
      });

      const embed = new EmbedBuilder()
        .setTitle('🎫 ' + type + ' Ticket')
        .setDescription('Tack! Vi återkommer så snart som möjligt.')
        .setColor(cat.color || '#6366f1')
        .addFields(
          { name: 'Typ',         value: cat.emoji + ' ' + type, inline: true },
          { name: 'Status',      value: '🟢 Öppen',             inline: true },
          { name: 'Skapad av',   value: String(user),           inline: true },
          { name: 'Ämne',        value: subject,                inline: false },
          { name: 'Beskrivning', value: description,            inline: false },
        )
        .setFooter({ text: 'Stäng med knappen nedan' })
        .setTimestamp();

      await ticketCh.send({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_close_' + ticketId).setLabel('Stäng ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
        )],
      });

      if (supportRoles.length) await ticketCh.send(supportRoles.map(r => r.toString()).join(' '));

      await db(
        'INSERT INTO tickets (id, type, category, status, subject, description, channel_id, guild_id, created_by, created_by_id, user_id, user_tag) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [ticketId, type, type.toLowerCase(), 'Öppen', subject, description, ticketCh.id, guild.id, user.tag, user.id, user.id, user.tag]
      ).catch(err => console.error('[DB] Ticket save failed:', err.message));

      await interaction.editReply({ content: '✅ Din ticket: ' + ticketCh.toString() });
      console.log('[Bot] Created "' + type + '" ticket for ' + user.tag);

      // AI in background (only if enabled for this category)
      if (ai.enabled() && cat.ai_enabled != 0) {
        ai.detectPriority(subject, description).then(p => {
          if (p && p !== 'normal') db('UPDATE tickets SET priority=? WHERE id=?', [p, ticketId]).catch(() => {});
        }).catch(() => {});
        ai.suggestReply(ticketCh, subject, description, type).catch(err => console.error('[AI] suggestReply failed:', err.message));
      } else {
      }

    } catch (err) {
      console.error('[Modal] Error:', err.message);
      interaction.editReply({ content: '❌ Fel inträffade. Försök igen.' }).catch(() => {});
    }
    return;
  }

  // ── AI buttons ────────────────────────────────────────────────────────────
  if (interaction.isButton() && (interaction.customId === 'ai_dismiss' || interaction.customId.startsWith('ai_send_'))) {
    if (interaction.customId === 'ai_dismiss') {
      await interaction.message.delete().catch(() => {});
      return interaction.reply({ content: '✕ Dismissed.', flags: 64 });
    }
    const suggestion = interaction.message.embeds[0]?.description;
    if (!suggestion) return;
    await interaction.message.delete().catch(() => {});
    await interaction.channel.send({ content: suggestion });
    return interaction.reply({ content: '✅ Sent!', flags: 64 });
  }

  // ── CSAT rating buttons ─────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('csat_')) {
    // customId format: csat_<score>_<ticketId>
    const parts    = interaction.customId.split('_');
    const score    = parseInt(parts[1]);
    const ticketId = parts.slice(2).join('_');

    if (!score || score < 1 || score > 5 || !ticketId) return;

    // Fetch ticket to verify this user owns it
    const [ticket] = await db('SELECT created_by_id, rating FROM tickets WHERE id=? LIMIT 1', [ticketId]).catch(() => []);
    if (!ticket) return interaction.reply({ content: '❌ Ticket hittades inte.', flags: 64 });
    if (ticket.created_by_id !== interaction.user.id) return interaction.reply({ content: '⛔ Du kan inte betygsätta andras tickets.', flags: 64 });
    if (ticket.rating) return interaction.reply({ content: 'ℹ️ Du har redan betygsättat den här ticketen.', flags: 64 });

    // Save rating to DB
    await db('UPDATE tickets SET rating=? WHERE id=?', [score, ticketId]).catch(() => {});

    // Stars label
    const stars = '★'.repeat(score) + '☆'.repeat(5 - score);

    // Update the DM message to show the rating is saved
    const confirmedEmbed = new EmbedBuilder()
      .setTitle('✅ Tack för ditt omdöme!')
      .setDescription(
        'Du gav **' + score + '/5** ' + stars + '\n\n' +
        'Ditt omdöme har sparats och hjälper oss att förbättra vår support. Tack!'
      )
      .setColor(score >= 4 ? '#22c55e' : score === 3 ? '#f59e0b' : '#ef4444')
      .setFooter({ text: SERVER_NAME + ' Support • Ticket ' + ticketId.slice(0, 8) });

    // Edit the original DM to remove buttons and show confirmation
    await interaction.update({ embeds: [confirmedEmbed], components: [] }).catch(() => {
      // If update fails (e.g. DM already gone), just ack
      interaction.reply({ content: '✅ Betyg sparat: ' + stars, flags: 64 }).catch(() => {});
    });

    return;
  }

  // ── Close button ──────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('ticket_close_')) {
    const ticketId = interaction.customId.replace('ticket_close_', '');
    const { guild, user, channel } = interaction;
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member || !isStaff(member)) {
      return interaction.reply({ content: '🚫 Du har inte behörighet.', flags: 64 });
    }
    const cdKey = 'close:' + user.id;
    if (onCooldown(cdKey, 5000)) return interaction.reply({ content: '⏳ Vänta ' + cooldownLeft(cdKey, 5000) + 's.', flags: 64 });
    setCooldown(cdKey);
    await interaction.deferReply({ flags: 64 });
    await closeTicket(channel, ticketId, user);
    await interaction.editReply({ content: '✅ Stängd.' });
    await modLog(guild, { action: 'CloseTicket', actor: user, channel, ticketId });
    return;
  }

  // ── /ticket ban & unban ───────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'ticket') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return interaction.reply({ content: '🚫 Saknar behörighet.', flags: 64 });

    const sub    = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Ingen anledning';

    if (sub === 'ban') {
      try {
        await db('INSERT INTO banned_users (user_id, reason, banned_by) VALUES (?,?,?)', [target.id, reason, interaction.user.id]);
        await interaction.reply({ content: '✅ ' + target.tag + ' bannad. Orsak: ' + reason, flags: 64 });
        await modLog(interaction.guild, { action: 'BanUser', actor: interaction.user, target, reason });
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return interaction.reply({ content: '⚠ Redan bannad.', flags: 64 });
        await interaction.reply({ content: '❌ Misslyckades.', flags: 64 });
      }
    }

    if (sub === 'unban') {
      const res = await db('DELETE FROM banned_users WHERE user_id=?', [target.id]);
      if (res.affectedRows > 0) {
        await interaction.reply({ content: '✅ ' + target.tag + ' unbannad.', flags: 64 });
        await modLog(interaction.guild, { action: 'UnbanUser', actor: interaction.user, target });
      } else {
        await interaction.reply({ content: '⚠ Inte i banlistan.', flags: 64 });
      }
    }
    return;
  }

  // ── /summarise ────────────────────────────────────────────────────────────
  // ── /note <message> ────────────────────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'note') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) {
      return interaction.reply({ content: '\u26d4 Staff only.', flags: 64 });
    }

    const match = (interaction.channel.topic || '').match(/ID: ([a-f0-9-]{36})/);
    if (!match) {
      return interaction.reply({ content: '\u274c Only works inside a ticket channel.', flags: 64 });
    }
    const ticketId = match[1];
    const noteText = interaction.options.getString('message', true);

    await interaction.deferReply({ flags: 64 });

    try {
      // Find or create a private Staff Notes thread on this channel
      let thread = interaction.channel.threads.cache.find(t => t.name === '\ud83d\udd12 Staff Notes' && !t.archived);

      if (!thread) {
        // Try to find an archived one and unarchive it first
        const archived = await interaction.channel.threads.fetchArchived({ type: 'private' }).catch(() => null);
        thread = archived?.threads.find(t => t.name === '\ud83d\udd12 Staff Notes') || null;
        if (thread?.archived) {
          await thread.setArchived(false).catch(() => { thread = null; });
        }
      }

      if (!thread) {
        const { ChannelType } = require('discord.js');
        thread = await interaction.channel.threads.create({
          name: '\ud83d\udd12 Staff Notes',
          type: ChannelType.PrivateThread,
          invitable: false,   // only staff with ManageThreads can add members
          reason: 'Staff notes thread for ticket ' + ticketId.slice(0, 8),
        }).catch(() => null);
      }

      if (!thread) {
        // Fallback: private thread creation may be unavailable (no boost) — post in channel with clear visual
        const fallbackEmbed = new EmbedBuilder()
          .setDescription('\ud83d\udd12 **Staff Note** (internal)\n\n' + noteText)
          .setColor('#f59e0b')
          .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL({ size: 64 }) })
          .setTimestamp()
          .setFooter({ text: 'Internal staff note • ' + SERVER_NAME });
        await interaction.channel.send({ embeds: [fallbackEmbed] }).catch(() => {});
      } else {
        // Add the author to the thread if not already in it
        await thread.members.add(interaction.user.id).catch(() => {});

        const noteEmbed = new EmbedBuilder()
          .setDescription(noteText)
          .setColor('#f59e0b')
          .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL({ size: 64 }) })
          .setTimestamp()
          .setFooter({ text: 'Internal staff note • ' + SERVER_NAME });
        await thread.send({ embeds: [noteEmbed] }).catch(() => {});
      }

      // Save to ticket_notes (dedicated, searchable table) and ticket_logs (activity feed)
      await db(
        'INSERT INTO ticket_notes (ticket_id, staff_id, staff_tag, note, source) VALUES (?,?,?,?,?)',
        [ticketId, interaction.user.id, interaction.user.tag, noteText, 'discord']
      ).catch(() => {});

      await db(
        'INSERT INTO ticket_logs (ticket_id, staff_id, staff_tag, action, details) VALUES (?,?,?,?,?)',
        [ticketId, interaction.user.id, interaction.user.tag, 'note', noteText]
      ).catch(() => {});

      await modLog(interaction.guild, {
        action: 'StaffNote',
        actor: interaction.user,
        channel: interaction.channel,
        ticketId,
        reason: noteText.slice(0, 200),
      }).catch(() => {});

      await interaction.editReply({ content: '\ud83d\udd12 Note saved.' });
    } catch (err) {
      console.error('[/note] Error:', err.message);
      await interaction.editReply({ content: '\u274c Failed to save note: ' + err.message });
    }
    return;
  }

  // ── /template <name> ────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'template') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) {
      return interaction.reply({ content: '\u26d4 Staff only.', flags: 64 });
    }

    const match = (interaction.channel.topic || '').match(/ID: ([a-f0-9-]{36})/);
    if (!match) {
      return interaction.reply({ content: '\u274c Only works inside a ticket channel.', flags: 64 });
    }
    const ticketId = match[1];
    const templateId = interaction.options.getString('name', true);

    await interaction.deferReply({ flags: 64 });

    try {
      const [tpl] = await db('SELECT * FROM reply_templates WHERE id = ? AND enabled = 1', [templateId]);
      if (!tpl) {
        return interaction.editReply({ content: '\u274c Template not found (it may have been deleted or disabled). Try the command again to refresh the list.' });
      }

      // Simple placeholder substitution
      const [ticket] = await db('SELECT created_by_id, user_tag FROM tickets WHERE id = ?', [ticketId]).catch(() => []);
      let content = tpl.content
        .replace(/\{user\}/gi, ticket?.created_by_id ? `<@${ticket.created_by_id}>` : (ticket?.user_tag || 'there'))
        .replace(/\{staff\}/gi, interaction.user.toString())
        .replace(/\{ticket\}/gi, '#' + (ticketId.slice(0, 8)));

      const sent = await interaction.channel.send({ content }).catch(() => null);
      if (!sent) return interaction.editReply({ content: '\u274c Failed to send the template message.' });

      // Save to ticket_messages so it shows up in the panel transcript
      await db(
        'INSERT INTO ticket_messages (ticket_id, discord_msg_id, author_id, author_tag, avatar_url, is_staff, content) VALUES (?,?,?,?,?,?,?)',
        [ticketId, sent.id, interaction.user.id, interaction.user.tag, interaction.user.displayAvatarURL({ size: 64, extension: 'png' }), 1, content]
      ).catch(() => {});

      await db('UPDATE tickets SET first_response_at = NOW() WHERE id = ? AND first_response_at IS NULL', [ticketId]).catch(() => {});
      await db('UPDATE reply_templates SET usage_count = usage_count + 1 WHERE id = ?', [templateId]).catch(() => {});

      await db(
        'INSERT INTO ticket_logs (ticket_id, staff_id, staff_tag, action, details) VALUES (?,?,?,?,?)',
        [ticketId, interaction.user.id, interaction.user.tag, 'template', tpl.title]
      ).catch(() => {});

      await interaction.editReply({ content: '\u2705 Sent template "' + tpl.title + '".' });
    } catch (err) {
      console.error('[/template] Error:', err.message);
      await interaction.editReply({ content: '\u274c Failed to send template: ' + err.message });
    }
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'summarise') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) return interaction.reply({ content: '🚫 Staff only.', flags: 64 });
    if (!ai.enabled()) return interaction.reply({ content: '❌ AI disabled. Add GROQ_API_KEY to .env', flags: 64 });
    const match = (interaction.channel.topic || '').match(/ID: ([a-f0-9-]{36})/);
    if (!match) return interaction.reply({ content: '❌ Only works in ticket channels.', flags: 64 });
    await interaction.deferReply({ flags: 64 });
    const msgs = await db('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY sent_at ASC LIMIT 50', [match[1]]);
    if (!msgs.length) return interaction.editReply('No messages saved yet.');
    const summary = await ai.summarise(msgs);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('🤖 AI Summary').setDescription(summary || 'Could not summarise.').setFooter({ text: 'Groq AI' })]
    });
    return;
  }

  // ── /add <user> ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'add') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) return interaction.reply({ content: '🚫 Saknar behörighet.', flags: 64 });

    const match = (interaction.channel.topic || '').match(/ID: ([a-f0-9-]{36})/);
    if (!match) return interaction.reply({ content: '❌ Endast i ticket-kanaler.', flags: 64 });

    const target = interaction.options.getUser('user', true);
    if (target.bot) return interaction.reply({ content: '⚠ Kan inte lägga till en bot.', flags: 64 });

    await interaction.deferReply({ flags: 64 });
    const updated = await interaction.channel.permissionOverwrites.edit(target.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }).catch(() => null);
    if (!updated) return interaction.editReply({ content: '❌ Misslyckades att lägga till användaren.' });

    await interaction.channel.send({ content: '✅ ' + target.toString() + ' har lagts till i denna ticket av ' + interaction.user.toString() + '.' }).catch(() => {});
    await interaction.editReply({ content: '✅ Klar.' }).catch(() => {});
    await modLog(interaction.guild, { action: 'AddToTicket', actor: interaction.user, target, channel: interaction.channel, ticketId: match[1] });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'remove') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) return interaction.reply({ content: '🚫 Saknar behörighet.', flags: 64 });

    const match = (interaction.channel.topic || '').match(/ID: ([a-f0-9-]{36})/);
    if (!match) return interaction.reply({ content: '❌ Endast i ticket-kanaler.', flags: 64 });

    const target = interaction.options.getUser('user', true);
    const opener = await db('SELECT created_by_id FROM tickets WHERE id=? LIMIT 1', [match[1]]).catch(() => []);
    if (opener?.[0]?.created_by_id && target.id === opener[0].created_by_id) {
      return interaction.reply({ content: '⚠ Kan inte ta bort ticket-skaparen.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });
    const removed = await interaction.channel.permissionOverwrites.delete(target.id).catch(() => null);
    if (!removed) return interaction.editReply({ content: '❌ Misslyckades att ta bort användaren.' });

    await interaction.channel.send({ content: '🧹 ' + target.toString() + ' togs bort från denna ticket av ' + interaction.user.toString() + '.' }).catch(() => {});
    await interaction.editReply({ content: '✅ Klar.' }).catch(() => {});
    await modLog(interaction.guild, { action: 'RemoveFromTicket', actor: interaction.user, target, channel: interaction.channel, ticketId: match[1] });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'claim') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) return interaction.reply({ content: '🚫 Saknar behörighet.', flags: 64 });

    const match = (interaction.channel.topic || '').match(/ID: ([a-f0-9-]{36})/);
    if (!match) return interaction.reply({ content: '❌ Endast i ticket-kanaler.', flags: 64 });

    await interaction.deferReply({ flags: 64 });
    await db('UPDATE tickets SET claimed_by=?, claimed_by_tag=? WHERE id=?', [interaction.user.id, interaction.user.tag, match[1]]).catch(() => null);
    await db('INSERT INTO ticket_logs (ticket_id, staff_id, staff_tag, action) VALUES (?,?,?,?)', [match[1], interaction.user.id, interaction.user.tag, 'claim']).catch(() => null);
    await interaction.channel.send({ content: '✋ ' + interaction.user.toString() + ' claimed this ticket.' }).catch(() => {});
    await interaction.editReply({ content: '✅ Claimed.' }).catch(() => {});
    await modLog(interaction.guild, { action: 'ClaimTicket', actor: interaction.user, channel: interaction.channel, ticketId: match[1] });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'assign') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) return interaction.reply({ content: '🚫 Saknar behörighet.', flags: 64 });

    const match = (interaction.channel.topic || '').match(/ID: ([a-f0-9-]{36})/);
    if (!match) return interaction.reply({ content: '❌ Endast i ticket-kanaler.', flags: 64 });
    const ticketId = match[1];

    const target = interaction.options.getUser('staff', true);
    if (target.bot) return interaction.reply({ content: '⚠ Kan inte tilldela en bot.', flags: 64 });

    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!targetMember || !isStaff(targetMember)) {
      return interaction.reply({ content: '⚠ ' + target.toString() + ' är inte staff.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    await db('UPDATE tickets SET assigned_to=?, assigned_to_tag=? WHERE id=?', [target.id, target.tag, ticketId]).catch(() => null);
    await db('INSERT INTO ticket_logs (ticket_id, staff_id, staff_tag, action, details) VALUES (?,?,?,?,?)',
      [ticketId, interaction.user.id, interaction.user.tag, 'assign', target.tag]).catch(() => null);

    // Update channel topic with the new assignee, replacing any previous "Tilldelad" tag
    try {
      const currentTopic = interaction.channel.topic || '';
      const withoutAssign = currentTopic.replace(/\s*\|\s*Tilldelad:[^|]*/i, '');
      await interaction.channel.setTopic((withoutAssign + ' | Tilldelad: ' + target.tag).slice(0, 1024)).catch(() => {});
    } catch {}

    await interaction.channel.send({
      content: '📌 ' + interaction.user.toString() + ' tilldelade denna ticket till ' + target.toString() + '.'
    }).catch(() => {});

    // Notify the new owner via DM
    await target.send({
      content: '📌 ' + interaction.user.tag + ' tilldelade dig en ticket i ' + (interaction.guild.name || SERVER_NAME) + ': ' + interaction.channel.toString(),
    }).catch(() => {});

    await interaction.editReply({ content: '✅ Tilldelad till ' + target.toString() + '.' }).catch(() => {});
    await modLog(interaction.guild, { action: 'AssignTicket', actor: interaction.user, target, channel: interaction.channel, ticketId });
    return;
  }


  if (interaction.isChatInputCommand() && interaction.commandName === 'priority') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) return interaction.reply({ content: '🚫 Saknar behörighet.', flags: 64 });

    const match = (interaction.channel.topic || '').match(/ID: ([a-f0-9-]{36})/);
    if (!match) return interaction.reply({ content: '❌ Endast i ticket-kanaler.', flags: 64 });

    const level = interaction.options.getString('level', true);
    await interaction.deferReply({ flags: 64 });
    await db('UPDATE tickets SET priority=? WHERE id=?', [level, match[1]]).catch(() => null);
    await db('INSERT INTO ticket_logs (ticket_id, staff_id, staff_tag, action, details) VALUES (?,?,?,?,?)', [match[1], interaction.user.id, interaction.user.tag, 'priority', level]).catch(() => null);
    await interaction.channel.send({ content: '⚡ Priority set to `' + level + '` by ' + interaction.user.toString() + '.' }).catch(() => {});
    await interaction.editReply({ content: '✅ Updated.' }).catch(() => {});
    await modLog(interaction.guild, { action: 'SetPriority', actor: interaction.user, channel: interaction.channel, ticketId: match[1], reason: level });
    return;
  }

  // ── /refreshpanel ─────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'refreshpanel') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) return interaction.reply({ content: '🚫 Staff only.', flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await postOrRefreshPanel(interaction.guild);
    return interaction.editReply({ content: '✅ Panel refreshed!' });
  }

  // ── /close <ticket_id> ────────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'close') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) return interaction.reply({ content: '🚫 Saknar behörighet.', flags: 64 });
    const ticketId = interaction.options.getString('ticket_id', true);
    const ch = interaction.guild.channels.cache.find(c => c.topic?.includes('ID: ' + ticketId));
    if (!ch) return interaction.reply({ content: '❌ Ticket-kanal hittades inte.', flags: 64 });
    await interaction.deferReply({ flags: 64 });
    await closeTicket(ch, ticketId, interaction.user);
    await interaction.editReply({ content: '✅ Stängd.' });
    return;
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
async function startBot() {
  await client.login(BOT_TOKEN);
  return client;
}

module.exports = { startBot, client, loadCategories, buildPanelEmbed, postOrRefreshPanel, closeTicket };
