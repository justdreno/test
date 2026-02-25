require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ActivityType, Partials, MessageFlags } = require('discord.js');
const { ERROR, TIME, QUEUE, INFO, COLOR } = require('./config/emojis');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const auditLogger = require('./utils/auditLogger');
const notificationManager = require('./utils/notificationManager');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessageReactions
  ],
  // Partials are REQUIRED to receive reactions on DM messages that were
  // sent before the bot started (i.e. cached before the bot was online)
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log(`Loading ${commandFiles.length} commands...`);

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`  Loaded: ${command.data.name}`);
  } else {
    console.warn(`  Skipped: ${file} (missing data or execute)`);
  }
}

// Load events
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

  console.log(`Loading ${eventFiles.length} events...`);

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
    console.log(`  Loaded: ${event.name}`);
  }
}

// Bot ready
client.once('ready', () => {
  console.log(`\nBot logged in as ${client.user.tag}`);
  console.log(`Guilds: ${client.guilds.cache.size}`);
  console.log(`Commands: ${client.commands.size}`);

  // Set bot activity
  client.user.setActivity('/apply to get tested', { type: ActivityType.Playing });

  // Start scheduled tasks
  startScheduledTasks();
});

// Interaction handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);

    const errorMessage = {
      content: `${ERROR} There was an error while executing this command!`,
      flags: [MessageFlags.Ephemeral]
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
});


