import { createServer } from 'http';
import { readFileSync } from 'fs';
import { getInboxDb, getOpenEscalations } from '../../store/inbox-database.js';
import { processCorrection } from './learning.js';

const PORT = process.env.REVIEW_PORT || 3456;

// ── HTML Dashboard ────────────────────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TWB Inbox Review</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; min-height: 100vh; }
  header { background: #1a1a1a; border-bottom: 2px solid #c0392b; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 18px; font-weight: 700; color: #fff; }
  header .badge { background: #c0392b; color: #fff; border-radius: 12px; padding: 2px 10px; font-size: 13px; font-weight: 600; }
  .tabs { display: flex; gap: 2px; padding: 16px 24px 0; }
  .tab { padding: 8px 20px; background: #1a1a1a; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 14px; color: #888; border: 1px solid #333; border-bottom: none; }
  .tab.active { background: #242424; color: #fff; }
  .container { padding: 0 24px 24px; }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
  .card-header { padding: 14px 18px; border-bottom: 1px solid #2a2a2a; display: flex; align-items: center; gap: 12px; }
  .platform-badge { padding: 3px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
  .platform-instagram { background: #833ab4; color: #fff; }
  .platform-facebook { background: #1877f2; color: #fff; }
  .platform-tiktok { background: #000; color: #fff; border: 1px solid #333; }
  .platform-youtube { background: #ff0000; color: #fff; }
  .platform-twitter { background: #1da1f2; color: #fff; }
  .type-badge { padding: 3px 8px; border-radius: 4px; font-size: 11px; background: #2a2a2a; color: #888; }
  .author { font-weight: 600; color: #fff; }
  .time { color: #555; font-size: 12px; margin-left: auto; }
  .card-body { padding: 18px; }
  .post-context { font-size: 12px; color: #555; margin-bottom: 10px; font-style: italic; }
  .message-text { background: #0f0f0f; border: 1px solid #2a2a2a; border-radius: 6px; padding: 12px; font-size: 14px; line-height: 1.5; margin-bottom: 16px; }
  .classification { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; color: #888; }
  .class-chip { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .class-complex { background: #f39c12; color: #000; }
  .class-simple { background: #27ae60; color: #fff; }
  .draft-label { font-size: 12px; color: #888; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  textarea { width: 100%; background: #0f0f0f; border: 1px solid #333; border-radius: 6px; padding: 12px; color: #e0e0e0; font-size: 14px; line-height: 1.5; resize: vertical; min-height: 80px; font-family: inherit; }
  textarea:focus { outline: none; border-color: #c0392b; }
  .char-count { font-size: 11px; color: #555; text-align: right; margin-top: 4px; }
  .actions { display: flex; gap: 8px; margin-top: 14px; }
  button { padding: 8px 18px; border-radius: 6px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
  button:hover { opacity: 0.85; }
  .btn-approve { background: #27ae60; color: #fff; }
  .btn-send-edited { background: #2980b9; color: #fff; }
  .btn-escalate { background: #c0392b; color: #fff; }
  .btn-ignore { background: #2a2a2a; color: #888; }
  .notes-input { width: 100%; background: #0f0f0f; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px 12px; color: #888; font-size: 13px; margin-top: 8px; font-family: inherit; }
  .notes-input:focus { outline: none; border-color: #555; }
  .escalation-card { border-left: 3px solid #c0392b; }
  .escalation-reason { background: #1f0a0a; border-radius: 4px; padding: 8px 12px; font-size: 13px; color: #e74c3c; margin-bottom: 12px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .stat-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 18px; text-align: center; }
  .stat-number { font-size: 32px; font-weight: 700; color: #fff; }
  .stat-label { font-size: 13px; color: #555; margin-top: 4px; }
  .empty-state { text-align: center; padding: 48px; color: #555; }
  .empty-state .icon { font-size: 48px; margin-bottom: 12px; }
  .toast { position: fixed; bottom: 24px; right: 24px; background: #27ae60; color: #fff; padding: 12px 20px; border-radius: 8px; font-weight: 600; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>

<header>
  <span style="font-size:20px">🔥</span>
  <h1>TWB Inbox Review</h1>
  <span class="badge" id="flagged-count">Loading...</span>
</header>

<div class="tabs">
  <div class="tab active" onclick="showTab('flagged')">Flagged for Review</div>
  <div class="tab" onclick="showTab('escalations')">Escalations</div>
  <div class="tab" onclick="showTab('stats')">Learning Stats</div>
</div>

<div class="container">
  <div id="tab-flagged">
    <br>
    <div id="flagged-list">Loading...</div>
  </div>
  <div id="tab-escalations" style="display:none">
    <br>
    <div id="escalations-list">Loading...</div>
  </div>
  <div id="tab-stats" style="display:none">
    <br>
    <div id="stats-content">Loading...</div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const platformEmoji = { instagram:'📸', facebook:'👥', tiktok:'🎵', youtube:'▶️', twitter:'🐦' };

function showTab(tab) {
  ['flagged','escalations','stats'].forEach(t => {
    document.getElementById('tab-' + t).style.display = t === tab ? 'block' : 'none';
    document.querySelectorAll('.tab')[['flagged','escalations','stats'].indexOf(t)].classList.toggle('active', t === tab);
  });
  if (tab === 'escalations') loadEscalations();
  if (tab === 'stats') loadStats();
}

function showToast(msg, color = '#27ae60') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = color;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

async function loadFlagged() {
  const res = await fetch('/api/flagged');
  const data = await res.json();
  const badge = document.getElementById('flagged-count');
  badge.textContent = data.length + ' pending';
  
  const container = document.getElementById('flagged-list');
  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">✅</div><div>All caught up! No messages need review.</div></div>';
    return;
  }
  
  container.innerHTML = data.map(msg => \`
    <div class="card" id="card-\${msg.id}">
      <div class="card-header">
        <span class="platform-badge platform-\${msg.platform}">\${platformEmoji[msg.platform] || '📱'} \${msg.platform}</span>
        <span class="type-badge">\${msg.message_type}</span>
        <span class="author">@\${msg.author_username || 'unknown'}</span>
        <span class="time">\${timeAgo(msg.received_at)}</span>
      </div>
      <div class="card-body">
        \${msg.post_caption ? \`<div class="post-context">Post: "\${msg.post_caption.slice(0, 100)}..."</div>\` : ''}
        <div class="message-text">"\${msg.body}"</div>
        <div class="classification">
          <span class="class-chip class-\${msg.classification}">\${msg.classification}</span>
          <span>\${msg.classification_reason}</span>
        </div>
        <div class="draft-label">Draft Response</div>
        <textarea id="response-\${msg.id}" oninput="updateCount('\${msg.id}')">\${msg.draft_response || ''}</textarea>
        <div class="char-count"><span id="count-\${msg.id}">\${(msg.draft_response||'').length}</span> chars</div>
        <input class="notes-input" id="notes-\${msg.id}" placeholder="Optional correction notes (what changed and why)..." />
        <div class="actions">
          <button class="btn-approve" onclick="approve('\${msg.id}')">✅ Approve & Send</button>
          <button class="btn-send-edited" onclick="sendEdited('\${msg.id}')">✏️ Send Edited</button>
          <button class="btn-escalate" onclick="escalate('\${msg.id}')">🚨 Escalate</button>
          <button class="btn-ignore" onclick="ignore('\${msg.id}')">Ignore</button>
        </div>
      </div>
    </div>
  \`).join('');
}

function updateCount(id) {
  const ta = document.getElementById('response-' + id);
  document.getElementById('count-' + id).textContent = ta.value.length;
}

async function approve(id) {
  const response = document.getElementById('response-' + id).value;
  await fetch('/api/approve', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id, response, notes: '' }) });
  document.getElementById('card-' + id).remove();
  showToast('Approved & sent ✅');
  updateBadge();
}

async function sendEdited(id) {
  const response = document.getElementById('response-' + id).value;
  const notes = document.getElementById('notes-' + id).value;
  await fetch('/api/correct', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id, response, notes }) });
  document.getElementById('card-' + id).remove();
  showToast('Correction saved & sent 📚', '#2980b9');
  updateBadge();
}

async function escalate(id) {
  await fetch('/api/escalate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
  document.getElementById('card-' + id).remove();
  showToast('Escalated 🚨', '#c0392b');
  updateBadge();
}

async function ignore(id) {
  await fetch('/api/ignore', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
  document.getElementById('card-' + id).remove();
  showToast('Ignored');
  updateBadge();
}

function updateBadge() {
  const remaining = document.querySelectorAll('[id^="card-"]').length;
  document.getElementById('flagged-count').textContent = remaining + ' pending';
}

async function loadEscalations() {
  const res = await fetch('/api/escalations');
  const data = await res.json();
  const container = document.getElementById('escalations-list');
  if (data.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">👌</div><div>No open escalations.</div></div>';
    return;
  }
  container.innerHTML = data.map(e => \`
    <div class="card escalation-card">
      <div class="card-header">
        <span class="platform-badge platform-\${e.platform}">\${platformEmoji[e.platform] || '📱'} \${e.platform}</span>
        <span class="type-badge">\${e.message_type}</span>
        <span class="author">@\${e.author_username}</span>
        <span class="time">\${timeAgo(e.escalated_at)}</span>
      </div>
      <div class="card-body">
        <div class="escalation-reason">🚨 \${e.escalation_reason}</div>
        <div class="message-text">"\${e.body}"</div>
        <div class="actions">
          <button class="btn-approve" onclick="resolveEscalation(\${e.id})">Mark Resolved</button>
        </div>
      </div>
    </div>
  \`).join('');
}

async function resolveEscalation(id) {
  await fetch('/api/resolve-escalation', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) });
  loadEscalations();
  showToast('Escalation resolved');
}

async function loadStats() {
  const res = await fetch('/api/stats');
  const data = await res.json();
  document.getElementById('stats-content').innerHTML = \`
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-number">\${data.totalExamples}</div><div class="stat-label">Learned Examples</div></div>
      <div class="stat-card"><div class="stat-number">\${data.corrections}</div><div class="stat-label">Human Corrections</div></div>
      <div class="stat-card"><div class="stat-number">\${data.totalExamples - data.corrections}</div><div class="stat-label">Direct Approvals</div></div>
      <div class="stat-card"><div class="stat-number">\${data.byPlatform?.length || 0}</div><div class="stat-label">Platforms Active</div></div>
    </div>
    <div class="card">
      <div class="card-header"><span style="font-weight:600">By Platform</span></div>
      <div class="card-body">
        \${(data.byPlatform || []).map(p => \`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #2a2a2a"><span>\${platformEmoji[p.platform] || '📱'} \${p.platform}</span><span style="color:#888">\${p.n} examples</span></div>\`).join('')}
      </div>
    </div>
    \${data.mostUsed?.length > 0 ? \`
    <div class="card">
      <div class="card-header"><span style="font-weight:600">Most Used Examples</span></div>
      <div class="card-body">
        \${data.mostUsed.map(ex => \`
          <div style="padding:10px 0;border-bottom:1px solid #2a2a2a">
            <div style="color:#888;font-size:12px;margin-bottom:4px">Used \${ex.use_count}x</div>
            <div style="font-size:13px">"<em>\${ex.original_message.slice(0,80)}</em>"</div>
            <div style="font-size:13px;color:#27ae60;margin-top:4px">→ "\${ex.final_response.slice(0,100)}"</div>
          </div>
        \`).join('')}
      </div>
    </div>\` : ''}
  \`;
}

// Load on boot
loadFlagged();
</script>
</body>
</html>`;

// ── HTTP API server ───────────────────────────────────────────────────────────

export function startReviewServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204); res.end(); return;
    }

    // ── Routes ──
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (url.pathname === '/api/flagged' && req.method === 'GET') {
      const db = getInboxDb();
      const flagged = db.prepare(`
        SELECT * FROM messages WHERE status = 'flagged' ORDER BY received_at ASC LIMIT 50
      `).all();
      json(res, flagged);
      return;
    }

    if (url.pathname === '/api/escalations' && req.method === 'GET') {
      json(res, getOpenEscalations());
      return;
    }

    if (url.pathname === '/api/stats' && req.method === 'GET') {
      const { getLearningStats } = await import('../../store/inbox-database.js');
      json(res, getLearningStats());
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const { id, response, notes } = body;

      if (url.pathname === '/api/approve') {
        await processCorrection(id, response, '');
        json(res, { ok: true });
        return;
      }

      if (url.pathname === '/api/correct') {
        await processCorrection(id, response, notes || '');
        json(res, { ok: true });
        return;
      }

      if (url.pathname === '/api/escalate') {
        const db = getInboxDb();
        db.prepare(`UPDATE messages SET status = 'escalated' WHERE id = ?`).run(id);
        const { createEscalation } = await import('../../store/inbox-database.js');
        createEscalation(id, 'unknown', 'Manually escalated from review dashboard');
        json(res, { ok: true });
        return;
      }

      if (url.pathname === '/api/ignore') {
        const db = getInboxDb();
        db.prepare(`UPDATE messages SET status = 'ignored' WHERE id = ?`).run(id);
        json(res, { ok: true });
        return;
      }

      if (url.pathname === '/api/resolve-escalation') {
        const { resolveEscalation } = await import('../../store/inbox-database.js');
        resolveEscalation(id, notes || '');
        json(res, { ok: true });
        return;
      }
    }

    res.writeHead(404); res.end('Not found');
  });

  server.listen(PORT, () => {
    console.log(`\n🖥️  Review dashboard: http://localhost:${PORT}`);
  });

  return server;
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}
