/**
 * whatsapp-center.js — WhatsApp Center Module
 *
 * Communication layer only. NOT financial core.
 * Mobile-first customer communication tool.
 *
 * Features:
 * - Customer search (from invoices + manual entries)
 * - Internal staff notes
 * - WhatsApp messaging via wa.me
 * - 7 editable message templates (localStorage)
 */
(function () {
  'use strict';

  // ─── Default Templates ─────────────────────────────────────────────────
  var DEFAULT_TEMPLATES = [
    { id: 'repair_quote_instock', label: '维修报价（有库存）/ Repair Quote (In Stock)', text: 'Hi 🙂 The repair for your XXXXX will be €XXXXX.\n\nWe currently have the part in stock and can get it done in around XXXXX.\n\nLet us know if you\'d like to go ahead.' },
    { id: 'repair_quote_order', label: '维修报价（没库存+定金）/ Repair Quote (Order Required)', text: 'Hi 🙂 The part for your XXXXX is currently not in stock, but we can order it in for you.\n\nThe repair will be €XXXXX and it usually takes around XXXXX days for the part to arrive.\n\nWe\'d just need a small deposit of €XXXXX before placing the order 🙂' },
    { id: 'repair_complete', label: '修好通知 / Repair Complete', text: 'Hi 🙂 Your XXXXX is now repaired and ready for collection.\n\nYou can drop into the shop anytime during opening hours.\n\nThanks again!' },
    { id: 'repair_complete_balance', label: '修好通知（带尾款）/ Repair Complete (Balance Remaining)', text: 'Hi 🙂 Your XXXXX is now repaired and ready for collection.\n\nThe remaining balance is €XXXXX.\n\nYou can collect it anytime during opening hours. Thanks again!' },
    { id: 'stock_arrival', label: '到货通知 / Stock Arrival', text: 'Hi 🙂 Your XXXXX has arrived and is ready.\n\nFeel free to drop into the shop anytime during opening hours.' },
    { id: 'google_review', label: 'Google评价 / Google Review Request', text: 'Hi 🙂 Thanks again for coming to TechCross.\n\nIf you\'re happy with the repair/service, we\'d really appreciate a quick Google review — it genuinely helps our small business a lot.\n\nAnd if there\'s anything at all you\'re not fully happy with, please message us directly first and we\'ll always do our best to sort it out for you.\n\nhttps://g.page/r/CSNDIa-pbVKSEBM/review' },
    { id: 'receipt_sent', label: '收据发送 / Receipt Sent', text: 'Hi 🙂 Thanks again for shopping with TechCross!\n\nYour receipt is attached below.\n\nIf we helped you out today, a quick 5⭐ Google review would mean a lot to our small business 🙏\n\nhttps://g.page/r/CSNDIa-pbVKSEBM/review\n\nThanks again!' },
  ];

  var TEMPLATES_KEY = 'wc_templates';
  var RECENT_KEY = 'wc_recent_numbers';

  // ─── Phone Normalization ───────────────────────────────────────────────
  function normalizePhone(input) {
    var cleaned = input.trim();
    // 08xxxxxxxx → +3538xxxxxxxx
    if (/^08\d{8}$/.test(cleaned)) {
      return '+353' + cleaned.slice(1);
    }
    // Already has +
    if (cleaned.startsWith('+')) return cleaned;
    // 00... → international, leave as is
    if (cleaned.startsWith('00')) return cleaned;
    // *... → leave as is
    if (cleaned.startsWith('*')) return cleaned;
    // Just digits, assume Irish
    if (/^\d+$/.test(cleaned)) {
      if (cleaned.startsWith('8')) return '+353' + cleaned;
      return '+353' + cleaned;
    }
    return cleaned;
  }

  // ─── Templates (localStorage) ──────────────────────────────────────────
  function getTemplates() {
    try {
      var saved = localStorage.getItem(TEMPLATES_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  }

  function saveTemplates(templates) {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  }

  function resetTemplates() {
    localStorage.removeItem(TEMPLATES_KEY);
    return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  }

  // ─── Recent Numbers (localStorage) ─────────────────────────────────────
  function getRecentNumbers() {
    try {
      var saved = localStorage.getItem(RECENT_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch (_) { return []; }
  }

  function addRecentNumber(phone, name) {
    var recents = getRecentNumbers();
    // Remove duplicate
    recents = recents.filter(function (r) { return r.phone !== phone; });
    recents.unshift({ phone: phone, name: name || '', ts: Date.now() });
    if (recents.length > 20) recents = recents.slice(0, 20);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents));
  }

  // ─── API Calls ─────────────────────────────────────────────────────────
  function apiHeaders() {
    return Auth.getHeaders();
  }

  function searchCustomers(q) {
    var url = '/api/inv/whatsapp/customers?q=' + encodeURIComponent(q);
    return fetch(url, { headers: apiHeaders() }).then(function (r) {
      if (!r.ok) throw new Error('Search failed');
      return r.json();
    });
  }

  function getNotes(phone) {
    return fetch('/api/inv/whatsapp/notes/' + encodeURIComponent(phone), {
      headers: apiHeaders(),
    }).then(function (r) {
      if (!r.ok) throw new Error('Failed to load notes');
      return r.json();
    });
  }

  function addNote(phone, text, name) {
    return fetch('/api/inv/whatsapp/notes/' + encodeURIComponent(phone), {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ text: text, name: name || '' }),
    }).then(function (r) {
      if (!r.ok) throw new Error('Failed to add note');
      return r.json();
    });
  }

  function deleteNote(phone, noteId) {
    return fetch('/api/inv/whatsapp/notes/' + encodeURIComponent(phone) + '/' + noteId, {
      method: 'DELETE',
      headers: apiHeaders(),
    }).then(function (r) {
      if (!r.ok) throw new Error('Failed to delete note');
      return r.json();
    });
  }

  function updateCustomerName(phone, name) {
    return fetch('/api/inv/whatsapp/notes/' + encodeURIComponent(phone), {
      method: 'PATCH',
      headers: apiHeaders(),
      body: JSON.stringify({ name: name }),
    }).then(function (r) {
      if (!r.ok) throw new Error('Failed to update name');
      return r.json();
    });
  }

  // ─── WhatsApp Link Generator ───────────────────────────────────────────
  function openWhatsApp(phone, message) {
    var normalized = normalizePhone(phone);
    // wa.me expects E164 without + or 00 prefix
    var waNumber = normalized.replace('+', '').replace(/^00/, '');
    var link = 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(message);
    window.open(link, '_blank');
    addRecentNumber(normalized, '');
    return normalized;
  }

  // ─── Render Helpers ────────────────────────────────────────────────────
  function esc(str) {
    if (typeof str !== 'string') return String(str || '');
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(d) {
    if (!d) return '';
    var date = new Date(d);
    if (isNaN(date.getTime())) return '';
    var dd = String(date.getDate()).padStart(2, '0');
    var mm = String(date.getMonth() + 1).padStart(2, '0');
    var yyyy = date.getFullYear();
    var hh = String(date.getHours()).padStart(2, '0');
    var min = String(date.getMinutes()).padStart(2, '0');
    return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + min;
  }

  // ─── UI State ──────────────────────────────────────────────────────────
  var state = {
    currentCustomer: null,   // { name, contact, source }
    currentNotes: null,      // CustomerNote document
    searchResults: [],
    templates: getTemplates(),
    selectedTemplateId: null,
    recents: getRecentNumbers(),
    isLoading: false,
    activeTab: 'search',     // 'search' | 'templates' | 'settings'
    noCustomerMatch: false,   // true when search found no matching customer
  };

  // ─── Main Render ───────────────────────────────────────────────────────
  function render() {
    var app = document.getElementById('wcApp');
    if (!app) return;

    var user = Auth.getUser();
    var isRoot = user && user.role === 'root';

    app.innerHTML =
      '<div class="wc-header">' +
        '<button class="wc-back" onclick="window.WC.goBack()" id="wcBackBtn" style="display:none">‹</button>' +
        '<h1 class="wc-title">WhatsApp Center</h1>' +
        '<div class="wc-header-tabs">' +
          '<button class="wc-tab ' + (state.activeTab === 'search' ? 'active' : '') + '" onclick="window.WC.switchTab(\'search\')">💬 Send</button>' +
          '<button class="wc-tab ' + (state.activeTab === 'templates' ? 'active' : '') + '" onclick="window.WC.switchTab(\'templates\')">📝 Templates</button>' +
          (isRoot ? '<button class="wc-tab ' + (state.activeTab === 'settings' ? 'active' : '') + '" onclick="window.WC.switchTab(\'settings\')">⚙ Settings</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="wc-body">' +
        '<div id="wcSearchView" class="wc-view' + (state.activeTab === 'search' ? ' active' : '') + '"></div>' +
        '<div id="wcTemplatesView" class="wc-view' + (state.activeTab === 'templates' ? ' active' : '') + '"></div>' +
        '<div id="wcSettingsView" class="wc-view' + (state.activeTab === 'settings' ? ' active' : '') + '"></div>' +
      '</div>';

    renderSearchView();
    renderTemplatesView();
    if (isRoot) renderSettingsView();
  }

  // ─── Search View ───────────────────────────────────────────────────────
  function renderSearchView() {
    var el = document.getElementById('wcSearchView');
    if (!el) return;

    var hasCustomer = state.currentCustomer !== null;

    el.innerHTML =
      '<div class="wc-search-section"' + (hasCustomer ? ' style="display:none"' : '') + '>' +
        '<div class="wc-search-bar">' +
          '<input type="tel" id="wcSearchInput" class="wc-input wc-input-search" placeholder="Name or phone to send... / 输入姓名或电话发送" autofocus>' +
          '<button class="wc-btn wc-btn-search" onclick="window.WC.doSearch()">🔍</button>' +
        '</div>' +
        '<div id="wcRecentsSection" class="wc-recents"></div>' +
        '<div id="wcResultsSection" class="wc-results"></div>' +
      '</div>' +
      '<div class="wc-customer-section"' + (!hasCustomer ? ' style="display:none"' : '') + '>' +
        '<div class="wc-customer-header">' +
          '<button class="wc-btn-back" onclick="window.WC.clearCustomer()">← Back</button>' +
          '<div class="wc-customer-info">' +
            '<strong id="wcCustomerName">' + esc(state.currentCustomer ? state.currentCustomer.name || 'Unknown' : '') + '</strong>' +
            '<span class="wc-customer-phone" id="wcCustomerPhone">' + esc(state.currentCustomer ? state.currentCustomer.contact : '') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="wc-notes-section">' +
          '<div class="wc-section-label">📋 Internal Notes / 内部备注 <span class="wc-internal-badge">INTERNAL</span></div>' +
          '<div id="wcNotesList" class="wc-notes-list"></div>' +
          '<div class="wc-add-note">' +
            '<textarea id="wcNoteInput" class="wc-input wc-textarea-sm" placeholder="Add internal note... / 添加内部备注..." rows="2"></textarea>' +
            '<button class="wc-btn wc-btn-sm" onclick="window.WC.addNote()">+ Add</button>' +
          '</div>' +
        '</div>' +
        (state.noCustomerMatch ? '<div class="wc-no-customer-notice">ℹ️ No saved customer found. You can still send a WhatsApp message. / 未找到客户记录，仍可发送消息。</div>' : '') +
        '<div class="wc-compose-section">' +
          '<div class="wc-section-label">💬 Message / 消息</div>' +
          '<div class="wc-templates-bar" id="wcTemplatesBar"></div>' +
          '<textarea id="wcMessageText" class="wc-input wc-textarea-msg" placeholder="Type your message... / 输入消息..." rows="4"></textarea>' +
          '<div class="wc-phone-row">' +
            '<input type="tel" id="wcSendPhone" class="wc-input wc-input-phone" placeholder="Phone / 电话" value="' + esc(state.currentCustomer ? state.currentCustomer.contact : '') + '">' +
            '<button class="wc-btn wc-btn-send" onclick="window.WC.sendMessage()">📱 Send WhatsApp</button>' +
          '</div>' +
          '<div class="wc-phone-hint" id="wcPhoneHint"></div>' +
        '</div>' +
      '</div>';

    // Render recents
    renderRecents();

    // If we have a customer, show their notes and templates
    if (hasCustomer) {
      renderNotes();
      renderTemplateBar();

      // Show phone hint
      updatePhoneHint(state.currentCustomer.contact);

      // Pre-fill message with current template if selected
      var template = getSelectedTemplate();
      if (template) {
        fillTemplate(template, state.currentCustomer.name || '');
      }
    }

    // Bind search events
    var searchInput = document.getElementById('wcSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        var val = this.value.trim();
        if (val.length >= 2) {
          window.WC.doSearch();
        } else if (val.length === 0) {
          clearResults();
          renderRecents();
        }
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') window.WC.doSearch();
      });
      if (!hasCustomer) searchInput.focus();
    }

    // Bind phone input change to update hint
    var phoneInput = document.getElementById('wcSendPhone');
    if (phoneInput) {
      phoneInput.addEventListener('input', function () {
        updatePhoneHint(this.value);
      });
    }
  }

  function renderRecents() {
    var el = document.getElementById('wcRecentsSection');
    if (!el) return;
    var recents = state.recents;
    if (!recents.length) {
      el.innerHTML = '';
      return;
    }
    var html = '<div class="wc-section-label">🕐 Recent / 最近</div><div class="wc-chip-list">';
    recents.forEach(function (r) {
      html += '<button class="wc-chip" onclick="window.WC.selectRecent(\'' + esc(r.phone) + '\', \'' + esc(r.name) + '\')">' +
        esc(r.name || r.phone) + (r.name ? '<span class="wc-chip-sub">' + esc(r.phone) + '</span>' : '') +
        '</button>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function clearResults() {
    var el = document.getElementById('wcResultsSection');
    if (el) el.innerHTML = '';
  }

  function renderResults(results) {
    var el = document.getElementById('wcResultsSection');
    if (!el) return;

    if (!results || results.length === 0) {
      el.innerHTML = '<div class="wc-empty">No customers found / 未找到客户</div>';
      return;
    }

    // Hide recents when showing results
    var recentsEl = document.getElementById('wcRecentsSection');
    if (recentsEl) recentsEl.style.display = 'none';

    var html = '<div class="wc-section-label">Results / 搜索结果</div>';
    results.forEach(function (r) {
      var sourceLabel = r.source === 'invoice' ? '🧾 Invoice' : '📝 Manual';
      html += '<button class="wc-result-item" onclick="window.WC.selectCustomer(\'' + esc(r.contact) + '\', \'' + esc(r.name) + '\', \'' + esc(r.source) + '\')">' +
        '<div class="wc-result-name">' + esc(r.name || 'Unknown') + '</div>' +
        '<div class="wc-result-contact">' + esc(r.contact) + ' <span class="wc-result-source">' + sourceLabel + '</span></div>' +
        (r.lastSeen ? '<div class="wc-result-meta">Last seen: ' + formatDate(r.lastSeen) + '</div>' : '') +
        '</button>';
    });
    el.innerHTML = html;
  }

  // ─── Notes ─────────────────────────────────────────────────────────────
  function renderNotes() {
    var el = document.getElementById('wcNotesList');
    if (!el) return;
    var notes = state.currentNotes ? state.currentNotes.notes || [] : [];

    if (notes.length === 0) {
      el.innerHTML = '<div class="wc-empty wc-empty-notes">No notes yet / 暂无备注</div>';
      return;
    }

    var html = '';
    notes.slice().reverse().forEach(function (n) {
      html += '<div class="wc-note-item">' +
        '<div class="wc-note-text">' + esc(n.text) + '</div>' +
        '<div class="wc-note-meta">' +
          '<span>' + esc(n.createdByDisplay || 'Staff') + '</span>' +
          '<span>' + formatDate(n.createdAt) + '</span>' +
          '<button class="wc-note-del" onclick="window.WC.deleteNote(\'' + n._id + '\')">✕</button>' +
        '</div>' +
        '</div>';
    });
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  // ─── Templates ─────────────────────────────────────────────────────────
  function renderTemplateBar() {
    var el = document.getElementById('wcTemplatesBar');
    if (!el) return;
    var templates = state.templates;
    var html = '';
    templates.forEach(function (t) {
      var active = state.selectedTemplateId === t.id;
      // Store full text as data attribute so selectTemplate reads it from DOM directly
      html += '<button class="wc-tpl-chip' + (active ? ' active' : '') + '" data-id="' + esc(t.id) + '" data-text="' + esc(t.text) + '" onclick="window.WC.selectTemplate(\'' + t.id + '\')">' + esc(t.label) + '</button>';
    });
    el.innerHTML = html;
  }

  function getSelectedTemplate() {
    if (!state.selectedTemplateId) return null;
    return state.templates.find(function (t) { return t.id === state.selectedTemplateId; }) || null;
  }

  function fillTemplate(template, customerName) {
    var textarea = document.getElementById('wcMessageText');
    if (!textarea) return;
    var msg = template.text;
    // Replace placeholders
    msg = msg.replace(/\[name\]/g, customerName || 'Customer');
    textarea.value = msg;
  }

  // ─── Templates View ────────────────────────────────────────────────────
  function renderTemplatesView() {
    var el = document.getElementById('wcTemplatesView');
    if (!el) return;

    var html = '<div class="wc-tpl-editor">' +
      '<p class="wc-tpl-desc">Edit your quick message templates. Changes save automatically to this device.</p>';

    state.templates.forEach(function (t, i) {
      html += '<div class="wc-tpl-card">' +
        '<div class="wc-tpl-card-header">' +
          '<span class="wc-tpl-label">' + esc(t.label) + '</span>' +
          '<button class="wc-btn-ghost" onclick="window.WC.resetSingleTemplate(' + i + ')" title="Reset to default">↺</button>' +
        '</div>' +
        '<textarea class="wc-input wc-tpl-textarea" data-index="' + i + '" rows="3" oninput="window.WC.onTemplateEdit(this)">' + esc(t.text) + '</textarea>' +
        '</div>';
    });

    html += '<button class="wc-btn wc-btn-secondary" onclick="window.WC.resetAllTemplates()">↺ Reset All Templates</button>';
    html += '</div>';
    el.innerHTML = html;
  }

  // ─── Settings View ─────────────────────────────────────────────────────
  function renderSettingsView() {
    var el = document.getElementById('wcSettingsView');
    if (!el) return;

    el.innerHTML =
      '<div class="wc-settings">' +
        '<p class="wc-tpl-desc">WhatsApp Center uses <strong>wa.me</strong> links only — no API keys needed.</p>' +
        '<div class="wc-settings-card">' +
          '<h3>Phone Number Format</h3>' +
          '<ul class="wc-settings-list">' +
            '<li><code>0870908555</code> → <code>+353870908555</code> (auto-convert)</li>' +
            '<li><code>00447999999999</code> → kept as-is (international)</li>' +
            '<li><code>+447999999999</code> → kept as-is (already formatted)</li>' +
          '</ul>' +
        '</div>' +
        '<div class="wc-settings-card">' +
          '<h3>Data Sources</h3>' +
          '<p>Customer list is built from Invoice records and manually added contacts.</p>' +
        '</div>' +
        '<div class="wc-settings-card">' +
          '<h3>Clear Local Data</h3>' +
          '<button class="wc-btn wc-btn-danger" onclick="window.WC.clearLocalData()">🗑 Clear Recent Numbers & Templates</button>' +
        '</div>' +
      '</div>';
  }

  // ─── Phone Hint ────────────────────────────────────────────────────────
  function updatePhoneHint(input) {
    var el = document.getElementById('wcPhoneHint');
    if (!el) return;
    if (!input || !input.trim()) {
      el.textContent = '';
      return;
    }
    var normalized = normalizePhone(input);
    if (normalized !== input.trim()) {
      el.innerHTML = 'Will be sent as: <strong>' + esc(normalized) + '</strong>';
    } else {
      el.textContent = '';
    }
  }

  // ─── Actions (exposed on window.WC) ─────────────────────────────────────
  function switchTab(tab) {
    state.activeTab = tab;
    // Clear customer when switching away from search
    if (tab !== 'search') state.currentCustomer = null;
    state.noCustomerMatch = false;
    render();
  }

  function doSearch() {
    var input = document.getElementById('wcSearchInput');
    if (!input) return;
    var q = input.value.trim();
    if (q.length < 1) return;

    if (state.isLoading) return;
    state.isLoading = true;

    var resultsEl = document.getElementById('wcResultsSection');
    if (resultsEl) resultsEl.innerHTML = '<div class="wc-empty">Searching... / 搜索中...</div>';

    var digits = q.replace(/\D/g, '');
    var hasPhone = digits.length >= 7;

    searchCustomers(q).then(function (results) {
      state.searchResults = results;

      if (results && results.length > 0) {
        renderResults(results);
        // If input looks like a phone, also offer "send without selecting"
        if (hasPhone) {
          addContinueOption(q);
        }
      } else if (hasPhone) {
        // Phone input, no customer found → show button instead of auto-navigate
        // User must click to confirm number is complete
        addContinueOption(q);
      } else {
        if (resultsEl) resultsEl.innerHTML = '<div class="wc-empty">No customers found / 未找到客户</div>';
      }
    }).catch(function () {
      // On error, if phone-like, still allow sending
      if (hasPhone) {
        addContinueOption(q);
      } else if (resultsEl) {
        resultsEl.innerHTML = '<div class="wc-empty wc-error">Search failed / 搜索失败</div>';
      }
    }).finally(function () {
      state.isLoading = false;
    });
  }

  function addContinueOption(rawInput) {
    var resultsEl = document.getElementById('wcResultsSection');
    if (!resultsEl) return;
    var cleanPhone = rawInput.replace(/[\s\(\)\-]/g, '');
    resultsEl.innerHTML +=
      '<button class="wc-result-item" onclick="window.WC.continueWithoutCustomer(\'' + esc(cleanPhone) + '\')" style="border:2px dashed #34c759;text-align:center;color:#34c759;font-weight:600;">📱 Send to ' + esc(cleanPhone) + ' (no customer record)</button>';
  }

  function openComposeForPhone(rawInput) {
    var cleanPhone = rawInput.replace(/[\s\(\)\-]/g, '');
    state.currentCustomer = { contact: cleanPhone, name: '', source: 'manual' };
    state.selectedTemplateId = null;
    state.noCustomerMatch = true;
    getNotes(cleanPhone).then(function (notes) {
      state.currentNotes = notes;
      render();
    }).catch(function () {
      state.currentNotes = { phone: cleanPhone, name: '', notes: [] };
      render();
    });
  }

  function continueWithoutCustomer(phone) {
    state.currentCustomer = { contact: phone, name: '', source: 'manual' };
    state.selectedTemplateId = null;
    state.noCustomerMatch = true;
    getNotes(phone).then(function (notes) {
      state.currentNotes = notes;
      render();
    }).catch(function () {
      state.currentNotes = { phone: phone, name: '', notes: [] };
      render();
    });
  }

  function selectCustomer(contact, name, source) {
    state.currentCustomer = { contact: contact, name: name || '', source: source || 'manual' };
    state.selectedTemplateId = null;
    state.noCustomerMatch = false;

    // Load notes
    getNotes(contact).then(function (notes) {
      state.currentNotes = notes;
      render();
      // Focus message textarea after render
      setTimeout(function () {
        var ta = document.getElementById('wcMessageText');
        if (ta) ta.focus();
      }, 100);
    }).catch(function () {
      state.currentNotes = { phone: contact, name: name || '', notes: [] };
      render();
    });
  }

  function selectRecent(phone, name) {
    selectCustomer(phone, name || '', 'recent');
  }

  function clearCustomer() {
    state.currentCustomer = null;
    state.currentNotes = null;
    state.selectedTemplateId = null;
    state.noCustomerMatch = false;
    render();
    setTimeout(function () {
      var input = document.getElementById('wcSearchInput');
      if (input) input.focus();
    }, 100);
  }

  function selectTemplate(id) {
    state.selectedTemplateId = id;
    // Read text from the button's data-text attribute (most reliable)
    var chip = document.querySelector('.wc-tpl-chip[data-id="' + id + '"]');
    if (chip && chip.dataset.text) {
      var name = state.currentCustomer ? state.currentCustomer.name : '';
      var msg = chip.dataset.text.replace(/\[name\]/g, name || 'Customer');
      var textarea = document.getElementById('wcMessageText');
      if (textarea) textarea.value = msg;
    }
    // Update template bar styling using data-id
    var chips = document.querySelectorAll('.wc-tpl-chip');
    chips.forEach(function (c) {
      c.classList.toggle('active', c.dataset.id === id);
    });
  }

  function sendMessage() {
    var phoneInput = document.getElementById('wcSendPhone');
    var textarea = document.getElementById('wcMessageText');
    if (!phoneInput || !textarea) return;

    var phone = phoneInput.value.trim();
    var message = textarea.value.trim();

    if (!phone) {
      phoneInput.focus();
      phoneInput.style.borderColor = '#ff3b30';
      setTimeout(function () { phoneInput.style.borderColor = ''; }, 2000);
      return;
    }
    if (!message) {
      textarea.focus();
      return;
    }

    var normalized = openWhatsApp(phone, message);
    phoneInput.value = normalized;

    // Update recent with name if available
    if (state.currentCustomer && state.currentCustomer.name) {
      addRecentNumber(normalized, state.currentCustomer.name);
    }
  }

  function addNote() {
    var input = document.getElementById('wcNoteInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    var phone = state.currentCustomer ? state.currentCustomer.contact : '';
    var name = state.currentCustomer ? state.currentCustomer.name : '';
    if (!phone) return;

    addNote(phone, text, name).then(function (doc) {
      state.currentNotes = doc;
      input.value = '';
      renderNotes();
      renderRecents(); // might have updated name
    }).catch(function (err) {
      alert('Failed to add note: ' + err.message);
    });
  }

  function deleteNote(noteId) {
    if (!confirm('Delete this note? / 删除此备注？')) return;
    var phone = state.currentCustomer ? state.currentCustomer.contact : '';
    if (!phone) return;

    deleteNote(phone, noteId).then(function () {
      // Reload notes
      return getNotes(phone);
    }).then(function (doc) {
      state.currentNotes = doc;
      renderNotes();
    }).catch(function (err) {
      alert('Failed to delete note: ' + err.message);
    });
  }

  // ─── Template editing ──────────────────────────────────────────────────
  function onTemplateEdit(textarea) {
    var index = parseInt(textarea.dataset.index);
    state.templates[index].text = textarea.value;
    saveTemplates(state.templates);
  }

  function resetSingleTemplate(index) {
    if (!confirm('Reset this template to default?')) return;
    state.templates[index].text = DEFAULT_TEMPLATES[index].text;
    saveTemplates(state.templates);
    renderTemplatesView();
  }

  function resetAllTemplates() {
    if (!confirm('Reset ALL templates to defaults?')) return;
    state.templates = resetTemplates();
    renderTemplatesView();
  }

  // ─── Settings actions ──────────────────────────────────────────────────
  function clearLocalData() {
    if (!confirm('Clear all recent numbers and templates? This cannot be undone.')) return;
    localStorage.removeItem(RECENT_KEY);
    localStorage.removeItem(TEMPLATES_KEY);
    state.recents = [];
    state.templates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
    render();
  }

  function goBack() {
    // No-op for now; back button is hidden unless we add navigation history
  }

  // ─── Keyboard shortcuts ────────────────────────────────────────────────
  function initKeyboard() {
    document.addEventListener('keydown', function (e) {
      // Ctrl+Enter / Cmd+Enter to send
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        var textarea = document.getElementById('wcMessageText');
        if (textarea && document.activeElement === textarea) {
          e.preventDefault();
          sendMessage();
        }
      }
      // Escape to go back
      if (e.key === 'Escape' && state.currentCustomer) {
        clearCustomer();
      }
    });
  }

  // ─── Init ──────────────────────────────────────────────────────────────
  function init() {
    // Auth check
    if (!Auth.requireAuth()) return;

    state.recents = getRecentNumbers();
    state.templates = getTemplates();

    render();
    initKeyboard();
  }

  // ─── Expose public API ─────────────────────────────────────────────────
  window.WC = {
    switchTab: switchTab,
    doSearch: doSearch,
    selectCustomer: selectCustomer,
    selectRecent: selectRecent,
    clearCustomer: clearCustomer,
    selectTemplate: selectTemplate,
    sendMessage: sendMessage,
    addNote: addNote,
    deleteNote: deleteNote,
    onTemplateEdit: onTemplateEdit,
    resetSingleTemplate: resetSingleTemplate,
    resetAllTemplates: resetAllTemplates,
    continueWithoutCustomer: continueWithoutCustomer,
    clearLocalData: clearLocalData,
    goBack: goBack,
    init: init,
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
