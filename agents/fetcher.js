import axios from 'axios';
import dayjs from 'dayjs';
import { config, getConfiguredPlatforms } from '../config/index.js';
import { upsertPost, upsertDailyMetrics } from '../store/database.js';

// ── Main analytics fetch ────────────────────────────────────────────────────

export async function runFetch(lookbackDays = 7) {
  const platforms = getConfiguredPlatforms();
  console.log(`\n📊 ANALYTICS FETCH — ${platforms.length} platform(s), ${lookbackDays}-day lookback`);

  const results = { platforms, totalNew: 0, totalUpdated: 0, errors: [] };

  for (const platform of platforms) {
    try {
      const r = await fetchPlatformAnalytics(platform, lookbackDays);
      results.totalNew += r.posts;
      console.log(`  [${platform}] ✓ ${r.posts} posts, metrics saved`);
    } catch (err) {
      console.error(`  ✗ ${platform}: ${err.message}`);
      results.errors.push(`${platform}: ${err.message}`);
    }
    await sleep(500);
  }

  console.log(`\n✅ Analytics fetch complete — ${results.totalNew} posts collected`);
  return results;
}

async function fetchPlatformAnalytics(platform, lookbackDays) {
  switch (platform) {
    case 'instagram': return fetchInstagramAnalytics(lookbackDays);
    case 'facebook':  return fetchFacebookAnalytics(lookbackDays);
    case 'tiktok':    return fetchTikTokAnalytics(lookbackDays);
    case 'youtube':   return fetchYouTubeAnalytics(lookbackDays);
    case 'twitter':   return fetchTwitterAnalytics(lookbackDays);
    default: return { posts: 0 };
  }
}

// ── Instagram Analytics ─────────────────────────────────────────────────────

async function fetchInstagramAnalytics(lookbackDays) {
  const BASE = `https://graph.facebook.com/${config.meta.apiVersion}`;
  const token = config.meta.accessToken;
  const userId = config.meta.instagramUserId;
  let posts = 0;

  // Fetch recent media with insights
  const mediaRes = await axios.get(`${BASE}/${userId}/media`, {
    params: {
      fields: 'id,caption,media_type,timestamp,like_count,comments_count,permalink',
      limit: 50,
      access_token: token,
    },
  });

  const since = dayjs().subtract(lookbackDays, 'day');

  for (const media of (mediaRes.data?.data || [])) {
    if (dayjs(media.timestamp).isBefore(since)) continue;

    // Fetch per-post insights (impressions deprecated by Meta, use reach/saved/shares)
    let reach = 0, impressions = 0, saved = 0, shares = 0;
    try {
      const insightsRes = await axios.get(`${BASE}/${media.id}/insights`, {
        params: {
          metric: 'reach,saved,shares',
          access_token: token,
        },
      });
      for (const metric of (insightsRes.data?.data || [])) {
        if (metric.name === 'reach') reach = metric.values?.[0]?.value || 0;
        if (metric.name === 'saved') saved = metric.values?.[0]?.value || 0;
        if (metric.name === 'shares') shares = metric.values?.[0]?.value || 0;
      }
    } catch {
      // Insights may not be available for all media types
    }

    const totalEngagement = (media.like_count || 0) + (media.comments_count || 0) + saved + shares;

    upsertPost({
      id: `ig_${media.id}`,
      platform: 'instagram',
      post_type: (media.media_type || 'unknown').toLowerCase(),
      caption: (media.caption || '').slice(0, 500),
      published_at: media.timestamp,
      fetched_at: new Date().toISOString(),
      likes: media.like_count || 0,
      comments: media.comments_count || 0,
      shares,
      views: 0,
      saves: saved,
      reach,
      impressions,
      engagement_rate: reach > 0 ? (totalEngagement / reach * 100) : 0,
      raw_json: JSON.stringify(media),
    });
    posts++;
    await sleep(100);
  }

  // Fetch account-level insights
  try {
    const accountRes = await axios.get(`${BASE}/${userId}`, {
      params: {
        fields: 'followers_count,follows_count,media_count',
        access_token: token,
      },
    });

    upsertDailyMetrics({
      platform: 'instagram',
      date: dayjs().format('YYYY-MM-DD'),
      followers: accountRes.data?.followers_count || 0,
      following: accountRes.data?.follows_count || 0,
      posts_count: accountRes.data?.media_count || 0,
      total_reach: 0,
      total_impressions: 0,
      total_engagement: 0,
      profile_views: 0,
      website_clicks: 0,
      raw_json: JSON.stringify(accountRes.data),
    });
  } catch {
    // Account insights may require additional permissions
  }

  return { posts };
}

