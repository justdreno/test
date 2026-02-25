const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const { ERROR, SUCCESS, INFO, COLOR } = require('../config/emojis');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reset-skips')
        .setDescription('Reset skipped players so they appear in /available again')
        .addBooleanOption(option =>
            option.setName('global')
                .setDescription('Admin only: Reset ALL skips for ALL players across the entire queue')
                .setRequired(false)
        )
        .addUserOption(option =>
            option.setName('tester')
                .setDescription('Admin only: Reset all skips made by a specific tester')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('player')
                .setDescription('Reset skips for a specific player (IGN)')
                .setRequired(false)
        ),

    async execute(interaction) {
        const callerId = interaction.user.id;
        const globalReset = interaction.options.getBoolean('global') || false;
        const targetTester = interaction.options.getUser('tester');
        const targetPlayer = interaction.options.getString('player');

        // Check if caller is admin
        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            (process.env.ADMIN_ROLE_ID && interaction.member.roles.cache.has(process.env.ADMIN_ROLE_ID));

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        try {
            // ─────────────────────────────────────────────────────────────────
            // 1. GLOBAL RESET (Admin Only)
            // ─────────────────────────────────────────────────────────────────
            if (globalReset) {
                if (!isAdmin) {
                    return await interaction.editReply({ content: `${ERROR} Only administrators can perform a global skip reset.` });
                }

                await db.query(`UPDATE applications SET skipped_by = NULL WHERE skipped_by IS NOT NULL`);
                return await interaction.editReply({ content: `${SUCCESS} **Global skip reset complete.** All players are now visible to all testers again.` });
            }

            // ─────────────────────────────────────────────────────────────────
            // 2. SPECIFIC PLAYER RESET
            // ─────────────────────────────────────────────────────────────────
            if (targetPlayer) {
                // Find the application
                const appRows = await db.query(`SELECT id, skipped_by, discord_id FROM applications WHERE minecraft_username = ?`, [targetPlayer]);
                if (!appRows || appRows.length === 0) {
                    return await interaction.editReply({ content: `${ERROR} Could not find an active application for \`${targetPlayer}\`.` });
                }

                const app = appRows[0];
                let skipped = [];
                try { skipped = JSON.parse(app.skipped_by || '[]'); } catch (_) { skipped = []; }

                if (isAdmin && !targetTester) {
                    // Admin clears all skips for this player
                    await db.query(`UPDATE applications SET skipped_by = NULL WHERE id = ?`, [app.id]);
                    return await interaction.editReply({ content: `${SUCCESS} Reset all tester skips for player **${targetPlayer}**.` });
                } else {
                    // Caller clears their own skip (or Admin clears a specific tester's skip)
                    const testerIdToClear = targetTester ? targetTester.id : callerId;

                    if (targetTester && !isAdmin) {
                        return await interaction.editReply({ content: `${ERROR} Only administrators can clear skips for other testers.` });
                    }

                    if (!skipped.includes(testerIdToClear)) {
                        return await interaction.editReply({ content: `${INFO} ${targetTester ? `<@${testerIdToClear}> hasn't` : "You haven't"} skipped **${targetPlayer}**.` });
                    }

                    skipped = skipped.filter(id => id !== testerIdToClear);
                    await db.query(`UPDATE applications SET skipped_by = ? WHERE id = ?`, [JSON.stringify(skipped), app.id]);
                    return await interaction.editReply({ content: `${SUCCESS} Reset skip for player **${targetPlayer}**. They will now appear in ${targetTester ? `<@${testerIdToClear}>'s` : 'your'} \`/available\` queue.` });
                }
            }

            // ─────────────────────────────────────────────────────────────────
            // 3. TARGET TESTER RESET (Admin) OR SELF RESET (Tester)
            // ─────────────────────────────────────────────────────────────────
            const testerIdToClear = targetTester ? targetTester.id : callerId;

            if (targetTester && !isAdmin) {
                return await interaction.editReply({ content: `${ERROR} Only administrators can reset skips for other testers.` });
            }

            // Fetch all applications that have skips
            const appsWithSkips = await db.query(`SELECT id, skipped_by FROM applications WHERE skipped_by IS NOT NULL`);
            if (!appsWithSkips || appsWithSkips.length === 0) {
                return await interaction.editReply({ content: `${INFO} No skipped players found in the queue.` });
            }

            let updatedCount = 0;

            for (const app of appsWithSkips) {
                let skipped = [];
                try { skipped = JSON.parse(app.skipped_by || '[]'); } catch (_) { skipped = []; }

                if (skipped.includes(testerIdToClear)) {
                    skipped = skipped.filter(id => id !== testerIdToClear);
                    const newValue = skipped.length === 0 ? null : JSON.stringify(skipped);
                    await db.query(`UPDATE applications SET skipped_by = ? WHERE id = ?`, [newValue, app.id]);
                    updatedCount++;
                }
            }

            if (updatedCount === 0) {
                return await interaction.editReply({ content: `${INFO} ${targetTester ? `<@${testerIdToClear}> has` : "You have"} not skipped any players currently in the queue.` });
            }

            return await interaction.editReply({
                content: `${SUCCESS} Reset skips for **${updatedCount}** player(s).\nThey will now show up in ${targetTester ? `<@${testerIdToClear}>'s` : 'your'} \`/available\` queue.`
            });

        } catch (error) {
            console.error('[ResetSkips] Error:', error);
            await interaction.editReply({ content: `${ERROR} An error occurred while resetting skips.` });
        }
    }
};
