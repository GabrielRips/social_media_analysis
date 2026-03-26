import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'inbox.db');

if (!existsSync(__dirname)) {
  mkdirSync(__dirname, { recursive: true });
}

let db;

export function getInboxDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- ── All incoming messages (comments + DMs) ───────────────────────────────
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,            -- platform-prefixed: ig_comment_123, fb_dm_456
      platform TEXT NOT NULL,         -- instagram, facebook, tiktok, youtube, twitter
      message_type TEXT NOT NULL,     -- comment, dm
      post_id TEXT,                   -- null for DMs
      post_caption TEXT,              -- context for what post was commented on
      author_id TEXT,
      author_username TEXT,
      author_name TEXT,
      body TEXT NOT NULL,             -- raw message text
      received_at TEXT NOT NULL,      -- ISO 8601
      fetched_at TEXT NOT NULL,

      -- Classification
      classification TEXT,            -- simple, complex, escalate, ignore
      classification_reason TEXT,     -- why it was classified this way
      classified_at TEXT,

      -- Response
      status TEXT DEFAULT 'pending',  -- pending, auto_responded, flagged, approved, sent, ignored, escalated
      draft_response TEXT,            -- Claude's draft
      final_response TEXT,            -- what was actually sent (may differ if human edited)
      responded_at TEXT,
      sent_at TEXT,
      sent_by TEXT,                   -- 'agent' or 'human'

      -- Correction tracking (for learning)
      was_corrected INTEGER DEFAULT 0,  -- 1 if human edited the draft before sending
      correction_notes TEXT,            -- optional human notes on why they changed it

      -- Raw API data
      raw_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_platform ON messages(platform);
    CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
    CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received_at);
    CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);

    -- ── Learned examples (the self-learning system) ───────────────────────────
    -- Every time a human corrects or approves a flagged response,
    -- it gets stored here and fed back into future prompts as few-shot examples.
    CREATE TABLE IF NOT EXISTS learned_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT REFERENCES messages(id),
      platform TEXT NOT NULL,
      message_type TEXT NOT NULL,     -- comment, dm
      original_message TEXT NOT NULL, -- the customer message
      final_response TEXT NOT NULL,   -- the human-approved response
      topic_tags TEXT,                -- JSON array of inferred topic tags
      was_correction INTEGER DEFAULT 0, -- 1 = human edited draft; 0 = human approved as-is
      correction_delta TEXT,          -- what changed (original draft → final)
      added_at TEXT NOT NULL,
      use_count INTEGER DEFAULT 0,    -- how many times this example has been used
      last_used_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_examples_platform ON learned_examples(platform);
    CREATE INDEX IF NOT EXISTS idx_examples_tags ON learned_examples(topic_tags);

    -- ── Escalation queue ──────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS escalations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT REFERENCES messages(id),
      platform TEXT NOT NULL,
      escalation_reason TEXT NOT NULL,
      escalated_at TEXT NOT NULL,
      assigned_to TEXT,               -- email/name of team member handling
      resolved INTEGER DEFAULT 0,
      resolved_at TEXT,
      resolution_notes TEXT
    );

    -- ── Fetch cursor (tracks what we've already seen) ─────────────────────────
    CREATE TABLE IF NOT EXISTS fetch_cursors (
      platform TEXT NOT NULL,
      cursor_type TEXT NOT NULL,      -- comments, dms
      last_cursor TEXT,               -- platform-specific cursor/timestamp
      last_fetched_at TEXT,
      PRIMARY KEY (platform, cursor_type)
    );
  `);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function upsertMessage(msg) {
  return getInboxDb().prepare(`
    INSERT INTO messages (
      id, platform, message_type, post_id, post_caption,
      author_id, author_username, author_name, body,
      received_at, fetched_at, raw_json
    ) VALUES (
      @id, @platform, @message_type, @post_id, @post_caption,
      @author_id, @author_username, @author_name, @body,
      @received_at, @fetched_at, @raw_json
    )
    ON CONFLICT(id) DO NOTHING
  `).run(msg);
}

export function getPendingMessages(limit = 50) {
  return getInboxDb().prepare(`
    SELECT * FROM messages
    WHERE status = 'pending'
    ORDER BY received_at ASC
    LIMIT ?
  `).all(limit);
}

export function getFlaggedMessages(limit = 50) {
  return getInboxDb().prepare(`
    SELECT * FROM messages
    WHERE status = 'flagged'
    ORDER BY received_at ASC
    LIMIT ?
  `).all(limit);
}

export function updateMessageClassification(id, classification, reason, draftResponse) {
  const status = classification === 'simple' ? 'auto_responded'
    : classification === 'escalate' ? 'escalated'
    : classification === 'ignore' ? 'ignored'
    : 'flagged';

  return getInboxDb().prepare(`
    UPDATE messages SET
      classification = @classification,
      classification_reason = @reason,
      classified_at = @now,
      status = @status,
      draft_response = @draftResponse
    WHERE id = @id
  `).run({
    id,
    classification,
    reason,
    now: new Date().toISOString(),
    status,
    draftResponse: draftResponse || null,
  });
}

export function markMessageSent(id, finalResponse, sentBy = 'agent') {
  return getInboxDb().prepare(`
    UPDATE messages SET
      final_response = @finalResponse,
      status = 'sent',
      sent_at = @now,
      sent_by = @sentBy
    WHERE id = @id
  `).run({ id, finalResponse, now: new Date().toISOString(), sentBy });
}

export function markMessageCorrected(id, finalResponse, correctionNotes = '') {
  return getInboxDb().prepare(`
    UPDATE messages SET
      final_response = @finalResponse,
      was_corrected = 1,
      correction_notes = @correctionNotes,
      status = 'sent',
      sent_at = @now,
      sent_by = 'human'
    WHERE id = @id
  `).run({ id, finalResponse, correctionNotes, now: new Date().toISOString() });
}

// ── Learned Examples ──────────────────────────────────────────────────────────

export function addLearnedExample(example) {
  return getInboxDb().prepare(`
    INSERT INTO learned_examples (
      message_id, platform, message_type, original_message,
      final_response, topic_tags, was_correction, correction_delta, added_at
    ) VALUES (
      @message_id, @platform, @message_type, @original_message,
      @final_response, @topic_tags, @was_correction, @correction_delta,
      @added_at
    )
  `).run({
    ...example,
    topic_tags: JSON.stringify(example.topic_tags || []),
    added_at: new Date().toISOString(),
  });
}

export function getRelevantExamples(platform, messageType, topicTags = [], limit = 8) {
  const db = getInboxDb();

  // Get platform + type specific examples, prioritising corrections
  // (corrections are more valuable — they represent human judgment)
  const examples = db.prepare(`
    SELECT * FROM learned_examples
    WHERE platform = ? AND message_type = ?
    ORDER BY was_correction DESC, use_count DESC, added_at DESC
    LIMIT ?
  `).all(platform, messageType, limit * 2);

  // Score by topic tag overlap
  const scored = examples.map(ex => {
    const exTags = JSON.parse(ex.topic_tags || '[]');
    const overlap = topicTags.filter(t => exTags.includes(t)).length;
    return { ...ex, score: overlap * 2 + (ex.was_correction ? 1 : 0) };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  // Update use_count for selected examples
  for (const ex of top) {
    db.prepare(`
      UPDATE learned_examples SET
        use_count = use_count + 1,
        last_used_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), ex.id);
  }

  return top;
}

