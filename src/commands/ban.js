const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const { WARN, TIME, INFO, QUEUE, ERROR, SUCCESS, COLOR } = require('../config/emojis');
const auditLogger = require('../utils/auditLogger');
const { sanitize, parseDuration } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a player from the system (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName('username')
        .setDescription('Minecraft username or Discord user ID to ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription('Ban duration')
        .setRequired(true)
        .addChoices(
          { name: '1 Day', value: '1 day' },
          { name: '3 Days', value: '3 days' },
          { name: '1 Week', value: '1 week' },
          { name: '2 Weeks', value: '2 weeks' },
          { name: '1 Month', value: '1 month' },
          { name: 'Permanent', value: 'permanent' }
        )
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for ban')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('appealable')
        .setDescription('Can the player appeal this ban?')
        .setRequired(false)
    ),

  async execute(interaction) {
    const adminId = interaction.user.id;
    const target = sanitize(interaction.options.getString('username'));
    const duration = interaction.options.getString('duration');
    const reason = sanitize(interaction.options.getString('reason'));
    const appealable = interaction.options.getBoolean('appealable') ?? true;

    try {
      // Determine if target is Discord ID or Minecraft username
      const isDiscordId = /^\d{17,19}$/.test(target);

      // Check if already banned
      const existingBan = await db.query(`
        SELECT * FROM bans 
        WHERE ${isDiscordId ? 'discord_id = ?' : 'minecraft_username = ?'}
        AND is_active = TRUE
        AND (expires_at IS NULL OR expires_at > NOW())
      `, [target]);

      if (existingBan && existingBan.length > 0) {
        return await interaction.reply({
          content: `${WARN} This user is already banned.\n\n**Reason:** ${existingBan[0].reason}\n**Expires:** ${existingBan[0].expires_at || 'Never'}`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      // Calculate expiration date
      let expiresAt = null;
      if (duration !== 'permanent') {
        const hours = parseDuration(duration);
        if (hours) {
          const date = new Date();
          date.setHours(date.getHours() + hours);
          expiresAt = date;
        }
      }

      // Cancel any active applications
      if (isDiscordId) {
        await db.query(`
          UPDATE applications 
          SET status = 'cancelled', completed_at = NOW()
          WHERE discord_id = ? 
          AND status IN ('pending', 'verifying', 'verified', 'invited', 'testing', 'rescheduled')
        `, [target]);
      } else {
        await db.query(`
          UPDATE applications 
          SET status = 'cancelled', completed_at = NOW()
          WHERE minecraft_username = ? 
          AND status IN ('pending', 'verifying', 'verified', 'invited', 'testing', 'rescheduled')
        `, [target]);
      }

      // Create ban record
      const banId = require('crypto').randomUUID();
      await db.query(`
        INSERT INTO bans 
        (id, ${isDiscordId ? 'discord_id' : 'minecraft_username'}, banned_by, reason, duration, appealable, banned_at, expires_at, is_active)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, TRUE)
      `, [
        banId,
        target,
        adminId,
        reason,
        duration,
        appealable,
        expiresAt
      ]);

      await auditLogger.log('USER_BANNED', adminId, 'admin', target, {
        duration,
        reason,
        appealable
      });

      // --- DISCORD BAN LOGGING ---
      const banLogsChannelId = process.env.BAN_LOGS_CHANNEL_ID;
      if (banLogsChannelId) {
        const banLogEmbed = {
          title: `${ERROR} User Banned`,
          description: `**Target:** ${target} (${isDiscordId ? 'Discord ID' : 'IGN'})`,
          fields: [
            { name: 'Admin', value: `<@${adminId}>`, inline: true },
            { name: 'Duration', value: duration, inline: true },
            { name: 'Appealable', value: appealable ? 'Yes' : 'No', inline: true },
            { name: 'Reason', value: reason }
          ],
          color: COLOR,
          timestamp: new Date()
        };
        await auditLogger.logToDiscord(interaction.client, banLogsChannelId, banLogEmbed);
      }

      // Build response
      const expiresText = expiresAt
        ? `Expires: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`
        : 'Permanent ban';

      await interaction.reply({
        embeds: [{
          title: `${ERROR} User Banned`,
          description: `**${isDiscordId ? 'Discord ID' : 'Minecraft Username'}:** ${target}`,
          fields: [
            {
              name: `${TIME} Duration`,
              value: duration,
              inline: true
            },
            {
              name: `${TIME} Expires`,
              value: expiresText,
              inline: true
            },
            {
              name: `${INFO} Reason`,
              value: reason
            },
            {
              name: `${QUEUE} Appealable`,
              value: appealable ? 'Yes' : 'No',
              inline: true
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Ban command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while banning the user. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};