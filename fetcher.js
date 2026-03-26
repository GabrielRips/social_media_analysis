import axios from 'axios';
import { config, getConfiguredPlatforms } from '../config/index.js';
import { upsertMessage, getCursor, setCursor } from '../store/inbox-database.js';
import dayjs from 'dayjs';

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function fetchInbox() {
  const platforms = getConfiguredPlatforms();
  console.log(`\n📬 INBOX FETCH — ${platforms.length} platform(s)`);

  const results = { totalNew: 0, byPlatform: {}, errors: [] };

  for (const platform of platforms) {
    try {
      const r = await fetchPlatformInbox(platform);
      results.totalNew += r.total;
      results.byPlatform[platform] = r;
    } catch (err) {
      console.error(`  ✗ ${platform}: ${err.message}`);
      results.errors.push(`${platform}: ${err.message}`);
    }
    await sleep(500);
  }

  console.log(`\n✅ Inbox fetch complete — ${results.totalNew} new messages`);
  return results;
}

async function fetchPlatformInbox(platform) {
  switch (platform) {
    case 'instagram': return fetchInstagramInbox();
    case 'facebook':  return fetchFacebookInbox();
    case 'tiktok':    return fetchTikTokComments();
    case 'youtube':   return fetchYouTubeComments();
    case 'twitter':   return fetchTwitterInbox();
    default: return { total: 0 };
  }
}

// ── Instagram ────────────────────────────────────────────────────────────────
// Requires: instagram_manage_comments, instagram_manage_messages permissions

async function fetchInstagramInbox() {
  const BASE = `https://graph.facebook.com/${config.meta.apiVersion}`;
  const token = config.meta.accessToken;
  const userId = config.meta.instagramUserId;
  let total = 0;

  console.log('  [Instagram] Fetching comments + DMs...');

  // ── Comments ──
  // Get recent media first, then comments per post
  const mediaRes = await axios.get(`${BASE}/${userId}/media`, {
    params: { fields: 'id,caption,timestamp', limit: 20, access_token: token },
  });

  for (const media of (mediaRes.data?.data || [])) {
    const commentsRes = await axios.get(`${BASE}/${media.id}/comments`, {
      params: {
        fields: 'id,text,username,timestamp,from',
        since: dayjs().subtract(7, 'day').unix(),
        access_token: token,
      },
    });

    for (const comment of (commentsRes.data?.data || [])) {
      upsertMessage({
        id: `ig_comment_${comment.id}`,
        platform: 'instagram',
        message_type: 'comment',
        post_id: media.id,
        post_caption: (media.caption || '').slice(0, 200),
        author_id: comment.from?.id || '',
        author_username: comment.username || comment.from?.username || '',
        author_name: comment.from?.name || '',
        body: comment.text || '',
        received_at: comment.timestamp,
        fetched_at: new Date().toISOString(),
        raw_json: JSON.stringify(comment),
      });
      total++;
    }
    await sleep(150);
  }

  // ── DMs (Messenger API for Instagram) ──
  const conversationsRes = await axios.get(`${BASE}/${userId}/conversations`, {
    params: {
      fields: 'id,participants,updated_time,messages{id,message,from,created_time}',
      platform: 'instagram',
      access_token: token,
    },
  });

  for (const convo of (conversationsRes.data?.data || [])) {
    for (const msg of (convo.messages?.data || [])) {
      // Skip messages sent by us (from the page)
      if (msg.from?.id === userId) continue;

      const cursor = getCursor('instagram', 'dms');
      if (cursor && msg.created_time <= cursor) continue;

      upsertMessage({
        id: `ig_dm_${msg.id}`,
        platform: 'instagram',
        message_type: 'dm',
        post_id: null,
        post_caption: null,
        author_id: msg.from?.id || '',
        author_username: msg.from?.username || '',
        author_name: msg.from?.name || '',
        body: msg.message || '',
        received_at: msg.created_time,
        fetched_at: new Date().toISOString(),
        raw_json: JSON.stringify({ msg, conversation_id: convo.id }),
      });
      total++;
    }
  }

  setCursor('instagram', 'dms', new Date().toISOString());
  console.log(`  [Instagram] ✓ ${total} messages`);
  return { total };
}

// ── Facebook ─────────────────────────────────────────────────────────────────

