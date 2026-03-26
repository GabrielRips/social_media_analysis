import { fetchInbox } from './fetcher.js';
import { processInbox } from './responder.js';
import { syncLearningFromHistory, printLearningStats } from './learning.js';
import { startReviewServer } from './review-dashboard.js';
import { getInboxDb } from '../../store/inbox-database.js';

// ── Main inbox sweep (runs on schedule) ──────────────────────────────────────

export async function runInboxSweep() {
  const start = Date.now();
  console.log('\n📬 INBOX SWEEP STARTING...');

  // Step 1: Fetch new messages from all platforms
  const fetchResults = await fetchInbox();

  // Step 2: Classify and auto-respond / flag
  const processResults = await processInbox();

  const duration = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n📬 Inbox sweep complete in ${duration}s`);
  console.log(`   New messages: ${fetchResults.totalNew}`);
  console.log(`   Auto-responded: ${processResults.autoResponded}`);
  console.log(`   Flagged for review: ${processResults.flagged}`);
  console.log(`   Escalated: ${processResults.escalated}`);
  console.log(`   Ignored: ${processResults.ignored}`);

  return { fetchResults, processResults };
}

// ── Get current queue summary ─────────────────────────────────────────────────

export function getQueueSummary() {
  const db = getInboxDb();
  return {
    pending:    db.prepare("SELECT COUNT(*) as n FROM messages WHERE status = 'pending'").get().n,
    flagged:    db.prepare("SELECT COUNT(*) as n FROM messages WHERE status = 'flagged'").get().n,
    escalated:  db.prepare("SELECT COUNT(*) as n FROM escalations WHERE resolved = 0").get().n,
    sentToday:  db.prepare("SELECT COUNT(*) as n FROM messages WHERE status = 'sent' AND date(sent_at) = date('now')").get().n,
    autoRate:   getAutoResponseRate(),
  };
}

function getAutoResponseRate() {
  const db = getInboxDb();
  const total = db.prepare("SELECT COUNT(*) as n FROM messages WHERE status IN ('sent','flagged','escalated')").get().n;
  const auto = db.prepare("SELECT COUNT(*) as n FROM messages WHERE sent_by = 'agent'").get().n;
  return total > 0 ? Math.round((auto / total) * 100) : 0;
}

// ── Start the review server ───────────────────────────────────────────────────

export { startReviewServer };
export { syncLearningFromHistory, printLearningStats };
