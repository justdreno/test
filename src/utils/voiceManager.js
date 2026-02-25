const { ChannelType, PermissionsBitField } = require('discord.js');

class VoiceChannelManager {
  /**
   * Create a private voice channel for testing
   * @param {Guild} guild - Discord guild
   * @param {string} testerId - Tester's Discord ID
   * @param {string} playerId - Player's Discord ID
   * @param {string} minecraftUsername - Player's MC username
   * @param {string} gamemode - Gamemode being tested
   * @returns {Promise<VoiceChannel|null>}
   */
  async createTestChannel(guild, testerId, playerId, minecraftUsername, gamemode) {
    try {
      // Use the voice category from env (separate from text ticket category)
      const categoryId = process.env.VOICE_CATEGORY_ID || process.env.TESTING_CATEGORY_ID;

      // Sanitize channel name (Discord: max 100 chars, lowercase, no spaces)
      const safeName = minecraftUsername.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
      const channelName = `vc-${safeName}-${gamemode}`;

      // Set up permissions — private, tester has full control
      const permissionOverwrites = [
        {
          id: guild.id, // @everyone denied
          deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]
        },
        {
          id: testerId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak,
            PermissionsBitField.Flags.MuteMembers,
            PermissionsBitField.Flags.DeafenMembers,
            PermissionsBitField.Flags.MoveMembers,
            PermissionsBitField.Flags.ManageChannels
          ]
        },
        {
          id: playerId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
          ]
        }
      ];

      // Allow admins if role configured
      if (process.env.ADMIN_ROLE_ID) {
        permissionOverwrites.push({
          id: process.env.ADMIN_ROLE_ID,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.Connect,
            PermissionsBitField.Flags.Speak
          ]
        });
      }

      // Build creation options — voice channels do NOT support 'topic'
      const createOptions = {
        name: channelName.substring(0, 100),
        type: ChannelType.GuildVoice,
        permissionOverwrites,
        userLimit: 2 // Tester + Player only
      };

      if (categoryId) {
        createOptions.parent = categoryId;
      }

      const channel = await guild.channels.create(createOptions);
      console.log(`[Voice] Created test channel: ${channel.name} (${channel.id})`);
      return channel;

    } catch (error) {
      console.error('[Voice] Error creating test channel:', error.message, error.code ?? '');
      return null;
    }
  }

  /**
   * Delete a test voice channel by ID (fetched from DB)
   * @param {Guild} guild
   * @param {string} channelId
   * @returns {Promise<boolean>}
   */
  async deleteTestChannelById(guild, channelId) {
    try {
      if (!channelId) return false;
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      if (!channel) {
        console.warn(`[Voice] Channel ${channelId} not found for deletion`);
        return false;
      }
      await channel.delete('Test completed');
      console.log(`[Voice] Deleted voice channel: ${channel.name} (${channelId})`);
      return true;
    } catch (error) {
      console.error('[Voice] Error deleting test channel:', error.message);
      return false;
    }
  }

  /**
   * Delete a test channel (by object)
   * @param {VoiceChannel} channel
   * @returns {Promise<boolean>}
   */
  async deleteTestChannel(channel) {
    try {
      await channel.delete('Test completed');
      console.log(`[Voice] Deleted test channel: ${channel.name}`);
      return true;
    } catch (error) {
      console.error('[Voice] Error deleting test channel:', error.message);
      return false;
    }
  }

  /**
   * Get active test voice channels (for cleanup)
   * @param {Guild} guild
   * @returns {Promise<Array>}
   */
  async getActiveTestChannels(guild) {
    try {
      const channels = guild.channels.cache.filter(ch =>
        ch.type === ChannelType.GuildVoice &&
        (ch.name.startsWith('vc-') || ch.name.startsWith('test-'))
      );
      return Array.from(channels.values());
    } catch (error) {
      console.error('[Voice] Error getting test channels:', error);
      return [];
    }
  }

  /**
   * Clean up old/empty test channels (older than 2 hours or empty)
   * @param {Guild} guild
   * @returns {Promise<number>}
   */
  async cleanupOldChannels(guild) {
    try {
      const channels = await this.getActiveTestChannels(guild);
      let deleted = 0;
      const twoHours = 2 * 60 * 60 * 1000;

      for (const channel of channels) {
        const age = Date.now() - channel.createdAt.getTime();
        if (channel.members.size === 0 || age > twoHours) {
          await this.deleteTestChannel(channel);
          deleted++;
        }
      }

      return deleted;
    } catch (error) {
      console.error('[Voice] Error cleaning up channels:', error);
      return 0;
    }
  }
}

module.exports = new VoiceChannelManager();