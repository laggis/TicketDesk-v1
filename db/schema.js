const db = require('./pool');

async function setup() {
  console.log('[DB] Setting up tables...');
  // Ensure proper Unicode support for Swedish characters (å ä ö)
  await db("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci").catch(()=>{});
  await db("SET CHARACTER SET utf8mb4").catch(()=>{});

  await db(`CREATE TABLE IF NOT EXISTS tickets (
    id                  VARCHAR(36)  PRIMARY KEY,
    ticket_number       INT          AUTO_INCREMENT UNIQUE,
    guild_id            VARCHAR(20)  DEFAULT NULL,
    channel_id          VARCHAR(20)  DEFAULT NULL,
    type                VARCHAR(50)  DEFAULT 'Support',
    category            VARCHAR(50)  DEFAULT 'general',
    status              VARCHAR(20)  DEFAULT 'Öppen',
    priority            VARCHAR(10)  DEFAULT 'normal',
    subject             VARCHAR(255) DEFAULT NULL,
    description         TEXT         DEFAULT NULL,
    user_id             VARCHAR(20)  DEFAULT NULL,
    user_tag            VARCHAR(100) DEFAULT NULL,
    created_by          VARCHAR(100) DEFAULT NULL,
    created_by_id       VARCHAR(20)  DEFAULT NULL,
    claimed_by          VARCHAR(20)  DEFAULT NULL,
    claimed_by_tag      VARCHAR(100) DEFAULT NULL,
    closed_by           VARCHAR(100) DEFAULT NULL,
    closed_by_id        VARCHAR(20)  DEFAULT NULL,
    close_reason        TEXT         DEFAULT NULL,
    close_requested_by  VARCHAR(100) DEFAULT NULL,
    pending_close       TINYINT(1)   DEFAULT 0,
    transcript_url      VARCHAR(500) DEFAULT NULL,
    rating              TINYINT      DEFAULT NULL,
    first_response_at   DATETIME     DEFAULT NULL,
    opened_at           DATETIME     DEFAULT CURRENT_TIMESTAMP,
    closed_at           DATETIME     DEFAULT NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await db(`CREATE TABLE IF NOT EXISTS ticket_messages (
    id             INT          AUTO_INCREMENT PRIMARY KEY,
    ticket_id      VARCHAR(36)  NOT NULL,
    discord_msg_id VARCHAR(20)  DEFAULT NULL,
    author_id      VARCHAR(20)  DEFAULT NULL,
    author_tag     VARCHAR(100) DEFAULT NULL,
    avatar_url     VARCHAR(500) DEFAULT NULL,
    is_staff       TINYINT(1)   DEFAULT 0,
    content        TEXT         DEFAULT NULL,
    sent_at        DATETIME     DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await db(`CREATE TABLE IF NOT EXISTS ticket_logs (
    id           INT          AUTO_INCREMENT PRIMARY KEY,
    ticket_id    VARCHAR(36)  NOT NULL,
    staff_id     VARCHAR(20)  DEFAULT NULL,
    staff_tag    VARCHAR(100) DEFAULT NULL,
    action       VARCHAR(100) DEFAULT NULL,
    details      TEXT         DEFAULT NULL,
    performed_at DATETIME     DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await db(`CREATE TABLE IF NOT EXISTS ticket_notes (
    id           INT          AUTO_INCREMENT PRIMARY KEY,
    ticket_id    VARCHAR(36)  NOT NULL,
    staff_id     VARCHAR(20)  DEFAULT NULL,
    staff_tag    VARCHAR(100) DEFAULT NULL,
    note         TEXT         NOT NULL,
    source       VARCHAR(20)  DEFAULT 'panel',
    created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await db(`CREATE TABLE IF NOT EXISTS banned_users (
    user_id   VARCHAR(20)  PRIMARY KEY,
    reason    TEXT         DEFAULT NULL,
    banned_by VARCHAR(20)  DEFAULT NULL,
    banned_at DATETIME     DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await db(`CREATE TABLE IF NOT EXISTS admin_users (
    id            INT          AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    discord_tag   VARCHAR(100) DEFAULT NULL,
    role          ENUM('admin','staff') DEFAULT 'admin',
    last_login    DATETIME     DEFAULT NULL,
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await db(`CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id           INT          AUTO_INCREMENT PRIMARY KEY,
    staff_id     VARCHAR(20)  DEFAULT NULL,
    staff_tag    VARCHAR(100) DEFAULT NULL,
    action       VARCHAR(100) DEFAULT NULL,
    ticket_id    VARCHAR(36)  DEFAULT NULL,
    ip           VARCHAR(100) DEFAULT NULL,
    user_agent   VARCHAR(500) DEFAULT NULL,
    details      TEXT         DEFAULT NULL,
    created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await db(`CREATE TABLE IF NOT EXISTS panel_config (
    id          INT          AUTO_INCREMENT PRIMARY KEY,
    user_id     VARCHAR(20)  NOT NULL UNIQUE,
    config_json TEXT         NOT NULL,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  await db(`CREATE TABLE IF NOT EXISTS ticket_categories (
    id                  INT          AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(50)  NOT NULL UNIQUE,
    emoji               VARCHAR(10)  DEFAULT '🎫',
    description         VARCHAR(255) DEFAULT NULL,
    discord_category_id VARCHAR(20)  DEFAULT NULL,
    color               VARCHAR(7)   DEFAULT '#6366f1',
    sort_order          INT          DEFAULT 0,
    enabled             TINYINT(1)   DEFAULT 1,
    created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // Seed default categories if table is empty
  const cats = await db('SELECT COUNT(*) as n FROM ticket_categories');
  if (cats[0].n === 0) {
    await db(`INSERT INTO ticket_categories (name, emoji, description, sort_order) VALUES
      ('Support', '🛠', 'Teknisk hjälp & generella frågor', 1),
      ('Köp',     '🛒', 'Köpfrågor & beställningar',        2),
      ('Övrigt',  '❓', 'Allt annat',                        3),
      ('Panel',   '🎤', 'Paneldiskussioner',                 4)
    `);
    console.log('[DB] Default categories seeded');
  }

  await db(`CREATE TABLE IF NOT EXISTS user_emails (
    id          INT          AUTO_INCREMENT PRIMARY KEY,
    discord_id  VARCHAR(20)  NOT NULL UNIQUE,
    discord_tag VARCHAR(100) DEFAULT NULL,
    email       VARCHAR(255) DEFAULT NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

  // Fix ticket_number to have auto-increment behavior
  await db("ALTER TABLE tickets MODIFY COLUMN ticket_number INT AUTO_INCREMENT").catch(()=>{});
  await db("ALTER TABLE ticket_categories ADD COLUMN IF NOT EXISTS ai_enabled TINYINT(1) DEFAULT 1").catch(()=>{});


  await db(`CREATE TABLE IF NOT EXISTS ai_faq (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    content     TEXT         NOT NULL,
    category    VARCHAR(50)  DEFAULT 'general',
    enabled     TINYINT(1)   DEFAULT 1,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);


  await db(`CREATE TABLE IF NOT EXISTS reply_templates (
    id             INT          AUTO_INCREMENT PRIMARY KEY,
    title          VARCHAR(100) NOT NULL,
    content        TEXT         NOT NULL,
    category       VARCHAR(50)  DEFAULT 'general',
    shortcut       VARCHAR(50)  DEFAULT NULL,
    enabled        TINYINT(1)   DEFAULT 1,
    usage_count    INT          DEFAULT 0,
    created_by_id  VARCHAR(20)  DEFAULT NULL,
    created_by_tag VARCHAR(100) DEFAULT NULL,
    created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await db(`CREATE TABLE IF NOT EXISTS ai_channels (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    channel_id  VARCHAR(30)  NOT NULL UNIQUE,
    channel_name VARCHAR(100) NOT NULL DEFAULT 'unknown',
    enabled     TINYINT(1)   DEFAULT 1,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Add any missing columns to existing tables (safe migrations)
  const migrations = [
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pending_close TINYINT(1) DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS close_requested_by VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal'",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general'",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS user_id VARCHAR(20) DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS user_tag VARCHAR(100) DEFAULT NULL",
    "ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500) DEFAULT NULL",
    "ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS attachments TEXT DEFAULT NULL",
    "ALTER TABLE ticket_categories ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT '#6366f1'",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS last_reminder_at DATETIME DEFAULT NULL",
    "ALTER TABLE ticket_categories ADD COLUMN IF NOT EXISTS sla_minutes INT DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breached TINYINT(1) DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rating TINYINT DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS csat_sent TINYINT(1) DEFAULT 0",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(20) DEFAULT NULL",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_to_tag VARCHAR(100) DEFAULT NULL",
  ];
  for (const m of migrations) {
    await db(m).catch(() => {}); // ignore if column already exists
  }

  // Indexes
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_tickets_status  ON tickets(status)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_pending ON tickets(pending_close)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_user    ON tickets(created_by_id)",
    "CREATE INDEX IF NOT EXISTS idx_msgs_ticket     ON ticket_messages(ticket_id)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_user_status ON tickets(created_by_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_status_opened ON tickets(status, opened_at)",
    "CREATE INDEX IF NOT EXISTS idx_msgs_ticket_sent ON ticket_messages(ticket_id, sent_at)",
    "CREATE INDEX IF NOT EXISTS idx_logs_ticket_time ON ticket_logs(ticket_id, performed_at)",
    "CREATE INDEX IF NOT EXISTS idx_audit_time ON admin_audit_logs(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_audit_staff ON admin_audit_logs(staff_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_rating ON tickets(rating)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_sla ON tickets(sla_breached, status)",
    "CREATE INDEX IF NOT EXISTS idx_notes_ticket ON ticket_notes(ticket_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_notes_created ON ticket_notes(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_templates_enabled ON reply_templates(enabled, category)",
    "CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to)",
  ];
  for (const i of indexes) {
    await db(i).catch(() => {});
  }

  // One-time backfill: migrate legacy notes stored in ticket_logs (action='note')
  // into the dedicated ticket_notes table so they're searchable from the panel.
  const noteCount = await db('SELECT COUNT(*) as n FROM ticket_notes');
  if (noteCount[0].n === 0) {
    const legacy = await db("SELECT ticket_id, staff_id, staff_tag, details, performed_at FROM ticket_logs WHERE action = 'note' AND details IS NOT NULL AND details != ''");
    if (legacy.length) {
      for (const row of legacy) {
        await db(
          'INSERT INTO ticket_notes (ticket_id, staff_id, staff_tag, note, source, created_at) VALUES (?,?,?,?,?,?)',
          [row.ticket_id, row.staff_id, row.staff_tag, row.details, 'discord', row.performed_at]
        ).catch(() => {});
      }
      console.log(`[DB] Backfilled ${legacy.length} legacy note(s) into ticket_notes`);
    }
  }

  console.log('[DB] All tables ready ✅');
}

module.exports = { setup };
