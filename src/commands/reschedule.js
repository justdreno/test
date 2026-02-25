const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { TIME, QUEUE, ERROR, INFO, COLOR } = require('../config/emojis');
const rateLimiter = require('../utils/rateLimiter');
const auditLogger = require('../utils/auditLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reschedule')
    .setDescription('Reschedule your application for later')
    .addStringOption(option =>
      option
        .setName('when')
        .setDescription('When would you like to reschedule?')
        .setRequired(true)
        .addChoices(
          { name: '30 minutes', value: '30' },
          { name: '1 hour', value: '60' },
          { name: '2 hours', value: '120' },
          { name: 'Tomorrow', value: '1440' },
          { name: 'This weekend', value: 'weekend' }
        )
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for rescheduling (optional)')
        .setRequired(false)
        .setMaxLength(200)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const when = interaction.options.getString('when');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Defer immediately to prevent timeout
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      // Check rate limit
      const rateCheck = await rateLimiter.checkLimit(userId, 'reschedule');
      if (!rateCheck.allowed) {
        return await interaction.editReply({
          content: `${TIME} ${rateCheck.message}`
        });
      }

      // Find active application — all non-terminal, non-testing statuses
      const rows = await db.query(`
        SELECT * FROM applications 
        WHERE discord_id = ? 
        AND status IN ('pending', 'verifying', 'verified', 'invited', 'rescheduled')
        ORDER BY applied_at DESC 
        LIMIT 1
      `, [userId]);

      if (!rows || rows.length === 0) {
        return await interaction.editReply({
          content: `${QUEUE} You don\'t have an active application to reschedule.\n\nUse \`/my-application\` to check your status.`
        });
      }

      const app = rows[0];

      // Cannot reschedule if currently being tested
      if (app.status === 'testing') {
        return await interaction.editReply({
          content: `${ERROR} You cannot reschedule while you are currently being tested.`
        });
      }

      // Check reschedule limit
      if (app.reschedule_count >= 2) {
        return await interaction.editReply({
          content: `${ERROR} You have already used your maximum of 2 reschedules.\n\nYou must complete this application or cancel it.`
        });
      }

      // Calculate reschedule time
      let rescheduleTime;
      if (when === 'weekend') {
        // Set to Saturday 10 AM
        const now = new Date();
        const daysUntilSaturday = (6 - now.getDay() + 7) % 7 || 7;
        rescheduleTime = new Date(now);
        rescheduleTime.setDate(now.getDate() + daysUntilSaturday);
        rescheduleTime.setHours(10, 0, 0, 0);
      } else {
        const minutes = parseInt(when);
        rescheduleTime = new Date(Date.now() + minutes * 60000);
      }

      // Update application
      await db.query(`
        UPDATE applications 
        SET status = 'rescheduled',
            reschedule_count = reschedule_count + 1,
            reschedule_time = ?,
            tester_id = NULL,
            invited_at = NULL,
            responded_at = NULL
        WHERE id = ?
      `, [rescheduleTime, app.id]);

      // Log to audit
      await auditLogger.log('APPLICATION_RESCHEDULED', userId, 'player', app.id, {
        reschedule_count: app.reschedule_count + 1,
        reschedule_time: rescheduleTime,
        reason
      });

      // Format time
      const timeString = when === 'weekend'
        ? 'This Saturday at 10:00 AM'
        : `<t:${Math.floor(rescheduleTime.getTime() / 1000)}:R>`;

      await interaction.editReply({
        embeds: [{
          title: `${TIME} Application Rescheduled`,
          description: `Your application for **${app.minecraft_username}** has been rescheduled.`,
          fields: [
            {
              name: `${TIME} Rescheduled For`,
              value: timeString,
              inline: true
            },
            {
              name: `${TIME} Reschedules Used`,
              value: `${app.reschedule_count + 1}/2`,
              inline: true
            },
            {
              name: `${INFO} Reason`,
              value: reason
            },
            {
              name: `${QUEUE} Status`,
              value: 'Your application will automatically reactivate at the scheduled time.'
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }]
      });

    } catch (error) {
      console.error('Reschedule command error:', error);
      await interaction.editReply({
        content: `${ERROR} An error occurred while rescheduling. Please try again later.`
      });
    }
  }
};