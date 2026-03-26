import 'dotenv/config';

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },

  meta: {
    accessToken: process.env.META_ACCESS_TOKEN || '',
    apiVersion: process.env.META_API_VERSION || 'v21.0',
    facebookPageId: process.env.FACEBOOK_PAGE_ID || '',
    instagramUserId: process.env.INSTAGRAM_USER_ID || '',
  },

  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    accessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
    refreshToken: process.env.TIKTOK_REFRESH_TOKEN || '',
  },

  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || '',
    channelId: process.env.YOUTUBE_CHANNEL_ID || '',
    serviceAccountEmail: process.env.YOUTUBE_SERVICE_ACCOUNT_EMAIL || '',
    serviceAccountKey: process.env.YOUTUBE_SERVICE_ACCOUNT_KEY || '',
    clientId: process.env.YOUTUBE_CLIENT_ID || '',
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN || '',
  },

  twitter: {
    bearerToken: process.env.TWITTER_BEARER_TOKEN || '',
    apiKey: process.env.TWITTER_API_KEY || '',
    apiSecret: process.env.TWITTER_API_SECRET || '',
    accessToken: process.env.TWITTER_ACCESS_TOKEN || '',
    accessSecret: process.env.TWITTER_ACCESS_SECRET || '',
    userId: process.env.TWITTER_USER_ID || '',
  },

  google: {
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '',
    docId: process.env.GOOGLE_DOC_ID || '',
  },

  agent: {
    cronSchedule: process.env.CRON_SCHEDULE || '0 7 * * *',
    timezone: process.env.TIMEZONE || 'Australia/Melbourne',
  },
};

// ── Determine which platforms have credentials configured ─────────────────────

export function getConfiguredPlatforms() {
  const platforms = [];
  if (config.meta.accessToken && config.meta.instagramUserId) platforms.push('instagram');
  if (config.meta.accessToken && config.meta.facebookPageId) platforms.push('facebook');
  if (config.tiktok.accessToken) platforms.push('tiktok');
  if (config.youtube.apiKey && config.youtube.channelId) platforms.push('youtube');
  if (config.twitter.bearerToken && config.twitter.userId) platforms.push('twitter');
  return platforms;
}

// ── Validate that minimum config is present ──────────────────────────────────

export function validateRequiredConfig() {
  const errors = [];

  if (!config.anthropic.apiKey) {
    errors.push('ANTHROPIC_API_KEY is required');
  }

  const platforms = getConfiguredPlatforms();
  if (platforms.length === 0) {
    errors.push('No social platforms configured — set at least one platform\'s credentials in .env');
  }

  return errors;
}
