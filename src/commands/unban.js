const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const auditLogger = require('../utils/auditLogger');
const { WARN, SUCCESS, INFO, TIME, ERROR, COLOR } = require('../config/emojis');
const { sanitize } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a player (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName('username')
        .setDescription('Minecraft username or Discord user ID to unban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for unban')
        .setRequired(false)
    ),

  async execute(interaction) {
    const adminId = interaction.user.id;
    const target = sanitize(interaction.options.getString('username'));
    const reason = sanitize(interaction.options.getString('reason')) || 'No reason provided';

    try {
      // Determine if target is Discord ID or Minecraft username
      const isDiscordId = /^\d{17,19}$/.test(target);

      // Check if user is banned
      const banRows = await db.query(`
        SELECT * FROM bans 
        WHERE ${isDiscordId ? 'discord_id = ?' : 'minecraft_username = ?'}
        AND is_active = TRUE
      `, [target]);

      if (!banRows || banRows.length === 0) {
        return await interaction.reply({
          content: `${WARN} This user is not currently banned.`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      const ban = banRows[0];

      // Update ban record
      await db.query(`
        UPDATE bans 
        SET is_active = FALSE, 
            unbanned_at = NOW(), 
            unbanned_by = ?
        WHERE id = ?
      `, [adminId, ban.id]);

      await auditLogger.log('USER_UNBANNED', adminId, 'admin', target, {
        previous_ban_reason: ban.reason,
        unban_reason: reason
      });

      // --- DISCORD UNBAN LOGGING ---
      const banLogsChannelId = process.env.BAN_LOGS_CHANNEL_ID;
      if (banLogsChannelId) {
        const unbanLogEmbed = {
          title: `${SUCCESS} User Unbanned`,
          description: `**Target:** ${target} (${isDiscordId ? 'Discord ID' : 'IGN'})`,
          fields: [
            { name: 'Admin', value: `<@${adminId}>`, inline: true },
            { name: 'Unban Reason', value: reason },
            { name: 'Original Ban Reason', value: ban.reason }
          ],
          color: COLOR,
          timestamp: new Date()
        };
        await auditLogger.logToDiscord(interaction.client, banLogsChannelId, unbanLogEmbed);
      }

      await interaction.reply({
        embeds: [{
          title: `${SUCCESS} User Unbanned`,
          description: `**${isDiscordId ? 'Discord ID' : 'Minecraft Username'}:** ${target}`,
          fields: [
            {
              name: `${INFO} Original Ban Reason`,
              value: ban.reason
            },
            {
              name: `${INFO} Unban Reason`,
              value: reason
            },
            {
              name: `${TIME} Originally Banned`,
              value: `<t:${Math.floor(new Date(ban.banned_at).getTime() / 1000)}:R>`
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Unban command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while unbanning the user. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};