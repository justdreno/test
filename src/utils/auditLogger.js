const db = require('../database');

class AuditLogger {
  async log(action, userId, userType, targetId, details) {
    try {
      await db.query(`
        INSERT INTO audit_log (id, action, user_id, user_type, target_id, details, created_at)
        VALUES (UUID(), ?, ?, ?, ?, ?, NOW())
      `, [action, userId, userType, targetId, JSON.stringify(details)]);
    } catch (error) {
      console.error('Audit log error:', error);
    }
  }

  /**
   * Send a formatted embed to a Discord channel
   * @param {Client} client 
   * @param {string} channelId 
   * @param {Object} embed 
   */
  async logToDiscord(client, channelId, embed) {
    try {
      if (!channelId) return;
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('[AuditLog] Discord notification error:', error.message);
    }
  }

  async getRecentLogs(limit = 50) {
    try {
      return await db.query(`
        SELECT * FROM audit_log 
        ORDER BY created_at DESC 
        LIMIT ?
      `, [limit]);
    } catch (error) {
      console.error('Get logs error:', error);
      return [];
    }
  }
}

module.exports = new AuditLogger();