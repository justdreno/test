const db = require('../database');
const auditLogger = require('../utils/auditLogger');
const ticketManager = require('../utils/ticketManager');
const voiceManager = require('../utils/voiceManager');
const { SUCCESS, GAME, QUEUE, STATS, ERROR, WARN, INFO, COLOR } = require('../config/emojis');

module.exports = {
  name: 'messageCreate',
  async execute(message) {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only handle DMs
    if (message.guild) return;

    const userId = message.author.id;
    const content = message.content.trim().toUpperCase();

    try {
      // Check if user has a pending application
      const rows = await db.query(`
        SELECT * FROM applications 
        WHERE discord_id = ? 
        AND status = 'pending'
        AND verification_code IS NOT NULL
        ORDER BY applied_at DESC 
        LIMIT 1
      `, [userId]);

      if (!rows || rows.length === 0) {
        // No pending application, check for invited application
        await handleInvitedApplication(message, userId, content);
        return;
      }

      const app = rows[0];

      // Check if code matches
      if (content === app.verification_code) {
        // Update application status to verified
        await db.query(`
          UPDATE applications 
          SET status = 'verified', 
              verified_at = NOW(),
              verification_code = NULL
          WHERE id = ?
        `, [app.id]);

        // Log to audit
        await auditLogger.log('APPLICATION_VERIFIED', userId, 'player', app.id, {
          minecraft_username: app.minecraft_username,
          method: 'dm_code'
        });

        // Send confirmation
        await message.reply({
          embeds: [{
            title: `${SUCCESS} Verification Successful`,
            description: `Your application for **${app.minecraft_username}** has been verified!`,
            fields: [
              {
                name: `${GAME} Minecraft Username`,
                value: app.minecraft_username,
                inline: true
              },
              {
                name: `${QUEUE} Gamemode`,
                value: app.primary_gamemode,
                inline: true
              },
              {
                name: `${STATS} Status`,
                value: 'You are now in the queue waiting for a tester.',
                inline: false
              }
            ],
            color: COLOR,
            timestamp: new Date()
          }]
        });

        // Also update their position in queue
        const positionRows = await db.query(`
          SELECT COUNT(*) as position 
          FROM applications 
          WHERE status IN ('pending', 'verified') 
          AND applied_at < ?
        `, [app.applied_at]);

        const position = (positionRows && positionRows[0].position + 1) || 'Unknown';

        await message.channel.send({
          content: `${STATS} Your current queue position: **#${position}**`,
        });

      } else {
        // Wrong code
        await message.reply({
          embeds: [{
            title: `${ERROR} Invalid Verification Code`,
            description: 'The code you entered does not match. Please check your DM and try again.',
            color: COLOR,
            timestamp: new Date()
          }]
        });
      }

    } catch (error) {
      console.error('DM message handler error:', error);
    }
  }
};

