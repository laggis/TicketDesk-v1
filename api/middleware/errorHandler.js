function errorHandler(err, req, res, next) {
  console.error('[API Error]', err?.message || err);
  res.status(500).json({ error: err?.message || 'Internal server error' });
}
module.exports = { errorHandler };