// ── Facebook Analytics ──────────────────────────────────────────────────────

async function fetchFacebookAnalytics(lookbackDays) {
  const BASE = `https://graph.facebook.com/${config.meta.apiVersion}`;
  const token = config.meta.accessToken;
  const pageId = config.meta.facebookPageId;
  let posts = 0;

  const postsRes = await axios.get(`${BASE}/${pageId}/posts`, {
    params: {
      fields: 'id,message,created_time',
      limit: 50,
      access_token: token,
    },
  });

  const since = dayjs().subtract(lookbackDays, 'day');

  for (const post of (postsRes.data?.data || [])) {
    if (dayjs(post.created_time).isBefore(since)) continue;

    const likes = 0;
    const comments = 0;
    const shares = 0;

    upsertPost({
      id: `fb_${post.id}`,
      platform: 'facebook',
      post_type: 'post',
      caption: (post.message || '').slice(0, 500),
      published_at: post.created_time,
      fetched_at: new Date().toISOString(),
      likes,
      comments,
      shares,
      views: 0,
      saves: 0,
      reach: 0,
      impressions: 0,
      engagement_rate: 0,
      raw_json: JSON.stringify(post),
    });
    posts++;
  }

  // Page-level metrics
  try {
    const pageRes = await axios.get(`${BASE}/${pageId}`, {
      params: {
        fields: 'fan_count,followers_count',
        access_token: token,
      },
    });

    upsertDailyMetrics({
      platform: 'facebook',
      date: dayjs().format('YYYY-MM-DD'),
      followers: pageRes.data?.followers_count || pageRes.data?.fan_count || 0,
      following: 0,
      posts_count: 0,
      total_reach: 0,
      total_impressions: 0,
      total_engagement: 0,
      profile_views: 0,
      website_clicks: 0,
      raw_json: JSON.stringify(pageRes.data),
    });
  } catch {
    // Page insights may require additional permissions
  }

  return { posts };
}

// ── TikTok Analytics ────────────────────────────────────────────────────────

async function fetchTikTokAnalytics(lookbackDays) {
  const BASE = 'https://open.tiktokapis.com/v2';
  const token = config.tiktok.accessToken;
  let posts = 0;

  const videosRes = await axios.post(`${BASE}/video/query/`, {}, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    params: {
      fields: 'id,video_description,create_time,like_count,comment_count,share_count,view_count',
    },
  });

  const since = dayjs().subtract(lookbackDays, 'day');

  for (const video of (videosRes.data?.data?.videos || [])) {
    const publishedAt = new Date(video.create_time * 1000).toISOString();
    if (dayjs(publishedAt).isBefore(since)) continue;

    const totalEngagement = (video.like_count || 0) + (video.comment_count || 0) + (video.share_count || 0);
    const views = video.view_count || 0;

    upsertPost({
      id: `tt_${video.id}`,
      platform: 'tiktok',
      post_type: 'video',
      caption: (video.video_description || '').slice(0, 500),
      published_at: publishedAt,
      fetched_at: new Date().toISOString(),
      likes: video.like_count || 0,
      comments: video.comment_count || 0,
      shares: video.share_count || 0,
      views,
      saves: 0,
      reach: 0,
      impressions: 0,
      engagement_rate: views > 0 ? (totalEngagement / views * 100) : 0,
      raw_json: JSON.stringify(video),
    });
    posts++;
  }

  return { posts };
}

// ── YouTube Analytics ───────────────────────────────────────────────────────

