const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { STATS, GAME, USER, SUCCESS, COLOR, STAR, KEY, TIME, INFO, QUEUE } = require('../config/emojis');
const helpers = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View your tester statistics'),

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      // Check if user is a tester
      const testerRows = await db.query(`
        SELECT * FROM testers 
        WHERE discord_id = ?
      `, [userId]);

      if (!testerRows || testerRows.length === 0) {
        return await interaction.reply({
          content: `${STATS} You are not registered as a tester.\n\nTester statistics are only available for approved testers.`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      const tester = testerRows[0];

      // Get tier changes this tester has made
      const tierChangeRows = await db.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN change_type = 'upgrade' THEN 1 ELSE 0 END) as upgrades,
          SUM(CASE WHEN change_type = 'downgrade' THEN 1 ELSE 0 END) as downgrades,
          SUM(CASE WHEN change_type = 'same' THEN 1 ELSE 0 END) as same,
          gamemode
        FROM tier_changes 
        WHERE tester_id = ?
        GROUP BY gamemode
      `, [userId]);

      // Calculate totals
      const totalTests = tierChangeRows?.reduce((acc, row) => acc + parseInt(row.total), 0) || 0;
      const totalUpgrades = tierChangeRows?.reduce((acc, row) => acc + parseInt(row.upgrades || 0), 0) || 0;
      const totalDowngrades = tierChangeRows?.reduce((acc, row) => acc + parseInt(row.downgrades || 0), 0) || 0;

      // Build embed
      const embed = {
        title: `${STATS} Your Tester Statistics`,
        description: `Tester: ${tester.discord_username}`,
        fields: [],
        color: COLOR,
        timestamp: new Date()
      };

      // Add overall stats
      embed.fields.push({
        name: `${QUEUE} Overall Statistics`,
        value: [
          `Total Tests: **${totalTests}**`,
          `Upgrades: **${totalUpgrades}**`,
          `Downgrades: **${totalDowngrades}**`,
          `No Change: **${totalTests - totalUpgrades - totalDowngrades}**`
        ].join('\n'),
        inline: true
      });

      // Add daily/weekly stats
      embed.fields.push({
        name: `${STATS} Recent Activity`,
        value: [
          `Today: **${tester.tests_today}/${tester.daily_limit}**`,
          `This Week: **${tester.tests_this_week}**`,
          `This Month: **${tester.tests_this_month}**`
        ].join('\n'),
        inline: true
      });

      // Add gamemode breakdown
      if (tierChangeRows && tierChangeRows.length > 0) {
        const gamemodeText = tierChangeRows
          .sort((a, b) => b.total - a.total)
          .slice(0, 5)
          .map(row => `${helpers.formatGamemode(row.gamemode)}: ${row.total}`)
          .join('\n');

        embed.fields.push({
          name: `${GAME} Gamemode Breakdown`,
          value: gamemodeText || 'No tests yet',
          inline: false
        });
      }

      // Add rating if available
      if (tester.rating) {
        embed.fields.push({
          name: `${STAR} Rating`,
          value: `${tester.rating.toFixed(1)}/5.0`,
          inline: true
        });
      }

      // Add last test date
      if (tester.last_test_at) {
        embed.fields.push({
          name: `${TIME} Last Test`,
          value: `<t:${Math.floor(new Date(tester.last_test_at).getTime() / 1000)}:R>`,
          inline: true
        });
      }

      // Add permissions
      let permissions;
      try {
        permissions = JSON.parse(tester.permissions);
      } catch (e) {
        permissions = [];
      }

      embed.fields.push({
        name: `${KEY} Permissions`,
        value: permissions.join(', ') || 'None',
        inline: false
      });

      await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('Stats command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while fetching your statistics. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};