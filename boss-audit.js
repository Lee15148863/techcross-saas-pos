/**
 * Boss Audit Log — UI Logic
 *
 * RUNBOOK §1 (L1): UI layer only — no business logic.
 * All data comes from the backend Root API audit-log endpoint.
 * RUNBOOK §3 Rule E: Every ROOT action generates AuditLog.
 *
 * Bilingual support: all user-visible text uses __('key') from lang.js.
 */

// ─── State ─────────────────────────────────────────────────────
let _cursor = null;
let _hasMore = false;
let _moduleFilter = '';

// ─── Auth ──────────────────────────────────────────────────────
function doLogout() {
  Auth.logout();
}

function goBack() {
  location.href = 'boss.html';
}

// ─── API Helper ────────────────────────────────────────────────
async function api(path, options = {}) {
  const token = Auth.getToken();
  if (!token) { Auth.logout(); throw new Error(__('err.noToken')); }

  const headers = { 'Authorization': 'Bearer ' + token };
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    showToast(__('err.sessionExpired'));
    Auth.logout();
    throw new Error(__('err.authFailed'));
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || __('err.requestFailed'));
  return data;
}

// ─── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._hide);
  el._hide = setTimeout(() => el.classList.remove('show'), 3000);
}

// ─── Module Filter ─────────────────────────────────────────────
function filterModule(module) {
  _moduleFilter = module;
  document.querySelectorAll('#moduleFilters .filter-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.filter === module)
  );
  loadAuditLog();
}

// ─── Load Audit Log ───────────────────────────────────────────
async function loadAuditLog() {
  _cursor = null;
  _hasMore = false;
  document.getElementById('loadMoreBtn').style.display = 'none';
  const container = document.getElementById('logList');
  container.innerHTML = '<div class="loading"><span class="spinner"></span>' + __('audit.loading') + '</div>';

  try {
    await fetchAuditLogs(true);
  } catch(err) {
    container.innerHTML = '<div class="card"><p style="color:#ff3b30;text-align:center">' + esc(err.message) + '</p></div>';
  }
}

async function loadMore() {
  if (!_hasMore || !_cursor) return;
  document.getElementById('loadMoreBtn').disabled = true;
  document.getElementById('loadMoreBtn').textContent = __('audit.loading');
  try {
    await fetchAuditLogs(false);
  } catch(err) {
    showToast(err.message);
  }
  document.getElementById('loadMoreBtn').disabled = false;
  document.getElementById('loadMoreBtn').textContent = __('audit.loadMore');
}

async function fetchAuditLogs(reset) {
  const startDate = document.getElementById('filterStart').value;
  const endDate = document.getElementById('filterEnd').value;
  const actionType = document.getElementById('filterAction').value;

  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (actionType) params.set('actionType', actionType);
  if (_moduleFilter) params.set('module', _moduleFilter);
  if (_cursor) params.set('cursor', _cursor);
  params.set('limit', '30');

  const data = await api('/api/inv/root/audit-log?' + params.toString());

  const container = document.getElementById('logList');
  const countEl = document.getElementById('entryCount');
  const rangeEl = document.getElementById('entryRange');

  if (reset) {
    container.innerHTML = '';
  }

  if (data.logs.length === 0) {
    if (reset) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>' + __('audit.noEntries') + '</p></div>';
    }
    countEl.textContent = __('audit.entryCount', { count: 0 });
    rangeEl.textContent = '';
    document.getElementById('loadMoreBtn').style.display = 'none';
    return;
  }

  const existingCount = reset ? 0 : parseInt(container.dataset.entryCount || '0');
  const totalCount = existingCount + data.logs.length;
  container.dataset.entryCount = totalCount;
  countEl.textContent = __('audit.entryCount', { count: totalCount });

  _hasMore = data.pagination?.hasMore || false;
  _cursor = data.pagination?.nextCursor || null;

  document.getElementById('loadMoreBtn').style.display = _hasMore ? 'block' : 'none';

  for (const log of data.logs) {
    container.appendChild(renderLogEntry(log));
  }
}

// ─── Render Single Log Entry ──────────────────────────────────
function renderLogEntry(log) {
  const div = document.createElement('div');
  div.className = 'log-item';

  const actionName = log.action.replace(/^root\./, '');
  const time = new Date(log.createdAt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const roleBadge = { root: 'badge-red', manager: 'badge-blue', staff: 'badge-gray' };
  const role = log.role || 'root';
  const moduleBadge = log.module ? '<span class="badge badge-gray">' + esc(log.module) + '</span>' : '';
  const roleSpan = '<span class="badge ' + (roleBadge[role] || 'badge-gray') + '">' + esc(role) + '</span>';

  // Snapshot data
  let detailsHtml = '';
  let hasSnapshot = false;
  if (log.beforeSnapshot || log.afterSnapshot) {
    hasSnapshot = true;
    const beforeJson = log.beforeSnapshot ? syntaxHighlight(JSON.stringify(log.beforeSnapshot, null, 2)) : '<em>' + __('audit.none') + '</em>';
    const afterJson = log.afterSnapshot ? syntaxHighlight(JSON.stringify(log.afterSnapshot, null, 2)) : '<em>' + __('audit.none') + '</em>';
    detailsHtml = '<div class="snapshot-grid">' +
      '<div class="snapshot-col"><div class="snapshot-label">' + __('audit.before') + '</div><pre>' + beforeJson + '</pre></div>' +
      '<div class="snapshot-col"><div class="snapshot-label">' + __('audit.after') + '</div><pre>' + afterJson + '</pre></div>' +
      '</div>';
  }

  const targetInfo = log.targetId ? '<span style="color:#636366">' + esc(log.targetId) + '</span>' : '';
  const operatorName = log.operator?.displayName || log.operator?.username || 'root';

  div.innerHTML =
    '<div class="log-header">' +
      '<div><div class="log-action">' + esc(actionName) + '</div>' +
      '<div class="log-meta">' + roleSpan + ' ' + moduleBadge + ' <span>' + esc(operatorName) + '</span></div></div>' +
      '<div class="log-time">' + time + '</div>' +
    '</div>' +
    '<div class="log-meta">' + (log.targetType ? esc(log.targetType) : '') + (targetInfo ? ' › ' + targetInfo : '') + '</div>' +
    (hasSnapshot ? '<div class="log-details" id="snapshot-' + log._id + '">' + detailsHtml + '</div>' : '');

  if (hasSnapshot) {
    div.addEventListener('click', function(e) {
      const snap = document.getElementById('snapshot-' + log._id);
      if (snap) snap.classList.toggle('open');
    });
  }

  return div;
}

// ─── JSON Syntax Highlight ────────────────────────────────────
function syntaxHighlight(json) {
  return json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"([^"]+)":/g, '<span class="key">"$1"</span>:')
    .replace(/"([^"]+)"(?=\s*[,}\]])/g, '<span class="string">"$1"</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>')
    .replace(/\bnull\b/g, '<span class="null">null</span>');
}

// ─── Utility ──────────────────────────────────────────────────
function esc(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var user = Auth.requireRole('root');
  if (!user) return;

  document.getElementById('appHeader').style.display = 'flex';
  document.getElementById('appContent').style.display = 'block';
  document.getElementById('userBadge').textContent = user.displayName || user.username;
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('filterEnd').value = today;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  document.getElementById('filterStart').value = weekAgo;
  loadAuditLog();

  // Apply saved language preference
  applyLang();
});