async function fetchFacebookInbox() {
  const BASE = `https://graph.facebook.com/${config.meta.apiVersion}`;
  const token = config.meta.accessToken;
  const pageId = config.meta.facebookPageId;
  let total = 0;

  console.log('  [Facebook] Fetching comments + DMs...');

  // ── Comments on posts ──
  const postsRes = await axios.get(`${BASE}/${pageId}/posts`, {
    params: { fields: 'id,message,created_time', limit: 20, access_token: token },
  });

  for (const post of (postsRes.data?.data || [])) {
    const commentsRes = await axios.get(`${BASE}/${post.id}/comments`, {
      params: {
        fields: 'id,message,from,created_time',
        filter: 'stream',
        access_token: token,
      },
    });

    for (const comment of (commentsRes.data?.data || [])) {
      upsertMessage({
        id: `fb_comment_${comment.id}`,
        platform: 'facebook',
        message_type: 'comment',
        post_id: post.id,
        post_caption: (post.message || '').slice(0, 200),
        author_id: comment.from?.id || '',
        author_username: comment.from?.name || '',
        author_name: comment.from?.name || '',
        body: comment.message || '',
        received_at: comment.created_time,
        fetched_at: new Date().toISOString(),
        raw_json: JSON.stringify(comment),
      });
      total++;
    }
    await sleep(150);
  }

  // ── Messenger DMs ──
  const inboxRes = await axios.get(`${BASE}/${pageId}/conversations`, {
    params: {
      fields: 'id,participants,updated_time,messages{id,message,from,created_time}',
      access_token: token,
    },
  });

  const cursor = getCursor('facebook', 'dms');

  for (const convo of (inboxRes.data?.data || [])) {
    for (const msg of (convo.messages?.data || [])) {
      if (msg.from?.id === pageId) continue;
      if (cursor && msg.created_time <= cursor) continue;

      upsertMessage({
        id: `fb_dm_${msg.id}`,
        platform: 'facebook',
        message_type: 'dm',
        post_id: null,
        post_caption: null,
        author_id: msg.from?.id || '',
        author_username: msg.from?.name || '',
        author_name: msg.from?.name || '',
        body: msg.message || '',
        received_at: msg.created_time,
        fetched_at: new Date().toISOString(),
        raw_json: JSON.stringify({ msg, conversation_id: convo.id }),
      });
      total++;
    }
  }

  setCursor('facebook', 'dms', new Date().toISOString());
  console.log(`  [Facebook] ✓ ${total} messages`);
  return { total };
}

// ── TikTok ───────────────────────────────────────────────────────────────────
// Note: TikTok API does not support DMs — comments only

async function fetchTikTokComments() {
  const BASE = 'https://open.tiktokapis.com/v2';
  const token = config.tiktok.accessToken;
  let total = 0;

  console.log('  [TikTok] Fetching comments (no DM API available)...');

  // Get recent video IDs first
  const videosRes = await axios.post(`${BASE}/video/query/`, {}, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    params: { fields: 'id,video_description,create_time' },
  });

  const videos = (videosRes.data?.data?.videos || []).slice(0, 10);

  for (const video of videos) {
    const commentsRes = await axios.get(`${BASE}/comment/list/`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        video_id: video.id,
        fields: 'id,text,create_time,like_count,reply_count,user',
        max_count: 50,
      },
    });

    for (const comment of (commentsRes.data?.data?.comments || [])) {
      upsertMessage({
        id: `tt_comment_${comment.id}`,
        platform: 'tiktok',
        message_type: 'comment',
        post_id: video.id,
        post_caption: (video.video_description || '').slice(0, 200),
        author_id: comment.user?.open_id || '',
        author_username: comment.user?.display_name || '',
        author_name: comment.user?.display_name || '',
        body: comment.text || '',
        received_at: new Date(comment.create_time * 1000).toISOString(),
        fetched_at: new Date().toISOString(),
        raw_json: JSON.stringify(comment),
      });
      total++;
    }
    await sleep(200);
  }

  console.log(`  [TikTok] ✓ ${total} comments`);
  return { total };
}

// ── YouTube ──────────────────────────────────────────────────────────────────
// Note: YouTube has no DM system

