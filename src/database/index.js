require('dotenv').config();
const mysql = require('mysql2/promise');

class Database {
  constructor() {
    this.pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });
  }

  async query(sql, params) {
    const [rows] = await this.pool.execute(sql, params);
    return rows;
  }

  async getConnection() {
    return await this.pool.getConnection();
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = new Database();