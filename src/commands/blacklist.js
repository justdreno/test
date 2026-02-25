const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const { WARN, ERROR, TIME, QUEUE, INFO, COLOR } = require('../config/emojis');
const auditLogger = require('../utils/auditLogger');
const { sanitize } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Permanently blacklist a player (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName('username')
        .setDescription('Minecraft username or Discord user ID to blacklist')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for blacklisting')
        .setRequired(true)
    ),

  async execute(interaction) {
    const adminId = interaction.user.id;
    const target = sanitize(interaction.options.getString('username'));
    const reason = sanitize(interaction.options.getString('reason'));

    try {
      // Determine if target is Discord ID or Minecraft username
      const isDiscordId = /^\d{17,19}$/.test(target);

      // Check if already blacklisted
      const existingBan = await db.query(`
        SELECT * FROM bans 
        WHERE ${isDiscordId ? 'discord_id = ?' : 'minecraft_username = ?'}
        AND is_active = TRUE
        AND expires_at IS NULL
      `, [target]);

      if (existingBan && existingBan.length > 0) {
        return await interaction.reply({
          content: `${WARN} This user is already blacklisted.`,
          flags: [MessageFlags.Ephemeral]
        });
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

      // Create blacklist record
      const banId = require('crypto').randomUUID();
      await db.query(`
        INSERT INTO bans 
        (id, ${isDiscordId ? 'discord_id' : 'minecraft_username'}, banned_by, reason, duration, appealable, banned_at, is_active)
        VALUES (?, ?, ?, ?, 'permanent', FALSE, NOW(), TRUE)
      `, [
        banId,
        target,
        adminId,
        reason
      ]);

      // Log to audit
      await auditLogger.log('USER_BLACKLISTED', adminId, 'admin', target, {
        reason
      });

      await interaction.reply({
        embeds: [{
          title: `${ERROR} User Blacklisted`,
          description: `**${isDiscordId ? 'Discord ID' : 'Minecraft Username'}:** ${target}`,
          fields: [
            {
              name: `${TIME} Duration`,
              value: 'Permanent (Blacklist)',
              inline: true
            },
            {
              name: `${QUEUE} Appealable`,
              value: 'No',
              inline: true
            },
            {
              name: `${INFO} Reason`,
              value: reason
            },
            {
              name: `${WARN} Note`,
              value: 'This user has been permanently blacklisted and cannot appeal this decision.'
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Blacklist command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while blacklisting the user. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};