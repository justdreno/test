const { WARN, STATS, TIME, QUEUE, INFO, GAME, USER, SUCCESS, COLOR } = require('../config/emojis');
const helpers = require('../utils/helpers');

class NotificationManager {
  constructor() {
    this.notificationChannelId = process.env.NOTIFICATION_CHANNEL_ID;
    this.adminChannelId = process.env.ADMIN_CHANNEL_ID;
  }

  /**
   * Send notification to a specific channel
   * @param {Client} client
   * @param {string} channelId
   * @param {Object} messageData
   */
  async sendToChannel(client, channelId, messageData) {
    try {
      if (!channelId) return;

      const channel = client.channels.cache.get(channelId);
      if (!channel) {
        console.warn(`[Notify] Channel ${channelId} not found`);
        return;
      }

      await channel.send(messageData);
    } catch (error) {
      console.error('[Notify] Error sending to channel:', error.message);
    }
  }

  /**
   * Send DM to a user
   * @param {Client} client
   * @param {string} userId
   * @param {Object} messageData
   */
  async sendDM(client, userId, messageData) {
    try {
      const user = await client.users.fetch(userId);
      await user.send(messageData);
      return true;
    } catch (error) {
      console.error(`[Notify] Could not DM user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Notify admins of queue backup
   * @param {Client} client
   * @param {number} queueSize
   * @param {number} avgWaitHours
   */
  async notifyQueueBackup(client, queueSize, avgWaitHours) {
    if (!this.adminChannelId) return;

    const embed = {
      title: `${WARN} Queue Backup Alert`,
      description: `The testing queue is backed up!`,
      fields: [
        { name: `${STATS} Queue Size`, value: `${queueSize} players waiting`, inline: true },
        { name: `${TIME} Average Wait`, value: `${avgWaitHours} hours`, inline: true }
      ],
      color: COLOR,
      timestamp: new Date()
    };

    await this.sendToChannel(client, this.adminChannelId, { embeds: [embed] });
  }

  /**
   * Notify player of queue position update
   * @param {Client} client
   * @param {string} userId
   * @param {number} oldPosition
   * @param {number} newPosition
   */
  async notifyQueuePosition(client, userId, oldPosition, newPosition) {
    if (oldPosition === newPosition) return;

    const embed = {
      title: `${QUEUE} Queue Update`,
      description: `Your position in the queue has changed.`,
      fields: [
        { name: 'Previous Position', value: `#${oldPosition}`, inline: true },
        { name: 'New Position', value: `#${newPosition}`, inline: true }
      ],
      color: COLOR,
      timestamp: new Date()
    };

    await this.sendDM(client, userId, { embeds: [embed] });
  }

  /**
   * Notify player they've been waiting too long
   * @param {Client} client
   * @param {string} userId
   * @param {number} waitHours
   */
  async notifyLongWait(client, userId, waitHours) {
    const embed = {
      title: `${TIME} Update on Your Application`,
      description: `You've been in the queue for ${waitHours} hours.`,
      fields: [
        { name: `${QUEUE} Status`, value: 'You are still in the queue and will be tested as soon as a tester is available.' },
        { name: `${INFO} Tip`, value: 'Make sure you\'re available when a tester invites you. You\'ll have 5 minutes to accept.' }
      ],
      color: COLOR,
      timestamp: new Date()
    };

    await this.sendDM(client, userId, { embeds: [embed] });
  }

