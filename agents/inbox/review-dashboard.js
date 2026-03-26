import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
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

  /* ── Upload tab ── */
  .upload-form { max-width: 640px; }
  .upload-form label { display: block; font-size: 13px; color: #888; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  .upload-form input[type="text"], .upload-form select { width: 100%; background: #0f0f0f; border: 1px solid #333; border-radius: 6px; padding: 10px 12px; color: #e0e0e0; font-size: 14px; font-family: inherit; margin-bottom: 16px; }
  .upload-form input[type="text"]:focus, .upload-form select:focus, .upload-form textarea:focus { outline: none; border-color: #c0392b; }
  .upload-form select { appearance: none; cursor: pointer; }
  .upload-form .field-row { display: flex; gap: 16px; }
  .upload-form .field-row > div { flex: 1; }
  .drop-zone { border: 2px dashed #333; border-radius: 8px; padding: 40px; text-align: center; color: #555; cursor: pointer; transition: border-color 0.2s, background 0.2s; margin-bottom: 16px; }
  .drop-zone:hover, .drop-zone.dragover { border-color: #c0392b; background: #1a0a0a; }
  .drop-zone.has-file { border-color: #27ae60; background: #0a1a0a; }
  .drop-zone .icon { font-size: 36px; margin-bottom: 8px; }
  .drop-zone .filename { color: #27ae60; font-weight: 600; font-size: 15px; }
  .drop-zone .filesize { color: #888; font-size: 13px; margin-top: 4px; }
  .thumb-preview { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .thumb-preview img { width: 120px; height: 68px; object-fit: cover; border-radius: 4px; border: 1px solid #333; }
  .progress-bar { width: 100%; height: 6px; background: #2a2a2a; border-radius: 3px; overflow: hidden; margin-bottom: 12px; display: none; }
  .progress-bar .fill { height: 100%; background: #c0392b; transition: width 0.3s; width: 0%; }
  .upload-status { font-size: 13px; color: #888; margin-bottom: 16px; display: none; }
  .upload-result { background: #0a1a0a; border: 1px solid #27ae60; border-radius: 8px; padding: 16px; margin-top: 16px; display: none; }
  .upload-result a { color: #c0392b; text-decoration: none; font-weight: 600; }
  .upload-result a:hover { text-decoration: underline; }
  .btn-upload { background: #c0392b; color: #fff; padding: 12px 32px; font-size: 16px; }
  .btn-upload:disabled { opacity: 0.4; cursor: not-allowed; }
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
  <div class="tab" onclick="showTab('upload')">Upload Video</div>
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
  <div id="tab-upload" style="display:none">
    <br>
    <div class="upload-form">
      <div class="card">
        <div class="card-header"><span style="font-weight:600">Upload to YouTube</span></div>
        <div class="card-body">

          <label>Video File</label>
          <div class="drop-zone" id="drop-zone" onclick="document.getElementById('file-input').click()">
            <div class="icon">🎬</div>
            <div>Drag & drop a video here, or click to browse</div>
            <div style="font-size:12px;margin-top:6px;color:#444">MP4, MOV, AVI, WMV, FLV, WebM — max 128 GB</div>
          </div>
          <input type="file" id="file-input" accept="video/*" style="display:none" />

          <label>Title</label>
          <input type="text" id="upload-title" maxlength="100" placeholder="Video title (max 100 characters)" />

          <label>Description</label>
          <textarea id="upload-desc" rows="4" placeholder="Video description..."></textarea>

          <div class="field-row">
            <div>
              <label>Privacy</label>
              <select id="upload-privacy">
                <option value="private">Private — Only you</option>
                <option value="unlisted">Unlisted — Anyone with link</option>
                <option value="public">Public — Everyone</option>
              </select>
            </div>
            <div>
              <label>Category</label>
              <select id="upload-category">
                <option value="22">People & Blogs</option>
                <option value="26">How-to & Style</option>
                <option value="19">Travel & Events</option>
                <option value="24">Entertainment</option>
                <option value="1">Film & Animation</option>
                <option value="2">Autos & Vehicles</option>
                <option value="10">Music</option>
                <option value="15">Pets & Animals</option>
                <option value="17">Sports</option>
                <option value="20">Gaming</option>
                <option value="23">Comedy</option>
                <option value="25">News & Politics</option>
                <option value="27">Education</option>
                <option value="28">Science & Technology</option>
              </select>
            </div>
          </div>

          <label>Tags (comma-separated)</label>
          <input type="text" id="upload-tags" placeholder="bbq, food, melbourne, thirdwavebbq" />

          <label>Custom Thumbnail (optional)</label>
          <div class="thumb-preview" id="thumb-preview" style="display:none">
            <img id="thumb-img" />
            <button class="btn-ignore" onclick="clearThumb()">Remove</button>
          </div>
          <input type="file" id="thumb-input" accept="image/*" style="margin-bottom:16px" />

          <div class="progress-bar" id="progress-bar"><div class="fill" id="progress-fill"></div></div>
          <div class="upload-status" id="upload-status"></div>

          <button class="btn-upload" id="btn-upload" onclick="startUpload()">Upload to YouTube</button>

          <div class="upload-result" id="upload-result">
            <div style="font-size:16px;font-weight:600;margin-bottom:8px">Video uploaded!</div>
            <div id="upload-result-body"></div>
          </div>

        </div>
      </div>
    </div>
  </div>

  <div id="tab-stats" style="display:none">
    <br>
    <div id="stats-content">Loading...</div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const platformEmoji = { instagram:'📸', facebook:'👥', tiktok:'🎵', youtube:'▶️', twitter:'🐦' };

const ALL_TABS = ['flagged','escalations','upload','stats'];
function showTab(tab) {
  ALL_TABS.forEach(t => {
    document.getElementById('tab-' + t).style.display = t === tab ? 'block' : 'none';
    document.querySelectorAll('.tab')[ALL_TABS.indexOf(t)].classList.toggle('active', t === tab);
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

// ── Upload tab logic ──
let selectedFile = null;

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const thumbInput = document.getElementById('thumb-input');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length) setFile(fileInput.files[0]); });

function setFile(f) {
  selectedFile = f;
  dropZone.classList.add('has-file');
  const mb = (f.size / 1024 / 1024).toFixed(1);
  dropZone.innerHTML = '<div class="icon">🎬</div><div class="filename">' + f.name + '</div><div class="filesize">' + mb + ' MB</div>';
  if (!document.getElementById('upload-title').value) {
    document.getElementById('upload-title').value = f.name.replace(/\\.[^.]+$/, '');
  }
}

thumbInput.addEventListener('change', () => {
  if (thumbInput.files.length) {
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('thumb-img').src = e.target.result;
      document.getElementById('thumb-preview').style.display = 'flex';
    };
    reader.readAsDataURL(thumbInput.files[0]);
  }
});

function clearThumb() {
  thumbInput.value = '';
  document.getElementById('thumb-preview').style.display = 'none';
}

async function startUpload() {
  if (!selectedFile) { showToast('Select a video file first', '#c0392b'); return; }
  const title = document.getElementById('upload-title').value.trim();
  if (!title) { showToast('Title is required', '#c0392b'); return; }

  const btn = document.getElementById('btn-upload');
  const bar = document.getElementById('progress-bar');
  const fill = document.getElementById('progress-fill');
  const status = document.getElementById('upload-status');
  const result = document.getElementById('upload-result');

  btn.disabled = true;
  btn.textContent = 'Uploading...';
  bar.style.display = 'block';
  status.style.display = 'block';
  result.style.display = 'none';
  status.textContent = 'Uploading video to server...';
  fill.style.width = '10%';

  const formData = new FormData();
  formData.append('video', selectedFile);
  formData.append('title', title);
  formData.append('description', document.getElementById('upload-desc').value);
  formData.append('privacy', document.getElementById('upload-privacy').value);
  formData.append('category', document.getElementById('upload-category').value);
  formData.append('tags', document.getElementById('upload-tags').value);
  if (thumbInput.files.length) formData.append('thumbnail', thumbInput.files[0]);

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload-video');

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 70) + 10; // 10-80% for upload to server
        fill.style.width = pct + '%';
        const mb = (e.loaded / 1024 / 1024).toFixed(1);
        const total = (e.total / 1024 / 1024).toFixed(1);
        status.textContent = 'Uploading to server: ' + mb + ' / ' + total + ' MB';
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        fill.style.width = '100%';
        status.textContent = 'Complete!';
        result.style.display = 'block';
        document.getElementById('upload-result-body').innerHTML =
          '<div>Video ID: <strong>' + data.videoId + '</strong></div>' +
          '<div style="margin-top:8px"><a href="https://youtu.be/' + data.videoId + '" target="_blank">Watch on YouTube →</a></div>' +
          '<div style="margin-top:4px;color:#888;font-size:13px">Status: ' + data.privacyStatus + '</div>';
        showToast('Video uploaded!');
      } else {
        let msg = 'Upload failed';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        status.textContent = msg;
        showToast(msg, '#c0392b');
      }
      btn.disabled = false;
      btn.textContent = 'Upload to YouTube';
    };

    xhr.onerror = () => {
      status.textContent = 'Network error — check connection';
      showToast('Upload failed', '#c0392b');
      btn.disabled = false;
      btn.textContent = 'Upload to YouTube';
    };

    xhr.send(formData);

    // Simulate YouTube processing phase after server receives file
    setTimeout(() => {
      if (fill.style.width !== '100%') {
        fill.style.width = '85%';
        status.textContent = 'Uploading to YouTube...';
      }
    }, 2000);

  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    showToast('Upload failed: ' + err.message, '#c0392b');
    btn.disabled = false;
    btn.textContent = 'Upload to YouTube';
  }
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

    // ── Video upload (multipart) ──
    if (url.pathname === '/api/upload-video' && req.method === 'POST') {
      try {
        const { fields, files } = await parseMultipart(req);
        if (!files.video) {
          res.writeHead(400);
          json(res, { error: 'No video file provided' });
          return;
        }

        const tmpDir = join(process.cwd(), 'tmp-uploads');
        if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

        const videoPath = join(tmpDir, 'upload-' + Date.now() + '-' + files.video.filename);
        writeFileSync(videoPath, files.video.data);

        let thumbnailPath = null;
        if (files.thumbnail) {
          thumbnailPath = join(tmpDir, 'thumb-' + Date.now() + '-' + files.thumbnail.filename);
          writeFileSync(thumbnailPath, files.thumbnail.data);
        }

        const { uploadVideo } = await import('../../youtube-upload.js');
        const tags = fields.tags ? fields.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

        const result = await uploadVideo({
          filePath: videoPath,
          title: fields.title || 'Untitled',
          description: fields.description || '',
          tags,
          categoryId: fields.category || '22',
          privacyStatus: fields.privacy || 'private',
          thumbnailPath,
        });

        // Clean up temp files
        try { unlinkSync(videoPath); } catch {}
        if (thumbnailPath) try { unlinkSync(thumbnailPath); } catch {}

        json(res, { ok: true, videoId: result.id, privacyStatus: result.status?.privacyStatus || fields.privacy });
      } catch (err) {
        console.error('Upload error:', err.message);
        res.writeHead(500);
        json(res, { error: err.message });
      }
      return;
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

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) return reject(new Error('No multipart boundary'));

    const boundary = boundaryMatch[1];
    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const fields = {};
      const files = {};

      const boundaryBuf = Buffer.from('--' + boundary);
      const parts = [];
      let start = 0;

      while (true) {
        const idx = buf.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        if (start > 0) {
          // Strip leading \r\n and trailing \r\n before boundary
          let partStart = start;
          let partEnd = idx - 2; // remove trailing \r\n
          if (partEnd > partStart) parts.push(buf.subarray(partStart, partEnd));
        }
        start = idx + boundaryBuf.length;
        // Skip \r\n or -- after boundary
        if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // end boundary --
        if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
      }

      for (const part of parts) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;

        const headerStr = part.subarray(0, headerEnd).toString();
        const body = part.subarray(headerEnd + 4);

        const nameMatch = headerStr.match(/name="([^"]+)"/);
        const filenameMatch = headerStr.match(/filename="([^"]+)"/);
        const name = nameMatch ? nameMatch[1] : null;

        if (!name) continue;

        if (filenameMatch) {
          files[name] = { filename: filenameMatch[1], data: body };
        } else {
          fields[name] = body.toString();
        }
      }

      resolve({ fields, files });
    });
    req.on('error', reject);
  });
}
