const db = require('../index');

async function migrate() {
    console.log('[Migration] Adding skipped_by column to applications table...');

    try {
        // Check if column already exists first (compatible with MySQL & MariaDB)
        const cols = await db.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'applications'
        AND COLUMN_NAME  = 'skipped_by'
    `);

        if (cols && cols.length > 0) {
            console.log('[Migration] Column skipped_by already exists, skipping.');
            return;
        }

        await db.query(`
      ALTER TABLE applications
      ADD COLUMN skipped_by JSON NULL COMMENT 'Array of tester Discord IDs who have skipped this player'
      AFTER voice_channel_id
    `);

        console.log('[Migration] Successfully added skipped_by column.');
    } catch (error) {
        console.error('[Migration] Error during migration:', error);
        throw error;
    }
}

if (require.main === module) {
    migrate().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = migrate;
