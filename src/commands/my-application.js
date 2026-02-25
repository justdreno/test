const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../database');
const { formatDuration, formatTimestamp } = require('../utils/helpers');
const { QUEUE, TIME, INFO, SUCCESS, GAME, STATS, REGION, STAR, ERROR, COLOR } = require('../config/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my-application')
    .setDescription('Check your application status'),

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      // Get user's active application
      const rows = await db.query(`
        SELECT * FROM applications 
        WHERE discord_id = ? 
        AND status IN ('pending', 'verifying', 'verified', 'invited', 'testing', 'rescheduled')
        ORDER BY applied_at DESC 
        LIMIT 1
      `, [userId]);

      if (!rows || rows.length === 0) {
        return await interaction.reply({
          content: `${QUEUE} You don\'t have any active applications.\n\nUse \`/apply\` to submit a new application.`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      const app = rows[0];

      // Get position in queue
      let queuePosition = null;
      let estimatedWait = 'Unknown';

      if (app.status === 'pending' || app.status === 'verified') {
        const posRows = await db.query(`
          SELECT COUNT(*) as position 
          FROM applications 
          WHERE status IN ('pending', 'verified') 
          AND applied_at < ?
        `, [app.applied_at]);

        queuePosition = (posRows && posRows[0].position + 1) || 'Unknown';

        // Estimate wait time (assuming 30 mins per test)
        const estimatedMinutes = queuePosition * 30;
        if (estimatedMinutes < 60) {
          estimatedWait = `${estimatedMinutes} minutes`;
        } else {
          estimatedWait = `${Math.round(estimatedMinutes / 60)} hours`;
        }
      }

      // Format status
      const statusEmojis = {
        'pending': TIME,
        'verifying': INFO,
        'verified': SUCCESS,
        'invited': QUEUE,
        'testing': GAME,
        'rescheduled': TIME
      };

      const statusDescriptions = {
        'pending': 'Pending verification',
        'verifying': 'Verification in progress',
        'verified': 'Verified and in queue',
        'invited': 'Invited — waiting for your response',
        'testing': 'Currently being tested',
        'rescheduled': 'Rescheduled — will reactivate at scheduled time'
      };

      // Build embed
      const embed = {
        title: `${INFO} Your Application`,
        description: '━━━━━━━━━━━━━━━━━━',
        fields: [
          {
            name: `${GAME} Minecraft`,
            value: app.minecraft_username,
            inline: true
          },
          {
            name: `${QUEUE} Gamemode`,
            value: `${app.primary_gamemode}${app.secondary_gamemode ? ` (${app.secondary_gamemode} backup)` : ''}`,
            inline: true
          },
          {
            name: `${REGION} Region`,
            value: app.region || 'Unknown',
            inline: true
          },
          {
            name: `${STATS} Status`,
            value: `${statusEmojis[app.status] || '❓'} ${statusDescriptions[app.status] || app.status}`,
            inline: true
          }
        ],
        color: COLOR,
        timestamp: new Date()
      };

      // Add queue position if applicable
      if (queuePosition) {
        embed.fields.push({
          name: `${QUEUE} Queue Position`,
          value: `#${queuePosition}`,
          inline: true
        });
        embed.fields.push({
          name: `${TIME} Estimated Wait`,
          value: estimatedWait,
          inline: true
        });
      }

      // Add timestamps
      embed.fields.push({
        name: `${INFO} Applied`,
        value: formatTimestamp(app.applied_at),
        inline: true
      });

      if (app.verified_at) {
        embed.fields.push({
          name: `${SUCCESS} Verified`,
          value: formatTimestamp(app.verified_at),
          inline: true
        });
      }

      // Add priority info
      const priorityEmojis = {
        'standard': '',
        'vip': '⭐',
        'premium': '',
        'supporter': ''
      };
      embed.fields.push({
        name: `${STAR} Priority`,
        value: `${priorityEmojis[app.priority] || ''} ${app.priority.charAt(0).toUpperCase() + app.priority.slice(1)}`,
        inline: true
      });

      // Add reschedule count if any
      if (app.reschedule_count > 0) {
        embed.fields.push({
          name: `${TIME} Reschedules`,
          value: `${app.reschedule_count}/2`,
          inline: true
        });
      }

      // Add notes if any
      if (app.notes) {
        embed.fields.push({
          name: `${INFO} Notes`,
          value: app.notes.substring(0, 200) + (app.notes.length > 200 ? '...' : ''),
          inline: false
        });
      }

      // Build action buttons
      const row = new ActionRowBuilder();

      // Cancel button — available for all non-testing statuses
      if (app.status !== 'testing') {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`cancelapp_${app.id}`)
            .setLabel('Cancel Application')
            .setStyle(ButtonStyle.Danger)
            .setEmoji(ERROR)
        );
      }

      await interaction.reply({
        embeds: [embed],
        components: row.components.length > 0 ? [row] : [],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('My-application command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while fetching your application. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  },

  getStatusColor(status) {
    const colors = {
      'pending': 0xf39c12,
      'verifying': 0x3498db,
      'verified': 0x2ecc71,
      'invited': 0x9b59b6,
      'testing': 0xe74c3c,
      'rescheduled': 0x95a5a6
    };
    return colors[status] || 0x95a5a6;
  }
};