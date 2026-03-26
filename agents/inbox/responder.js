import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { TWB_KNOWLEDGE } from '../../knowledge/twb.js';
import {
  getPendingMessages,
  updateMessageClassification,
  markMessageSent,
  createEscalation,
  getRelevantExamples,
  addLearnedExample,
} from '../../store/inbox-database.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// ── Classification prompt ─────────────────────────────────────────────────────

function buildClassificationPrompt(message) {
  return `You are a message classifier for Third Wave BBQ, an Australian BBQ restaurant brand.

Classify this incoming ${message.message_type} from ${message.platform}:

AUTHOR: @${message.author_username}
PLATFORM: ${message.platform}
TYPE: ${message.message_type}
POST CONTEXT: ${message.post_caption || 'N/A (direct message)'}
MESSAGE: "${message.body}"

AUTO-ESCALATE immediately (respond with "escalate") if the message contains ANY of:
${TWB_KNOWLEDGE.escalationRules.autoEscalate.map(r => `- ${r}`).join('\n')}

HANDLE AUTOMATICALLY (respond with "simple") if it's clearly one of:
${TWB_KNOWLEDGE.escalationRules.autoHandle.map(r => `- ${r}`).join('\n')}

MARK AS COMPLEX (respond with "complex") if it:
- Requires specific venue/booking information we can't confirm
- Is ambiguous and could go either direction
- Is a detailed question requiring nuanced judgment
- Seems like a genuine customer concern that needs care (but isn't an escalation)

IGNORE (respond with "ignore") if it:
- Is clearly spam or a bot
- Is not in English and cannot be understood
- Is a tagged friend with no question (e.g. "@friend look at this")
- Is an emoji-only reaction with no text content needing a reply

Respond with JSON only:
{
  "classification": "simple|complex|escalate|ignore",
  "reason": "One sentence explaining the classification",
  "topic_tags": ["array", "of", "topic", "keywords"],
  "sentiment": "positive|neutral|negative",
  "urgency": "low|medium|high"
}`;
}

// ── Response generation prompt ────────────────────────────────────────────────

function buildResponsePrompt(message, classification, examples) {
  const examplesSection = examples.length > 0
    ? `\n## LEARNED EXAMPLES FROM PAST RESPONSES\n(These are real responses that were approved or corrected by the TWB team. Mirror this style and approach.)\n\n${examples.map((ex, i) =>
      `Example ${i + 1}:\nCustomer: "${ex.original_message}"\nTWB Response: "${ex.final_response}"`
    ).join('\n\n')}\n`
    : '';

  return `You are a social media responder for Third Wave BBQ, an Australian BBQ restaurant brand.

## BRAND VOICE
Tone: ${TWB_KNOWLEDGE.brandVoice.tone}
Do use: ${TWB_KNOWLEDGE.brandVoice.doUse.join(', ')}
Do NOT use: ${TWB_KNOWLEDGE.brandVoice.doNotUse.join(', ')}
Max length: ${TWB_KNOWLEDGE.brandVoice.maxLength}

## BUSINESS KNOWLEDGE
Venues: ${TWB_KNOWLEDGE.venues.filter(v => v.status === 'open').map(v => v.name).join(', ')} (all Melbourne)
Opening soon: ${TWB_KNOWLEDGE.venues.filter(v => v.status === 'opening_soon').map(v => v.name).join(', ') || 'None'}
Specials: ${TWB_KNOWLEDGE.menu.specials.join(', ')}
Bookings: ${TWB_KNOWLEDGE.bookings.method}

## COMMON FAQs
${TWB_KNOWLEDGE.commonFAQs.map(faq => `Q: ${faq.question}\nA: ${faq.answer}`).join('\n\n')}
${examplesSection}
## MESSAGE TO RESPOND TO
Platform: ${message.platform} (${message.message_type})
Author: @${message.author_username}
Post context: ${message.post_caption || 'N/A — direct message'}
Message: "${message.body}"
Classification: ${classification.classification} — ${classification.reason}

## INSTRUCTIONS
- Write a natural, on-brand response
- For comments: keep it under 3 sentences, punchy and genuine
- For DMs: can be slightly longer but still concise
- Do NOT start with "Hey" or "Hi [name]" — get straight to the value
- Do NOT use "Thanks for reaching out" or similar corporate openers
- Do NOT promise anything specific about wait times, prices, or availability
- If directing to a venue, say "your nearest venue" or name the specific venue only if it's clear from context
- End comments with a natural sign-off (no need for "— The TWB Team" on short comment replies; use it for DMs)

Respond with JSON only:
{
  "response_text": "The actual response to post",
  "confidence": "high|medium|low",
  "confidence_reason": "Why you are or aren't confident in this response"
}`;
}

