const db = require('../index');

async function migrate() {
    console.log('[Migration] Adding voice_channel_id column to applications table...');

    try {
        await db.query(`
      ALTER TABLE applications 
      ADD COLUMN IF NOT EXISTS voice_channel_id VARCHAR(20) NULL AFTER channel_id;
    `);

        console.log('[Migration] Successfully added voice_channel_id column.');
    } catch (error) {
        // If column already exists, ignore error
        if (error.code === 'ER_DUP_COLUMN_NAME') {
            console.log('[Migration] Column voice_channel_id already exists.');
        } else {
            console.error('[Migration] Error during migration:', error);
            throw error;
        }
    }
}

if (require.main === module) {
    migrate().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = migrate;
