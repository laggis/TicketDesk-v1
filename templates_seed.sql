-- TicketDesk reply templates seed (compatible with current schema)
-- Import only if you want to reset/reseed templates manually.

CREATE TABLE IF NOT EXISTS `reply_templates` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `label`          VARCHAR(100) DEFAULT NULL,
  `text`           TEXT         DEFAULT NULL,
  `title`          VARCHAR(100) DEFAULT NULL,
  `content`        TEXT         DEFAULT NULL,
  `category`       VARCHAR(50)  DEFAULT 'General',
  `shortcut`       VARCHAR(50)  DEFAULT NULL,
  `sort_order`     INT          DEFAULT 0,
  `enabled`        TINYINT(1)   DEFAULT 1,
  `created_by_id`  VARCHAR(20)  DEFAULT NULL,
  `created_by_tag` VARCHAR(100) DEFAULT NULL,
  `created_at`     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `reply_templates` (`label`, `text`, `title`, `content`, `category`, `sort_order`, `enabled`) VALUES
('Hälsning', 'Hej! 👋\n\nHur kan vi hjälpa dig idag?', 'Hälsning', 'Hej! 👋\n\nHur kan vi hjälpa dig idag?', 'General', 10, 1),
('Behöver info', 'Skulle du kunna ge oss lite mer info:\n- Vad hände?\n- När började det?\n- Skärmdumpar/felmeddelanden?\n\nTack!', 'Behöver info', 'Skulle du kunna ge oss lite mer info:\n- Vad hände?\n- När började det?\n- Skärmdumpar/felmeddelanden?\n\nTack!', 'General', 20, 1),
('Jobbar på det', 'Tack för ditt tålamod — vi tittar på detta nu och återkommer till dig så snart vi kan.', 'Jobbar på det', 'Tack för ditt tålamod — vi tittar på detta nu och återkommer till dig så snart vi kan.', 'General', 30, 1),
('Löst', 'Detta bör nu vara löst. Om problemet kvarstår, svara här så hjälper vi dig vidare.', 'Löst', 'Detta bör nu vara löst. Om problemet kvarstår, svara här så hjälper vi dig vidare.', 'General', 40, 1),
('Be om loggar', 'För att vi ska kunna felsöka detta behöver vi dina loggar.\n\nSkicka gärna loggar, skärmdumpar eller exakt felmeddelande så tittar vi vidare.', 'Be om loggar', 'För att vi ska kunna felsöka detta behöver vi dina loggar.\n\nSkicka gärna loggar, skärmdumpar eller exakt felmeddelande så tittar vi vidare.', 'Support', 50, 1),
('Eskaleras', 'Tack för din rapport — detta är mer komplext och vi eskalerar ditt ärende till nästa nivå. Vi återkommer så snart vi kan.', 'Eskaleras', 'Tack för din rapport — detta är mer komplext och vi eskalerar ditt ärende till nästa nivå. Vi återkommer så snart vi kan.', 'Support', 60, 1),
('Betalning mottagen', 'Vi har nu bekräftat din betalning. Din order behandlas och du kommer att få ett bekräftelsemail inom kort.', 'Betalning mottagen', 'Vi har nu bekräftat din betalning. Din order behandlas och du kommer att få ett bekräftelsemail inom kort.', 'Köp', 80, 1),
('Stänger – inget svar', 'Vi har inte hört från dig på ett tag och stänger nu detta ärende. Öppna gärna ett nytt om du fortfarande behöver hjälp!', 'Stänger – inget svar', 'Vi har inte hört från dig på ett tag och stänger nu detta ärende. Öppna gärna ett nytt om du fortfarande behöver hjälp!', 'Avslutning', 100, 1);
