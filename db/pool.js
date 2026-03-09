const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    15,
  charset:            'utf8mb4',
  timezone:           'local',
});

// Convenience wrapper — returns rows directly
async function db(query, params = []) {
  const [rows] = await pool.execute(query, params);
  return rows;
}

// Expose raw pool so routes using pool.query() still work
db.pool  = pool;
db.query = (...args) => pool.query(...args);

module.exports = db;