  /**
   * Notify eligible testers that a player is waiting.
   * Only notifies testers whose permissions include the player's gamemode,
   * who haven't hit their daily limit, and who don't already have an active test.
   *
   * @param {Client} client
   * @param {string} gamemode - The gamemode the player wants to be tested in
   * @param {string} minecraftUsername - Player's IGN (for embed context)
   */
  async notifyTestersAvailable(client, gamemode, minecraftUsername = null) {
    try {
      // Fetch all active testers
      const testers = await db.query(`
        SELECT discord_id, permissions, tests_today, daily_limit
        FROM testers
        WHERE is_active = TRUE
      `);

      if (!testers || testers.length === 0) return;

      const embed = {
        title: `${QUEUE} Player Ready for Testing`,
        description: minecraftUsername
          ? `**${minecraftUsername}** is in the queue and needs a **${helpers.formatGamemode(gamemode)}** tester!`
          : `A player in the queue needs a **${helpers.formatGamemode(gamemode)}** tester!`,
        fields: [
          { name: `${GAME} Gamemode`, value: helpers.formatGamemode(gamemode), inline: true },
          { name: `${USER} Action`, value: 'Use `/available` to get the next player.', inline: false }
        ],
        color: COLOR,
        timestamp: new Date()
      };

      for (const tester of testers) {
        // Skip if over daily limit
        if (tester.tests_today >= tester.daily_limit) continue;

        // Skip if permissions don't include this gamemode
        let perms = [];
        try {
          perms = JSON.parse(tester.permissions);
        } catch (_) {
          perms = [];
        }
        if (!perms.includes(gamemode)) continue;

        // Skip if already has an active test (status = 'testing')
        const activeRows = await db.query(`
          SELECT COUNT(*) as count FROM applications
          WHERE tester_id = ? AND status = 'testing'
        `, [tester.discord_id]);
        if (activeRows[0]?.count > 0) continue;

        await this.sendDM(client, tester.discord_id, { embeds: [embed] });
      }
    } catch (error) {
      console.error('[Notify] Error notifying testers:', error.message);
    }
  }

  /**
   * Send daily queue summary to admin channel
   * @param {Client} client
   */
  async sendDailySummary(client) {
    if (!this.adminChannelId) return;

    try {
      const queueStats = await db.query(`
        SELECT status, COUNT(*) as count
        FROM applications
        WHERE status IN ('pending', 'verified', 'invited', 'testing')
        GROUP BY status
      `);

      const totalPending = queueStats.reduce((acc, row) => acc + row.count, 0);
      const avgWait = await db.query(`
        SELECT AVG(TIMESTAMPDIFF(HOUR, applied_at, NOW())) as avg_hours
        FROM applications
        WHERE status IN ('pending', 'verified')
      `);

      const testerStats = await db.query(`
        SELECT COUNT(*) as total_testers, SUM(tests_today) as tests_today
        FROM testers WHERE is_active = TRUE
      `);

      const embed = {
        title: `${STATS} Daily Queue Summary`,
        description: `Summary for ${new Date().toLocaleDateString()}`,
        fields: [
          { name: `${TIME} Pending Verification`, value: `${queueStats.find(s => s.status === 'pending')?.count || 0}`, inline: true },
          { name: `${SUCCESS} Verified (In Queue)`, value: `${queueStats.find(s => s.status === 'verified')?.count || 0}`, inline: true },
          { name: `${QUEUE} Invited`, value: `${queueStats.find(s => s.status === 'invited')?.count || 0}`, inline: true },
          { name: `${GAME} Testing`, value: `${queueStats.find(s => s.status === 'testing')?.count || 0}`, inline: true },
          { name: `${STATS} Total Waiting`, value: `${totalPending}`, inline: true },
          { name: `${TIME} Avg Wait Time`, value: `${Math.round(avgWait[0]?.avg_hours || 0)} hours`, inline: true },
          { name: `${USER} Active Testers`, value: `${testerStats[0]?.total_testers || 0}`, inline: true },
          { name: `${STATS} Tests Today`, value: `${testerStats[0]?.tests_today || 0}`, inline: true }
        ],
        color: COLOR,
        timestamp: new Date()
      };

      await this.sendToChannel(client, this.adminChannelId, { embeds: [embed] });
    } catch (error) {
      console.error('[Notify] Error sending daily summary:', error.message);
    }
  }

  /**
   * Notify player of reschedule reactivation
   * @param {Client} client
   * @param {string} userId
   * @param {string} gamemode
   */
  async notifyRescheduleReactivated(client, userId, gamemode) {
    const embed = {
      title: `${QUEUE} Your Application is Active!`,
      description: `Your rescheduled test for **${helpers.formatGamemode(gamemode)}** is now active.`,
      fields: [
        { name: `${QUEUE} Status`, value: 'You are back in the queue and will be invited by a tester soon.' },
        { name: `${INFO} Reminder`, value: 'Make sure you\'re ready when a tester invites you!' }
      ],
      color: COLOR,
      timestamp: new Date()
    };

    await this.sendDM(client, userId, { embeds: [embed] });
  }
}

module.exports = new NotificationManager();