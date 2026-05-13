/**
 * Boss Control Dashboard — JavaScript Logic
 *
 * RUNBOOK §1 (L1): UI layer only — no business logic, no calculations.
 * All financial truth comes from the backend Root API.
 * RUNBOOK §6: NEVER calculate VAT, totals, or profits in frontend.
 *
 * Bilingual support: all user-visible text uses __('key') from lang.js.
 */

// ─── State ─────────────────────────────────────────────────────
let _modalCallback = null;
let _ledgerFilter = 'all';

// ─── Auth ──────────────────────────────────────────────────────
function doLogout() {
  Auth.logout();
}

// ─── API Helper ────────────────────────────────────────────────
async function api(path, options = {}) {
  const token = Auth.getToken();
  if (!token) { Auth.logout(); throw new Error(__('err.noToken')); }

  const headers = { 'Authorization': 'Bearer ' + token };
  let body = options.body;
  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const res = await fetch(path, { ...options, body, headers });
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

// ─── Modal (bottom sheet) ──────────────────────────────────────
function showConfirm(title, body, cb, dangerLabel) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = body;
  const confirmBtn = document.getElementById('modalConfirmBtn');
  confirmBtn.textContent = dangerLabel || __('modal.confirm');
  confirmBtn.className = 'btn btn-' + (dangerLabel === __('modal.cancel') ? 'secondary' : 'danger') + ' btn-block';
  _modalCallback = cb;
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
  _modalCallback = null;
}

function confirmModal() {
  const cb = _modalCallback;
  closeModal();
  if (typeof cb === 'function') cb();
}

// ─── Tab Switching ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  const tabBtn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
  if (tabBtn) tabBtn.classList.add('active');

  // Lazy load
  if (name === 'overview' && !window._overviewLoaded) { loadOverview(); }
  if (name === 'users') { loadUsers(); }
  if (name === 'ledger') { loadLedger(); }
  if (name === 'refund') { loadRefundHistory(); }
  if (name === 'devices') { loadDevices(); }
  if (name === 'system') { loadSystemStatus(); }
}

// ═══════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════

async function loadOverview() {
  try {
    window._overviewLoaded = true;
    const data = await api('/api/inv/root/overview');
    const t = data.today;

    document.getElementById('ovCash').textContent = '€' + (t.payment?.cash || 0).toFixed(2);
    document.getElementById('ovCard').textContent = '€' + (t.payment?.card || 0).toFixed(2);
    document.getElementById('ovCashTxns').textContent = __('ov.ledgerIn') + ': €' + (t.ledger?.cashIn || 0).toFixed(2);
    document.getElementById('ovCardTxns').textContent = __('ov.ledgerIn') + ': €' + (t.ledger?.cardIn || 0).toFixed(2);
    document.getElementById('ovVat').textContent = '€' + (t.vat?.totalVat || 0).toFixed(2);
    document.getElementById('ovVatDetail').textContent = '23%: €' + (t.vat?.standard23?.vat || 0).toFixed(2) + ' | 13.5%: €' + (t.vat?.reduced135?.vat || 0).toFixed(2);
    document.getElementById('ovProfit').textContent = '€' + (t.sales?.net || 0).toFixed(2);
    document.getElementById('ovGross').textContent = __('ov.gross') + ': €' + (t.sales?.gross || 0).toFixed(2);
    document.getElementById('ovSalesCount').textContent = t.sales?.count || 0;
    document.getElementById('ovRefundCount').textContent = __('ov.refundLabel', { count: t.refunds?.count || 0, amount: (t.refunds?.total || 0).toFixed(2) });
    document.getElementById('ovRefunds').textContent = '€' + (t.refunds?.total || 0).toFixed(2);

    // Device PL
    document.getElementById('ovDevSold').textContent = (data.devices?.soldCount || 0) + ' / ' + (data.devices?.totalDevices || 0) + ' devices';
    document.getElementById('ovDevProfit').textContent = '€' + (data.devices?.grossProfit || 0).toFixed(2);

    // Daily close status
    const closeEl = document.getElementById('ovCloseStatus');
    if (data.lastDailyClose) {
      closeEl.innerHTML = '<span class="badge badge-green">' + __('ov.closed') + ': ' + data.lastDailyClose.date + '</span>';
    } else {
      closeEl.innerHTML = '<span class="badge badge-orange">' + __('ov.noClose') + '</span>';
    }
  } catch(err) {
    document.getElementById('ovCash').textContent = '—';
    showToast(__('ov.failedLoad') + ': ' + err.message);
  }
}

