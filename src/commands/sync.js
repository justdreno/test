const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('../database');
const { ERROR, GAME, QUEUE, STATS, SUCCESS, COLOR } = require('../config/emojis');
const api = require('../utils/api');
const auditLogger = require('../utils/auditLogger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Manually sync tier to website (Testers only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(option =>
      option
        .setName('minecraft_username')
        .setDescription('Minecraft username to sync')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('gamemode')
        .setDescription('Gamemode to sync')
        .setRequired(true)
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
    )
    .addStringOption(option =>
      option
        .setName('tier')
        .setDescription('Tier to assign (if not in database)')
        .setRequired(false)
        .addChoices(
          { name: 'HT5', value: 'HT5' },
          { name: 'HT4', value: 'HT4' },
          { name: 'HT3', value: 'HT3' },
          { name: 'HT2', value: 'HT2' },
          { name: 'HT1', value: 'HT1' },
          { name: 'LT5', value: 'LT5' },
          { name: 'LT4', value: 'LT4' },
          { name: 'LT3', value: 'LT3' },
          { name: 'LT2', value: 'LT2' },
          { name: 'LT1', value: 'LT1' }
        )
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const mcUsername = interaction.options.getString('minecraft_username');
    const gamemode = interaction.options.getString('gamemode');
    const manualTier = interaction.options.getString('tier');

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      // Verify tester exists
      const testerRows = await db.query(`
        SELECT * FROM testers 
        WHERE discord_id = ? AND is_active = TRUE
      `, [userId]);

      if (!testerRows || testerRows.length === 0) {
        return await interaction.editReply({
          content: `${ERROR} You do not have tester permissions.`
        });
      }

      // Get tier from database if not manually specified
      let tier = manualTier;
      if (!tier) {
        const tierRows = await db.query(`
          SELECT new_tier FROM tier_changes 
          WHERE minecraft_username = ? 
          AND gamemode = ?
          ORDER BY changed_at DESC
          LIMIT 1
        `, [mcUsername, gamemode]);

        if (!tierRows || tierRows.length === 0) {
          return await interaction.editReply({
            content: `${ERROR} No tier found for **${mcUsername}** in **${gamemode}**.\n\nPlease specify the tier manually or run a test first.`
          });
        }

        tier = tierRows[0].new_tier;
      }

      // Check API health first
      const apiHealthy = await api.healthCheck();
      if (!apiHealthy) {
        return await interaction.editReply({
          content: `${ERROR} Web API is currently unavailable.\n\nPlease try again later or contact an admin.`
        });
      }

      // Sync to web API
      const success = await api.updatePlayerTier(mcUsername, gamemode, tier, {
        synced_by: userId,
        synced_at: new Date().toISOString(),
        manual_sync: true
      });

      if (success) {
        await auditLogger.log('TIER_SYNCED', userId, 'tester', mcUsername, {
          minecraft_username: mcUsername,
          gamemode: gamemode,
          tier: tier
        });

        await interaction.editReply({
          embeds: [{
            title: `${SUCCESS} Tier Synced Successfully`,
            description: `Successfully synced **${mcUsername}** to the website.`,
            fields: [
              {
                name: `${GAME} Minecraft Username`,
                value: mcUsername,
                inline: true
              },
              {
                name: `${QUEUE} Gamemode`,
                value: gamemode,
                inline: true
              },
              {
                name: `${STATS} Tier`,
                value: tier,
                inline: true
              }
            ],
            color: COLOR,
            timestamp: new Date()
          }]
        });
      } else {
        await interaction.editReply({
          content: `${ERROR} Failed to sync tier to website.\n\nThe API returned an error. Please check the logs or contact an admin.`
        });
      }

    } catch (error) {
      console.error('Sync command error:', error);
      await interaction.editReply({
        content: `${ERROR} An error occurred while syncing. Please try again.`
      });
    }
  }
};