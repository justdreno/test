require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

console.log('Deploying slash commands...\n');

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ('data' in command) {
    commands.push(command.data.toJSON());
    console.log(`  Registered: ${command.data.name}`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\nDeploying ${commands.length} application commands...`);

    // ONLY register guild commands (faster updates, no duplication)
    if (process.env.GUILD_ID) {
      console.log(`Deploying to guild: ${process.env.GUILD_ID}`);

      // First, delete all existing guild commands to prevent duplicates
      console.log('  Clearing old guild commands...');
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: [] }
      );

      // Then register new commands
      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`[OK] Successfully deployed ${data.length} guild commands.`);

      // Clear global commands to prevent duplication
      console.log('\n  Clearing global commands (to prevent duplication)...');
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: [] }
      );
      console.log('[OK] Global commands cleared.');

    } else {
      // If no GUILD_ID, register globally (for multi-server bots)
      console.log('Deploying global commands...');
      const globalData = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log(`[OK] Successfully deployed ${globalData.length} global commands.`);
    }

    console.log('\n[OK] Commands deployed successfully!');
    console.log('Note: Changes may take up to 1 minute to appear in Discord.');

  } catch (error) {
    console.error('Error deploying commands:', error);
    process.exit(1);
  }
})();