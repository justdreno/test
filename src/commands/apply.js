const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const db = require('../database');
const { TIME, TOOLS, ERROR, WARN, KEY, SUCCESS, GAME, REGION, QUEUE, COLOR } = require('../config/emojis');
const rateLimiter = require('../utils/rateLimiter');
const auditLogger = require('../utils/auditLogger');
const { validateMinecraftUsername, generateVerificationCode, sanitize } = require('../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Apply for a tier test')
    .addStringOption(option =>
      option
        .setName('minecraft_username')
        .setDescription('Your Minecraft username (3-16 characters)')
        .setRequired(true)
        .setMaxLength(16)
        .setMinLength(3)
    )
    .addStringOption(option =>
      option
        .setName('region')
        .setDescription('Your region')
        .setRequired(true)
        .addChoices(
          { name: 'North America', value: 'North America' },
          { name: 'Europe', value: 'Europe' },
          { name: 'Asia', value: 'Asia' },
          { name: 'Other', value: 'Other' }
        )
    )
    .addStringOption(option =>
      option
        .setName('gamemode')
        .setDescription('Primary gamemode for testing')
        .setRequired(true)
        .addChoices(
          { name: 'Vanilla', value: 'vanilla' },
          { name: 'UHC', value: 'uhc' },
          { name: 'Crystal', value: 'pot' },
          { name: 'NethOP', value: 'nethop' },
          { name: 'SMP', value: 'smp' },
          { name: 'Sword', value: 'sword' },
          { name: 'Axe', value: 'axe' },
          { name: 'Mace', value: 'mace' }
        )
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Defer immediately — DB queries and DMs can take >3 s
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      // Check rate limit
      const rateCheck = await rateLimiter.checkLimit(userId, 'apply');
      if (!rateCheck.allowed) {
        return await interaction.editReply({
          content: `${TIME} ${rateCheck.message}`
        });
      }

      // Check if maintenance mode
      const configRows = await db.query('SELECT value FROM config WHERE `key` = ?', ['maintenance_mode']);
      if (configRows && configRows[0]?.value === 'true') {
        return await interaction.editReply({
          content: `${TOOLS} The bot is currently in maintenance mode. Please try again later.`
        });
      }

      // Check if user is banned
      const banRows = await db.query(`
        SELECT * FROM bans 
        WHERE (discord_id = ? OR minecraft_username = ?) 
        AND is_active = TRUE 
        AND (expires_at IS NULL OR expires_at > NOW())
      `, [userId, sanitize(interaction.options.getString('minecraft_username'))]);

      if (banRows && banRows.length > 0) {
        const ban = banRows[0];
        const expiresText = ban.expires_at
          ? `Expires: <t:${Math.floor(new Date(ban.expires_at).getTime() / 1000)}:R>`
          : 'Permanent ban';

        return await interaction.editReply({
          content: `${ERROR} You are banned from the system.\n\n**Reason:** ${ban.reason}\n**${expiresText}**\n\nIf you believe this is a mistake, please contact an administrator.`
        });
      }

      // Check for existing active application
      const existingRows = await db.query(`
        SELECT * FROM applications 
        WHERE discord_id = ? 
        AND status IN ('pending', 'verifying', 'verified', 'invited', 'testing', 'rescheduled')
      `, [userId]);

      if (existingRows && existingRows.length > 0) {
        const existing = existingRows[0];
        return await interaction.editReply({
          content: `${WARN} You already have an active application for **${existing.minecraft_username}**.\n\nStatus: \`${existing.status.toUpperCase()}\`\nUse \`/my-application\` to check your status.`
        });
      }

      // Validate inputs
      const mcUsername = sanitize(interaction.options.getString('minecraft_username'));
      const region = interaction.options.getString('region');
      const gamemode = interaction.options.getString('gamemode');

      // Validate Minecraft username
      const usernameValidation = validateMinecraftUsername(mcUsername);
      if (!usernameValidation.valid) {
        return await interaction.editReply({
          content: `${ERROR} Invalid Minecraft username: ${usernameValidation.error}`
        });
      }

      // Check if MC username already in an active application
      const mcRows = await db.query(`
        SELECT * FROM applications 
        WHERE minecraft_username = ? 
        AND status IN ('pending', 'verifying', 'verified', 'invited', 'testing')
      `, [mcUsername]);

      if (mcRows && mcRows.length > 0) {
        return await interaction.editReply({
          content: `${WARN} The Minecraft username **${mcUsername}** is already in an active application.`
        });
      }

      // Check daily application limit
      const dailyRows = await db.query(`
        SELECT COUNT(*) as count FROM applications 
        WHERE discord_id = ? 
        AND applied_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `, [userId]);

      const dailyLimit = process.env.MAX_DAILY_APPLICATIONS || 3;
      if (dailyRows && dailyRows[0].count >= dailyLimit) {
        return await interaction.editReply({
          content: `${ERROR} You have reached the maximum of ${dailyLimit} applications per 24 hours.\nPlease try again tomorrow.`
        });
      }

      // Generate verification code
      const verificationCode = generateVerificationCode();

      // Get queue position
      const queueRows = await db.query(`
        SELECT COUNT(*) as count FROM applications 
        WHERE status IN ('pending', 'verifying', 'verified')
      `);
      const position = (queueRows && queueRows[0].count) + 1;

      // Create application
      const applicationId = require('crypto').randomUUID();
      await db.query(`
        INSERT INTO applications 
        (id, discord_id, discord_username, minecraft_username, region, 
         primary_gamemode, status, priority, position, applied_at, verification_code, verified_in_game)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 'standard', ?, NOW(), ?, 0)
      `, [
        applicationId,
        userId,
        username,
        mcUsername,
        region,
        gamemode,
        position,
        verificationCode
      ]);

      // Log to audit
      await auditLogger.log('APPLICATION_CREATED', userId, 'player', applicationId, {
        minecraft_username: mcUsername,
        gamemode: gamemode
      });

      // Send DM with verification instructions
      let verifyMessageId = null;
      try {
        const dmChannel = await interaction.user.createDM();
        const verifyMsg = await dmChannel.send({
          embeds: [{
            title: `${KEY} Verify Your Minecraft Account`,
            description: [
              `To verify ownership of **${mcUsername}**, follow these steps:`,
              '',
              `**Step 1:** Join \`bananasmp.net\` and run:`,
              `\`\`\`/verify ${verificationCode}\`\`\``,
              `**Step 2:** Come back here and click the **Verify Application** button below.`,
              '',
              `> ${WARN} If you click verify before running \`/verify\` in-game, you will be asked to do it first.`,
              '',
              `Your application will expire if not verified within **30 minutes**.`
            ].join('\n'),
            color: COLOR,
            timestamp: new Date(),
            footer: { text: `Code: ${verificationCode}` }
          }],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('verify_submit_btn')
                .setLabel('Verify Application')
                .setStyle(ButtonStyle.Success)
                .setEmoji(SUCCESS)
            )
          ]
        });

        verifyMessageId = verifyMsg.id;

        // Store the DM message ID so the reaction handler can find the application
        await db.query(`
          UPDATE applications SET verify_message_id = ? WHERE id = ?
        `, [verifyMessageId, applicationId]);

      } catch (dmError) {
        console.error('Failed to send verification DM:', dmError);
      }

      // Reply to interaction
      const embed = {
        title: `${SUCCESS} Application Submitted Successfully`,
        description: `Your application has been received and is **pending verification**.`,
        fields: [
          {
            name: `${GAME} Minecraft Username`,
            value: mcUsername,
            inline: true
          },
          {
            name: `${REGION} Region`,
            value: region,
            inline: true
          },
          {
            name: `${QUEUE} Gamemode`,
            value: gamemode,
            inline: true
          },
          {
            name: `${TIME} Queue Position`,
            value: `#${position}`,
            inline: true
          },
          {
            name: `${QUEUE} Next Step`,
            value: verifyMessageId
              ? '📬 Check your DMs — join `bananasmp.net`, run `/verify <code>`, then click the **Verify Application** button in the DM.'
              : `${WARN} Could not send DM. Please enable DMs and re-apply.`,
            inline: false
          }
        ],
        color: COLOR,
        footer: {
          text: 'Check your DMs for verification instructions'
        },
        timestamp: new Date()
      };

      await interaction.editReply({
        embeds: [embed]
      });

    } catch (error) {
      console.error('Apply command error:', error);
      await interaction.editReply({
        content: `${ERROR} An error occurred while processing your application. Please try again later.`
      });
    }
  }
};