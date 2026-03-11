const jwt = require('jsonwebtoken');

function getJwtSecrets() {
  const multi = (process.env.JWT_SECRETS || '').split(',').map(s => s.trim()).filter(Boolean);
  const single = (process.env.JWT_SECRET || '').trim();
  return multi.length ? multi : (single ? [single] : []);
}

function authenticateToken(req, res, next) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const secrets = getJwtSecrets();
    if (!secrets.length) return res.status(500).json({ error: 'JWT secret not configured' });
    for (const secret of secrets) {
      try {
        req.user = jwt.verify(token, secret);
        return next();
      } catch {}
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { authenticateToken, requireAdmin };