function refreshOverview() { loadOverview(); showToast(__('ov.refreshed')); }

// ═══════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════

async function loadUsers() {
  const container = document.getElementById('userList');
  try {
    const users = await api('/api/inv/root/users');
    container.innerHTML = '<div class="card">' + users.map(u => {
      const roleBadge = { root: 'badge-red', manager: 'badge-blue', staff: 'badge-gray' };
      const disabledLabel = __('users.disabled');
      return '<div class="list-item">' +
        '<div><div class="item-title">' + esc(u.displayName) + ' <span class="badge ' + (roleBadge[u.role] || 'badge-gray') + '">' + u.role + '</span></div>' +
        '<div class="item-sub">@' + esc(u.username) + (u.active ? '' : ' • <span style="color:#ff3b30">' + disabledLabel + '</span>') + '</div></div>' +
        '<div class="btn-group" style="gap:4px;flex-wrap:wrap">' +
        '<button class="btn btn-sm btn-secondary" onclick="showEditUser(\'' + u._id + '\')">' + __('users.edit') + '</button>' +
        '<button class="btn btn-sm btn-secondary" onclick="showResetPassword(\'' + u._id + '\',\'' + esc(u.username) + '\')">' + __('users.resetPw') + '</button>' +
        '<button class="btn btn-sm ' + (u.active ? 'btn-warning' : 'btn-success') + '" onclick="toggleUserActive(\'' + u._id + '\',' + u.active + ')">' + (u.active ? __('users.disable') : __('users.enable')) + '</button>' +
        '</div></div>';
    }).join('') + '</div>';
  } catch(err) {
    container.innerHTML = '<div class="card"><p style="color:#ff3b30;text-align:center">' + esc(err.message) + '</p></div>';
  }
}

function showCreateUser() {
  const body = '<div class="input-group"><label>' + __('cu.username') + '</label><input type="text" id="cuUser" placeholder="' + __('cu.username') + '"></div>' +
    '<div class="input-group"><label>' + __('cu.password') + '</label><input type="password" id="cuPass" placeholder="' + __('cu.passwordPlaceholder') + '"></div>' +
    '<div class="input-group"><label>' + __('cu.displayName') + '</label><input type="text" id="cuName" placeholder="' + __('cu.displayPlaceholder') + '"></div>' +
    '<div class="input-group"><label>' + __('cu.role') + '</label><select id="cuRole"><option value="staff">' + __('cu.staff') + '</option><option value="manager">' + __('cu.manager') + '</option><option value="root">' + __('cu.root') + '</option></select></div>';
  showConfirm(__('cu.title'), body, doCreateUser, __('cu.create'));
}

async function doCreateUser() {
  const username = document.getElementById('cuUser')?.value;
  const password = document.getElementById('cuPass')?.value;
  const displayName = document.getElementById('cuName')?.value;
  const role = document.getElementById('cuRole')?.value;
  if (!username || !password || !displayName || !role) { showToast(__('users.allFieldsReq')); return; }

  try {
    await api('/api/inv/root/users/create', {
      method: 'POST',
      body: { username, password, displayName, role },
    });
    showToast(__('users.created'));
    loadUsers();
  } catch(err) { showToast(err.message); }
}

async function toggleUserActive(id, current) {
  if (!current) {
    // Enabling — just do it
    try {
      await api('/api/inv/root/users/' + id, { method: 'PATCH', body: { active: true } });
      showToast(__('users.enabledMsg'));
      loadUsers();
    } catch(err) { showToast(err.message); }
    return;
  }
  // Disabling — confirm
  showConfirm(__('users.disableTitle'), '<p style="color:#ff3b30;font-weight:500">' + __('users.disableBody') + '</p>', async () => {
    try {
      await api('/api/inv/root/users/' + id, { method: 'PATCH', body: { active: false } });
      showToast(__('users.disabledMsg'));
      loadUsers();
    } catch(err) { showToast(err.message); }
  }, __('users.disable'));
}