// ── Main processing loop ──────────────────────────────────────────────────────

export async function processInbox() {
  const messages = getPendingMessages(100);
  console.log(`\n🤖 RESPONDER — Processing ${messages.length} pending messages`);

  if (messages.length === 0) {
    console.log('  No pending messages.');
    return { processed: 0, autoResponded: 0, flagged: 0, escalated: 0, ignored: 0 };
  }

  const stats = { processed: 0, autoResponded: 0, flagged: 0, escalated: 0, ignored: 0 };

  for (const message of messages) {
    try {
      await processMessage(message, stats);
    } catch (err) {
      console.error(`  ✗ Failed to process ${message.id}: ${err.message}`);
    }
    await sleep(300); // Gentle rate limiting
  }

  console.log(`\n✅ Inbox processed:`);
  console.log(`   Auto-responded: ${stats.autoResponded}`);
  console.log(`   Flagged for review: ${stats.flagged}`);
  console.log(`   Escalated: ${stats.escalated}`);
  console.log(`   Ignored: ${stats.ignored}`);

  return stats;
}

async function processMessage(message, stats) {
  // Step 1: Classify
  const classification = await classifyMessage(message);

  if (classification.classification === 'ignore') {
    updateMessageClassification(message.id, 'ignore', classification.reason, null);
    stats.ignored++;
    return;
  }

  if (classification.classification === 'escalate') {
    updateMessageClassification(message.id, 'escalate', classification.reason, null);
    createEscalation(message.id, message.platform, classification.reason);
    console.log(`  🚨 Escalated: @${message.author_username} — ${classification.reason}`);
    stats.escalated++;
    return;
  }

  // Step 2: Generate response (for both simple and complex)
  const examples = getRelevantExamples(
    message.platform,
    message.message_type,
    classification.topic_tags || [],
    8
  );

  const response = await generateResponse(message, classification, examples);

  if (classification.classification === 'simple' && response.confidence === 'high') {
    // Auto-respond
    const sent = await sendResponse(message, response.response_text);
    if (sent) {
      updateMessageClassification(message.id, 'simple', classification.reason, response.response_text);
      markMessageSent(message.id, response.response_text, 'agent');

      // Add to learned examples immediately (approved-as-sent)
      addLearnedExample({
        message_id: message.id,
        platform: message.platform,
        message_type: message.message_type,
        original_message: message.body,
        final_response: response.response_text,
        topic_tags: classification.topic_tags || [],
        was_correction: 0,
        correction_delta: null,
      });

      console.log(`  ✅ Auto-responded: @${message.author_username} (${message.platform})`);
      stats.autoResponded++;
    }
  } else {
    // Flag for human review (complex, or simple with low/medium confidence)
    updateMessageClassification(message.id, classification.classification, classification.reason, response.response_text);
    console.log(`  🔍 Flagged: @${message.author_username} — ${classification.reason} (confidence: ${response.confidence})`);
    stats.flagged++;
  }

  stats.processed++;
}

// ── Classification call ───────────────────────────────────────────────────────

async function classifyMessage(message) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: buildClassificationPrompt(message) }],
  });

  const text = res.content[0]?.text || '';
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    return { classification: 'complex', reason: 'Could not parse classification — defaulting to manual review', topic_tags: [] };
  }
}

// ── Response generation call ──────────────────────────────────────────────────

