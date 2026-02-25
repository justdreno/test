const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../database');
const { TIME, ERROR, WARN, QUEUE, GAME, REGION, STATS, STAR, TIMER, SUCCESS, COLOR, INFO } = require('../config/emojis');
const rateLimiter = require('../utils/rateLimiter');
const auditLogger = require('../utils/auditLogger');
const helpers = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('available')
    .setDescription('Get next player from queue (Testers only)'),

  async execute(interaction) {
    const userId = interaction.user.id;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      // ── Rate limit ───────────────────────────────────────────────────────
      const rateCheck = await rateLimiter.checkLimit(userId, 'available');
      if (!rateCheck.allowed) {
        return await interaction.editReply({ content: `${TIME} ${rateCheck.message}` });
      }

      // ── Verify tester ────────────────────────────────────────────────────
      const testerRows = await db.query(`
        SELECT * FROM testers WHERE discord_id = ? AND is_active = TRUE
      `, [userId]);

      if (!testerRows || testerRows.length === 0) {
        return await interaction.editReply({
          content: `${ERROR} You do not have tester permissions.\n\nContact an administrator if you believe this is wrong.`
        });
      }

      const tester = testerRows[0];

      // ── Daily limit ───────────────────────────────────────────────────────
      if (tester.tests_today >= tester.daily_limit) {
        return await interaction.editReply({
          content: `${ERROR} Daily limit reached (${tester.daily_limit} tests).\n\nYour limit resets tomorrow.`
        });
      }

      // ── Parse gamemode permissions ────────────────────────────────────────
      let permissions = [];
      try {
        permissions = JSON.parse(tester.permissions);
      } catch (_) {
        permissions = [];
      }

      if (permissions.length === 0) {
        return await interaction.editReply({
          content: `${WARN} You have no gamemode permissions assigned. Contact an administrator.`
        });
      }

      // ── Fetch verified queue ──────────────────────────────────────────────
      const queueRows = await db.query(`
        SELECT * FROM applications
        WHERE status = 'verified'
          AND (reschedule_time IS NULL OR reschedule_time <= NOW())
        ORDER BY
          CASE priority
            WHEN 'supporter' THEN 4
            WHEN 'premium'   THEN 3
            WHEN 'vip'       THEN 2
            ELSE 1
          END DESC,
          applied_at ASC
      `);

      if (!queueRows || queueRows.length === 0) {
        return await interaction.editReply({
          content: `${QUEUE} The queue is currently empty.\n\nNo verified players are waiting.`
        });
      }

      // ── Filter by gamemode AND skip list ──────────────────────────────────
      const eligiblePlayers = queueRows.filter(app => {
        // Must match at least one of this tester's gamemodes
        const gamemodeMatch =
          permissions.includes(app.primary_gamemode) ||
          (app.secondary_gamemode && permissions.includes(app.secondary_gamemode));
        if (!gamemodeMatch) return false;

        // Exclude players this tester has already skipped
        let skipped = [];
        try { skipped = JSON.parse(app.skipped_by || '[]'); } catch (_) { skipped = []; }
        return !skipped.includes(userId);
      });

      if (eligiblePlayers.length === 0) {
        // Are there players but all skipped by this tester?
        const allMatchingGamemode = queueRows.filter(app =>
          permissions.includes(app.primary_gamemode) ||
          (app.secondary_gamemode && permissions.includes(app.secondary_gamemode))
        );

        if (allMatchingGamemode.length > 0) {
          return await interaction.editReply({
            content: `${TIME} You've skipped all available players in your gamemodes.\n\nWait for new players or contact an admin to reset your skip list.\n\n**Your permissions:** ${permissions.join(', ')}`
          });
        }

        const availableGamemodes = [...new Set(queueRows.flatMap(app =>
          [app.primary_gamemode, app.secondary_gamemode].filter(Boolean)
        ))];

        return await interaction.editReply({
          content: `${QUEUE} No players in the queue matching your gamemodes.\n\n**Your permissions:** ${permissions.join(', ')}\n**Queue needs:** ${availableGamemodes.join(', ')}`
        });
      }

      // ── Pick best player ──────────────────────────────────────────────────
      const player = eligiblePlayers[0];

      // ── Player history ────────────────────────────────────────────────────
      const historyRows = await db.query(`
        SELECT
          COUNT(*) as total_tests,
          SUM(CASE WHEN change_type = 'upgrade'   THEN 1 ELSE 0 END) as upgrades,
          SUM(CASE WHEN change_type = 'downgrade' THEN 1 ELSE 0 END) as downgrades,
          SUM(CASE WHEN change_type = 'same'      THEN 1 ELSE 0 END) as sames
        FROM tier_changes
        WHERE minecraft_username = ?
      `, [player.minecraft_username]);

      const history = historyRows?.[0];
      const hasHistory = history?.total_tests > 0;

      // ── Queue position ────────────────────────────────────────────────────
      const posRows = await db.query(`
        SELECT COUNT(*) as ahead
        FROM applications
        WHERE status = 'verified'
          AND applied_at < ?
          AND (primary_gamemode IN (${permissions.map(() => '?').join(',')})
               OR secondary_gamemode IN (${permissions.map(() => '?').join(',')}))
      `, [player.applied_at, ...permissions, ...permissions]);
      const queuePos = (posRows?.[0]?.ahead ?? 0) + 1;

      // ── Build embed ───────────────────────────────────────────────────────
      const pGM = helpers.formatGamemode(player.primary_gamemode);
      const sGM = player.secondary_gamemode ? helpers.formatGamemode(player.secondary_gamemode) : null;
      const gamemodeDisplay = sGM ? `${pGM} *(or ${sGM})*` : pGM;

      const historyText = hasHistory
        ? `${history.total_tests} tests | ${QUEUE}${history.upgrades} ${QUEUE}${history.downgrades} ${QUEUE}${history.sames}`
        : 'No previous tests';

      const trend = !hasHistory ? '' :
        history.upgrades > history.downgrades ? ` ${STATS}` :
          history.downgrades > history.upgrades ? ` ${STATS}` : ` ${INFO}`;

      const embed = {
        title: `${QUEUE} Player Ready — Queue #${queuePos}`,
        color: COLOR,
        fields: [
          { name: `${GAME} IGN`, value: player.minecraft_username, inline: true },
          { name: `${QUEUE} Gamemode`, value: gamemodeDisplay, inline: true },
          { name: `${REGION} Region`, value: player.region || 'Unknown', inline: true },
          { name: `${STATS} History${trend}`, value: historyText, inline: true },
          {
            name: `${STAR} Priority`,
            value: player.priority.charAt(0).toUpperCase() + player.priority.slice(1),
            inline: true
          },
          { name: `${TIMER} Wait`, value: helpers.formatDuration(player.applied_at), inline: true }
        ],
        footer: {
          text: `Your tests today: ${tester.tests_today}/${tester.daily_limit} | ${eligiblePlayers.length - 1} more eligible player(s) in queue`
        },
        timestamp: new Date()
      };

      // ── Action buttons ────────────────────────────────────────────────────
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`invite_${player.id}_${userId}`)
          .setLabel('Invite Player')
          .setStyle(ButtonStyle.Success)
          .setEmoji(SUCCESS),
        new ButtonBuilder()
          .setCustomId(`skip_${player.id}_${userId}`)
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji(ERROR),
        new ButtonBuilder()
          .setCustomId(`history_${player.minecraft_username}`)
          .setLabel('View History')
          .setStyle(ButtonStyle.Primary)
          .setEmoji(INFO)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });

      await auditLogger.log('AVAILABLE_USED', userId, 'tester', player.id, {
        minecraft_username: player.minecraft_username,
        gamemode: player.primary_gamemode
      });

    } catch (error) {
      console.error('[Available] Error:', error);
      await interaction.editReply({
        content: `${ERROR} An error occurred while fetching the next player. Please try again.`
      });
    }
  }
};