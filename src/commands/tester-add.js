const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const auditLogger = require('../utils/auditLogger');
const { ERROR, WARN, SUCCESS, QUEUE, STATS, TIME, STAR, GAME, INFO, COLOR } = require('../config/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tester-add')
    .setDescription('Add a new tester (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Discord user to add as tester')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('permissions')
        .setDescription('Gamemodes this tester can evaluate (comma-separated)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('tier_limit')
        .setDescription('Maximum tier this tester can assign')
        .setRequired(false)
        .addChoices(
          { name: 'No Limit (All Tiers)', value: 'unlimited' },
          { name: 'High Tier 5', value: 'HT5' },
          { name: 'High Tier 3', value: 'HT3' },
          { name: 'High Tier 1', value: 'HT1' },
          { name: 'Low Tier 5', value: 'LT5' },
          { name: 'Low Tier 3', value: 'LT3' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('daily_limit')
        .setDescription('Maximum tests per day (default: 10)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(50)
    )
    .addBooleanOption(option =>
      option
        .setName('priority_queue')
        .setDescription('Can this tester take priority players?')
        .setRequired(false)
    ),

  async execute(interaction) {
    const adminId = interaction.user.id;
    const user = interaction.options.getUser('user');
    const permissionsStr = interaction.options.getString('permissions');
    const tierLimit = interaction.options.getString('tier_limit') || 'unlimited';
    const dailyLimit = interaction.options.getInteger('daily_limit') || 10;
    const priorityQueue = interaction.options.getBoolean('priority_queue') || false;

    try {
      // Parse permissions
      const permissions = permissionsStr.split(',').map(p => p.trim().toLowerCase());

      // Validate permissions
      const validGamemodes = ['vanilla', 'uhc', 'pot', 'sword', 'bow', 'rod', 'squid', 'bedwars', 'skywars'];
      const invalidGamemodes = permissions.filter(p => !validGamemodes.includes(p));

      if (invalidGamemodes.length > 0) {
        return await interaction.reply({
          content: `${ERROR} Invalid gamemodes: ${invalidGamemodes.join(', ')}\n\nValid options: ${validGamemodes.join(', ')}`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      // Check if user is already a tester
      const existingRows = await db.query(`
        SELECT * FROM testers 
        WHERE discord_id = ?
      `, [user.id]);

      if (existingRows && existingRows.length > 0) {
        const existing = existingRows[0];

        if (existing.is_active) {
          return await interaction.reply({
            content: `${WARN} ${user.username} is already an active tester.\n\nUse \`/tester-update\` to modify their permissions.`,
            flags: [MessageFlags.Ephemeral]
          });
        } else {
          // Reactivate tester
          await db.query(`
            UPDATE testers 
            SET is_active = TRUE,
                permissions = ?,
                tier_limit = ?,
                daily_limit = ?,
                priority_queue = ?
            WHERE discord_id = ?
          `, [JSON.stringify(permissions), tierLimit, dailyLimit, priorityQueue, user.id]);

          await auditLogger.log('TESTER_REACTIVATED', adminId, 'admin', user.id, {
            permissions,
            tier_limit: tierLimit,
            daily_limit: dailyLimit
          });

          return await interaction.reply({
            embeds: [{
              title: `${SUCCESS} Tester Reactivated`,
              description: `${user.username} has been reactivated as a tester.`,
              fields: [
                {
                  name: `${QUEUE} Permissions`,
                  value: permissions.join(', ')
                },
                {
                  name: `${STATS} Tier Limit`,
                  value: tierLimit,
                  inline: true
                },
                {
                  name: '[UP] Daily Limit',
                  value: dailyLimit.toString(),
                  inline: true
                }
              ],
              color: COLOR,
              timestamp: new Date()
            }],
            flags: [MessageFlags.Ephemeral]
          });
        }
      }

      // Create new tester
      await db.query(`
        INSERT INTO testers 
        (id, discord_id, discord_username, permissions, tier_limit, daily_limit, priority_queue, is_active, added_at, added_by)
        VALUES (UUID(), ?, ?, ?, ?, ?, ?, TRUE, NOW(), ?)
      `, [
        user.id,
        user.username,
        JSON.stringify(permissions),
        tierLimit,
        dailyLimit,
        priorityQueue,
        adminId
      ]);

      // Log to audit
      await auditLogger.log('TESTER_ADDED', adminId, 'admin', user.id, {
        permissions,
        tier_limit: tierLimit,
        daily_limit: dailyLimit,
        priority_queue: priorityQueue
      });

      await interaction.reply({
        embeds: [{
          title: `${SUCCESS} Tester Added`,
          description: `${user.username} has been added as a tester.`,
          fields: [
            {
              name: `${QUEUE} Permissions`,
              value: permissions.join(', ')
            },
            {
              name: `${STATS} Tier Limit`,
              value: tierLimit,
              inline: true
            },
            {
              name: `${TIME} Daily Limit`,
              value: dailyLimit.toString(),
              inline: true
            },
            {
              name: `${STAR} Priority Queue`,
              value: priorityQueue ? 'Yes' : 'No',
              inline: true
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }],
        flags: [MessageFlags.Ephemeral]
      });

      // DM the new tester
      try {
        await user.send({
          embeds: [{
            title: `${GAME} You have been added as a FastTiers Tester!`,
            description: `Congratulations! You have been approved as a tester for the FastTiers system.`,
            fields: [
              {
                name: `${QUEUE} Your Permissions`,
                value: permissions.join(', ')
              },
              {
                name: `${TIME} Daily Limit`,
                value: `${dailyLimit} tests per day`
              },
              {
                name: `${INFO} Getting Started`,
                value: 'Use `/available` to get players from the queue.\nUse `/stats` to view your tester statistics.'
              }
            ],
            color: COLOR,
            timestamp: new Date()
          }]
        });
      } catch (dmError) {
        console.log('Could not DM new tester:', dmError.message);
      }

    } catch (error) {
      console.error('Tester-add command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while adding the tester. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};