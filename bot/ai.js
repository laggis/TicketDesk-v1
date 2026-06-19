let groq = null;
let MODEL = 'llama-3.3-70b-versatile';

const SYSTEM = 'You are a helpful support assistant for a Discord server ticket system. '
  + 'Always reply in the SAME LANGUAGE the user wrote in (Swedish or English). '
  + 'Be friendly, professional and concise. Keep replies under 150 words. '
  + 'Never make up information. If the issue needs a human, say so clearly. '
  + 'Write the reply directly — no meta-commentary.';

try {
  const Groq = require('groq-sdk');
  if (process.env.GROQ_API_KEY) {
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    console.log('[AI] Groq loaded (llama-3.3-70b)');
  } else {
    console.log('[AI] GROQ_API_KEY not set — AI disabled');
  }
} catch {
  console.log('[AI] groq-sdk not installed — run: npm install groq-sdk');
}

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function enabled() { return !!groq; }

async function chat(messages, max_tokens = 300, temperature = 0.6) {
  const res = await groq.chat.completions.create({ model: MODEL, messages, max_tokens, temperature });
  return res.choices[0]?.message?.content?.trim() || null;
}

async function suggestReply(channel, subject, description, type) {
  if (!groq) return;
  try {
    const text = await chat([
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: 'A user opened a "' + type + '" ticket.\nSubject: ' + subject + '\nMessage: ' + description + '\n\nSuggest a helpful first response.' }
    ]);
    if (!text) return;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2).setTitle('🤖 AI Suggested Reply').setDescription(text)
      .setFooter({ text: 'Groq AI • Review before sending!' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ai_send_' + channel.id).setLabel('Send This Reply').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ai_dismiss').setLabel('Dismiss').setStyle(ButtonStyle.Secondary),
    );
    await channel.send({ embeds: [embed], components: [row] });
  } catch (err) { console.error('[AI] suggestReply:', err.message); }
}

async function detectPriority(subject, description) {
  if (!groq) return 'normal';
  try {
    const raw = await chat([
      { role: 'system', content: 'Classify ticket urgency. Respond ONLY with JSON.' },
      { role: 'user',   content: 'Subject: ' + subject + '\nMessage: ' + description + '\n\nRespond: {"priority":"low|normal|urgent","reason":"one sentence"}' }
    ], 80, 0.1);
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
    console.log('[AI] Priority: ' + json.priority + ' — ' + json.reason);
    return json.priority || 'normal';
  } catch { return 'normal'; }
}


async function draftReply(ticket, messages = [], faqRows = [], templateRows = []) {
  if (!groq) return null;
  try {
    const transcript = messages.slice(-20).map(m => {
      const who = m.is_staff ? '[STAFF]' : '[USER]';
      return `${who} ${m.author_tag || 'unknown'}: ${m.content || ''}`;
    }).join('\n');

    const faq = faqRows
      .filter(f => f.enabled === undefined || f.enabled)
      .slice(0, 8)
      .map(f => `- ${f.title || f.category}: ${f.content}`)
      .join('\n');

    const templates = templateRows
      .filter(t => t.enabled === undefined || t.enabled)
      .slice(0, 10)
      .map(t => `- ${t.label || t.title}: ${t.text || t.content}`)
      .join('\n');

    const prompt = `Ticket subject: ${ticket.subject || ''}\nTicket category: ${ticket.category || ticket.type || ''}\nTicket description: ${ticket.description || ''}\n\nConversation so far:\n${transcript || '(no saved messages yet)'}\n\nSaved FAQ / knowledge base:\n${faq || '(none)'}\n\nSaved reply templates:\n${templates || '(none)'}\n\nWrite a helpful staff reply that can be pasted directly into the ticket. Do not close the ticket unless the user clearly says the issue is solved.`;

    return await chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt }
    ], 350, 0.45);
  } catch (err) {
    console.error('[AI] draftReply:', err.message);
    return null;
  }
}

async function summarise(messages) {
  if (!groq) return null;
  try {
    const transcript = messages.map(m => (m.is_staff ? '[STAFF]' : '[USER]') + ' ' + m.author_tag + ': ' + m.content).join('\n');
    return await chat([
      { role: 'system', content: 'Summarise support ticket conversations concisely. Reply in the same language.' },
      { role: 'user',   content: 'Summarise in 3-5 bullet points:\n\n' + transcript }
    ], 300, 0.4);
  } catch (err) { console.error('[AI] summarise:', err.message); return null; }
}

module.exports = { enabled, suggestReply, detectPriority, draftReply, summarise };
