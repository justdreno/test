const db = require('../database');

class RateLimiter {
  constructor() {
    this.limits = {
      'apply': { count: 1, window: 5 * 60 }, // 5 minutes
      'cancel-application': { count: 1, window: 60 * 60 }, // 1 hour
      'available': { count: 1, window: 10 }, // 10 seconds
      'reschedule': { count: 2, window: 24 * 60 * 60 } // 24 hours
    };
  }

  async checkLimit(userId, command) {
    const limit = this.limits[command];
    if (!limit) return { allowed: true };

    try {
      // Check recent usage
      const rows = await db.query(`
        SELECT count, last_used 
        FROM rate_limits 
        WHERE user_id = ? AND command = ?
      `, [userId, command]);

      if (!rows || rows.length === 0) {
        // First use, create record
        await db.query(`
          INSERT INTO rate_limits (id, user_id, command, count, last_used)
          VALUES (UUID(), ?, ?, 1, NOW())
        `, [userId, command]);
        return { allowed: true };
      }

      const record = rows[0];
      const secondsSinceLastUse = Math.floor((Date.now() - new Date(record.last_used)) / 1000);

      if (secondsSinceLastUse > limit.window) {
        // Window passed, reset
        await db.query(`
          UPDATE rate_limits 
          SET count = 1, last_used = NOW()
          WHERE user_id = ? AND command = ?
        `, [userId, command]);
        return { allowed: true };
      }

      if (record.count >= limit.count) {
        // Rate limit hit
        const retryAfter = limit.window - secondsSinceLastUse;
        return {
          allowed: false,
          retryAfter,
          message: `Please wait ${this.formatTime(retryAfter)} before using this command again.`
        };
      }

      // Increment count
      await db.query(`
        UPDATE rate_limits 
        SET count = count + 1, last_used = NOW()
        WHERE user_id = ? AND command = ?
      `, [userId, command]);

      return { allowed: true };
    } catch (error) {
      console.error('Rate limit check error:', error);
      return { allowed: true }; // Fail open
    }
  }

  formatTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }
}

module.exports = new RateLimiter();