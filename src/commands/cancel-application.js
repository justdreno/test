const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { TIME, QUEUE, ERROR, SUCCESS, WARN, INFO, COLOR } = require('../config/emojis');
const rateLimiter = require('../utils/rateLimiter');
const auditLogger = require('../utils/auditLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancel-application')
    .setDescription('Cancel your pending application'),

  async execute(interaction) {
    const userId = interaction.user.id;

    // Defer immediately to prevent timeout
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      // Check rate limit
      const rateCheck = await rateLimiter.checkLimit(userId, 'cancel-application');
      if (!rateCheck.allowed) {
        return await interaction.editReply({
          content: `${TIME} ${rateCheck.message}`
        });
      }

      // Get user's active application (any non-terminal status)
      const rows = await db.query(`
        SELECT * FROM applications 
        WHERE discord_id = ? 
        AND status IN ('pending', 'verifying', 'verified', 'invited', 'rescheduled')
        ORDER BY applied_at DESC 
        LIMIT 1
      `, [userId]);

      if (!rows || rows.length === 0) {
        return await interaction.editReply({
          content: `${QUEUE} You don\'t have any active applications to cancel.`
        });
      }

      const app = rows[0];

      // Cannot cancel during active test
      if (app.status === 'testing') {
        return await interaction.editReply({
          content: `${ERROR} You cannot cancel your application while you are currently being tested.\n\nPlease contact a tester or admin if you need to stop.`
        });
      }

      const previousTester = app.tester_id;
      const wasInvited = app.status === 'invited';

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

      // Update queue positions for remaining applications
      await db.query(`
        UPDATE applications 
        SET position = position - 1 
        WHERE status IN ('pending', 'verified') 
        AND position > ?
      `, [app.position]);

      // Log to audit
      await auditLogger.log('APPLICATION_CANCELLED', userId, 'player', app.id, {
        minecraft_username: app.minecraft_username,
        previous_status: app.status
      });

      // If they were invited, notify the tester
      if (wasInvited && previousTester) {
        try {
          const tester = await interaction.client.users.fetch(previousTester);
          await tester.send({
            embeds: [{
              title: `${ERROR} Player Cancelled Application`,
              description: `**${app.minecraft_username}** has cancelled their application.`,
              fields: [
                {
                  name: `${INFO} Status`,
                  value: 'The player cancelled while invited. No action needed.\nUse `/available` to get the next player.'
                }
              ],
              color: COLOR,
              timestamp: new Date()
            }]
          });
        } catch (dmError) {
          console.log('Could not DM tester about cancellation:', dmError.message);
        }
      }

      // Count recent cancellations for warning
      const cancelRows = await db.query(`
        SELECT COUNT(*) as count FROM applications 
        WHERE discord_id = ? 
        AND status = 'cancelled' 
        AND applied_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      `, [userId]);

      const recentCancellations = cancelRows && cancelRows[0].count;

      // Build response
      let response = `${SUCCESS} Your application for **${app.minecraft_username}** has been cancelled successfully.`;

      if (recentCancellations >= 2) {
        response += `\n\n${WARN} **Warning:** You have cancelled 3 or more applications in the past week.\nFrequent cancellations may result in temporary restrictions.`;
      }

      response += '\n\nYou can submit a new application using `/apply`.';

      await interaction.editReply({
        content: response
      });

    } catch (error) {
      console.error('Cancel-application command error:', error);
      await interaction.editReply({
        content: `${ERROR} An error occurred while cancelling your application. Please try again later.`
      });
    }
  }
};