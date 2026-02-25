const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const { ERROR, INFO, QUEUE, COLOR } = require('../config/emojis');
const auditLogger = require('../utils/auditLogger');
const helpers = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel-test')
    .setDescription('Cancel a test if player no-shows (Testers only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(option =>
      option
        .setName('minecraft_username')
        .setDescription('Minecraft username of the player')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for cancellation')
        .setRequired(false)
        .addChoices(
          { name: 'Player no-show', value: 'no_show' },
          { name: 'Player disconnected', value: 'disconnected' },
          { name: 'Technical issues', value: 'technical' },
          { name: 'Other', value: 'other' }
        )
    )
    .addStringOption(option =>
      option
        .setName('other_reason')
        .setDescription('If other, specify reason')
        .setRequired(false)
    ),

  async execute(interaction) {
    const testerId = interaction.user.id;
    const mcUsername = interaction.options.getString('minecraft_username');
    const reasonChoice = interaction.options.getString('reason') || 'other';
    const otherReason = interaction.options.getString('other_reason') || '';

    const reason = reasonChoice === 'other' && otherReason
      ? otherReason
      : reasonChoice.replace('_', ' ');

    try {
      // Verify tester exists
      const testerRows = await db.query(`
        SELECT * FROM testers 
        WHERE discord_id = ? AND is_active = TRUE
      `, [testerId]);

      if (!testerRows || testerRows.length === 0) {
        return await interaction.reply({
          content: `${ERROR} You do not have tester permissions.`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      // Find the active testing application
      const appRows = await db.query(`
        SELECT * FROM applications 
        WHERE minecraft_username = ? 
        AND status = 'testing'
        AND tester_id = ?
        ORDER BY invited_at DESC
        LIMIT 1
      `, [mcUsername, testerId]);

      if (!appRows || appRows.length === 0) {
        return await interaction.reply({
          content: `${ERROR} No active test found for **${mcUsername}**.`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      const app = appRows[0];

      // Return player to queue
      await db.query(`
        UPDATE applications 
        SET status = 'verified',
            tester_id = NULL,
            invited_at = NULL,
            responded_at = NULL
        WHERE id = ?
      `, [app.id]);

      await auditLogger.log('TEST_CANCELLED', testerId, 'tester', app.id, {
        minecraft_username: mcUsername,
        reason: reason
      });

      // --- DISCORD TICKET LOGGING ---
      const ticketLogsChannelId = process.env.TICKET_LOGS_CHANNEL_ID;
      if (ticketLogsChannelId) {
        const cancelLogEmbed = {
          title: `${ERROR} Test Cancelled`,
          fields: [
            { name: 'Player', value: `**${mcUsername}** (<@${app.discord_id}>)`, inline: true },
            { name: 'Tester', value: `<@${testerId}>`, inline: true },
            { name: 'Reason', value: reason },
            { name: 'Status', value: 'Returned to queue', inline: true }
          ],
          color: COLOR,
          timestamp: new Date()
        };
        await auditLogger.logToDiscord(interaction.client, ticketLogsChannelId, cancelLogEmbed);
      }

      // Notify player
      try {
        const player = await interaction.client.users.fetch(app.discord_id);
        await player.send({
          embeds: [{
            title: `${ERROR} Test Cancelled`,
            description: `Your test for **${helpers.formatGamemode(app.primary_gamemode)}** has been cancelled.`,
            fields: [
              {
                name: `${INFO} Reason`,
                value: reason
              },
              {
                name: `${QUEUE} Status`,
                value: 'You have been returned to the queue and will be invited by another tester soon.'
              }
            ],
            color: COLOR,
            timestamp: new Date()
          }]
        });
      } catch (dmError) {
        console.log('Could not DM player:', dmError.message);
      }

      await interaction.reply({
        embeds: [{
          title: `${ERROR} Test Cancelled`,
          description: `Cancelled test for **${mcUsername}**`,
          fields: [
            {
              name: `${INFO} Reason`,
              value: reason
            },
            {
              name: `${QUEUE} Player Status`,
              value: 'Returned to queue'
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Cancel-test command error:', error);
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          content: `${ERROR} An error occurred. Please try again.`,
        });
      } else {
        await interaction.reply({
          content: `${ERROR} An error occurred. Please try again.`,
          flags: [MessageFlags.Ephemeral]
        });
      }
    }
  }
};