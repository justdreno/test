const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../database');
const { formatDuration } = require('../utils/helpers');
const { QUEUE, INFO, TIME, SUCCESS, GAME, STAR, ERROR, COLOR } = require('../config/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue-list')
    .setDescription('View the testing queue (Admin/Testers only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(option =>
      option
        .setName('filter')
        .setDescription('Filter queue by status')
        .setRequired(false)
        .addChoices(
          { name: 'All Active', value: 'all' },
          { name: 'Pending Verification', value: 'pending' },
          { name: 'Verified Only', value: 'verified' },
          { name: 'Invited', value: 'invited' },
          { name: 'Testing', value: 'testing' }
        )
    )
    .addStringOption(option =>
      option
        .setName('gamemode')
        .setDescription('Filter by gamemode')
        .setRequired(false)
        .addChoices(
          { name: 'Vanilla', value: 'vanilla' },
          { name: 'UHC', value: 'uhc' },
          { name: 'Pot', value: 'pot' },
          { name: 'Sword', value: 'sword' },
          { name: 'Bow', value: 'bow' },
          { name: 'Rod', value: 'rod' },
          { name: 'Squid', value: 'squid' },
          { name: 'Bedwars', value: 'bedwars' },
          { name: 'Skywars', value: 'skywars' }
        )
    ),

  async execute(interaction) {
    try {
      const filter = interaction.options.getString('filter') || 'all';
      const gamemode = interaction.options.getString('gamemode');

      // Build query
      let query = `
        SELECT * FROM applications 
        WHERE 1=1
      `;
      const params = [];

      if (filter === 'all') {
        query += ` AND status IN ('pending', 'verifying', 'verified', 'invited', 'testing', 'rescheduled')`;
      } else if (filter !== 'all') {
        query += ` AND status = ?`;
        params.push(filter);
      }

      if (gamemode) {
        query += ` AND (primary_gamemode = ? OR secondary_gamemode = ?)`;
        params.push(gamemode, gamemode);
      }

      query += ` ORDER BY 
        CASE priority 
          WHEN 'supporter' THEN 4
          WHEN 'premium' THEN 3
          WHEN 'vip' THEN 2
          ELSE 1
        END DESC,
        applied_at ASC
        LIMIT 25`;

      const rows = await db.query(query, params);

      if (!rows || rows.length === 0) {
        return await interaction.reply({
          content: `${QUEUE} The queue is currently empty.`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      // Build embed
      const embed = {
        title: `${INFO} Testing Queue`,
        description: `Showing ${rows.length} applications${filter !== 'all' ? ` (${filter})` : ''}${gamemode ? ` - Gamemode: ${gamemode}` : ''}`,
        fields: [],
        color: COLOR,
        timestamp: new Date()
      };

      // Group by status
      const byStatus = rows.reduce((acc, app) => {
        if (!acc[app.status]) acc[app.status] = [];
        acc[app.status].push(app);
        return acc;
      }, {});

      // Add fields for each status
      for (const [status, apps] of Object.entries(byStatus)) {
        const statusEmojis = {
          'pending': TIME,
          'verifying': INFO,
          'verified': SUCCESS,
          'invited': QUEUE,
          'testing': GAME,
          'rescheduled': TIME
        };

        const value = apps.slice(0, 10).map((app, idx) => {
          const priorityEmoji = {
            'standard': '',
            'vip': STAR,
            'premium': '',
            'supporter': ''
          }[app.priority] || '';

          return `${idx + 1}. ${priorityEmoji} **${app.minecraft_username}** - ${app.primary_gamemode} (${formatDuration(app.applied_at)})`;
        }).join('\n');

        if (apps.length > 10) {
          value + `\n... and ${apps.length - 10} more`;
        }

        embed.fields.push({
          name: `${statusEmojis[status] || '❓'} ${status.charAt(0).toUpperCase() + status.slice(1)} (${apps.length})`,
          value: value || 'None',
          inline: false
        });
      }

      // Add summary
      const totalCount = rows.length;
      const pendingCount = byStatus['pending']?.length || 0;
      const verifiedCount = byStatus['verified']?.length || 0;

      embed.footer = {
        text: `Total: ${totalCount} | Pending: ${pendingCount} | Verified: ${verifiedCount}`
      };

      await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Queue-list command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while fetching the queue. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};