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
const DELETE_DELAY       = parseInt(process.env.TICKET_DELETE_DELAY_MS || '5000');
const SUPPORT_ROLE_IDS   = (process.env.SUPPORT_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const SERVER_NAME        = process.env.SERVER_NAME || 'TicketDesk';
const MAX_OPEN_TICKETS_PER_USER = Math.max(1, parseInt(process.env.MAX_OPEN_TICKETS_PER_USER || '5'));

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

    // DM opener
    if (opener?.created_by_id) {
      const u = await client.users.fetch(opener.created_by_id).catch(() => null);
      if (u) await u.send({ content: '📄 Din ticket har stängts:', embeds: [embed], files: [{ attachment: buf, name: fname }] }).catch(() => {});
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
    { name: 'priority',     description: 'Sätt prioritet på denna ticket', options: [{ name: 'level', type: 3, description: 'low / normal / urgent', required: true, choices: [{ name: 'low', value: 'low' }, { name: 'normal', value: 'normal' }, { name: 'urgent', value: 'urgent' }] }] },
    { name: 'summarise',    description: 'AI-sammanfattning av denna ticket (staff only)' },
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
});

// ─── Interactions ──────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {

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
      if (ai.enabled() && cat.ai_enabled !== 0) {
        ai.detectPriority(subject, description).then(p => {
          if (p && p !== 'normal') db('UPDATE tickets SET priority=? WHERE id=?', [p, ticketId]).catch(() => {});
        }).catch(() => {});
        ai.suggestReply(ticketCh, subject, description, type).catch(() => {});
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
