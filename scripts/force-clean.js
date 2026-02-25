#!/usr/bin/env node
/**
 * FastTiers – Force Clean Script
 * ─────────────────────────────────────────────────────────────────
 * Wipes ALL player/application data from BOTH the bot database and
 * the web server database.
 *
 * What gets DELETED:
 *   Bot DB   → applications, tier_changes, bans, tester_notes, audit_log
 *              (testers table is PRESERVED by default)
 *   Web DB   → players, player_tiers
 *              (gamemodes, tier_definitions, partners are PRESERVED)
 *
 * Usage:
 *   node scripts/force-clean.js             ← dry run (shows what would be deleted)
 *   node scripts/force-clean.js --confirm --yes           ← delete everything
 *   node scripts/force-clean.js --confirm --yes --testers ← also wipes testers table
 * ─────────────────────────────────────────────────────────────────
 * ⚠️  THIS IS IRREVERSIBLE. Make a DB backup before running with --confirm.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DRY_RUN = !process.argv.includes('--confirm');
const YES = process.argv.includes('--yes');
const WIPE_TESTERS = process.argv.includes('--testers');

// ── DB config (same as bot) ────────────────────────────────────────────────
const DB_CONFIG = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

// ── Tables and their descriptions ─────────────────────────────────────────
const BOT_TABLES = [
    { table: 'applications', desc: 'All player applications (queue, testing, completed, etc.)' },
    { table: 'tier_changes', desc: 'Tier history records (upgrades/downgrades)' },
    { table: 'bans', desc: 'Player bans and blacklists' },
    { table: 'tester_notes', desc: 'Notes written by testers about players' },
    { table: 'audit_log', desc: 'Audit log entries' },
];

const WEB_TABLES = [
    { table: 'players', desc: 'Player profiles (username, points, rank, region)' },
    { table: 'player_tiers', desc: 'Player tier assignments per gamemode' },
];

// Optional tester wipe
if (WIPE_TESTERS) {
    BOT_TABLES.push({ table: 'testers', desc: 'Tester accounts and their stats ⚠️' });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function hr() { console.log('─'.repeat(60)); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function ok(msg) { console.log(`  ✅ ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

async function getRowCount(conn, table) {
    try {
        const [rows] = await conn.execute(`SELECT COUNT(*) as n FROM \`${table}\``);
        return rows[0].n;
    } catch (_) {
        return '(table not found)';
    }
}

async function truncateTable(conn, table) {
    try {
        // Disable FK checks so we can truncate in any order
        await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
        await conn.execute(`TRUNCATE TABLE \`${table}\``);
        await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
        return true;
    } catch (err) {
        warn(`Could not truncate ${table}: ${err.message}`);
        return false;
    }
}

async function resetTesterStats(conn) {
    try {
        await conn.execute(`
      UPDATE testers SET
        tests_today         = 0,
        tests_this_week     = 0,
        tests_this_month    = 0,
        tests_conducted     = 0,
        last_test_at        = NULL
    `);
        return true;
    } catch (err) {
        warn(`Could not reset tester stats: ${err.message}`);
        return false;
    }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║       FastTiers – Force Clean Script        ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    if (DRY_RUN) {
        console.log('  🔵 MODE: DRY RUN — no data will be deleted');
        console.log('     Run with --confirm to actually delete data.\n');
    } else {
        console.log('  🔴 MODE: LIVE — data WILL be permanently deleted!\n');
    }

    // Connect
    let conn;
    try {
        conn = await mysql.createConnection(DB_CONFIG);
        ok(`Connected to ${DB_CONFIG.database}@${DB_CONFIG.host}`);
    } catch (err) {
        console.error(`\n❌ DB connection failed: ${err.message}`);
        process.exit(1);
    }

    hr();
    console.log('\n📦 BOT DATABASE — tables to clean:\n');

    for (const { table, desc } of BOT_TABLES) {
        const count = await getRowCount(conn, table);
        console.log(`  • ${table.padEnd(20)} ${String(count).padStart(6)} rows  — ${desc}`);
    }

    console.log('\n🌐 WEB DATABASE — tables to clean:\n');
    for (const { table, desc } of WEB_TABLES) {
        const count = await getRowCount(conn, table);
        console.log(`  • ${table.padEnd(20)} ${String(count).padStart(6)} rows  — ${desc}`);
    }

    if (!WIPE_TESTERS) {
        console.log('\n  💡 Testers table is PRESERVED (pass --testers to also wipe it)');
        console.log('  💡 Tester stats (tests_today etc.) will be reset to 0');
    }

    console.log('\n  🔒 PRESERVED (never touched):');
    console.log('     gamemodes, tier_definitions, partners');

    hr();

    if (DRY_RUN) {
        console.log('\n✅ Dry run complete. No data was modified.\n');
        await conn.end();
        return;
    }

    // ── Confirmation check (no stdin needed — works in Pterodactyl) ─────────
    if (!YES) {
        console.log('  ⚠️  Add --yes to actually run the deletion, e.g.:');
        console.log('     node scripts/force-clean.js --confirm --yes');
        console.log('     node scripts/force-clean.js --confirm --yes --testers\n');
        await conn.end();
        return;
    }

    console.log('\n🗑️  Deleting data...\n');

    // ── Wipe bot tables ──────────────────────────────────────────────────────
    for (const { table } of BOT_TABLES) {
        const success = await truncateTable(conn, table);
        if (success) ok(`Cleared: ${table}`);
    }

    // ── Reset tester stats if testers table is preserved ────────────────────
    if (!WIPE_TESTERS) {
        const statsReset = await resetTesterStats(conn);
        if (statsReset) ok('Reset tester stats (tests_today, tests_conducted, etc.) to 0');
    }

    // ── Wipe web tables ──────────────────────────────────────────────────────
    for (const { table } of WEB_TABLES) {
        const success = await truncateTable(conn, table);
        if (success) ok(`Cleared: ${table}`);
    }

    hr();
    console.log('\n✅ Force clean complete!\n');
    console.log('  What to do next:');
    console.log('    1. Restart the bot');
    console.log('    2. Restart the web server (to re-seed default data if needed)');
    console.log('    3. Testers can now start fresh\n');

    await conn.end();
}

main().catch(err => {
    console.error('\n❌ Unexpected error:', err.message);
    process.exit(1);
});
