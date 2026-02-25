const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const auditLogger = require('../utils/auditLogger');
const { WARN, SUCCESS, INFO, ERROR, COLOR } = require('../config/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('maintenance')
    .setDescription('Toggle maintenance mode (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption(option =>
      option
        .setName('enabled')
        .setDescription('Enable or disable maintenance mode')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for maintenance (optional)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const adminId = interaction.user.id;
    const enabled = interaction.options.getBoolean('enabled');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    try {
      // Update config
      await db.query(`
        UPDATE config 
        SET value = ?, updated_at = NOW(), updated_by = ?
        WHERE \`key\` = 'maintenance_mode'
      `, [enabled.toString(), adminId]);

      // Log to audit
      await auditLogger.log('MAINTENANCE_TOGGLE', adminId, 'admin', null, {
        enabled,
        reason
      });

      const statusEmoji = enabled ? WARN : SUCCESS;
      const statusText = enabled ? 'ENABLED' : 'DISABLED';
      const color = COLOR;

      await interaction.reply({
        embeds: [{
          title: `${statusEmoji} Maintenance Mode ${statusText}`,
          description: enabled
            ? 'The bot is now in maintenance mode.\n\n- `/apply` is disabled\n- Active tests can continue\n- Admin commands still work'
            : 'Maintenance mode has been disabled.\n\nAll features are now available!',
          fields: enabled ? [
            {
              name: `${INFO} Reason`,
              value: reason
            }
          ] : [],
          color: color,
          timestamp: new Date()
        }],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Maintenance command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while toggling maintenance mode. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};