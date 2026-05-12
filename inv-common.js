/**
 * Tech Cross 进销存系统 — 前端公共模块
 * JWT token 管理、API 请求封装、角色权限检查、通用工具
 */

const INV_API_BASE = '/api/inv';

// ─── Token 管理 ─────────────────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem('inv_token');
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('inv_user'));
  } catch {
    return null;
  }
}

function isLoggedIn() {
  const token = getToken();
  if (!token) return false;
  // Check token expiry (JWT payload is base64 encoded)
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      logout();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = 'inv-login.html';
    return false;
  }
  return true;
}

function requireAdmin() {
  if (!requireAuth()) return false;
  const user = getUser();
  if (!user || user.role !== 'root') {
    window.location.href = 'inv-login.html';
    return false;
  }
  return true;
}

function logout() {
  localStorage.removeItem('inv_token');
  localStorage.removeItem('inv_user');
  window.location.href = 'inv-login.html';
}

// ─── API 请求封装 ────────────────────────────────────────────────────────────

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + getToken()
  };
}

async function invFetch(url, opts) {
  opts = opts || {};
  opts.headers = authHeaders();
  const res = await fetch(INV_API_BASE + url, opts);
  if (res.status === 401) {
    logout();
    return null;
  }
  return res;
}

// ─── 角色权限检查 ────────────────────────────────────────────────────────────

function isAdmin() {
  const user = getUser();
  return user && user.role === 'root';
}

function isStaff() {
  const user = getUser();
  return user && (user.role === 'staff' || user.role === 'root');
}

/**
 * 初始化页面公共元素：显示用户名、角色、隐藏/显示管理菜单
 */
function initPageAuth() {
  if (!requireAuth()) return false;
  const user = getUser();

  // Display name
  const displayNameEl = document.getElementById('displayName');
  if (displayNameEl) displayNameEl.textContent = user.displayName || user.username;

  // Role badge
  const roleBadgeEl = document.getElementById('roleBadge');
  if (roleBadgeEl) roleBadgeEl.textContent = user.role === 'root' ? '店主' : '员工';

  // Show admin sections
  if (isAdmin()) {
    const adminSection = document.getElementById('adminSection');
    if (adminSection) adminSection.style.display = '';
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }

  return true;
}

// ─── 通用工具 ────────────────────────────────────────────────────────────────

function escHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showToast(msg, type) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;padding:14px 22px;border-radius:12px;font-size:14px;font-weight:500;box-shadow:0 8px 32px rgba(0,0,0,.15);transform:translateX(120%);transition:transform .3s ease;max-width:400px;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = '';
  toast.style.background = type === 'error' ? '#ff3b30' : type === 'success' ? '#34c759' : '#0071e3';
  toast.style.color = '#fff';
  setTimeout(() => { toast.style.transform = 'translateX(0)'; }, 10);
  setTimeout(() => { toast.style.transform = 'translateX(120%)'; }, 3000);
}

// Export for use in HTML pages
if (typeof window !== 'undefined') {
  window.invAuth = { getToken, getUser, isLoggedIn, requireAuth, requireAdmin, logout, isAdmin, isStaff, initPageAuth };
  window.invApi = { invFetch, authHeaders, INV_API_BASE };
  window.invUtils = { escHtml, showToast };
}
