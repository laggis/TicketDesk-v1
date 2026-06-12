const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router       = express.Router();
const SETTINGS_PATH = path.join(__dirname, '..', '..', 'bot_settings.json');

// ── Defaults ────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  staleRemindersEnabled:  true,
  staleTicketMinutes:     30,
  staleReminderCooldownMinutes: 30,
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(data) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
}

// GET /api/settings  — any authenticated user
router.get('/', authenticateToken, (req, res) => {
  res.json(loadSettings());
});

// POST /api/settings  — admin only
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const current = loadSettings();
  const {
    staleRemindersEnabled,
    staleTicketMinutes,
    staleReminderCooldownMinutes,
  } = req.body;

  const updated = {
    ...current,
    ...(staleRemindersEnabled !== undefined && { staleRemindersEnabled: !!staleRemindersEnabled }),
    ...(staleTicketMinutes    !== undefined && { staleTicketMinutes:    Math.max(1, parseInt(staleTicketMinutes))    }),
    ...(staleReminderCooldownMinutes !== undefined && {
      staleReminderCooldownMinutes: Math.max(1, parseInt(staleReminderCooldownMinutes)),
    }),
  };

  saveSettings(updated);
  res.json({ ok: true, settings: updated });
});

module.exports = { router, loadSettings };