async function fetchYouTubeComments() {
  const apiKey = config.youtube.apiKey;
  const channelId = config.youtube.channelId;
  let total = 0;

  console.log('  [YouTube] Fetching comments...');

  const commentsRes = await axios.get('https://www.googleapis.com/youtube/v3/commentThreads', {
    params: {
      key: apiKey,
      allThreadsRelatedToChannelId: channelId,
      part: 'snippet',
      maxResults: 100,
      order: 'time',
      moderationStatus: 'published',
    },
  });

  for (const thread of (commentsRes.data?.items || [])) {
    const top = thread.snippet?.topLevelComment?.snippet;
    if (!top) continue;

    upsertMessage({
      id: `yt_comment_${thread.id}`,
      platform: 'youtube',
      message_type: 'comment',
      post_id: thread.snippet.videoId,
      post_caption: thread.snippet.videoId, // We use video ID as reference
      author_id: top.authorChannelId?.value || '',
      author_username: top.authorDisplayName || '',
      author_name: top.authorDisplayName || '',
      body: top.textOriginal || top.textDisplay || '',
      received_at: top.publishedAt,
      fetched_at: new Date().toISOString(),
      raw_json: JSON.stringify(thread),
    });
    total++;
  }

  console.log(`  [YouTube] ✓ ${total} comments`);
  return { total };
}

// ── Twitter/X ────────────────────────────────────────────────────────────────

async function fetchTwitterInbox() {
  const BASE = 'https://api.twitter.com/2';
  const userId = config.twitter.userId;
  let total = 0;

  console.log('  [Twitter/X] Fetching mentions + DMs...');

  // ── Mentions (comments/replies) ──
  const mentionsRes = await axios.get(`${BASE}/users/${userId}/mentions`, {
    headers: { Authorization: `Bearer ${config.twitter.bearerToken}` },
    params: {
      max_results: 100,
      'tweet.fields': 'id,text,created_at,author_id,conversation_id,in_reply_to_user_id',
      'user.fields': 'id,username,name',
      expansions: 'author_id',
      start_time: dayjs().subtract(7, 'day').toISOString(),
    },
  });

  const usersMap = {};
  for (const user of (mentionsRes.data?.includes?.users || [])) {
    usersMap[user.id] = user;
  }

  for (const tweet of (mentionsRes.data?.data || [])) {
    const author = usersMap[tweet.author_id] || {};
    upsertMessage({
      id: `tw_mention_${tweet.id}`,
      platform: 'twitter',
      message_type: 'comment',
      post_id: tweet.conversation_id || null,
      post_caption: null,
      author_id: tweet.author_id,
      author_username: author.username || '',
      author_name: author.name || '',
      body: tweet.text || '',
      received_at: tweet.created_at,
      fetched_at: new Date().toISOString(),
      raw_json: JSON.stringify(tweet),
    });
    total++;
  }

  // ── DMs ──
  // Requires user context auth (OAuth 1.0a)
  try {
    const dmsRes = await axios.get(`${BASE}/dm_conversations`, {
      headers: { Authorization: buildOAuthHeader('GET', `${BASE}/dm_conversations`) },
      params: {
        'dm_event.fields': 'id,text,created_at,sender_id,conversation_id',
        expansions: 'sender_id',
        'user.fields': 'id,username,name',
        max_results: 50,
      },
    });

    const dmUsersMap = {};
    for (const user of (dmsRes.data?.includes?.users || [])) {
      dmUsersMap[user.id] = user;
    }

    const cursor = getCursor('twitter', 'dms');

    for (const event of (dmsRes.data?.data || [])) {
      if (event.sender_id === userId) continue; // Skip our own sent DMs
      if (cursor && event.created_at <= cursor) continue;

      const sender = dmUsersMap[event.sender_id] || {};
      upsertMessage({
        id: `tw_dm_${event.id}`,
        platform: 'twitter',
        message_type: 'dm',
        post_id: null,
        post_caption: null,
        author_id: event.sender_id,
        author_username: sender.username || '',
        author_name: sender.name || '',
        body: event.text || '',
        received_at: event.created_at,
        fetched_at: new Date().toISOString(),
        raw_json: JSON.stringify(event),
      });
      total++;
    }

    setCursor('twitter', 'dms', new Date().toISOString());
  } catch (err) {
    console.warn('  [Twitter/X] DM fetch requires OAuth 1.0a — check credentials');
  }

  console.log(`  [Twitter/X] ✓ ${total} messages`);
  return { total };
}

// ── OAuth 1.0a helper (Twitter DMs require user-context auth) ─────────────────

function buildOAuthHeader(method, url) {
  // Simplified — for production use the 'oauth-1.0a' npm package
  // This is a placeholder that signals the need for proper OAuth signing
  const { apiKey, apiSecret, accessToken, accessSecret } = config.twitter;
  // In real implementation: use oauth-1.0a library to sign the request
  return `OAuth oauth_consumer_key="${apiKey}", oauth_token="${accessToken}"`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
