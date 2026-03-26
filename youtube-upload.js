import { google } from 'googleapis';
import { config } from './config/index.js';
import fs from 'fs';
import path from 'path';

// ── YouTube Video Uploader ──────────────────────────────────────────────────
// Uses OAuth2 (refresh token) — service accounts cannot upload to channels.
// Required env vars: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN

function getOAuth2Client() {
  const { clientId, clientSecret, refreshToken } = config.youtube;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'YouTube upload requires YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN.\n' +
      'Run `node youtube-auth.mjs` to get a refresh token.'
    );
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

/**
 * Upload a video to YouTube.
 *
 * @param {object} opts
 * @param {string} opts.filePath        — Path to the video file
 * @param {string} opts.title           — Video title (max 100 chars)
 * @param {string} opts.description     — Video description (max 5000 chars)
 * @param {string[]} [opts.tags]        — Tags / keywords
 * @param {string} [opts.categoryId]    — YouTube category ID (default "22" = People & Blogs)
 * @param {string} [opts.privacyStatus] — "public" | "unlisted" | "private" (default "private")
 * @param {string} [opts.thumbnailPath] — Path to a custom thumbnail image
 * @param {boolean} [opts.notifySubscribers] — Notify subscribers (default true)
 * @returns {Promise<object>}           — YouTube API response with video id, status, snippet
 */
export async function uploadVideo({
  filePath,
  title,
  description,
  tags = [],
  categoryId = '22',
  privacyStatus = 'private',
  thumbnailPath,
  notifySubscribers = true,
}) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Video file not found: ${filePath}`);
  }

  const auth = getOAuth2Client();
  const youtube = google.youtube({ version: 'v3', auth });

  const fileSize = fs.statSync(filePath).size;
  console.log(`\n▶ Uploading "${title}" (${(fileSize / 1024 / 1024).toFixed(1)} MB)...`);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    notifySubscribers,
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId,
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(filePath),
    },
  });

  const videoId = res.data.id;
  console.log(`  ✅ Uploaded — https://youtu.be/${videoId}`);
  console.log(`  Status: ${res.data.status.uploadStatus} / ${res.data.status.privacyStatus}`);

  // Upload custom thumbnail if provided
  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    console.log(`  📷 Setting custom thumbnail...`);
    await youtube.thumbnails.set({
      videoId,
      media: {
        mimeType: 'image/png',
        body: fs.createReadStream(thumbnailPath),
      },
    });
    console.log(`  ✅ Thumbnail set`);
  }

  return res.data;
}

// ── CLI usage ───────────────────────────────────────────────────────────────
// node youtube-upload.js --file video.mp4 --title "My Video" --description "About this video" --privacy unlisted

const args = process.argv.slice(2);
if (args.includes('--file')) {
  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const file = getArg('--file');
  const title = getArg('--title') || path.basename(file, path.extname(file));
  const description = getArg('--description') || '';
  const privacy = getArg('--privacy') || 'private';
  const thumbnail = getArg('--thumbnail');
  const tagsRaw = getArg('--tags');
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()) : [];

  uploadVideo({
    filePath: file,
    title,
    description,
    tags,
    privacyStatus: privacy,
    thumbnailPath: thumbnail,
  })
    .then((data) => {
      console.log(`\nDone — video ID: ${data.id}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\n✗ Upload failed: ${err.message}`);
      process.exit(1);
    });
}
