const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { ERROR, QUEUE, INFO, SUCCESS, GAME, STATS, STAR, REWARD, REGION, WARN, COLOR } = require('../config/emojis');
const auditLogger = require('../utils/auditLogger');
const api = require('../utils/api');
const ticketManager = require('../utils/ticketManager');
const voiceManager = require('../utils/voiceManager');
const rolesConfig = require('../config/roles');

// Tier flow: LT5 → HT5 → LT4 → HT4 → LT3 → HT3 → LT2 → HT2 → LT1 → HT1
// Index:     0     1     2     3     4     5     6     7     8     9
const TIER_FLOW = ['LT5', 'HT5', 'LT4', 'HT4', 'LT3', 'HT3', 'LT2', 'HT2', 'LT1', 'HT1'];

// Points required for each tier
const TIER_POINTS = {
  'LT5': 1,
  'HT5': 2,
  'LT4': 4,
  'HT4': 8,
  'LT3': 16,
  'HT3': 32,
  'LT2': 64,
  'HT2': 128,
  'LT1': 256,
  'HT1': 512
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('complete')
    .setDescription('Complete a test and assign tier (Testers only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const testerId = interaction.user.id;
    const channelId = interaction.channelId;

    // Defer immediately to prevent timeout
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      // Verify tester exists
      const testerRows = await db.query(`
        SELECT * FROM testers 
        WHERE discord_id = ? AND is_active = TRUE
      `, [testerId]);

      if (!testerRows || testerRows.length === 0) {
        return await interaction.editReply({
          content: `${ERROR} You do not have tester permissions.`
        });
      }

      // Find the active testing application
      let appRows = await db.query(`
        SELECT * FROM applications 
        WHERE tester_id = ? 
        AND status = 'testing'
        AND channel_id = ?
        ORDER BY invited_at DESC
        LIMIT 1
      `, [testerId, channelId]);

      if (!appRows || appRows.length === 0) {
        appRows = await db.query(`
          SELECT * FROM applications 
          WHERE tester_id = ? 
          AND status = 'testing'
          ORDER BY invited_at DESC
          LIMIT 1
        `, [testerId]);
      }

      if (!appRows || appRows.length === 0) {
        return await interaction.editReply({
          content: `${ERROR} No active test found.\n\nUse this command in the test ticket channel.`
        });
      }

      const app = appRows[0];

      // Get player's current tier
      const currentTier = await api.getPlayerTier(app.minecraft_username, app.primary_gamemode);
      const currentIndex = currentTier ? TIER_FLOW.indexOf(currentTier) : -1;

      // Calculate options
      const options = [];

      // Downgrade option
      if (currentIndex > 0) {
        const downTier = TIER_FLOW[currentIndex - 1];
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Downgrade to ${downTier}`)
            .setDescription(`Move down from ${currentTier} to ${downTier}`)
            .setValue(`down_${downTier}`)
            .setEmoji(QUEUE)
        );
      } else if (currentIndex === 0) {
        // At LT5, downgrade = no tier
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel('Downgrade (Remove Tier)')
            .setDescription(`Remove ${currentTier} tier completely`)
            .setValue('down_none')
            .setEmoji(QUEUE)
        );
      }

      // Keep option (only if has tier)
      if (currentTier && currentIndex >= 0) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Keep ${currentTier}`)
            .setDescription(`Stay at current tier: ${currentTier}`)
            .setValue(`keep_${currentTier}`)
            .setEmoji(INFO)
        );
      }

      // Upgrade option (only if has tier and not at max)
      if (currentIndex >= 0 && currentIndex < TIER_FLOW.length - 1) {
        const upTier = TIER_FLOW[currentIndex + 1];
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Upgrade to ${upTier}`)
            .setDescription(`Move up from ${currentTier} to ${upTier}`)
            .setValue(`up_${upTier}`)
            .setEmoji(SUCCESS)
        );
      }

      // If no tier yet, allow assigning starting tier
      if (!currentTier) {
        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel('Assign LT5 (Starting Tier)')
            .setDescription('First time tester - assign lowest tier')
            .setValue('up_LT5')
            .setEmoji(SUCCESS)
        );
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`complete_${app.id}`)
        .setPlaceholder('Select tier outcome...')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.editReply({
        content: `🎯 Complete test for **${app.minecraft_username}**`,
        embeds: [{
          title: `${GAME} Select Tier Outcome`,
          description: `Player: **${app.minecraft_username}**\nGamemode: **${app.primary_gamemode}**\nCurrent Tier: **${currentTier || 'None'}**`,
          fields: [
            {
              name: '📋 Tier Flow',
              value: 'LT5 → HT5 → LT4 → HT4 → LT3 → HT3 → LT2 → HT2 → LT1 → HT1'
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }],
        components: [row],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Complete command error:', error);
      await interaction.editReply({
        content: `${ERROR} An error occurred. Please try again.`
      });
    }
  }
};

// Handle tier selection from dropdown
module.exports.handleTierSelection = async (interaction, action, tier, appId) => {
  try {
    const testerId = interaction.user.id;

    // Get application
    const appRows = await db.query(`
      SELECT * FROM applications WHERE id = ? AND tester_id = ?
    `, [appId, testerId]);

    if (!appRows || appRows.length === 0) {
      return await interaction.reply({
        content: `${ERROR} Test not found or you are not the assigned tester.`,
        flags: [MessageFlags.Ephemeral]
      });
    }

    const app = appRows[0];

    // Get previous tier
    const previousTier = await api.getPlayerTier(app.minecraft_username, app.primary_gamemode);

    // Determine change type
    let changeType = 'same';
    if (action === 'up') changeType = 'upgrade';
    else if (action === 'down') changeType = 'downgrade';
    else if (action === 'keep') changeType = 'same';

    // Calculate points to add based on tier
    let pointsToAdd = 0;
    if (tier && TIER_POINTS[tier]) {
      pointsToAdd = TIER_POINTS[tier];
    }

    // Complete the application
    await db.query(`
      UPDATE applications 
      SET status = 'completed',
          completed_at = NOW()
      WHERE id = ?
    `, [app.id]);

    // Record tier change
    await db.query(`
      INSERT INTO tier_changes 
      (id, application_id, discord_id, minecraft_username, gamemode, 
       previous_tier, new_tier, tester_id, change_type)
      VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      app.id,
      app.discord_id,
      app.minecraft_username,
      app.primary_gamemode,
      previousTier,
      tier,
      testerId,
      changeType
    ]);

    // Sync with web API (with points and region)
    let apiSyncSuccess = false;
    try {
      apiSyncSuccess = await api.updatePlayerTier(app.minecraft_username, app.primary_gamemode, tier, {
        previous_tier: previousTier,
        change_type: changeType,
        tested_by: testerId,
        tested_at: new Date().toISOString(),
        points_added: pointsToAdd,
        region: app.region
      });

      if (apiSyncSuccess) {
        console.log(`[API] Synced tier for ${app.minecraft_username}: ${tier} (+${pointsToAdd} points)`);
      }
    } catch (apiError) {
      console.error('[API] Error:', apiError.message);
    }

    // Delete ticket and voice channels
    if (app.channel_id || app.voice_channel_id) {
      try {
        if (app.channel_id) {
          const channel = await interaction.guild.channels.fetch(app.channel_id);
          if (channel) {
            await channel.send({
              embeds: [{
                title: `${SUCCESS} Test Completed`,
                description: `**${app.minecraft_username}** test finished!`,
                fields: [
                  {
                    name: `${STATS} Result`,
                    value: tier
                      ? `${previousTier || 'None'} → **${tier}** (${changeType})`
                      : `**${previousTier}** removed (downgrade)`,
                    inline: false
                  },
                  {
                    name: `${STAR} Points`,
                    value: tier ? `+${pointsToAdd} points` : 'No points (tier removed)',
                    inline: true
                  }
                ],
                color: COLOR,
                timestamp: new Date()
              }]
            });

            setTimeout(async () => {
              await ticketManager.deleteTestTicket(channel);
            }, 5000);
          }
        }

        if (app.voice_channel_id) {
          await voiceManager.deleteTestChannelById(interaction.guild, app.voice_channel_id);
        }
      } catch (error) {
        console.error('[Cleanup] Error deleting channels:', error.message);
      }
    }

    // Log to audit
    await auditLogger.log('TEST_COMPLETED', testerId, 'tester', app.id, {
      minecraft_username: app.minecraft_username,
      gamemode: app.primary_gamemode,
      previous_tier: previousTier,
      new_tier: tier,
      change_type: changeType,
      points_added: pointsToAdd,
      api_synced: apiSyncSuccess
    });

    // Notify player
    try {
      const player = await interaction.client.users.fetch(app.discord_id);
      const tierDisplay = tier || 'No tier';
      const pointsDisplay = tier ? `+${pointsToAdd} points` : 'No points earned';

      await player.send({
        embeds: [{
          title: `${REWARD} Test Complete!`,
          description: `Your **${app.primary_gamemode}** test is complete!`,
          fields: [
            {
              name: `${STATS} Tier Result`,
              value: tier
                ? `${previousTier || 'None'} → **${tier}**`
                : `**${previousTier}** removed`,
              inline: false
            },
            {
              name: `${STAR} Points Earned`,
              value: pointsDisplay,
              inline: true
            },
            {
              name: `${REGION} Website`,
              value: apiSyncSuccess
                ? `${SUCCESS} Updated on website`
                : `${WARN} Saved locally`,
              inline: true
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }]
      });
    } catch (dmError) {
      console.log('Could not DM player:', dmError.message);
    }

    // Update interaction
    const resultText = tier
      ? `${previousTier || 'None'} → **${tier}** (${changeType}, +${pointsToAdd} pts)`
      : `**${previousTier}** removed (downgrade)`;

    await interaction.update({
      content: `${SUCCESS} **${app.minecraft_username}** tested!\n${resultText}`,
      embeds: [],
      components: []
    });

    // --- DISCORD ROLE SYNC & LOGGING ---
    const guild = interaction.guild;
    const member = await guild.members.fetch(app.discord_id).catch(() => null);

    if (member) {
      const modeKey = app.primary_gamemode.toUpperCase().replace(/\s+/g, '');
      const modeRoles = rolesConfig[modeKey];

      if (modeRoles) {
        // 1. Remove all existing tier roles for this gamemode
        const rolesToRemove = Object.values(modeRoles).filter(id => id && member.roles.cache.has(id));
        if (rolesToRemove.length > 0) {
          await member.roles.remove(rolesToRemove).catch(e => console.error(`[Roles] Remove error: ${e.message}`));
        }

        // 2. Add the new tier role
        const newRoleId = modeRoles[tier];
        if (newRoleId) {
          await member.roles.add(newRoleId).catch(e => console.error(`[Roles] Add error: ${e.message}`));
        }
      }
    }

    // 3. Send 1-line announcement
    const updatesChannelId = process.env.TIER_UPDATES_CHANNEL_ID;
    if (updatesChannelId) {
      let announcement = '';
      const displayGM = helpers.formatGamemode(app.primary_gamemode);
      if (changeType === 'upgrade') {
        announcement = `🚀 **${app.minecraft_username}** has been promoted to **${tier}** in **${displayGM}**!`;
      } else if (changeType === 'downgrade') {
        announcement = `📉 **${app.minecraft_username}** has been downgraded to **${tier || 'No Tier'}** in **${displayGM}**.`;
      } else {
        announcement = `⚖️ **${app.minecraft_username}** remains at **${tier}** in **${displayGM}**.`;
      }
      await auditLogger.logToDiscord(interaction.client, updatesChannelId, {
        description: announcement,
        color: COLOR
      });
    }

    // 4. Log to ticket logs
    const ticketLogsChannelId = process.env.TICKET_LOGS_CHANNEL_ID;
    if (ticketLogsChannelId) {
      const logEmbed = {
        title: `${GAME} Test Completed`,
        fields: [
          { name: 'Player', value: `**${app.minecraft_username}** (<@${app.discord_id}>)`, inline: true },
          { name: 'Tester', value: `<@${testerId}>`, inline: true },
          { name: 'Gamemode', value: helpers.formatGamemode(app.primary_gamemode), inline: true },
          { name: 'Result', value: `${previousTier || 'None'} → **${tier || 'None'}** (${changeType})`, inline: false },
          { name: 'Points', value: `+${pointsToAdd}`, inline: true },
          { name: 'Region', value: app.region || 'Unknown', inline: true }
        ],
        footer: { text: `Application ID: ${app.id}` },
        color: COLOR,
        timestamp: new Date()
      };
      await auditLogger.logToDiscord(interaction.client, ticketLogsChannelId, logEmbed);
    }

  } catch (error) {
    console.error('Tier selection error:', error);
    await interaction.editReply({
      content: `${ERROR} Error completing test. Please try again.`
    });
  }
};