// ─── Reset Password ────────────────────────────────────────────
function showResetPassword(id, username) {
  const body = '<div class="input-group"><label>' + __('users.newPassword') + '</label><input type="password" id="resetPwInput" placeholder="' + __('cu.passwordPlaceholder') + '"></div>' +
    '<div class="input-group"><label>' + __('users.confirmPassword') + '</label><input type="password" id="resetPwConfirm" placeholder="' + __('users.confirmPassword') + '"></div>';
  showConfirm(__('users.resetPwTitle') + ': ' + esc(username), body, doResetPassword.bind(null, id), __('users.resetPw'));
}

async function doResetPassword(id) {
  const password = document.getElementById('resetPwInput')?.value;
  const confirm = document.getElementById('resetPwConfirm')?.value;
  if (!password || !confirm) { showToast(__('users.allFieldsReq')); return; }
  if (password !== confirm) { showToast(__('users.pwMismatch')); return; }
  if (password.length < 8) { showToast(__('users.pwTooShort')); return; }
  // Backend also requires at least one letter and one digit
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) { showToast(__('users.pwWeak')); return; }

  try {
    await api('/api/inv/root/users/' + id + '/reset-password', {
      method: 'POST',
      body: { password },
    });
    showToast(__('users.pwResetDone'));
  } catch(err) { showToast(err.message); }
}

// ─── Edit User ────────────────────────────────────────────────
const PERMISSION_LABELS = {
  pos: __('perm.pos'), products: __('perm.products'), stock: __('perm.stock'),
  suppliers: __('perm.suppliers'), purchases: __('perm.purchases'),
  transactions: __('perm.transactions'), reports: __('perm.reports'),
  invoices: __('perm.invoices'), settings: __('perm.settings'),
  users: __('perm.users'), expenses: __('perm.expenses'),
  refund: __('perm.refund'), website: __('perm.website'),
};

async function showEditUser(id) {
  // Fetch current user data
  const users = await api('/api/inv/root/users');
  const user = users.find(u => u._id === id);
  if (!user) { showToast(__('users.notFound')); return; }

  const isRootOrMgr = user.role === 'root' || user.role === 'manager';
  const currentPerms = user._permissions || user.permissions || {};

  let permHtml = '';
  if (!isRootOrMgr) {
    permHtml = '<div class="card-title" style="margin-top:12px">' + __('users.permissions') + '</div>';
    for (const key of ['pos', 'products', 'stock', 'suppliers', 'purchases', 'transactions', 'reports', 'invoices', 'settings', 'users', 'expenses', 'refund', 'website']) {
      const label = PERMISSION_LABELS[key] || key;
      const checked = currentPerms[key] ? 'checked' : '';
      permHtml += '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px;cursor:pointer">' +
        '<input type="checkbox" class="perm-checkbox" data-perm="' + key + '" ' + checked + ' style="width:18px;height:18px"> ' + label +
        '</label>';
    }
  } else {
    permHtml = '<p style="color:#8e8e93;font-size:13px;margin-top:8px">' + __('users.permLocked', { role: user.role }) + '</p>';
  }

  const isSelf = user._id === (Auth.getUser()?.id);
  const body = '<div class="input-group"><label>' + __('cu.displayName') + '</label>' +
    '<input type="text" id="editDisplayName" value="' + esc(user.displayName) + '"></div>' +
    '<div class="input-group"><label>' + __('cu.role') + '</label>' +
    '<select id="editRole"><option value="staff" ' + (user.role === 'staff' ? 'selected' : '') + '>' + __('cu.staff') + '</option>' +
    '<option value="manager" ' + (user.role === 'manager' ? 'selected' : '') + '>' + __('cu.manager') + '</option>' +
    '<option value="root" ' + (user.role === 'root' ? 'selected' : '') + '>' + __('cu.root') + '</option></select></div>' +
    permHtml +
    (!isSelf ? '<hr style="border:none;border-top:1px solid #f2f2f7;margin:16px 0"><button class="btn btn-danger btn-block btn-sm" onclick="confirmDeleteUser(\'' + id + '\',\'' + esc(user.displayName) + '\')">' + __('users.delete') + '</button>' : '');

  showConfirm(__('users.editTitle') + ': ' + esc(user.displayName), body, doEditUser.bind(null, id, user.role), __('users.save'));
}

