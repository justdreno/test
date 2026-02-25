const db = require('../database');
const auditLogger = require('../utils/auditLogger');
const { TIME, WARN, SUCCESS, GAME, QUEUE, COLOR } = require('../config/emojis');

module.exports = {
    name: 'messageReactionAdd',

    async execute(reaction, user, client) {
        // Ignore bot reactions
        if (user.bot) return;

        if (reaction.emoji.name !== 'check' && reaction.emoji.id !== '1110505590305861655') return;

        // Only care about DM channels
        if (reaction.message.guild) return;

        // Handle partial reactions (fetch full data if needed)
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (err) {
                console.error('[VerifyReaction] Could not fetch reaction:', err);
                return;
            }
        }

        const messageId = reaction.message.id;
        const userId = user.id;

        try {
            // Find application by verify_message_id
            const rows = await db.query(`
        SELECT * FROM applications 
        WHERE verify_message_id = ? 
        AND discord_id = ?
        AND status = 'pending'
        LIMIT 1
      `, [messageId, userId]);

            if (!rows || rows.length === 0) {
                // Could be an old or irrelevant reaction — silently ignore
                return;
            }

            const app = rows[0];

            // Check if verification code has expired (30 minutes)
            const appliedAt = new Date(app.applied_at);
            const timeoutMs = (process.env.VERIFICATION_TIMEOUT_MINUTES || 30) * 60 * 1000;
            if (Date.now() - appliedAt.getTime() > timeoutMs) {
                try {
                    const dmChannel = await user.createDM();
                    await dmChannel.send({
                        embeds: [{
                            title: `${TIME} Verification Expired`,
                            description: 'Your verification window has expired (30 minutes).\n\nPlease submit a new application with `/apply`.',
                            color: COLOR,
                            timestamp: new Date()
                        }]
                    });
                } catch (_) { }

                // Mark as expired
                await db.query(`
          UPDATE applications SET status = 'expired', completed_at = NOW() WHERE id = ?
        `, [app.id]);
                return;
            }

            // Check if player has run /verify in-game
            if (!app.verified_in_game) {
                try {
                    const dmChannel = await user.createDM();
                    await dmChannel.send({
                        embeds: [{
                            title: `${WARN} Not Verified In-Game Yet`,
                            description: [
                                'You need to verify **in-game first** before clicking the reaction.',
                                '',
                                '**Step 1:** Join `bananasmp.net`',
                                `**Step 2:** Run: \`/verify ${app.verification_code}\``,
                                '**Step 3:** Come back here and click the ' + SUCCESS + ' button again.'
                            ].join('\n'),
                            color: COLOR,
                            timestamp: new Date()
                        }]
                    });
                } catch (_) { }
                return;
            }

            // Player has verified in-game — mark application as verified!
            await db.query(`
        UPDATE applications 
        SET status = 'verified',
            verified_at = NOW(),
            verification_code = NULL,
            verify_message_id = NULL
        WHERE id = ?
      `, [app.id]);

            // Log to audit
            await auditLogger.log('APPLICATION_VERIFIED', userId, 'player', app.id, {
                minecraft_username: app.minecraft_username,
                method: 'reaction_after_ingame_verify'
            });

            // Get queue position
            const posRows = await db.query(`
        SELECT COUNT(*) as position 
        FROM applications 
        WHERE status IN ('pending', 'verified') 
        AND applied_at < ?
      `, [app.applied_at]);

            const position = (posRows && posRows[0].position + 1) || '?';

            // Send success DM
            try {
                const dmChannel = await user.createDM();
                await dmChannel.send({
                    embeds: [{
                        title: `${SUCCESS} Verification Complete!`,
                        description: `Your application for **${app.minecraft_username}** is now **verified** and in the queue!`,
                        fields: [
                            {
                                name: `${GAME} Minecraft`,
                                value: app.minecraft_username,
                                inline: true
                            },
                            {
                                name: `${QUEUE} Gamemode`,
                                value: app.primary_gamemode,
                                inline: true
                            },
                            {
                                name: `${QUEUE} Queue Position`,
                                value: `#${position}`,
                                inline: true
                            },
                            {
                                name: `${TIME} What\'s Next`,
                                value: 'A tester will invite you when it\'s your turn. Make sure your DMs are open!'
                            }
                        ],
                        color: COLOR,
                        timestamp: new Date()
                    }]
                });
            } catch (_) { }

        } catch (error) {
            console.error('[VerifyReaction] Error handling reaction:', error);
        }
    }
};
