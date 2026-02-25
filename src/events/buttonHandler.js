const { MessageFlags } = require('discord.js');
const db = require('../database');
const { ERROR, SUCCESS, INFO, QUEUE, GAME, TIME, WARN, COLOR, REGION, STAR } = require('../config/emojis');
const auditLogger = require('../utils/auditLogger');
const ticketManager = require('../utils/ticketManager');
const voiceManager = require('../utils/voiceManager');
const helpers = require('../utils/helpers');
const completeCommand = require('../commands/complete');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    // Handle select menu (dropdown) interactions
    if (interaction.isStringSelectMenu()) {
      const customId = interaction.customId;
      const userId = interaction.user.id;

      try {
        // Parse select menu ID
        const parts = customId.split('_');
        const action = parts[0];

        // Handle complete dropdown
        if (action === 'complete') {
          const appId = parts[1];
          const selectedValue = interaction.values[0]; // e.g., "up_LT4" or "down_LT3" or "keep_LT5"
          const [tierAction, tier] = selectedValue.split('_');

          // Check if user is the tester
          const appRows = await db.query(`
            SELECT * FROM applications WHERE id = ? AND tester_id = ?
          `, [appId, userId]);

          if (!appRows || appRows.length === 0) {
            return await interaction.reply({
              content: `${ERROR} You are not the assigned tester for this test.`,
              flags: [MessageFlags.Ephemeral]
            });
          }

          // Pass to complete command handler
          await completeCommand.handleTierSelection(interaction, tierAction, tier, appId);
          return;
        }
      } catch (error) {
        console.error('Select menu error:', error);
        await interaction.reply({
          content: `${ERROR} Error processing selection.`,
          flags: [MessageFlags.Ephemeral]
        });
      }
      return;
    }

    // Only handle button interactions
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    const userId = interaction.user.id;

    try {
      // Parse button ID
      const parts = customId.split('_');
      const action = parts[0];

      // ─────────────────────────────────────────────────────────────────────
      // cancelapp_<appId> — Cancel APPLICATION (from /my-application embed)
      // ─────────────────────────────────────────────────────────────────────
      if (action === 'cancelapp') {
        const appId = parts[1];

        const rows = await db.query(`
          SELECT * FROM applications WHERE id = ? AND discord_id = ?
        `, [appId, userId]);

        if (!rows || rows.length === 0) {
          return await interaction.reply({
            content: `${ERROR} Application not found or you are not the owner.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        const app = rows[0];

        if (app.status === 'testing') {
          return await interaction.reply({
            content: `${ERROR} You cannot cancel your application while you are being tested.\n\nPlease contact a tester or admin.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        const wasInvited = app.status === 'invited';
        const previousTester = app.tester_id;

        // Cancel the application
        await db.query(`
          UPDATE applications 
          SET status = 'cancelled', 
              completed_at = NOW(),
              tester_id = NULL,
              invited_at = NULL,
              responded_at = NULL
          WHERE id = ?
        `, [app.id]);

        // Fix queue positions
        await db.query(`
          UPDATE applications 
          SET position = position - 1 
          WHERE status IN ('pending', 'verified') 
          AND position > ?
        `, [app.position]);

        // Log audit
        await auditLogger.log('APPLICATION_CANCELLED', userId, 'player', app.id, {
          minecraft_username: app.minecraft_username,
          previous_status: app.status,
          method: 'button'
        });

        // Notify tester if they had been invited
        if (wasInvited && previousTester) {
          try {
            const tester = await interaction.client.users.fetch(previousTester);
            await tester.send({
              embeds: [{
                title: `${ERROR} Player Cancelled Application`,
                description: `**${app.minecraft_username}** has cancelled their application while invited.`,
                fields: [{
                  name: `${QUEUE} Status`,
                  value: 'No action needed. Use `/available` to get the next player.'
                }],
                color: COLOR,
                timestamp: new Date()
              }]
            });
          } catch (dmError) {
            console.log('Could not DM tester:', dmError.message);
          }
        }

        return await interaction.update({
          content: `${SUCCESS} Your application for **${app.minecraft_username}** has been cancelled.\n\nUse \`/apply\` to submit a new application.`,
          embeds: [],
          components: []
        });
      }

      // ─────────────────────────────────────────────────────────────────────
      // verify_submit_btn — Process verification click in DMs
      // ─────────────────────────────────────────────────────────────────────
      if (action === 'verify' && parts[1] === 'submit') {
        const messageId = interaction.message.id;

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        // Find application by verify_message_id
        const rows = await db.query(`
          SELECT * FROM applications 
          WHERE verify_message_id = ? 
          AND discord_id = ?
          AND status = 'pending'
          LIMIT 1
        `, [messageId, userId]);

        if (!rows || rows.length === 0) {
          return await interaction.editReply({
            content: `${ERROR} This verification session is no longer active or could not be found.`
          });
        }

        const app = rows[0];

        // Check if player has run /verify in-game
        if (!app.verified_in_game) {
          return await interaction.editReply({
            embeds: [{
              title: `${WARN} Not Verified In-Game Yet`,
              description: [
                'You need to verify **in-game first** before clicking the button.',
                '',
                '**Step 1:** Join `bananasmp.net`',
                `**Step 2:** Run: \`/verify ${app.verification_code}\``,
                '**Step 3:** Come back here and click the button again.'
              ].join('\n'),
              color: COLOR,
              timestamp: new Date()
            }]
          });
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
          method: 'button_after_ingame_verify'
        });

        // Get queue position
        const posRows = await db.query(`
          SELECT COUNT(*) as position 
          FROM applications 
          WHERE status IN ('pending', 'verified') 
          AND applied_at < ?
        `, [app.applied_at]);

        const position = (posRows && posRows[0].position + 1) || '?';

        // Update the original message to remove the button since it's verified
        await interaction.message.edit({
          components: [] // Removes the button
        });

        return await interaction.editReply({
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
                value: helpers.formatGamemode(app.primary_gamemode),
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
      }

      // ─────────────────────────────────────────────────────────────────────
      // Old tier button (no longer used — now dropdown)
      // ─────────────────────────────────────────────────────────────────────
      if (action === 'tier') {
        return await interaction.reply({
          content: `${ERROR} Please use the dropdown menu instead.`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      // ─────────────────────────────────────────────────────────────────────
      // complete_<mcUsername> — Complete test button (from ticket channel)
      // ─────────────────────────────────────────────────────────────────────
      if (action === 'complete') {
        const mcUsername = parts[1];

        // Find the test by username and channel
        const appRows = await db.query(`
          SELECT * FROM applications 
          WHERE minecraft_username = ? 
          AND status = 'testing'
          AND channel_id = ?
        `, [mcUsername, interaction.channelId]);

        if (!appRows || appRows.length === 0) {
          return await interaction.reply({
            content: `${ERROR} No active test found in this channel.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        const app = appRows[0];

        // Check if user is tester
        if (app.tester_id !== userId) {
          return await interaction.reply({
            content: `${ERROR} Only the assigned tester can complete this test.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        // Execute complete command
        await completeCommand.execute(interaction);
        return;
      }

      // ─────────────────────────────────────────────────────────────────────
      // cancel_<mcUsername> — Cancel TEST button (from ticket channel, tester only)
      // ─────────────────────────────────────────────────────────────────────
      if (action === 'cancel') {
        const mcUsername = parts[1];

        // Find the test
        const appRows = await db.query(`
          SELECT * FROM applications 
          WHERE minecraft_username = ? 
          AND status = 'testing'
          AND channel_id = ?
        `, [mcUsername, interaction.channelId]);

        if (!appRows || appRows.length === 0) {
          return await interaction.reply({
            content: `${ERROR} No active test found in this channel.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        const app = appRows[0];

        // Check if user is tester
        if (app.tester_id !== userId) {
          return await interaction.reply({
            content: `${ERROR} Only the assigned tester can cancel this test.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        // Return player to queue instead of fully cancelling
        await db.query(`
          UPDATE applications 
          SET status = 'verified',
              tester_id = NULL,
              invited_at = NULL,
              responded_at = NULL
          WHERE id = ?
        `, [app.id]);

        // Log
        await auditLogger.log('TEST_CANCELLED', userId, 'tester', app.id, {
          minecraft_username: mcUsername,
          method: 'button'
        });

        // Notify player
        try {
          const player = await interaction.client.users.fetch(app.discord_id);
          await player.send({
            embeds: [{
              title: `${ERROR} Test Cancelled`,
              description: `Your test for **${helpers.formatGamemode(app.primary_gamemode)}** was cancelled by the tester.`,
              fields: [{
                name: `${QUEUE} Status`,
                value: 'You have been returned to the queue and will be invited by another tester soon.'
              }],
              color: COLOR,
              timestamp: new Date()
            }]
          });
        } catch (dmError) {
          console.log('Could not DM player:', dmError.message);
        }

        // Acknowledge interaction immediately (cannot reply after channel is deleted)
        await interaction.deferUpdate();

        // Send a goodbye message so users can see the reason before deletion
        try {
          await interaction.channel.send({
            embeds: [{
              title: `${ERROR} Test Cancelled`,
              description: `Test for **${mcUsername}** was cancelled by <@${userId}>. This channel will be deleted in 5 seconds.`,
              color: COLOR,
              timestamp: new Date()
            }]
          });
        } catch (_) { }

        // Delete channels after a short delay so users can see the message
        setTimeout(async () => {
          await ticketManager.deleteTestTicket(interaction.channel);
          if (app.voice_channel_id) {
            await voiceManager.deleteTestChannelById(interaction.guild, app.voice_channel_id);
          }
        }, 5000);
        return;
      }

      // ─────────────────────────────────────────────────────────────────────
      // invite_<appId>_<testerId> — Invite button (from /available)
      // ─────────────────────────────────────────────────────────────────────
      if (action === 'invite') {
        const applicationId = parts[1];
        const testerId = parts[2];

        if (userId !== testerId) {
          return await interaction.reply({
            content: `${ERROR} This invitation is not for you.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        // Check if tester has active test
        const hasActive = await ticketManager.hasActiveTest(testerId);
        if (hasActive) {
          return await interaction.reply({
            content: `${ERROR} You already have an active test. Complete it first.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        // Get application
        const rows = await db.query(`
          SELECT * FROM applications WHERE id = ?
        `, [applicationId]);

        if (!rows || rows.length === 0) {
          return await interaction.reply({
            content: `${ERROR} Application not found.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        const app = rows[0];

        // Update status
        await db.query(`
          UPDATE applications 
          SET status = 'invited', 
              invited_at = NOW(),
              tester_id = ?
          WHERE id = ?
        `, [testerId, applicationId]);

        // Update tester stats
        await db.query(`
          UPDATE testers 
          SET tests_today = tests_today + 1,
              tests_this_week = tests_this_week + 1,
              tests_this_month = tests_this_month + 1,
              tests_conducted = tests_conducted + 1,
              last_test_at = NOW()
          WHERE discord_id = ?
        `, [testerId]);

        await auditLogger.log('PLAYER_INVITED', testerId, 'tester', applicationId, {
          minecraft_username: app.minecraft_username,
          gamemode: app.primary_gamemode
        });

        // DM player
        try {
          const applicant = await interaction.client.users.fetch(app.discord_id);
          await applicant.send({
            embeds: [{
              title: `${GAME} You\\'ve Been Invited!`,
              description: `A tester is ready for **${helpers.formatGamemode(app.primary_gamemode)}**!`,
              fields: [
                {
                  name: `${TIME} Response Time`,
                  value: 'You have **5 minutes** to reply ACCEPT or DECLINE'
                },
                {
                  name: `${SUCCESS} To Accept`,
                  value: 'Reply: **ACCEPT**',
                  inline: true
                },
                {
                  name: `${ERROR} To Decline`,
                  value: 'Reply: **DECLINE**',
                  inline: true
                }
              ],
              color: COLOR,
              timestamp: new Date()
            }]
          });
        } catch (dmError) {
          await interaction.reply({
            content: `${WARN} Could not DM player. They may have DMs disabled.`,
            flags: [MessageFlags.Ephemeral]
          });
          return;
        }

        await interaction.update({
          content: `${SUCCESS} **${app.minecraft_username}** invited! Waiting for response...`,
          components: [],
          embeds: []
        });
      }

      // ─────────────────────────────────────────────────────────────────────
      // skip_<appId>_<testerId> — Skip button (from /available)
      // Records the skip and advances to the next eligible player inline.
      // ─────────────────────────────────────────────────────────────────────
      else if (action === 'skip') {
        const applicationId = parts[1];
        const testerId = parts[2];

        if (userId !== testerId) {
          return await interaction.reply({
            content: `${ERROR} This is not your selection.`,
            flags: [MessageFlags.Ephemeral]
          });
        }

        // Defer update while we do DB work
        await interaction.deferUpdate();

        // Record this tester in the skipped_by list of the skipped application
        try {
          const appRows = await db.query(`SELECT skipped_by FROM applications WHERE id = ?`, [applicationId]);
          if (appRows && appRows.length > 0) {
            let skipped = [];
            try { skipped = JSON.parse(appRows[0].skipped_by || '[]'); } catch (_) { skipped = []; }
            if (!skipped.includes(userId)) {
              skipped.push(userId);
              await db.query(`UPDATE applications SET skipped_by = ? WHERE id = ?`, [JSON.stringify(skipped), applicationId]);
            }
          }
        } catch (skipErr) {
          console.error('[Skip] Failed to record skip:', skipErr.message);
        }

        // Get the tester's permissions
        const testerData = await db.query(`SELECT permissions, tests_today, daily_limit FROM testers WHERE discord_id = ? AND is_active = TRUE`, [userId]);
        if (!testerData || testerData.length === 0) {
          return await interaction.editReply({ content: `${ERROR} Tester not found.`, components: [], embeds: [] });
        }
        let permissions = [];
        try { permissions = JSON.parse(testerData[0].permissions); } catch (_) { permissions = []; }

        // Fetch next eligible player (excluding all skipped by this tester)
        const queueRows = await db.query(`
          SELECT * FROM applications
          WHERE status = 'verified'
            AND (reschedule_time IS NULL OR reschedule_time <= NOW())
          ORDER BY
            CASE priority WHEN 'supporter' THEN 4 WHEN 'premium' THEN 3 WHEN 'vip' THEN 2 ELSE 1 END DESC,
            applied_at ASC
        `);

        const eligible = (queueRows || []).filter(app => {
          const gamemodeMatch = permissions.includes(app.primary_gamemode) ||
            (app.secondary_gamemode && permissions.includes(app.secondary_gamemode));
          if (!gamemodeMatch) return false;
          let skipped = [];
          try { skipped = JSON.parse(app.skipped_by || '[]'); } catch (_) { skipped = []; }
          return !skipped.includes(userId);
        });

        if (eligible.length === 0) {
          return await interaction.editReply({
            content: `${TIME} No more eligible players in the queue after skipping.\n\nWait for new players or use \`/available\` again later.`,
            components: [],
            embeds: []
          });
        }

        const next = eligible[0];
        const { formatDuration } = require('../utils/helpers');
        const historyRows = await db.query(`
          SELECT COUNT(*) as total_tests,
            SUM(CASE WHEN change_type='upgrade' THEN 1 ELSE 0 END) as upgrades,
            SUM(CASE WHEN change_type='downgrade' THEN 1 ELSE 0 END) as downgrades
          FROM tier_changes WHERE minecraft_username = ?
        `, [next.minecraft_username]);
        const history = historyRows?.[0];
        const hasHistory = history?.total_tests > 0;
        const trend = !hasHistory ? '' : history.upgrades > history.downgrades ? ' [UP]' : history.downgrades > history.upgrades ? ' [DOWN]' : ' [SAME]';

        const embed = {
          title: `${STATS} Next Player — ${eligible.length} eligible in queue`,
          color: COLOR,
          fields: [
            { name: `${GAME} IGN`, value: next.minecraft_username, inline: true },
            { name: `${QUEUE} Gamemode`, value: next.secondary_gamemode ? `${helpers.formatGamemode(next.primary_gamemode)} *(or ${helpers.formatGamemode(next.secondary_gamemode)})*` : helpers.formatGamemode(next.primary_gamemode), inline: true },
            { name: `${REGION} Region`, value: next.region || 'Unknown', inline: true },
            { name: `${STATS} History${trend}`, value: hasHistory ? `${history.total_tests} tests | ↑${history.upgrades} ↓${history.downgrades}` : 'First test', inline: true },
            { name: `${STAR} Priority`, value: next.priority.charAt(0).toUpperCase() + next.priority.slice(1), inline: true },
            { name: `${TIME} Wait`, value: formatDuration(next.applied_at), inline: true }
          ],
          footer: { text: `Tester: ${testerData[0].tests_today}/${testerData[0].daily_limit} tests today` },
          timestamp: new Date()
        };

        const newRow = new (require('discord.js').ActionRowBuilder)().addComponents(
          new (require('discord.js').ButtonBuilder)().setCustomId(`invite_${next.id}_${userId}`).setLabel('Invite Player').setStyle(require('discord.js').ButtonStyle.Success).setEmoji(SUCCESS),
          new (require('discord.js').ButtonBuilder)().setCustomId(`skip_${next.id}_${userId}`).setLabel('Skip →').setStyle(require('discord.js').ButtonStyle.Secondary).setEmoji(ERROR),
          new (require('discord.js').ButtonBuilder)().setCustomId(`history_${next.minecraft_username}`).setLabel('View History').setStyle(require('discord.js').ButtonStyle.Primary).setEmoji(INFO)
        );

        await interaction.editReply({ embeds: [embed], components: [newRow], content: null });
      }

      // ─────────────────────────────────────────────────────────────────────
      // history_<mcUsername> — View history button (from /available)
      // ─────────────────────────────────────────────────────────────────────
      else if (action === 'history') {
        const minecraftUsername = parts[1];

        const historyRows = await db.query(`
          SELECT * FROM tier_changes 
          WHERE minecraft_username = ?
          ORDER BY changed_at DESC
          LIMIT 10
        `, [minecraftUsername]);

        const notesRows = await db.query(`
          SELECT * FROM tester_notes 
          WHERE minecraft_username = ?
          ORDER BY created_at DESC
          LIMIT 5
        `, [minecraftUsername]);

        const historyText = historyRows?.length > 0
          ? historyRows.map(h => {
            const emoji = h.change_type === 'upgrade' ? '[UP]' : h.change_type === 'downgrade' ? '[DOWN]' : '[SAME]';
            return `${emoji} ${helpers.formatGamemode(h.gamemode)}: ${h.previous_tier || 'None'} -> ${h.new_tier}`;
          }).join('\n')
          : 'No history.';

        const notesText = notesRows?.length > 0
          ? notesRows.map(n => {
            const emoji = n.severity === 'critical' ? ERROR : n.severity === 'warning' ? WARN : INFO;
            return `${emoji} ${n.note.substring(0, 100)}`;
          }).join('\n\n')
          : 'No notes.';

        await interaction.reply({
          embeds: [{
            title: `${STATS} ${minecraftUsername}`,
            fields: [
              { name: `${STATS} Tier History`, value: historyText },
              { name: `${INFO} Notes`, value: notesText }
            ],
            color: COLOR,
            timestamp: new Date()
          }],
          flags: [MessageFlags.Ephemeral]
        });
      }

    } catch (error) {
      console.error('Button interaction error:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `${ERROR} Error processing action.`,
          flags: [MessageFlags.Ephemeral]
        });
      }
    }
  }
};