async function confirmDeleteUser(id, displayName) {
  // Close the edit modal first, then show delete confirmation
  closeModal();
  setTimeout(function() {
    showConfirm(__('users.deleteTitle'), '<p>' + __('users.deleteBody', { name: esc(displayName) }) + '</p><p style="color:#ff3b30;font-size:14px;margin-top:8px">' + __('users.deleteWarn') + '</p>', async function() {
      try {
        await api('/api/inv/root/users/' + id, { method: 'DELETE' });
        showToast(__('users.deleted'));
        loadUsers();
      } catch(err) { showToast(err.message); }
    }, __('users.delete'));
  }, 300);
}

async function doEditUser(id, originalRole) {
  const displayName = document.getElementById('editDisplayName')?.value.trim();
  const role = document.getElementById('editRole')?.value;
  if (!displayName) { showToast(__('users.allFieldsReq')); return; }

  const payload = { displayName, role };

  // Collect permissions if role is staff
  if (role === 'staff') {
    const perms = {};
    document.querySelectorAll('.perm-checkbox').forEach(cb => {
      perms[cb.dataset.perm] = cb.checked;
    });
    payload.permissions = perms;
  }

  try {
    await api('/api/inv/root/users/' + id, {
      method: 'PATCH',
      body: payload,
    });
    showToast(__('users.updated'));
    loadUsers();
  } catch(err) { showToast(err.message); }
}

// ═══════════════════════════════════════════════════════════════
// LEDGER
// ═══════════════════════════════════════════════════════════════