export function getLearningStats() {
  const db = getInboxDb();
  return {
    totalExamples: db.prepare('SELECT COUNT(*) as n FROM learned_examples').get().n,
    corrections: db.prepare('SELECT COUNT(*) as n FROM learned_examples WHERE was_correction = 1').get().n,
    byPlatform: db.prepare(`
      SELECT platform, COUNT(*) as n FROM learned_examples GROUP BY platform
    `).all(),
    mostUsed: db.prepare(`
      SELECT original_message, final_response, use_count
      FROM learned_examples ORDER BY use_count DESC LIMIT 5
    `).all(),
  };
}

// ── Escalations ───────────────────────────────────────────────────────────────

export function createEscalation(messageId, platform, reason) {
  return getInboxDb().prepare(`
    INSERT INTO escalations (message_id, platform, escalation_reason, escalated_at)
    VALUES (?, ?, ?, ?)
  `).run(messageId, platform, reason, new Date().toISOString());
}

export function getOpenEscalations() {
  return getInboxDb().prepare(`
    SELECT e.*, m.body, m.author_username, m.message_type, m.platform,
           m.post_caption, m.received_at
    FROM escalations e
    JOIN messages m ON e.message_id = m.id
    WHERE e.resolved = 0
    ORDER BY e.escalated_at ASC
  `).all();
}

export function resolveEscalation(escalationId, notes = '') {
  return getInboxDb().prepare(`
    UPDATE escalations SET resolved = 1, resolved_at = ?, resolution_notes = ?
    WHERE id = ?
  `).run(new Date().toISOString(), notes, escalationId);
}

// ── Fetch Cursors ─────────────────────────────────────────────────────────────

export function getCursor(platform, cursorType) {
  return getInboxDb().prepare(`
    SELECT last_cursor FROM fetch_cursors WHERE platform = ? AND cursor_type = ?
  `).get(platform, cursorType)?.last_cursor || null;
}

export function setCursor(platform, cursorType, cursor) {
  return getInboxDb().prepare(`
    INSERT INTO fetch_cursors (platform, cursor_type, last_cursor, last_fetched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(platform, cursor_type) DO UPDATE SET
      last_cursor = excluded.last_cursor,
      last_fetched_at = excluded.last_fetched_at
  `).run(platform, cursorType, cursor, new Date().toISOString());
}

// CLI init
if (process.argv.includes('--init-inbox')) {
  getInboxDb();
  console.log('✅ Inbox database initialised at', DB_PATH);
}
