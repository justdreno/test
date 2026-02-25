require('dotenv').config();
const mysql = require('mysql2/promise');

// Split schema into separate statements for better error handling
const tables = [
  // Applications table
  `CREATE TABLE IF NOT EXISTS applications (
    id VARCHAR(36) PRIMARY KEY,
    discord_id VARCHAR(20) NOT NULL,
    discord_username VARCHAR(100),
    minecraft_username VARCHAR(16) NOT NULL,
    region VARCHAR(10),
    primary_gamemode VARCHAR(50),
    status ENUM('pending', 'verifying', 'verified', 'invited', 'testing', 'completed', 'cancelled', 'expired', 'rescheduled') DEFAULT 'pending',
    priority ENUM('standard', 'vip', 'premium', 'supporter') DEFAULT 'standard',
    position INT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verified_at TIMESTAMP NULL,
    invited_at TIMESTAMP NULL,
    responded_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    tester_id VARCHAR(20),
    channel_id VARCHAR(20),
    reschedule_count INT DEFAULT 0,
    reschedule_time TIMESTAMP NULL,
    notes TEXT,
    verification_code VARCHAR(10),
    INDEX idx_status (status),
    INDEX idx_discord (discord_id),
    INDEX idx_minecraft (minecraft_username)
  )`,

  // Testers table
  `CREATE TABLE IF NOT EXISTS testers (
    id VARCHAR(36) PRIMARY KEY,
    discord_id VARCHAR(20) UNIQUE NOT NULL,
    discord_username VARCHAR(100),
    permissions JSON,
    tier_limit VARCHAR(10),
    daily_limit INT DEFAULT 10,
    priority_queue BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    added_by VARCHAR(20),
    tests_conducted INT DEFAULT 0,
    tests_this_week INT DEFAULT 0,
    tests_this_month INT DEFAULT 0,
    tests_today INT DEFAULT 0,
    rating DECIMAL(2,1) DEFAULT 5.0,
    last_test_at TIMESTAMP NULL,
    INDEX idx_active (is_active)
  )`,

  // Tier changes table
  `CREATE TABLE IF NOT EXISTS tier_changes (
    id VARCHAR(36) PRIMARY KEY,
    application_id VARCHAR(36),
    discord_id VARCHAR(20),
    minecraft_username VARCHAR(16),
    gamemode VARCHAR(50),
    previous_tier VARCHAR(10),
    new_tier VARCHAR(10),
    tester_id VARCHAR(20),
    tester_note TEXT,
    change_type ENUM('upgrade', 'downgrade', 'same') NOT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_player (minecraft_username),
    INDEX idx_tester (tester_id)
  )`,

  // Bans table
  `CREATE TABLE IF NOT EXISTS bans (
    id VARCHAR(36) PRIMARY KEY,
    discord_id VARCHAR(20),
    minecraft_username VARCHAR(16),
    banned_by VARCHAR(20),
    reason TEXT,
    duration VARCHAR(50),
    appealable BOOLEAN DEFAULT TRUE,
    banned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,
    unbanned_at TIMESTAMP NULL,
    unbanned_by VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_active (is_active),
    INDEX idx_discord (discord_id)
  )`,

  // Tester notes table
  `CREATE TABLE IF NOT EXISTS tester_notes (
    id VARCHAR(36) PRIMARY KEY,
    minecraft_username VARCHAR(16),
    tester_id VARCHAR(20),
    note TEXT,
    severity ENUM('info', 'warning', 'critical') DEFAULT 'info',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_player (minecraft_username)
  )`,

  // Audit log table
  `CREATE TABLE IF NOT EXISTS audit_log (
    id VARCHAR(36) PRIMARY KEY,
    action VARCHAR(100),
    user_id VARCHAR(20),
    user_type ENUM('player', 'tester', 'admin'),
    target_id VARCHAR(50),
    details JSON,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_action (action),
    INDEX idx_user (user_id),
    INDEX idx_created (created_at)
  )`,

  // Rate limiting table
  `CREATE TABLE IF NOT EXISTS rate_limits (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(20),
    command VARCHAR(50),
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    count INT DEFAULT 1,
    INDEX idx_user_cmd (user_id, command)
  )`,

  // Gamemodes table
  `CREATE TABLE IF NOT EXISTS gamemodes (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    description TEXT,
    icon_url VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_active (is_active)
  )`,

  // Configuration table - using backticks for 'key' column
  `CREATE TABLE IF NOT EXISTS config (
    \`key\` VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(20)
  )`
];

const insertData = [
  // Insert default config values
  `INSERT INTO config (\`key\`, value) VALUES
  ('maintenance_mode', 'false'),
  ('max_queue_size', '100'),
  ('verification_timeout', '30'),
  ('invite_timeout', '24'),
  ('auto_cleanup_days', '30')
  ON DUPLICATE KEY UPDATE value = VALUES(value)`,

  // Insert default gamemodes
  `INSERT INTO gamemodes (id, name, display_name, description) VALUES
  (UUID(), 'vanilla', 'Vanilla', 'Classic Minecraft PvP'),
  (UUID(), 'uhc', 'UHC', 'Ultra Hardcore PvP'),
  (UUID(), 'pot', 'Pot', 'Potion PvP'),
  (UUID(), 'sword', 'Sword', 'Sword-only combat'),
  (UUID(), 'bow', 'Bow', 'Archery combat'),
  (UUID(), 'rod', 'Rod', 'Fishing rod combat'),
  (UUID(), 'squid', 'Squid', 'Squid game style'),
  (UUID(), 'bedwars', 'Bedwars', 'Base building and PvP'),
  (UUID(), 'skywars', 'Skywars', 'Sky island battles')
  ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`
];

async function setupDatabase() {
  let connection;

  try {
    console.log('Connecting to MySQL...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    console.log('Creating tables...');

    for (let i = 0; i < tables.length; i++) {
      try {
        await connection.query(tables[i]);
        console.log(`  ✓ Table ${i + 1}/${tables.length} created`);
      } catch (err) {
        console.error(`  ✗ Table ${i + 1}/${tables.length} failed:`, err.message);
        throw err;
      }
    }

    console.log('Inserting default data...');

    for (let i = 0; i < insertData.length; i++) {
      try {
        await connection.query(insertData[i]);
        console.log(`  ✓ Data ${i + 1}/${insertData.length} inserted`);
      } catch (err) {
        console.warn(`  ⚠ Data ${i + 1}/${insertData.length} skipped:`, err.message);
        // Don't throw error for data inserts - tables are more important
      }
    }

    console.log('\n[OK] Database setup complete!');

  } catch (error) {
    console.error('\n[ERROR] Database setup failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (require.main === module) {
  setupDatabase();
}

module.exports = { setupDatabase };