function filterLedger(type) {
  _ledgerFilter = type;
  document.querySelectorAll('#ledgerFilters .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === type));
  loadLedger();
}

async function loadLedger() {
  const container = document.getElementById('ledgerEntries');
  const date = document.getElementById('ledgerDate').value;

  try {
    const params = new URLSearchParams();
    if (date) { params.set('startDate', date); params.set('endDate', date); }
    if (_ledgerFilter !== 'all') params.set('entryType', _ledgerFilter);
    params.set('limit', '50');

    const data = await api('/api/inv/root/ledger?' + params.toString());
    document.getElementById('ledgerNet').textContent = '€' + (data.summary?.net || 0).toFixed(2);
    document.getElementById('ledgerNet').className = 'card-value ' + ((data.summary?.net || 0) >= 0 ? 'green' : 'red');

    if (data.entries.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>' + __('ledger.noEntries') + '</p></div>';
      return;
    }

    const entryTypeLabels = {
      sale: __('entry.sale'), refund: __('entry.refund'), expense: __('entry.expense'),
      supplier: __('entry.supplier'), device_buy: __('entry.device_buy'),
      bank_in: __('entry.bank_in'), bank_out: __('entry.bank_out')
    };

    container.innerHTML = '<div class="card">' + data.entries.slice(0, 30).map(e => {
      const dirColor = e.direction === 'in' ? 'green' : 'red';
      const dirSign = e.direction === 'in' ? '+' : '-';
      const typeLabel = entryTypeLabels[e.entryType] || e.entryType;
      return '<div class="list-item">' +
        '<div><div class="item-title">' + typeLabel + '</div>' +
        '<div class="item-sub">' + (e.receiptNumber || '') + ' • ' + new Date(e.createdAt).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' }) + '</div></div>' +
        '<div class="item-right"><span class="card-value ' + dirColor + '">' + dirSign + '€' + (e.amount || 0).toFixed(2) + '</span>' +
        '<div class="item-sub">' + (e.paymentMethod || '') + '</div></div></div>';
    }).join('') + '</div>';

    if (data.entries.length > 30) {
      container.innerHTML += '<p style="text-align:center;color:#8e8e93;font-size:13px;padding:8px">' +
        __('ledger.showing', { count: 30, total: data.entries.length }) + '</p>';
    }
  } catch(err) {
    container.innerHTML = '<div class="card"><p style="color:#ff3b30;text-align:center">' + esc(err.message) + '</p></div>';
  }
}

async function deleteOrphanedLedger() {
  const date = document.getElementById('ledgerDate').value;
  const msg = date
    ? '确认删除 ' + date + ' 之前所有已删除交易对应的流水记录？'
    : '确认删除所有已删除交易对应的孤立流水记录？';
  if (!confirm(msg)) return;
  if (!confirm('此操作不可撤销。再次确认？')) return;

  try {
    const body = { orphaned: true, confirm: true };
    if (date) body.toDate = date;
    const res = await api('/api/inv/root/ledger/delete', 'POST', body);
    alert('已删除 ' + res.deletedCount + ' 条孤立流水');
    loadLedger();
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// REFUND
// ═══════════════════════════════════════════════════════════════

async function doForceRefund() {
  const receipt = document.getElementById('refundReceipt').value.trim();
  const method = document.getElementById('refundMethod').value;
  const reason = document.getElementById('refundReason').value.trim() || __('refund.reasonPlaceholder');

  if (!receipt) { showToast(__('refund.receiptReq')); return; }

  showConfirm(__('refund.execute'), '<p>' + __('refund.confirmExecute', { receipt: esc(receipt), method: method }) + '</p><p style="color:#ff3b30;font-size:14px;margin-top:8px">' + __('refund.confirmExecuteWarn') + '</p>', async () => {
    try {
      const result = await api('/api/inv/root/refund/force', {
        method: 'POST',
        body: { receiptNumber: receipt, refundMethod: method, reason },
      });
      showToast(__('refund.executed', { amount: (result.totalRefund || 0).toFixed(2) }));
      document.getElementById('refundReceipt').value = '';
      loadRefundHistory();
    } catch(err) { showToast(err.message); }
  }, __('refund.execute'));
}

async function doReverseRefund() {
  const receipt = document.getElementById('reverseReceipt').value.trim();
  if (!receipt) { showToast(__('refund.reverseReceiptReq')); return; }

  showConfirm(__('refund.reverseBtn'), '<p>' + __('refund.confirmReverse', { receipt: esc(receipt) }) + '</p><p style="color:#ff3b30;font-size:14px;margin-top:8px">' + __('refund.confirmReverseWarn') + '</p>', async () => {
    try {
      const result = await api('/api/inv/root/refund/reverse', {
        method: 'POST',
        body: { receiptNumber: receipt, reason: 'Root reversal' },
      });
      showToast(__('refund.reversed'));
      document.getElementById('reverseReceipt').value = '';
      loadRefundHistory();
    } catch(err) { showToast(err.message); }
  }, __('refund.reverseBtn'));
}

async function loadRefundHistory() {
  const container = document.getElementById('refundHistory');
  try {
    const data = await api('/api/inv/root/refund/history?limit=10');
    if (data.refunds.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>' + __('refund.noRefunds') + '</p></div>';
      return;
    }

    container.innerHTML = data.refunds.map(r => {
      return '<div class="list-item">' +
        '<div><div class="item-title">' + esc(r.receiptNumber) + '</div>' +
        '<div class="item-sub">' + (r.originalReceipt ? __('refund.original') + ': ' + r.originalReceipt : '') + ' • ' + new Date(r.createdAt).toLocaleDateString('en-GB') + '</div></div>' +
        '<div class="item-right"><span class="card-value red">-€' + Math.abs(r.totalAmount || 0).toFixed(2) + '</span>' +
        '<div class="item-sub">' + (r.paymentMethod || '') + '</div></div></div>';
    }).join('');
  } catch(err) {
    container.innerHTML = '<p style="color:#8e8e93;text-align:center">' + esc(err.message) + '</p>';
  }
}

// ═══════════════════════════════════════════════════════════════
// DEVICES
// ═══════════════════════════════════════════════════════════════

let _deviceFilter = '';

function filterDevices(status) {
  _deviceFilter = status;
  document.querySelectorAll('#deviceFilters .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === status));
  loadDevices();
}

async function loadDevices() {
  const listContainer = document.getElementById('deviceList');
  const summaryContainer = document.getElementById('deviceSummary');
  try {
    const params = new URLSearchParams();
    if (_deviceFilter) params.set('status', _deviceFilter);
    params.set('limit', '50');

    const data = await api('/api/inv/root/devices?' + params.toString());

    // Summary
    if (data.count > 0) {
      summaryContainer.innerHTML = '<div class="card" style="margin-bottom:12px">' +
        '<div class="card-row"><span class="card-label">' + __('devices.total') + '</span><span class="card-value">' + data.count + '</span></div>' +
        '<div class="card-row"><span class="card-label">' + __('devices.totalBuy') + '</span><span class="card-value red">€' + (data.totalBuyPrice || 0).toFixed(2) + '</span></div>' +
        '<div class="card-row"><span class="card-label">' + __('devices.totalSell') + '</span><span class="card-value green">€' + (data.totalSellPrice || 0).toFixed(2) + '</span></div>' +
        '<div class="card-row"><span class="card-label">' + __('devices.grossProfit') + '</span><span class="card-value ' + ((data.grossProfit || 0) >= 0 ? 'green' : 'red') + '">€' + (data.grossProfit || 0).toFixed(2) + '</span></div></div>';
    } else {
      summaryContainer.innerHTML = '';
    }

    if (!data.devices || data.devices.length === 0) {
      listContainer.innerHTML = '<div class="empty-state"><div class="empty-icon">📱</div><p>' + __('devices.noDevices') + '</p></div>';
      return;
    }

    const statusBadge = { SOLD: 'badge-green', TESTED: 'badge-blue', PENDING: 'badge-orange', BUY_IN: 'badge-gray' };

    listContainer.innerHTML = '<div class="card">' + data.devices.map(d => {
      const profit = (d.sellPrice || 0) - (d.buyPrice || 0);
      return '<div class="list-item">' +
        '<div><div class="item-title">' + esc(d.serialNumber) + ' <span class="badge ' + (statusBadge[d.status] || 'badge-gray') + '">' + d.status + '</span></div>' +
        '<div class="item-sub">' + __('devices.buy') + ': €' + (d.buyPrice || 0).toFixed(2) + (d.sellPrice ? ' | ' + __('devices.sell') + ': €' + d.sellPrice.toFixed(2) : '') + ' | ' + __('devices.pl') + ': <span class="' + (profit >= 0 ? 'green' : 'red') + '">€' + profit.toFixed(2) + '</span></div></div>' +
        '<div><button class="btn btn-sm btn-secondary" onclick="editDevice(\'' + d.serialNumber + '\')">' + __('devices.edit') + '</button></div></div>';
    }).join('') + '</div>';

    if (data.devices.length > 50) {
      listContainer.innerHTML += '<p style="text-align:center;color:#8e8e93;font-size:13px;padding:8px">' +
        __('devices.showing', { count: 50, total: data.devices.length }) + '</p>';
    }
  } catch(err) {
    listContainer.innerHTML = '<div class="card"><p style="color:#ff3b30;text-align:center">' + esc(err.message) + '</p></div>';
  }
}

// ─── Device Edit (inline in modal) ─────────────────────────────
async function editDevice(serialNumber) {
  const data = await api('/api/inv/root/devices?limit=100&status=');
  const device = data.devices?.find(d => d.serialNumber === serialNumber);
  if (!device) { showToast(__('devices.notFound')); return; }

  const body = '<div class="input-group"><label>' + __('devEdit.buyPrice') + '</label><input type="number" step="0.01" id="devBuyPrice" value="' + (device.buyPrice || 0) + '"></div>' +
    '<div class="input-group"><label>' + __('devEdit.sellPrice') + '</label><input type="number" step="0.01" id="devSellPrice" value="' + (device.sellPrice || 0) + '"></div>' +
    '<div class="input-group"><label>' + __('devEdit.status') + '</label><select id="devStatus"><option value="BUY_IN" ' + (device.status === 'BUY_IN' ? 'selected' : '') + '>BUY_IN</option><option value="PENDING" ' + (device.status === 'PENDING' ? 'selected' : '') + '>PENDING</option><option value="TESTED" ' + (device.status === 'TESTED' ? 'selected' : '') + '>TESTED</option><option value="SOLD" ' + (device.status === 'SOLD' ? 'selected' : '') + '>SOLD</option></select></div>' +
    '<div class="input-group"><label>' + __('devEdit.notes') + '</label><input type="text" id="devNotes" value="' + esc(device.notes || '') + '"></div>';

  showConfirm(__('devEdit.title') + ': ' + serialNumber, body, async () => {
    const buyPrice = parseFloat(document.getElementById('devBuyPrice')?.value);
    const sellPrice = document.getElementById('devSellPrice')?.value !== '' ? parseFloat(document.getElementById('devSellPrice').value) : undefined;
    const status = document.getElementById('devStatus')?.value;
    const notes = document.getElementById('devNotes')?.value;

    const payload = {};
    if (!isNaN(buyPrice)) payload.buyPrice = buyPrice;
    if (sellPrice !== undefined && !isNaN(sellPrice)) payload.sellPrice = sellPrice;
    if (status) payload.status = status;
    payload.notes = notes || '';

    try {
      await api('/api/inv/root/devices/' + device._id, { method: 'PATCH', body: payload });
      showToast(__('devices.updated'));
      loadDevices();
    } catch(err) { showToast(err.message); }
  }, __('devEdit.save'));
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM CONTROL
// ═══════════════════════════════════════════════════════════════

async function loadSystemStatus() {
  try {
    const data = await api('/api/inv/root/system/status');
    document.getElementById('sysTime').textContent = new Date(data.serverTime).toLocaleString('en-GB');
    document.getElementById('sysUsers').textContent = __('sys.activeUsersVal', { count: data.activeUsers || 0 });

    const pausedEl = document.getElementById('sysPaused');
    if (data.systemPaused) {
      pausedEl.innerHTML = '<span class="status-dot red"></span> ' + __('sys.paused');
    } else {
      pausedEl.innerHTML = '<span class="status-dot green"></span> ' + __('sys.running');
    }

    const lockedEl = document.getElementById('sysLocked');
    if (data.transactionsLocked) {
      lockedEl.innerHTML = '<span class="status-dot red"></span> ' + __('sys.locked');
    } else {
      lockedEl.innerHTML = '<span class="status-dot green"></span> ' + __('sys.unlocked');
    }

    const closeEl = document.getElementById('sysLastClose');
    if (data.lastDailyClose) {
      closeEl.textContent = data.lastDailyClose.date + ' (' + data.lastDailyClose.status + ')';
    } else {
      closeEl.textContent = __('sys.noClose');
    }
  } catch(err) {
    showToast(__('sys.failedLoad'));
  }
}

async function doForceClose() {
  const date = document.getElementById('closeDate').value;
  if (!date) { showToast(__('sys.selectDate')); return; }

  showConfirm(__('close.forceTitle'), '<p>' + __('close.forceBody', { date: date }) + '</p><p style="color:#ff3b30;font-size:14px;margin-top:8px">' + __('close.forceWarn') + '</p>', async () => {
    try {
      await api('/api/inv/root/daily-close/force', { method: 'POST', body: { date, skipDevicePL: true } });
      showToast(__('close.forceDone', { date }));
      loadSystemStatus();
    } catch(err) { showToast(err.message); }
  }, __('sys.forceClose'));
}

async function doReopenClose() {
  const date = document.getElementById('closeDate').value;
  if (!date) { showToast(__('sys.selectDate')); return; }

  showConfirm(__('close.reopenTitle'), '<p>' + __('close.reopenBody', { date: date }) + '</p><p style="color:#ff3b30;font-size:14px;margin-top:8px">' + __('close.reopenWarn') + '</p>', async () => {
    try {
      await api('/api/inv/root/daily-close/reopen', { method: 'POST', body: { date, reason: 'Root reopen' } });
      showToast(__('close.reopenDone', { date }));
      loadSystemStatus();
    } catch(err) { showToast(err.message); }
  }, __('sys.reopen'));
}

async function doSystemPause() {
  showConfirm(__('ctrl.pauseTitle'), '<p style="color:#ff3b30;font-weight:500">' + __('ctrl.pauseBody') + '</p><p style="font-size:14px;margin-top:8px">' + __('ctrl.pauseWarn') + '</p>', async () => {
    try {
      await api('/api/inv/root/system/pause', { method: 'POST', body: { reason: 'Root emergency stop' } });
      showToast(__('ctrl.pauseDone'));
      loadSystemStatus();
    } catch(err) { showToast(err.message); }
  }, __('ctrl.pauseBtn'));
}

async function doSystemResume() {
  showConfirm(__('ctrl.resumeTitle'), '<p>' + __('ctrl.resumeBody') + '</p>', async () => {
    try {
      await api('/api/inv/root/system/resume', { method: 'POST' });
      showToast(__('ctrl.resumeDone'));
      loadSystemStatus();
    } catch(err) { showToast(err.message); }
  }, __('ctrl.resumeBtn'));
}

async function doLockTransactions() {
  showConfirm(__('ctrl.lockTitle'), '<p style="color:#ff3b30;font-weight:500">' + __('ctrl.lockWarn') + '</p><p style="font-size:14px;margin-top:8px">' + __('ctrl.lockSub') + '</p>', async () => {
    try {
      await api('/api/inv/root/system/lock-all-transactions', { method: 'POST' });
      showToast(__('ctrl.lockDone'));
      loadSystemStatus();
    } catch(err) { showToast(err.message); }
  }, __('ctrl.lockBtn'));
}

async function loadAuditLog() {
  const container = document.getElementById('auditLog');
  try {
    const data = await api('/api/inv/root/audit-log?limit=20');
    if (data.logs.length === 0) {
      container.innerHTML = '<p style="color:#8e8e93;text-align:center">' + __('ledger.noEntries') + '</p>';
      return;
    }

    container.innerHTML = data.logs.map(l => {
      const actionName = l.action.replace('root.', '');
      return '<div class="list-item">' +
        '<div><div class="item-title" style="font-size:13px">' + esc(actionName) + '</div>' +
        '<div class="item-sub">' + esc(l.targetType || '') + ' • ' + new Date(l.createdAt).toLocaleString('en-GB') + '</div></div>' +
        '<div style="font-size:12px;color:#8e8e93;max-width:100px;overflow:hidden;text-overflow:ellipsis">' + esc(l.targetId || '') + '</div></div>';
    }).join('');
  } catch(err) {
    container.innerHTML = '<p style="color:#8e8e93;text-align:center">' + esc(err.message) + '</p>';
  }
}

// ─── Export CSV ────────────────────────────────────────────────
async function exportCsv(dataset) {
  const names = {
    'transactions': __('export.transactions'),
    'ledger': __('export.ledger'),
    'audit': __('export.audit'),
    'daily-close': __('export.dailyClose'),
    'vat-summary': __('export.vatSummary'),
  };
  const label = names[dataset] || dataset;

  const startDate = document.getElementById('exportStart')?.value || '';
  const endDate = document.getElementById('exportEnd')?.value || '';

  let body = '<p>' + __('export.download', { label }) + '</p>';
  if (startDate || endDate) {
    body += '<p style="font-size:13px;color:#8e8e93;margin-top:4px">' +
      __('export.period', { start: startDate || '…', end: endDate || '…' }) + '</p>';
  }

  showConfirm(__('export.download', { label }), body, async () => {
    try {
      const token = Auth.getToken();
      if (!token) { showToast(__('export.notAuth')); return; }

      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      const qs = params.toString();

      const url = '/api/inv/root/export/csv/' + dataset + (qs ? '?' + qs : '');

      showToast(__('export.downloading', { label }));

      const res = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + token },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || __('export.failed'));
      }

      const blob = await res.blob();
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = dataset + '-' + new Date().toISOString().split('T')[0] + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(dlUrl);
      showToast('✅ ' + __('export.downloaded', { label }));
    } catch(err) {
      showToast('❌ ' + err.message);
    }
  }, __('export.download', { label }));
}

// ─── Utility ──────────────────────────────────────────────────
function esc(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Keyboard shortcut: Enter to login ────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var user = Auth.requireRole('root');
  if (!user) return;

  document.getElementById('appHeader').style.display = 'flex';
  document.getElementById('tabBar').style.display = 'flex';
  document.getElementById('userBadge').textContent = user.displayName || user.username;
  document.getElementById('headerDate').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  document.getElementById('closeDate').value = today;
  document.getElementById('ledgerDate').value = today;
  const es = document.getElementById('exportStart');
  const ee = document.getElementById('exportEnd');
  if (es) es.value = monthAgo;
  if (ee) ee.value = today;
  loadOverview();
  loadUsers();
  loadLedger();
  loadRefundHistory();
  loadDevices();
  loadSystemStatus();

  // Apply saved language preference
  applyLang();
});
