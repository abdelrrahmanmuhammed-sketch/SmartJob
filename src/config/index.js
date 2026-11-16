require('dotenv').config();

function normalizePhone(phone) {
  if (!phone) return '';
  // Remove non-digit characters except leading plus
  let cleaned = phone.trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+20')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('0020')) {
    cleaned = cleaned.substring(4);
  } else if (cleaned.startsWith('20')) {
    cleaned = cleaned.substring(2);
  }
  // Ensure Egyptian local format starts with 0
  if (cleaned.length === 10 && !cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }
  return cleaned;
}

const config = {
  port: parseInt(process.env.PORT, 10) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  jwtSecret: process.env.JWT_SECRET || 'smart-job-dev-secret-key-32-chars-long!',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  adminPhone: process.env.ADMIN_PHONE || '+20 15 05677212',
  adminNormalizedPhone: normalizePhone(process.env.ADMIN_PHONE || '+20 15 05677212'),
  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@SecurePassword2026!',
  adminName: process.env.ADMIN_NAME || 'جنة هيثم جمعة',
  publicAdContactNumber: process.env.PUBLIC_AD_CONTACT_NUMBER || '01154093079',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  normalizePhone
};

module.exports = config;
