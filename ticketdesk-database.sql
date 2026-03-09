-- ═══════════════════════════════════════════════════════════════════
--  TicketDesk v2 — Complete Database Schema
--  PenguinHosting
--  Generated: 2026-03-09
--
--  HOW TO USE:
--  1. Open HeidiSQL
--  2. Create a new database called "ticketbot" if it doesn't exist
--  3. Select the ticketbot database
--  4. Run this entire file
--
--  SAFE TO RUN ON EXISTING DB — uses IF NOT EXISTS / IF EXISTS
-- ═══════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS `ticketbot`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `ticketbot`;

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
--  tickets
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `tickets` (
  `id`                  VARCHAR(36)   NOT NULL,
  `ticket_number`       INT           DEFAULT 0,
  `guild_id`            VARCHAR(20)   DEFAULT NULL,
  `channel_id`          VARCHAR(20)   DEFAULT NULL,
  `type`                VARCHAR(50)   DEFAULT 'Support',
  `category`            VARCHAR(50)   DEFAULT 'general',
  `status`              VARCHAR(20)   DEFAULT 'Öppen',
  `priority`            VARCHAR(10)   DEFAULT 'normal',
  `subject`             VARCHAR(255)  DEFAULT NULL,
  `description`         TEXT          DEFAULT NULL,
  `user_id`             VARCHAR(20)   DEFAULT NULL,
  `user_tag`            VARCHAR(100)  DEFAULT NULL,
  `created_by`          VARCHAR(100)  DEFAULT NULL,
  `created_by_id`       VARCHAR(20)   DEFAULT NULL,
  `claimed_by`          VARCHAR(20)   DEFAULT NULL,
  `claimed_by_tag`      VARCHAR(100)  DEFAULT NULL,
  `closed_by`           VARCHAR(100)  DEFAULT NULL,
  `closed_by_id`        VARCHAR(20)   DEFAULT NULL,
  `close_reason`        TEXT          DEFAULT NULL,
  `close_requested_by`  VARCHAR(100)  DEFAULT NULL,
  `pending_close`       TINYINT(1)    DEFAULT 0,
  `transcript_url`      VARCHAR(500)  DEFAULT NULL,
  `rating`              TINYINT       DEFAULT NULL,
  `first_response_at`   DATETIME      DEFAULT NULL,
  `opened_at`           DATETIME      DEFAULT CURRENT_TIMESTAMP,
  `closed_at`           DATETIME      DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_status`      (`status`),
  INDEX `idx_pending`     (`pending_close`),
  INDEX `idx_user`        (`created_by_id`),
  INDEX `idx_channel`     (`channel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
--  ticket_messages
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ticket_messages` (
  `id`             INT           NOT NULL AUTO_INCREMENT,
  `ticket_id`      VARCHAR(36)   DEFAULT NULL,
  `discord_msg_id` VARCHAR(20)   DEFAULT NULL,
  `author_id`      VARCHAR(20)   DEFAULT NULL,
  `author_tag`     VARCHAR(100)  DEFAULT NULL,
  `avatar_url`     VARCHAR(500)  DEFAULT NULL,
  `is_staff`       TINYINT(1)    DEFAULT 0,
  `content`        TEXT          DEFAULT NULL,
  `sent_at`        DATETIME      DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ticket` (`ticket_id`),
  CONSTRAINT `ticket_messages_ibfk_1`
    FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
--  ticket_logs
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ticket_logs` (
  `id`           INT           NOT NULL AUTO_INCREMENT,
  `ticket_id`    VARCHAR(36)   DEFAULT NULL,
  `staff_id`     VARCHAR(20)   DEFAULT NULL,
  `staff_tag`    VARCHAR(100)  DEFAULT NULL,
  `action`       VARCHAR(100)  DEFAULT NULL,
  `details`      TEXT          DEFAULT NULL,
  `performed_at` DATETIME      DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ticket` (`ticket_id`),
  CONSTRAINT `ticket_logs_ibfk_1`
    FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
--  ticket_ratings
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ticket_ratings` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `ticket_id`     VARCHAR(36)  DEFAULT NULL,
  `user_id`       VARCHAR(20)  DEFAULT NULL,
  `staff_id`      VARCHAR(20)  DEFAULT NULL,
  `rating`        TINYINT      DEFAULT NULL,
  `dm_message_id` VARCHAR(20)  DEFAULT NULL,
  `rated_at`      DATETIME     DEFAULT NULL,
  `created_at`    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_ticket` (`ticket_id`),
  CONSTRAINT `ticket_ratings_ibfk_1`
    FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
--  banned_users
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `banned_users` (
  `user_id`   VARCHAR(20)   NOT NULL,
  `reason`    TEXT          DEFAULT NULL,
  `banned_by` VARCHAR(20)   DEFAULT NULL,
  `banned_at` DATETIME      DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
--  admin_users  (panel login accounts)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `admin_users` (
  `id`            INT           NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(50)   NOT NULL,
  `password_hash` VARCHAR(255)  NOT NULL,
  `discord_tag`   VARCHAR(100)  DEFAULT NULL,
  `role`          ENUM('admin','staff') DEFAULT 'admin',
  `last_login`    DATETIME      DEFAULT NULL,
  `created_at`    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
--  panel_config
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `panel_config` (
  `id`          INT   NOT NULL AUTO_INCREMENT,
  `user_id`     VARCHAR(20)  NOT NULL,
  `config_json` TEXT  NOT NULL,
  `updated_at`  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
--  ticket_categories  (managed from admin panel)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ticket_categories` (
  `id`                  INT           NOT NULL AUTO_INCREMENT,
  `name`                VARCHAR(50)   NOT NULL,
  `emoji`               VARCHAR(10)   DEFAULT '🎫',
  `description`         VARCHAR(255)  DEFAULT NULL,
  `discord_category_id` VARCHAR(20)   DEFAULT NULL,
  `color`               VARCHAR(7)    DEFAULT '#6366f1',
  `sort_order`          INT           DEFAULT 0,
  `enabled`             TINYINT(1)    DEFAULT 1,
  `ai_enabled`          TINYINT(1)    DEFAULT 1,
  `created_at`          DATETIME      DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
--  user_emails
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `user_emails` (
  `id`          INT           NOT NULL AUTO_INCREMENT,
  `discord_id`  VARCHAR(20)   NOT NULL,
  `discord_tag` VARCHAR(100)  DEFAULT NULL,
  `email`       VARCHAR(255)  DEFAULT NULL,
  `created_at`  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_discord` (`discord_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
--  Seed default categories (only if table is empty)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO `ticket_categories` (`name`, `emoji`, `description`, `sort_order`, `ai_enabled`)
SELECT * FROM (SELECT 'Support', '🛠', 'Teknisk hjälp & generella frågor', 1, 1) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM `ticket_categories`) LIMIT 1;

INSERT INTO `ticket_categories` (`name`, `emoji`, `description`, `sort_order`, `ai_enabled`)
SELECT * FROM (SELECT 'Köp', '🛒', 'Köpfrågor & beställningar', 2, 0) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM `ticket_categories` WHERE name = 'Köp') LIMIT 1;

INSERT INTO `ticket_categories` (`name`, `emoji`, `description`, `sort_order`, `ai_enabled`)
SELECT * FROM (SELECT 'Övrigt', '❓', 'Allt annat', 3, 1) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM `ticket_categories` WHERE name = 'Övrigt') LIMIT 1;

INSERT INTO `ticket_categories` (`name`, `emoji`, `description`, `sort_order`, `ai_enabled`)
SELECT * FROM (SELECT 'Panel', '🎤', 'Paneldiskussioner', 4, 0) AS tmp
WHERE NOT EXISTS (SELECT 1 FROM `ticket_categories` WHERE name = 'Panel') LIMIT 1;

SET FOREIGN_KEY_CHECKS = 1;

-- ─────────────────────────────────────────────────────────────────────
--  Verify
-- ─────────────────────────────────────────────────────────────────────
SELECT
  TABLE_NAME,
  TABLE_ROWS,
  ENGINE,
  TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'ticketbot'
ORDER BY TABLE_NAME;
