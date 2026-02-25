const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const auditLogger = require('../utils/auditLogger');
const { ERROR, INFO, WARN, COLOR } = require('../config/emojis');
const { sanitize } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Add a note about a player (Testers only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(option =>
      option
        .setName('minecraft_username')
        .setDescription('Minecraft username to add note about')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('note')
        .setDescription('Note content (max 500 characters)')
        .setRequired(true)
        .setMaxLength(500)
    )
    .addStringOption(option =>
      option
        .setName('severity')
        .setDescription('Severity level')
        .setRequired(false)
        .addChoices(
          { name: 'Info', value: 'info' },
          { name: 'Warning', value: 'warning' },
          { name: 'Critical', value: 'critical' }
        )
    ),

  async execute(interaction) {
    const testerId = interaction.user.id;
    const mcUsername = sanitize(interaction.options.getString('minecraft_username'));
    const note = sanitize(interaction.options.getString('note'));
    const severity = interaction.options.getString('severity') || 'info';

    try {
      // Check if user is a tester
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

      // Create note
      const noteId = require('crypto').randomUUID();
      await db.query(`
        INSERT INTO tester_notes 
        (id, minecraft_username, tester_id, note, severity, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `, [noteId, mcUsername, testerId, note, severity]);

      // Log to audit
      await auditLogger.log('NOTE_ADDED', testerId, 'tester', mcUsername, {
        note: note.substring(0, 100),
        severity
      });

      const severityEmojis = {
        'info': INFO,
        'warning': WARN,
        'critical': ERROR
      };

      await interaction.reply({
        embeds: [{
          title: `${severityEmojis[severity]} Note Added`,
          description: `**Player:** ${mcUsername}`,
          fields: [
            {
              name: `${INFO} Note`,
              value: note
            },
            {
              name: `${WARN} Severity`,
              value: severity.charAt(0).toUpperCase() + severity.slice(1),
              inline: true
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Note command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while adding the note. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};