// Scheduled tasks
function startScheduledTasks() {
  const cron = require('node-cron');

  // Daily cleanup at 3 AM
  cron.schedule('0 3 * * *', async () => {
    console.log('[Scheduled] Running daily cleanup...');
    try {
      // Clean up old cancelled applications
      await db.query(`
        DELETE FROM applications 
        WHERE status = 'cancelled' 
        AND applied_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
      `);

      // Reset tester daily counts
      await db.query(`
        UPDATE testers 
        SET tests_today = 0 
        WHERE DATE(last_test_at) < CURDATE()
      `);

      // Clean up expired invites
      await db.query(`
        UPDATE applications 
        SET status = 'expired' 
        WHERE status = 'invited' 
        AND invited_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `);

      console.log('[Scheduled] Daily cleanup completed');
    } catch (error) {
      console.error('[Scheduled] Cleanup error:', error);
    }
  });

  // Hourly metrics update
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduled] Updating metrics...');
    try {
      const queueCount = await db.query(`
        SELECT COUNT(*) as count 
        FROM applications 
        WHERE status IN ('pending', 'verified', 'invited')
      `);

      const avgWaitTime = await db.query(`
        SELECT AVG(TIMESTAMPDIFF(HOUR, applied_at, NOW())) as avg_hours 
        FROM applications 
        WHERE status IN ('pending', 'verified', 'invited')
      `);

      console.log(`[Metrics] Queue: ${queueCount[0]?.count || 0}, Avg wait: ${avgWaitTime[0]?.avg_hours || 0}h`);
    } catch (error) {
      console.error('[Scheduled] Metrics error:', error);
    }
  });

  // Check for invitation timeouts every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      // Find invitations older than 5 minutes that haven't been responded to
      const expiredInvites = await db.query(`
        SELECT * FROM applications 
        WHERE status = 'invited' 
        AND invited_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
        AND responded_at IS NULL
      `);

      if (expiredInvites && expiredInvites.length > 0) {
        console.log(`[Timeout] Found ${expiredInvites.length} expired invitation(s)`);

        for (const app of expiredInvites) {
          // Return to queue
          await db.query(`
            UPDATE applications 
            SET status = 'verified',
                invited_at = NULL,
                tester_id = NULL
            WHERE id = ?
          `, [app.id]);

          // Notify player
          try {
            const player = await client.users.fetch(app.discord_id);
            await player.send({
              embeds: [{
                title: `${TIME} Invitation Expired`,
                description: `Your invitation for **${app.primary_gamemode}** has expired.`,
                fields: [
                  {
                    name: `${QUEUE} Status`,
                    value: 'You have been returned to the queue.'
                  }
                ],
                color: COLOR,
                timestamp: new Date()
              }]
            });
          } catch (dmError) {
            console.log('Could not DM player about timeout:', dmError.message);
          }

          // Notify tester
          try {
            const tester = await client.users.fetch(app.tester_id);
            await tester.send({
              embeds: [{
                title: `${TIME} Invitation Expired`,
                description: `**${app.minecraft_username}** did not respond in time.`,
                fields: [
                  {
                    name: `${INFO} Status`,
                    value: 'The player has been returned to the queue.\nUse `/available` to get the next player.'
                  }
                ],
                color: COLOR,
                timestamp: new Date()
              }]
            });
          } catch (dmError) {
            console.log('Could not DM tester about timeout:', dmError.message);
          }

          await auditLogger.log('INVITATION_EXPIRED', 'system', 'admin', app.id, {
            minecraft_username: app.minecraft_username
          });
        }

        console.log(`[Timeout] Returned ${expiredInvites.length} player(s) to queue`);
      }
    } catch (error) {
      console.error('[Timeout] Error:', error);
    }
  });

  // Check for unverified pending applications every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      // Find pending applications older than the verification timeout (default 15 mins)
      const timeoutMinutes = parseInt(process.env.VERIFICATION_TIMEOUT_MINUTES) || 15;
      const expiredPending = await db.query(`
        SELECT * FROM applications 
        WHERE status = 'pending' 
        AND verified_in_game = 0
        AND applied_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
      `, [timeoutMinutes]);

      if (expiredPending && expiredPending.length > 0) {
        console.log(`[Verification] Found ${expiredPending.length} unverified expired application(s)`);

        for (const app of expiredPending) {
          // Cancel the application
          await db.query(`
            UPDATE applications 
            SET status = 'cancelled',
                completed_at = NOW(),
                notes = 'Auto-cancelled: Did not complete in-game verification in time'
            WHERE id = ?
          `, [app.id]);

          // Notify player
          try {
            const player = await client.users.fetch(app.discord_id);
            await player.send({
              embeds: [{
                title: `${TIME} Verification Timeout`,
                description: `Your application for **${app.minecraft_username}** has been automatically cancelled.`,
                fields: [
                  {
                    name: `${INFO} Reason`,
                    value: `You did not complete the in-game verification (\`/verify\`) within ${timeoutMinutes} minutes.`
                  },
                  {
                    name: `${INFO} Next Steps`,
                    value: 'You can submit a new application using `/apply` when you are ready to verify.'
                  }
                ],
                color: COLOR,
                timestamp: new Date()
              }]
            });
          } catch (dmError) {
            console.log(`[Verification] Could not DM player ${app.discord_id} about auto-cancel:`, dmError.message);
          }

          // Log to audit
          await auditLogger.log('APPLICATION_CANCELLED', 'system', 'admin', app.id, {
            minecraft_username: app.minecraft_username,
            reason: 'Verification timeout'
          });
        }

        console.log(`[Verification] Auto-cancelled ${expiredPending.length} unverified application(s)`);
      }
    } catch (error) {
      console.error('[Verification Timeout] Error:', error);
    }
  });

  // Daily summary at 9 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('[Scheduled] Sending daily summary...');
    try {
      await notificationManager.sendDailySummary(client);
    } catch (error) {
      console.error('[Scheduled] Daily summary error:', error);
    }
  });

  // Check for queue backup every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const queueCount = await db.query(`
        SELECT COUNT(*) as count FROM applications 
        WHERE status IN ('verified', 'invited')
      `);

      const avgWait = await db.query(`
        SELECT AVG(TIMESTAMPDIFF(HOUR, applied_at, NOW())) as avg_hours 
        FROM applications 
        WHERE status IN ('verified', 'invited')
      `);

      const count = queueCount[0]?.count || 0;
      const waitHours = Math.round(avgWait[0]?.avg_hours || 0);

      // Alert if more than 20 people waiting or avg wait > 6 hours
      if (count > 20 || waitHours > 6) {
        await notificationManager.notifyQueueBackup(client, count, waitHours);
      }
    } catch (error) {
      console.error('[Scheduled] Queue backup check error:', error);
    }
  });

  // Check for long waits every 2 hours
  cron.schedule('0 */2 * * *', async () => {
    try {
      const longWaits = await db.query(`
        SELECT discord_id, TIMESTAMPDIFF(HOUR, applied_at, NOW()) as wait_hours
        FROM applications 
        WHERE status = 'verified'
        AND applied_at < DATE_SUB(NOW(), INTERVAL 4 HOUR)
      `);

      for (const app of longWaits) {
        await notificationManager.notifyLongWait(client, app.discord_id, app.wait_hours);
      }
    } catch (error) {
      console.error('[Scheduled] Long wait notification error:', error);
    }
  });

  // Notify testers when queue has pending tests (every 30 minutes)
  cron.schedule('*/30 * * * *', async () => {
    try {
      const pendingCount = await db.query(`
        SELECT COUNT(*) as count FROM applications 
        WHERE status = 'verified'
      `);

      if (pendingCount[0]?.count > 0) {
        const testers = await db.query(`
          SELECT discord_id FROM testers 
          WHERE is_active = TRUE
        `);

        await notificationManager.notifyTestersAvailable(client, testers, pendingCount[0].count);
      }
    } catch (error) {
      console.error('[Scheduled] Tester notification error:', error);
    }
  });

  // Check for reactivating rescheduled applications every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      const reactivateApps = await db.query(`
        SELECT * FROM applications 
        WHERE status = 'rescheduled'
        AND reschedule_time <= NOW()
      `);

      for (const app of reactivateApps) {
        await db.query(`
          UPDATE applications 
          SET status = 'verified',
              reschedule_time = NULL
          WHERE id = ?
        `, [app.id]);

        await notificationManager.notifyRescheduleReactivated(
          client,
          app.discord_id,
          app.primary_gamemode
        );

        console.log(`[Scheduled] Reactivated application ${app.id}`);
      }
    } catch (error) {
      console.error('[Scheduled] Reschedule reactivation error:', error);
    }
  });

  console.log('Scheduled tasks started');
}

// Error handling
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN);