const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database');
const { QUEUE, STATS, SUCCESS, ERROR, TIME, GAME, INFO, COLOR } = require('../config/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View your testing history and tier changes'),

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      // Get all tier changes for this user
      const tierChanges = await db.query(`
        SELECT * FROM tier_changes 
        WHERE discord_id = ?
        ORDER BY changed_at DESC
        LIMIT 20
      `, [userId]);

      // Get all applications
      const applications = await db.query(`
        SELECT * FROM applications 
        WHERE discord_id = ?
        ORDER BY applied_at DESC
        LIMIT 20
      `, [userId]);

      if ((!tierChanges || tierChanges.length === 0) && (!applications || applications.length === 0)) {
        return await interaction.reply({
          content: `${QUEUE} You don\'t have any testing history yet.\n\nUse \`/apply\` to submit your first application!`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      const embed = {
        title: `${STATS} Your Testing History`,
        description: `Showing your last ${Math.min(tierChanges?.length || 0, 10)} tier changes and applications.`,
        fields: [],
        color: COLOR,
        timestamp: new Date()
      };

      // Add tier changes
      if (tierChanges && tierChanges.length > 0) {
        const recentChanges = tierChanges.slice(0, 5);
        const changesText = recentChanges.map(tc => {
          const changeEmoji = tc.change_type === 'upgrade' ? '↑' :
            tc.change_type === 'downgrade' ? '↓' : '→';
          const prevText = tc.previous_tier || 'None';
          return `${changeEmoji} **${tc.gamemode}**: ${prevText} → ${tc.new_tier} (<t:${Math.floor(new Date(tc.changed_at).getTime() / 1000)}:R>)`;
        }).join('\n');

        embed.fields.push({
          name: `${STATS} Recent Tier Changes`,
          value: changesText,
          inline: false
        });

        // Calculate stats
        const totalTests = tierChanges.length;
        const upgrades = tierChanges.filter(tc => tc.change_type === 'upgrade').length;
        const downgrades = tierChanges.filter(tc => tc.change_type === 'downgrade').length;
        const same = tierChanges.filter(tc => tc.change_type === 'same').length;

        embed.fields.push({
          name: `${STATS} Overall Stats`,
          value: [
            `Total Tests: **${totalTests}**`,
            `Upgrades: **${upgrades}**`,
            `Downgrades: **${downgrades}**`,
            `No Change: **${same}**`
          ].join('\n'),
          inline: true
        });
      }

      // Add recent applications
      if (applications && applications.length > 0) {
        const recentApps = applications.slice(0, 5);
        const appsText = recentApps.map(app => {
          const statusEmoji = {
            'completed': SUCCESS,
            'cancelled': ERROR,
            'expired': TIME,
            'testing': GAME,
            'invited': QUEUE,
            'verified': SUCCESS,
            'pending': TIME
          }[app.status] || '❓';

          return `${statusEmoji} **${app.minecraft_username}** (${app.primary_gamemode}) - ${app.status}`;
        }).join('\n');

        embed.fields.push({
          name: `${INFO} Recent Applications`,
          value: appsText,
          inline: false
        });
      }

      // Add current tier summary by gamemode
      if (tierChanges && tierChanges.length > 0) {
        const currentTiers = {};
        tierChanges.forEach(tc => {
          if (!currentTiers[tc.gamemode] || new Date(tc.changed_at) > new Date(currentTiers[tc.gamemode].date)) {
            currentTiers[tc.gamemode] = {
              tier: tc.new_tier,
              date: tc.changed_at
            };
          }
        });

        const tiersText = Object.entries(currentTiers)
          .map(([gamemode, data]) => `**${gamemode}**: ${data.tier}`)
          .join('\n');

        if (tiersText) {
          embed.fields.push({
            name: `${QUEUE} Current Tiers`,
            value: tiersText,
            inline: true
          });
        }
      }

      await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
      });

    } catch (error) {
      console.error('History command error:', error);
      await interaction.reply({
        content: `${ERROR} An error occurred while fetching your history. Please try again later.`,
        flags: [MessageFlags.Ephemeral]
      });
    }
  }
};