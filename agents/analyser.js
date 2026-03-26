import Anthropic from '@anthropic-ai/sdk';
import dayjs from 'dayjs';
import { config, getConfiguredPlatforms } from '../config/index.js';
import { getRecentPosts, saveAnalysis, getDb } from '../store/database.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// Strip lone surrogates & control chars that break JSON serialisation
function sanitize(s) {
  if (!s) return '';
  return s.replace(/[\uD800-\uDFFF]/gu, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// ── Run analysis across all configured platforms ────────────────────────────

export async function runAnalysis(lookbackDays = 7) {
  const platforms = getConfiguredPlatforms();
  console.log(`\n🧠 ANALYSIS — ${platforms.length} platform(s)`);

  const results = [];

  for (const platform of platforms) {
    try {
      const analysis = await analysePlatform(platform, lookbackDays);
      if (analysis) {
        results.push(analysis);
        console.log(`  [${platform}] ✓ Analysis complete`);
      } else {
        console.log(`  [${platform}] ⚠ No data to analyse`);
      }
    } catch (err) {
      console.error(`  ✗ ${platform}: ${err.message}`);
    }
  }

  console.log(`\n✅ Analysis complete — ${results.length} platform(s) analysed`);
  return results;
}

// ── Analyse a single platform ───────────────────────────────────────────────

async function analysePlatform(platform, lookbackDays) {
  const posts = getRecentPosts(platform, lookbackDays);

  if (posts.length === 0) return null;

  // Get daily metrics for context
  const db = getDb();
  const metrics = db.prepare(`
    SELECT * FROM daily_metrics
    WHERE platform = ?
    ORDER BY date DESC
    LIMIT 14
  `).all(platform);

  const periodStart = dayjs().subtract(lookbackDays, 'day').format('YYYY-MM-DD');
  const periodEnd = dayjs().format('YYYY-MM-DD');

  // Sort posts by engagement for top-performers
  const sortedPosts = [...posts].sort((a, b) => {
    const engA = (a.likes || 0) + (a.comments || 0) + (a.shares || 0);
    const engB = (b.likes || 0) + (b.comments || 0) + (b.shares || 0);
    return engB - engA;
  });

  const topPosts = sortedPosts.slice(0, 5);
  const totalLikes = posts.reduce((s, p) => s + (p.likes || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.comments || 0), 0);
  const totalShares = posts.reduce((s, p) => s + (p.shares || 0), 0);
  const totalViews = posts.reduce((s, p) => s + (p.views || 0), 0);
  const avgEngagement = posts.length > 0
    ? ((totalLikes + totalComments + totalShares) / posts.length).toFixed(1)
    : 0;

  const prompt = buildAnalysisPrompt({
    platform,
    periodStart,
    periodEnd,
    posts,
    topPosts,
    metrics,
    stats: { totalLikes, totalComments, totalShares, totalViews, avgEngagement },
  });

  // Sanitize the entire prompt to strip lone surrogates from DB data
  const safePrompt = sanitize(prompt);

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{ role: 'user', content: safePrompt }],
  });

  const text = res.content[0]?.text || '';
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = {
      summary: text.slice(0, 500),
      top_posts: [],
      recommendations: [text],
      sentiment_breakdown: {},
    };
  }

  const analysis = {
    platform,
    analysis_date: dayjs().format('YYYY-MM-DD'),
    period_start: periodStart,
    period_end: periodEnd,
    summary: parsed.summary || '',
    top_posts: parsed.top_posts || topPosts.map(p => ({
      id: p.id,
      caption: sanitize(p.caption).slice(0, 100),
      likes: p.likes,
      comments: p.comments,
      views: p.views,
    })),
    recommendations: parsed.recommendations || [],
    sentiment_breakdown: parsed.sentiment_breakdown || {},
    raw_analysis: text,
  };

  saveAnalysis(analysis);

  return analysis;
}

// ── Build Claude prompt ─────────────────────────────────────────────────────

function buildAnalysisPrompt({ platform, periodStart, periodEnd, posts, topPosts, metrics, stats }) {
  return `You are a social media analyst for Third Wave BBQ, an Australian BBQ restaurant brand with 200M+ monthly views across platforms.

Analyse this ${platform} performance data for the period ${periodStart} to ${periodEnd}.

## AGGREGATE STATS
- Total posts in period: ${posts.length}
- Total likes: ${stats.totalLikes}
- Total comments: ${stats.totalComments}
- Total shares: ${stats.totalShares}
- Total views: ${stats.totalViews}
- Average engagement per post: ${stats.avgEngagement}

## TOP 5 PERFORMING POSTS
${topPosts.map((p, i) => `${i + 1}. [${p.post_type}] "${sanitize(p.caption).slice(0, 120)}"
   Likes: ${p.likes} | Comments: ${p.comments} | Shares: ${p.shares} | Views: ${p.views}
   Engagement rate: ${p.engagement_rate?.toFixed(2) || 0}%`).join('\n')}

## ACCOUNT METRICS (last 14 days)
${metrics.map(m => `${m.date}: ${m.followers} followers`).join('\n') || 'No historical metrics available yet'}

## ALL POSTS (for content pattern analysis)
${posts.map(p => `- [${p.post_type}] "${sanitize(p.caption).slice(0, 80)}" — ${p.likes}❤️ ${p.comments}💬 ${p.views}👁️`).join('\n')}

Respond with JSON only:
{
  "summary": "2-3 paragraph executive summary of performance",
  "top_posts": [
    { "caption_preview": "...", "why_it_worked": "..." }
  ],
  "recommendations": [
    "Actionable recommendation 1",
    "Actionable recommendation 2",
    "Actionable recommendation 3"
  ],
  "content_patterns": {
    "best_performing_type": "reels|images|videos|etc",
    "best_posting_time": "if discernible from data",
    "topics_that_resonate": ["topic1", "topic2"]
  },
  "sentiment_breakdown": {
    "positive": 0,
    "neutral": 0,
    "negative": 0
  },
  "growth_trend": "growing|stable|declining",
  "week_over_week_notes": "any notable changes"
}`;
}