async function handleInvitedApplication(message, userId, content) {
  try {
    // Check if user has an invited application
    const rows = await db.query(`
      SELECT * FROM applications 
      WHERE discord_id = ? 
      AND status = 'invited'
      ORDER BY invited_at DESC 
      LIMIT 1
    `, [userId]);

    if (!rows || rows.length === 0) {
      return;
    }

    const app = rows[0];

    if (content === 'ACCEPT') {
      // Check if tester already has an active test
      const hasActive = await ticketManager.hasActiveTest(app.tester_id);
      if (hasActive) {
        await message.reply({
          embeds: [{
            title: `${WARN} Tester Busy`,
            description: `The tester is currently conducting another test.\n\nYou will remain in the queue and be invited by another tester.`,
            color: COLOR,
            timestamp: new Date()
          }]
        });

        // Return to queue
        await db.query(`
          UPDATE applications 
          SET status = 'verified', 
              invited_at = NULL,
              tester_id = NULL
          WHERE id = ?
        `, [app.id]);

        return;
      }

      // Update to testing status
      await db.query(`
        UPDATE applications 
        SET status = 'testing', 
            responded_at = NOW()
        WHERE id = ?
      `, [app.id]);

      // Log to audit
      await auditLogger.log('INVITATION_ACCEPTED', userId, 'player', app.id, {
        minecraft_username: app.minecraft_username,
        tester_id: app.tester_id
      });

      // Create ticket and voice channel
      let ticketChannel = null;
      let voiceChannel = null;
      try {
        const guild = message.client.guilds.cache.first();

        if (guild) {
          // Create dedicated voice channel first
          try {
            voiceChannel = await voiceManager.createTestChannel(
              guild,
              app.tester_id,
              userId,
              app.minecraft_username,
              app.primary_gamemode
            );
          } catch (voiceError) {
            console.error('Error creating voice channel:', voiceError);
          }

          // Create text ticket, passing voice channel ID
          ticketChannel = await ticketManager.createTestTicket(
            guild,
            app.tester_id,
            userId,
            app.minecraft_username,
            app.primary_gamemode,
            voiceChannel?.id
          );

          if (ticketChannel || voiceChannel) {
            // Update application with channel IDs
            await db.query(`
              UPDATE applications 
              SET channel_id = ?, voice_channel_id = ?
              WHERE id = ?
            `, [ticketChannel?.id || null, voiceChannel?.id || null, app.id]);
          }
        }
      } catch (error) {
        console.error('Error creating test channels:', error);
      }

      // Notify player
      await message.reply({
        embeds: [{
          title: `${SUCCESS} Invitation Accepted!`,
          description: `You have accepted the invitation for **${app.primary_gamemode}** testing.`,
          fields: [
            {
              name: `${INFO} Next Steps`,
              value: ticketChannel
                ? `${QUEUE} **Test ticket created:** <#${ticketChannel.id}>\nJoin the channel and wait for the tester.`
                : 'The tester will contact you shortly with server details.'
            },
            {
              name: `${GAME} Voice Channel`,
              value: voiceChannel
                ? `Please join the dedicated voice channel: <#${voiceChannel.id}>`
                : 'Use the text ticket channel for communication.',
              inline: false
            },
            {
              name: `${TIME} Be Ready`,
              value: 'Please join within 5 minutes.'
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }]
      });

      // Notify tester
      try {
        const tester = await message.client.users.fetch(app.tester_id);
        await tester.send({
          embeds: [{
            title: `${SUCCESS} Player Accepted!`,
            description: `**${app.minecraft_username}** has accepted your invitation.`,
            fields: [
              {
                name: `${GAME} Minecraft Username`,
                value: app.minecraft_username,
                inline: true
              },
              {
                name: `${QUEUE} Gamemode`,
                value: app.primary_gamemode,
                inline: true
              },
              {
                name: `${STATS} Action Required`,
                value: `${ticketChannel ? `${QUEUE} **Test ticket:** <#${ticketChannel.id}>\n` : ''}${voiceChannel ? `${GAME} **Voice channel:** <#${voiceChannel.id}>\n` : ''}Join the channels and start the test!\n\nUse buttons in the channel or \`/complete\` to finish.`
              }
            ],
            color: COLOR,
            timestamp: new Date()
          }]
        });
      } catch (dmError) {
        console.error('Could not DM tester:', dmError);
      }

    } else if (content === 'DECLINE') {
      // Return to verified queue
      await db.query(`
        UPDATE applications 
        SET status = 'verified', 
            responded_at = NOW(),
            invited_at = NULL,
            tester_id = NULL
        WHERE id = ?
      `, [app.id]);

      // Log to audit
      await auditLogger.log('INVITATION_DECLINED', userId, 'player', app.id, {
        minecraft_username: app.minecraft_username
      });

      // Notify player
      await message.reply({
        embeds: [{
          title: `${ERROR} Invitation Declined`,
          description: `You have declined the invitation. You remain in the queue.`,
          fields: [
            {
              name: `${QUEUE} Status`,
              value: 'You are back in the verified queue waiting for another tester.'
            }
          ],
          color: COLOR,
          timestamp: new Date()
        }]
      });

      // Notify tester
      try {
        const tester = await message.client.users.fetch(app.tester_id);
        await tester.send({
          embeds: [{
            title: `${ERROR} Player Declined`,
            description: `**${app.minecraft_username}** has declined the invitation.`,
            fields: [
              {
                name: `${STATS} Status`,
                value: 'The player has been returned to the queue.\nUse `/available` to get the next player.'
              }
            ],
            color: COLOR,
            timestamp: new Date()
          }]
        });
      } catch (dmError) {
        console.error('Could not DM tester:', dmError);
      }
    }

  } catch (error) {
    console.error('Handle invited application error:', error);
  }
}