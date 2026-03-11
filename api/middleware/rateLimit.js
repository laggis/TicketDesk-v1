const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 60, keyFn, message = 'Too many requests' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = (keyFn ? keyFn(req) : `${req.ip}:${req.baseUrl}${req.path}`) || req.ip;
    const existing = buckets.get(key);

    if (!existing || now > existing.resetAt) {
      const resetAt = now + windowMs;
      buckets.set(key, { count: 1, resetAt });
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, max - 1)));
      res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      return next();
    }

    existing.count += 1;
    buckets.set(key, existing);

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - existing.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(existing.resetAt / 1000)));

    if (existing.count > max) {
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

module.exports = { rateLimit };
