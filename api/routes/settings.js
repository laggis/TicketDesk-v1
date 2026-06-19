const express = require('express');
const path    = require('path');
const fs      = require('fs');
const nodemailer = require('nodemailer');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router       = express.Router();
const SETTINGS_PATH = path.join(__dirname, '..', '..', 'bot_settings.json');

// ── Defaults ────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  staleRemindersEnabled:  true,
  staleTicketMinutes:     30,
  staleReminderCooldownMinutes: 30,
  smtp: {
    host: '',
    port: 587,
    user: '',
    pass: '',
    from: '',
    secure: false
  }
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
  const settings = loadSettings();
  // Don't send password back to client, just a flag if it's set
  const safeSettings = {
    ...settings,
    smtp: {
      ...settings.smtp,
      pass: settings.smtp?.pass ? '********' : ''
    }
  };
  res.json(safeSettings);
});

// POST /api/settings  — admin only
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const current = loadSettings();
  const {
    staleRemindersEnabled,
    staleTicketMinutes,
    staleReminderCooldownMinutes,
    smtp
  } = req.body;

  const updated = {
    ...current,
    ...(staleRemindersEnabled !== undefined && { staleRemindersEnabled: !!staleRemindersEnabled }),
    ...(staleTicketMinutes    !== undefined && { staleTicketMinutes:    Math.max(1, parseInt(staleTicketMinutes))    }),
    ...(staleReminderCooldownMinutes !== undefined && {
      staleReminderCooldownMinutes: Math.max(1, parseInt(staleReminderCooldownMinutes)),
    }),
    ...(smtp !== undefined && {
      smtp: {
        ...current.smtp,
        ...smtp,
        // Keep existing password if new one is just ********
        pass: smtp.pass === '********' ? current.smtp?.pass : smtp.pass
      }
    })
  };

  saveSettings(updated);
  // Send back safe settings
  const safeUpdated = {
    ...updated,
    smtp: {
      ...updated.smtp,
      pass: updated.smtp?.pass ? '********' : ''
    }
  };
  res.json({ ok: true, settings: safeUpdated });
});

// POST /api/settings/test-smtp — admin only
router.post('/test-smtp', authenticateToken, requireAdmin, async (req, res) => {
  const { smtp, testEmail } = req.body;

  if (!testEmail) {
    return res.status(400).json({ error: 'Test email address is required' });
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: parseInt(smtp.port) || 587,
      secure: smtp.secure === true,
      auth: {
        user: smtp.user,
        pass: smtp.pass
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Verify connection first
    await transporter.verify();

    // Send test email
    await transporter.sendMail({
      from: smtp.from || smtp.user,
      to: testEmail,
      subject: `[${process.env.SERVER_NAME || 'TicketDesk'}] SMTP Test`,
      text: 'SMTP settings are working correctly!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #6366f1;">✅ SMTP Test Successful</h2>
          <p>Your SMTP settings are configured correctly!</p>
          <p style="color: #888; margin-top: 30px; font-size: 12px;">Skickat från ${process.env.SERVER_NAME || 'TicketDesk'}</p>
        </div>
      `
    });

    res.json({ ok: true, message: 'Test email sent successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, loadSettings };
