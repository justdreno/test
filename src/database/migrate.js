require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrateDatabase() {
  console.log('--- Database Migration ---');
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    console.log('[OK] Connected to database');

    const alterations = [
      { sql: 'ALTER TABLE applications ADD COLUMN verified_in_game TINYINT(1) DEFAULT 0', name: 'verified_in_game' },
      { sql: 'ALTER TABLE applications ADD COLUMN verify_message_id VARCHAR(255)', name: 'verify_message_id' },
      { sql: 'ALTER TABLE applications ADD COLUMN verification_code VARCHAR(10)', name: 'verification_code' },
      { sql: 'ALTER TABLE applications ADD COLUMN minecraft_uuid VARCHAR(36)', name: 'minecraft_uuid' }
    ];

    for (let alt of alterations) {
      try {
        await connection.query(alt.sql);
        console.log(`[OK] Added column: ${alt.name}`);
      } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
          console.log(`[SKIP] Skipped column: ${alt.name} (already exists)`);
        } else {
          console.error(`[ERROR] Failed to add column: ${alt.name}`, e.message);
        }
      }
    }

    console.log('--- Migration Complete ---');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
    process.exit(0);
  }
}

migrateDatabase();