async function fetchYouTubeAnalytics(lookbackDays) {
  const apiKey = config.youtube.apiKey;
  const channelId = config.youtube.channelId;
  let posts = 0;

  // Get recent videos from the channel's uploads playlist
  const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: {
      key: apiKey,
      id: channelId,
      part: 'contentDetails,statistics',
    },
  });

  const uploadsPlaylistId = channelRes.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  const channelStats = channelRes.data?.items?.[0]?.statistics;

  if (channelStats) {
    upsertDailyMetrics({
      platform: 'youtube',
      date: dayjs().format('YYYY-MM-DD'),
      followers: parseInt(channelStats.subscriberCount || '0', 10),
      following: 0,
      posts_count: parseInt(channelStats.videoCount || '0', 10),
      total_reach: 0,
      total_impressions: 0,
      total_engagement: 0,
      profile_views: parseInt(channelStats.viewCount || '0', 10),
      website_clicks: 0,
      raw_json: JSON.stringify(channelStats),
    });
  }

  if (!uploadsPlaylistId) return { posts };

  const playlistRes = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
    params: {
      key: apiKey,
      playlistId: uploadsPlaylistId,
      part: 'snippet',
      maxResults: 20,
    },
  });

  const since = dayjs().subtract(lookbackDays, 'day');
  const videoIds = [];

  for (const item of (playlistRes.data?.items || [])) {
    if (dayjs(item.snippet?.publishedAt).isBefore(since)) continue;
    videoIds.push(item.snippet.resourceId.videoId);
  }

  if (videoIds.length === 0) return { posts };

  // Get video statistics
  const videosRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      key: apiKey,
      id: videoIds.join(','),
      part: 'snippet,statistics',
    },
  });

  for (const video of (videosRes.data?.items || [])) {
    const stats = video.statistics || {};
    const views = parseInt(stats.viewCount || '0', 10);
    const likes = parseInt(stats.likeCount || '0', 10);
    const comments = parseInt(stats.commentCount || '0', 10);

    upsertPost({
      id: `yt_${video.id}`,
      platform: 'youtube',
      post_type: 'video',
      caption: (video.snippet?.title || '').slice(0, 500),
      published_at: video.snippet?.publishedAt,
      fetched_at: new Date().toISOString(),
      likes,
      comments,
      shares: 0,
      views,
      saves: 0,
      reach: 0,
      impressions: 0,
      engagement_rate: views > 0 ? ((likes + comments) / views * 100) : 0,
      raw_json: JSON.stringify(video),
    });
    posts++;
  }

  return { posts };
}

// ── Twitter/X Analytics ─────────────────────────────────────────────────────

async function fetchTwitterAnalytics(lookbackDays) {
  const BASE = 'https://api.twitter.com/2';
  const userId = config.twitter.userId;
  let posts = 0;

  const tweetsRes = await axios.get(`${BASE}/users/${userId}/tweets`, {
    headers: { Authorization: `Bearer ${config.twitter.bearerToken}` },
    params: {
      max_results: 100,
      'tweet.fields': 'id,text,created_at,public_metrics',
      start_time: dayjs().subtract(lookbackDays, 'day').toISOString(),
    },
  });

  for (const tweet of (tweetsRes.data?.data || [])) {
    const m = tweet.public_metrics || {};
    const totalEngagement = (m.like_count || 0) + (m.reply_count || 0) + (m.retweet_count || 0) + (m.quote_count || 0);
    const impressions = m.impression_count || 0;

    upsertPost({
      id: `tw_${tweet.id}`,
      platform: 'twitter',
      post_type: 'tweet',
      caption: (tweet.text || '').slice(0, 500),
      published_at: tweet.created_at,
      fetched_at: new Date().toISOString(),
      likes: m.like_count || 0,
      comments: m.reply_count || 0,
      shares: (m.retweet_count || 0) + (m.quote_count || 0),
      views: impressions,
      saves: m.bookmark_count || 0,
      reach: 0,
      impressions,
      engagement_rate: impressions > 0 ? (totalEngagement / impressions * 100) : 0,
      raw_json: JSON.stringify(tweet),
    });
    posts++;
  }

  // User metrics
  try {
    const userRes = await axios.get(`${BASE}/users/${userId}`, {
      headers: { Authorization: `Bearer ${config.twitter.bearerToken}` },
      params: { 'user.fields': 'public_metrics' },
    });

    const um = userRes.data?.data?.public_metrics || {};
    upsertDailyMetrics({
      platform: 'twitter',
      date: dayjs().format('YYYY-MM-DD'),
      followers: um.followers_count || 0,
      following: um.following_count || 0,
      posts_count: um.tweet_count || 0,
      total_reach: 0,
      total_impressions: 0,
      total_engagement: 0,
      profile_views: 0,
      website_clicks: 0,
      raw_json: JSON.stringify(um),
    });
  } catch {
    // User metrics may require elevated access
  }

  return { posts };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
