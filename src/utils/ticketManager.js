const { ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { SUCCESS, ERROR, GAME, USER, QUEUE, INFO, COLOR } = require('../config/emojis');

class TicketManager {
  constructor() {
    this.ticketCategoryId = process.env.TESTING_CATEGORY_ID;
    this.testerRoleId = process.env.TESTER_ROLE_ID;
    this.adminRoleId = process.env.ADMIN_ROLE_ID;
  }

  /**
   * Create a testing ticket channel
   * @param {Guild} guild - Discord guild
   * @param {string} testerId - Tester's Discord ID
   * @param {string} playerId - Player's Discord ID
   * @param {string} minecraftUsername - Player's MC username
   * @param {string} gamemode - Gamemode being tested
   * @param {string|null} [voiceChannelId] - ID of the dedicated voice channel
   * @returns {Promise<TextChannel|null>}
   */
  async createTestTicket(guild, testerId, playerId, minecraftUsername, gamemode, voiceChannelId = null) {
    try {
      // Create channel name
      const safeName = minecraftUsername.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
      const channelName = `test-${safeName}`;

      // Set up permissions
      const permissionOverwrites = [
        {
          id: guild.id, // @everyone
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: testerId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.AddReactions,
            PermissionsBitField.Flags.ManageMessages
          ]
        },
        {
          id: playerId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.AddReactions
          ]
        }
      ];

      // Add tester role if configured
      if (this.testerRoleId) {
        permissionOverwrites.push({
          id: this.testerRoleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        });
      }

      // Add admin role if configured
      if (this.adminRoleId) {
        permissionOverwrites.push({
          id: this.adminRoleId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageMessages,
            PermissionsBitField.Flags.ManageChannels
          ]
        });
      }

      // Create the text channel
      const channel = await guild.channels.create({
        name: channelName.substring(0, 100),
        type: ChannelType.GuildText,
        parent: this.ticketCategoryId || undefined,
        permissionOverwrites,
        topic: `Testing ${minecraftUsername} in ${gamemode}`
      });

      console.log(`[Ticket] Created test ticket: ${channel.name} (${channel.id})`);

      // Build action buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`complete_${minecraftUsername}`)
            .setLabel('Complete Test')
            .setStyle(ButtonStyle.Success)
            .setEmoji(SUCCESS),
          new ButtonBuilder()
            .setCustomId(`cancel_${minecraftUsername}`)
            .setLabel('Cancel Test')
            .setStyle(ButtonStyle.Danger)
            .setEmoji(ERROR)
        );

      // Build the instructions field — include voice channel mention if provided
      let instructionsValue = `1. Conduct the test on your server\n2. Use **${SUCCESS} Complete Test** to finish and assign tier\n3. Use **${ERROR} Cancel Test** if the player no-shows`;
      if (voiceChannelId) {
        instructionsValue += `\n\n[Voice] **Dedicated Voice Channel:** <#${voiceChannelId}>`;
      }

      // Send initial embed message
      await channel.send({
        content: `<@${testerId}> <@${playerId}>`,
        embeds: [{
          title: `${GAME} Test Started`,
          description: `Testing **${minecraftUsername}** in **${gamemode}**`,
          fields: [
            {
              name: `${USER} Tester`,
              value: `<@${testerId}>`,
              inline: true
            },
            {
              name: `${USER} Player`,
              value: `<@${playerId}>`,
              inline: true
            },
            {
              name: `${QUEUE} Gamemode`,
              value: gamemode,
              inline: true
            },
            ...(voiceChannelId ? [{
              name: '[Voice] Voice Channel',
              value: `<#${voiceChannelId}>\nBoth parties — please join this channel for the test.`,
              inline: false
            }] : []),
            {
              name: `${INFO} Instructions`,
              value: instructionsValue,
              inline: false
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }],
        components: [row]
      });

      return channel;

    } catch (error) {
      console.error('[Ticket] Error creating test ticket:', error);
      return null;
    }
  }

  /**
   * Delete a test ticket channel
   * @param {TextChannel} channel
   * @returns {Promise<boolean>}
   */
  async deleteTestTicket(channel) {
    try {
      await channel.delete('Test completed');
      console.log(`[Ticket] Deleted test ticket: ${channel.name}`);
      return true;
    } catch (error) {
      console.error('[Ticket] Error deleting test ticket:', error);
      return false;
    }
  }

  /**
   * Check if tester has active test
   * @param {string} testerId
   * @returns {Promise<boolean>}
   */
  async hasActiveTest(testerId) {
    try {
      const db = require('../database');
      const rows = await db.query(`
        SELECT COUNT(*) as count FROM applications 
        WHERE tester_id = ? 
        AND status = 'testing'
      `, [testerId]);

      return rows[0]?.count > 0;
    } catch (error) {
      console.error('[Ticket] Error checking active test:', error);
      return false;
    }
  }
}

module.exports = new TicketManager();