async function generateResponse(message, classification, examples) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: buildResponsePrompt(message, classification, examples) }],
  });

  const text = res.content[0]?.text || '';
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    return {
      response_text: text.trim(),
      confidence: 'low',
      confidence_reason: 'JSON parse failed — raw response used',
    };
  }
}

// ── Send response via platform API ───────────────────────────────────────────

async function sendResponse(message, responseText) {
  try {
    switch (message.platform) {
      case 'instagram': console.log('  ⏸ IG auto-reply disabled — flagging instead'); return false;
      case 'facebook':  console.log('  ⏸ FB auto-reply disabled — flagging instead'); return false;
      case 'tiktok':    console.log('  ⏸ TT auto-reply disabled — flagging instead'); return false;
      case 'youtube':   console.log('  ⏸ YT auto-reply disabled — flagging instead'); return false;
      case 'twitter':   console.log('  ⏸ TW auto-reply disabled — flagging instead'); return false;
      default:
        console.warn(`  No send handler for platform: ${message.platform}`);
        return false;
    }
  } catch (err) {
    console.error(`  ✗ Send failed for ${message.id}: ${err.message}`);
    return false;
  }
}

async function sendInstagramResponse(message, text) {
  const BASE = `https://graph.facebook.com/${config.meta.apiVersion}`;
  const token = config.meta.accessToken;

  if (message.message_type === 'comment') {
    // Extract original comment ID from our prefixed ID
    const commentId = message.id.replace('ig_comment_', '');
    await axios.post(`${BASE}/${commentId}/replies`, null, {
      params: { message: text, access_token: token },
    });
  } else {
    // DM — send via Messenger API
    const raw = JSON.parse(message.raw_json || '{}');
    const recipientId = message.author_id;
    await axios.post(`${BASE}/me/messages`, {
      recipient: { id: recipientId },
      message: { text },
    }, { params: { access_token: token } });
  }
  return true;
}

async function sendFacebookResponse(message, text) {
  const BASE = `https://graph.facebook.com/${config.meta.apiVersion}`;
  const token = config.meta.accessToken;

  if (message.message_type === 'comment') {
    const commentId = message.id.replace('fb_comment_', '');
    await axios.post(`${BASE}/${commentId}/comments`, null, {
      params: { message: text, access_token: token },
    });
  } else {
    const recipientId = message.author_id;
    await axios.post(`${BASE}/me/messages`, {
      recipient: { id: recipientId },
      message: { text },
    }, { params: { access_token: token } });
  }
  return true;
}

async function sendTikTokResponse(message, text) {
  const BASE = 'https://open.tiktokapis.com/v2';
  const commentId = message.id.replace('tt_comment_', '');
  const videoId = message.post_id;

  await axios.post(`${BASE}/comment/reply/`, {
    video_id: videoId,
    parent_comment_id: commentId,
    text,
  }, {
    headers: { Authorization: `Bearer ${config.tiktok.accessToken}` },
  });
  return true;
}

async function sendYouTubeResponse(message, text) {
  const { google } = await import('googleapis');
  const auth = new google.auth.JWT(
    config.youtube.serviceAccountEmail,
    null,
    config.youtube.serviceAccountKey,
    ['https://www.googleapis.com/auth/youtube.force-ssl']
  );

  const youtube = google.youtube({ version: 'v3', auth });
  const threadId = message.id.replace('yt_comment_', '');

  await youtube.comments.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        parentId: threadId,
        textOriginal: text,
      },
    },
  });
  return true;
}

async function sendTwitterResponse(message, text) {
  const BASE = 'https://api.twitter.com/2';
  // Reply to tweet
  const tweetId = message.id.replace('tw_mention_', '').replace('tw_dm_', '');

  if (message.message_type === 'comment') {
    await axios.post(`${BASE}/tweets`, {
      text,
      reply: { in_reply_to_tweet_id: tweetId },
    }, {
      headers: { Authorization: `Bearer ${config.twitter.bearerToken}` },
    });
  }
  // DM sending via Twitter requires OAuth 1.0a — handled separately
  return true;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// We need axios for the send functions — import at top
import axios from 'axios';
