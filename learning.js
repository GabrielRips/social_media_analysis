import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import {
  getFlaggedMessages,
  markMessageCorrected,
  addLearnedExample,
  getLearningStats,
  getInboxDb,
} from '../../store/inbox-database.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// ── Process a human correction ────────────────────────────────────────────────
// Called when a human reviews a flagged message and either:
//   a) Approves the draft as-is
//   b) Edits the draft and sends the corrected version

export async function processCorrection(messageId, finalResponse, correctionNotes = '') {
  const db = getInboxDb();
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);

  if (!message) {
    throw new Error(`Message ${messageId} not found`);
  }

  const wasEdited = finalResponse.trim() !== (message.draft_response || '').trim();

  // Save the correction
  markMessageCorrected(messageId, finalResponse, correctionNotes);

  // Extract topic tags using Claude if we don't have them
  const topicTags = await extractTopicTags(message.body, finalResponse);

  // Compute what changed (for the correction delta)
  let correctionDelta = null;
  if (wasEdited && message.draft_response) {
    correctionDelta = JSON.stringify({
      original_draft: message.draft_response,
      human_final: finalResponse,
      notes: correctionNotes,
    });
  }

  // Add to learned examples
  addLearnedExample({
    message_id: messageId,
    platform: message.platform,
    message_type: message.message_type,
    original_message: message.body,
    final_response: finalResponse,
    topic_tags: topicTags,
    was_correction: wasEdited ? 1 : 0,
    correction_delta: correctionDelta,
  });

  console.log(`📚 Learned: ${wasEdited ? 'Correction' : 'Approval'} stored for ${message.platform} ${message.message_type}`);
  console.log(`   Tags: ${topicTags.join(', ')}`);

  return { learned: true, wasEdited, topicTags };
}

// ── Extract topic tags for a message/response pair ────────────────────────────

async function extractTopicTags(message, response) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Extract 2-5 concise topic tags for this restaurant social media message/response pair.
Tags should describe the TOPIC (not sentiment). Examples: booking, hours, menu, allergy, catering, compliment, ayce_tuesday, franchise, delivery, birthday_voucher, new_venue, general_question.

Message: "${message}"
Response: "${response}"

Respond with JSON only: { "tags": ["tag1", "tag2"] }`,
    }],
  });

  const text = res.content[0]?.text || '';
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    return JSON.parse(clean).tags || [];
  } catch {
    return ['general'];
  }
}

// ── Bulk process all approved/corrected flagged messages ──────────────────────
// Run this to catch up on any corrections that were made outside the UI

export async function syncLearningFromHistory() {
  const db = getInboxDb();

  // Find sent messages with human edits that haven't been added as examples yet
  const unprocessed = db.prepare(`
    SELECT m.* FROM messages m
    LEFT JOIN learned_examples le ON le.message_id = m.id
    WHERE m.status = 'sent'
    AND m.final_response IS NOT NULL
    AND le.id IS NULL
    ORDER BY m.sent_at ASC
    LIMIT 100
  `).all();

  console.log(`📚 Syncing ${unprocessed.length} historical messages into learning DB...`);

  for (const message of unprocessed) {
    const topicTags = await extractTopicTags(message.body, message.final_response);
    const wasEdited = message.was_corrected === 1;

    addLearnedExample({
      message_id: message.id,
      platform: message.platform,
      message_type: message.message_type,
      original_message: message.body,
      final_response: message.final_response,
      topic_tags: topicTags,
      was_correction: wasEdited ? 1 : 0,
      correction_delta: null,
    });

    await sleep(200);
  }

  console.log(`✅ Synced ${unprocessed.length} examples`);
}

// ── Print learning stats ──────────────────────────────────────────────────────

export function printLearningStats() {
  const stats = getLearningStats();

  console.log('\n📊 LEARNING SYSTEM STATS');
  console.log('─────────────────────────');
  console.log(`Total learned examples: ${stats.totalExamples}`);
  console.log(`Human corrections: ${stats.corrections}`);
  console.log(`Human approvals: ${stats.totalExamples - stats.corrections}`);
  console.log('\nBy platform:');
  for (const p of stats.byPlatform) {
    console.log(`  ${p.platform}: ${p.n} examples`);
  }
  if (stats.mostUsed.length > 0) {
    console.log('\nMost used examples:');
    for (const ex of stats.mostUsed) {
      console.log(`  [${ex.use_count}x] "${ex.original_message.slice(0, 60)}..."`);
    }
  }
}

// ── Review dashboard (CLI) ────────────────────────────────────────────────────
// Simple CLI review loop for processing flagged messages without a full UI

export async function runCLIReview() {
  const flagged = getFlaggedMessages(20);

  if (flagged.length === 0) {
    console.log('\n✅ No flagged messages to review.');
    return;
  }

  console.log(`\n📋 REVIEW QUEUE — ${flagged.length} message(s) pending\n`);

  for (const message of flagged) {
    console.log('═══════════════════════════════════════════════');
    console.log(`Platform: ${message.platform.toUpperCase()} ${message.message_type}`);
    console.log(`From: @${message.author_username}`);
    if (message.post_caption) {
      console.log(`Post: "${message.post_caption.slice(0, 80)}..."`);
    }
    console.log(`\nMessage:\n  "${message.body}"`);
    console.log(`\nDraft response:\n  "${message.draft_response}"`);
    console.log(`\nClassification: ${message.classification} — ${message.classification_reason}`);
    console.log('\n[A] Approve as-is  [E] Edit  [S] Skip  [X] Escalate');
  }

  console.log('\n(This is the CLI preview. Use the review dashboard UI for full interactive editing.)');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
