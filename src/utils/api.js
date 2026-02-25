require('dotenv').config();
const axios = require('axios');

class FastTiersAPI {
  constructor() {
    this.baseURL = process.env.API_URL || 'http://localhost:7000';
    this.apiKey = process.env.API_KEY;

    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey ? `Bearer ${this.apiKey}` : undefined
      }
    });
  }

  /**
   * Get player by Minecraft username
   * @param {string} minecraftUsername 
   * @returns {Promise<Object|null>}
   */
  async getPlayer(minecraftUsername) {
    try {
      // Try to search for player first
      const response = await this.client.get(`/search/players?q=${encodeURIComponent(minecraftUsername)}`);
      const searchResults = Array.isArray(response.data) ? response.data : [];

      const player = searchResults.find(p =>
        p.username.toLowerCase() === minecraftUsername.toLowerCase()
      );

      if (!player) return null;

      // Now get full player data with tiers
      const playerResponse = await this.client.get(`/players/${player.id}`);
      return playerResponse.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      console.error('API Error - getPlayer:', error.message);
      return null;
    }
  }

  /**
   * Search for players
   * @param {string} query 
   * @returns {Promise<Array>}
   */
  async searchPlayers(query) {
    try {
      const response = await this.client.get(`/search/players?q=${encodeURIComponent(query)}`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('API Error - searchPlayers:', error.message);
      return [];
    }
  }

  /**
   * Get player's tier for a specific gamemode
   * @param {string} minecraftUsername 
   * @param {string} gamemode 
   * @returns {Promise<string|null>}
   */
  async getPlayerTier(minecraftUsername, gamemode) {
    try {
      const player = await this.getPlayer(minecraftUsername);
      if (!player || !player.tiers) return null;

      const tier = player.tiers.find(t => {
        // Check nested gamemode.code structure
        const gmCode = t.gamemode?.code || '';
        return gmCode.toLowerCase() === gamemode.toLowerCase();
      });

      // Return the nested tier_definition.code
      return tier ? tier.tier_definition?.code : null;
    } catch (error) {
      console.error('API Error - getPlayerTier:', error.message);
      return null;
    }
  }

  /**
   * Get all gamemodes
   * @returns {Promise<Array>}
   */
  async getGamemodes() {
    try {
      const response = await this.client.get('/gamemodes');
      return response.data || [];
    } catch (error) {
      console.error('API Error - getGamemodes:', error.message);
      return [];
    }
  }

  /**
   * Get leaderboard for a gamemode
   * @param {string} gamemode 
   * @param {number} limit 
   * @returns {Promise<Array>}
   */
  async getLeaderboard(gamemode, limit = 10) {
    try {
      const response = await this.client.get(`/leaderboard/${gamemode}?limit=${limit}`);
      return response.data || [];
    } catch (error) {
      console.error('API Error - getLeaderboard:', error.message);
      return [];
    }
  }

  /**
   * Create or update player
   * @param {Object} playerData 
   * @returns {Promise<Object|null>}
   */
  async createOrUpdatePlayer(playerData) {
    try {
      const response = await this.client.post('/players', playerData);
      return response.data;
    } catch (error) {
      console.error('API Error - createOrUpdatePlayer:', error.message);
      return null;
    }
  }

  /**
   * Update player tier
   * @param {string} minecraftUsername 
   * @param {string} gamemode 
   * @param {string} tier 
   * @param {Object} metadata 
   * @returns {Promise<boolean>}
   */
  async updatePlayerTier(minecraftUsername, gamemode, tier, metadata = {}) {
    console.log(`[API] Sending tier update to ${this.baseURL}/players/tier`);
    console.log(`[API] Data:`, { minecraft_username: minecraftUsername, gamemode, tier });
    try {
      const response = await this.client.post('/players/tier', {
        minecraft_username: minecraftUsername,
        gamemode: gamemode,
        tier: tier,
        ...metadata
      });
      console.log(`[API] Response status: ${response.status}`);
      console.log(`[API] Response data:`, response.data);
      return response.status === 200 && response.data && response.data.success === true;
    } catch (error) {
      console.error('[API] Error - updatePlayerTier:', error.message);
      if (error.response) {
        console.error('[API] Error response:', error.response.status, error.response.data);
      }
      return false;
    }
  }

  /**
   * Health check
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new FastTiersAPI();