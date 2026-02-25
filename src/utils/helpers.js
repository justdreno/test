const { SUCCESS, ERROR } = require('../config/emojis');

// Validate Minecraft username (3-16 chars, alphanumeric + underscore)
function validateMinecraftUsername(username) {
  if (!username || username.length < 3 || username.length > 16) {
    return { valid: false, error: 'Username must be 3-16 characters' };
  }

  const regex = /^[a-zA-Z0-9_]+$/;
  if (!regex.test(username)) {
    return { valid: false, error: 'Username can only contain letters, numbers, and underscores' };
  }

  return { valid: true };
}

// Validate email format
function validateEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

// Generate random verification code
function generateVerificationCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Format duration for display
function formatDuration(startDate) {
  const diff = Date.now() - new Date(startDate).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Format timestamp for display
function formatTimestamp(date) {
  return `<t:${Math.floor(new Date(date).getTime() / 1000)}:R>`;
}

// Get queue position display
function getQueuePositionEmoji(position) {
  if (position === 1) return '';
  if (position <= 3) return '';
  if (position <= 5) return '';
  return '';
}

// Get priority weight (higher = more priority)
function getPriorityWeight(priority) {
  const weights = {
    'standard': 0,
    'vip': 10,
    'premium': 20,
    'supporter': 30
  };
  return weights[priority] || 0;
}

// Parse duration string (e.g., "1 day", "1 week") to hours
function parseDuration(durationStr) {
  const match = durationStr.match(/(\d+)\s*(day|week|month|year|hour)s?/i);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers = {
    'hour': 1,
    'day': 24,
    'week': 24 * 7,
    'month': 24 * 30,
    'year': 24 * 365
  };

  return value * multipliers[unit];
}

// Sanitize input
function sanitize(str) {
  if (!str) return '';
  return str.replace(/[<>]/g, '').trim();
}

// Create progress bar
function createProgressBar(current, total, length = 20) {
  const filled = Math.round((current / total) * length);
  const empty = length - filled;
  return SUCCESS.repeat(filled) + ERROR.repeat(empty);
}

// Format gamemode for display
function formatGamemode(code) {
  if (!code) return 'Unknown';
  const mappings = {
    'pot': 'Crystal',
    'vanilla': 'Vanilla',
    'uhc': 'UHC',
    'nethop': 'NethOP',
    'smp': 'SMP',
    'sword': 'Sword',
    'axe': 'Axe',
    'mace': 'Mace'
  };
  return mappings[code.toLowerCase()] || code.charAt(0).toUpperCase() + code.slice(1);
}

module.exports = {
  validateMinecraftUsername,
  validateEmail,
  generateVerificationCode,
  formatDuration,
  formatTimestamp,
  getQueuePositionEmoji,
  getPriorityWeight,
  parseDuration,
  sanitize,
  createProgressBar,
  formatGamemode
};