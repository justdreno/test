const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const auditLogger = require('../utils/auditLogger');
const { STAR, TIME, INFO, ERROR, COLOR } = require('../config/emojis');
const { sanitize, parseDuration } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('priority-add')
    .setDescription('Give a player priority queue status (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName('minecraft_username')
        .setDescription('Minecraft username to give priority')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('tier')
        .setDescription('Priority tier')
        .setRequired(true)
        .addChoices(
          { name: 'VIP', value: 'vip' },
          { name: 'Premium', value: 'premium' },
          { name: 'Supporter', value: 'supporter' }
        )
    )
    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription('Duration (leave blank for permanent)')
        .setRequired(false)
        .addChoices(
          { name: '1 Week', value: '1 week' },
          { name: '1 Month', value: '1 month' },
          { name: '3 Months', value: '3 months' },
          { name: '6 Months', value: '6 months' },
          { name: '1 Year', value: '1 year' }
        )
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for priority (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const adminId = interaction.user.id;
    const mcUsername = sanitize(interaction.options.getString('minecraft_username'));
    const tier = interaction.options.getString('tier');
    const duration = interaction.options.getString('duration');
    const reason = sanitize(interaction.options.getString('reason')) || 'No reason provided';

    try {
      // Update priority on active application
      const result = await db.query(`
        UPDATE applications 
        SET priority = ?
        WHERE minecraft_username = ? 
        AND status IN ('pending', 'verifying', 'verified', 'invited', 'testing', 'rescheduled')
      `, [tier, mcUsername]);

      // Log to audit
      await auditLogger.log('PRIORITY_ADDED', adminId, 'admin', mcUsername, {
        tier,
        duration: duration || 'permanent',
        reason
      });

      // Build response
      const tierEmojis = {
        'vip': STAR,
        'premium': STAR,
        'supporter': STAR
      };

      const durationText = duration ? duration : 'Permanent';

      await interaction.reply({
        embeds: [{
          title: `${tierEmojis[tier] || STAR} Priority Added`,
          description: `**Minecraft Username:** ${mcUsername}`,
          fields: [
            {
              name: `${STAR} Tier`,
              value: tier.toUpperCase(),
              inline: true
            },
            {
              name: `${TIME} Duration`,
              value: durationText,
              inline: true
            },
            {
              name: `${INFO} Reason`,
              value: reason
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Priority-add command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while adding priority. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};