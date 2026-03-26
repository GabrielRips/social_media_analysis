import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'analytics.db');

if (!existsSync(__dirname)) {
  mkdirSync(__dirname, { recursive: true });
}

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- ── Platform posts / content ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      post_type TEXT,                -- reel, image, video, story, tweet, etc.
      caption TEXT,
      published_at TEXT,
      fetched_at TEXT NOT NULL,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      saves INTEGER DEFAULT 0,
      reach INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      engagement_rate REAL DEFAULT 0,
      raw_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);
    CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);

    -- ── Daily platform-level metrics ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      date TEXT NOT NULL,
      followers INTEGER DEFAULT 0,
      following INTEGER DEFAULT 0,
      posts_count INTEGER DEFAULT 0,
      total_reach INTEGER DEFAULT 0,
      total_impressions INTEGER DEFAULT 0,
      total_engagement INTEGER DEFAULT 0,
      profile_views INTEGER DEFAULT 0,
      website_clicks INTEGER DEFAULT 0,
      raw_json TEXT,
      UNIQUE(platform, date)
    );

    -- ── Analysis results ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      analysis_date TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      summary TEXT,
      top_posts TEXT,                -- JSON array
      recommendations TEXT,          -- JSON array
      sentiment_breakdown TEXT,      -- JSON object
      raw_analysis TEXT,
      created_at TEXT NOT NULL
    );

    -- ── Run log ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      platforms TEXT,                 -- JSON array
      posts_new INTEGER DEFAULT 0,
      posts_updated INTEGER DEFAULT 0,
      analysis_summary TEXT,
      doc_success INTEGER DEFAULT 0,
      errors TEXT                     -- JSON array or null
    );
  `);
}

// ── Posts ────────────────────────────────────────────────────────────────────

export function upsertPost(post) {
  return getDb().prepare(`
    INSERT INTO posts (
      id, platform, post_type, caption, published_at, fetched_at,
      likes, comments, shares, views, saves, reach, impressions,
      engagement_rate, raw_json
    ) VALUES (
      @id, @platform, @post_type, @caption, @published_at, @fetched_at,
      @likes, @comments, @shares, @views, @saves, @reach, @impressions,
      @engagement_rate, @raw_json
    )
    ON CONFLICT(id) DO UPDATE SET
      likes = excluded.likes,
      comments = excluded.comments,
      shares = excluded.shares,
      views = excluded.views,
      saves = excluded.saves,
      reach = excluded.reach,
      impressions = excluded.impressions,
      engagement_rate = excluded.engagement_rate,
      fetched_at = excluded.fetched_at,
      raw_json = excluded.raw_json
  `).run(post);
}

export function getRecentPosts(platform, days = 7) {
  return getDb().prepare(`
    SELECT * FROM posts
    WHERE platform = ?
    AND published_at >= datetime('now', ?)
    ORDER BY published_at DESC
  `).all(platform, `-${days} days`);
}

// ── Daily Metrics ───────────────────────────────────────────────────────────

export function upsertDailyMetrics(metrics) {
  return getDb().prepare(`
    INSERT INTO daily_metrics (
      platform, date, followers, following, posts_count,
      total_reach, total_impressions, total_engagement,
      profile_views, website_clicks, raw_json
    ) VALUES (
      @platform, @date, @followers, @following, @posts_count,
      @total_reach, @total_impressions, @total_engagement,
      @profile_views, @website_clicks, @raw_json
    )
    ON CONFLICT(platform, date) DO UPDATE SET
      followers = excluded.followers,
      following = excluded.following,
      posts_count = excluded.posts_count,
      total_reach = excluded.total_reach,
      total_impressions = excluded.total_impressions,
      total_engagement = excluded.total_engagement,
      profile_views = excluded.profile_views,
      website_clicks = excluded.website_clicks,
      raw_json = excluded.raw_json
  `).run(metrics);
}

// ── Analyses ────────────────────────────────────────────────────────────────

export function saveAnalysis(analysis) {
  return getDb().prepare(`
    INSERT INTO analyses (
      platform, analysis_date, period_start, period_end,
      summary, top_posts, recommendations, sentiment_breakdown,
      raw_analysis, created_at
    ) VALUES (
      @platform, @analysis_date, @period_start, @period_end,
      @summary, @top_posts, @recommendations, @sentiment_breakdown,
      @raw_analysis, @created_at
    )
  `).run({
    ...analysis,
    top_posts: JSON.stringify(analysis.top_posts || []),
    recommendations: JSON.stringify(analysis.recommendations || []),
    sentiment_breakdown: JSON.stringify(analysis.sentiment_breakdown || {}),
    created_at: new Date().toISOString(),
  });
}

// ── Run Log ─────────────────────────────────────────────────────────────────

export function logRun({ platforms, postsNew, postsUpdated, analysisSummary, docSuccess, errors }) {
  return getDb().prepare(`
    INSERT INTO runs (started_at, completed_at, platforms, posts_new, posts_updated, analysis_summary, doc_success, errors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    new Date().toISOString(),
    new Date().toISOString(),
    JSON.stringify(platforms || []),
    postsNew || 0,
    postsUpdated || 0,
    analysisSummary || '',
    docSuccess ? 1 : 0,
    errors ? JSON.stringify(errors) : null,
  );
}
