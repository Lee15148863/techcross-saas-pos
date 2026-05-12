/**
 * auth-guard.js — Unified Authentication Module
 *
 * SINGLE source of truth for all auth logic across the system.
 * Every HTML page MUST use this module instead of inline auth code.
 *
 * Usage:
 *   <script src="auth-guard.js"></script>
 *   const user = Auth.requireAuth();         // redirects to login if invalid
 *   const user = Auth.requireRole('root');    // redirects if not root
 *   if (Auth.isRoot()) { ... }               // non-blocking role check
 *   Auth.logout();                           // clears session + redirects
 *   Auth.getHeaders();                       // { Authorization: Bearer ... }
 */
(function (global) {
  'use strict';

  var AUTH = {
    // ─── Get current user object ───────────────────────────────────────────
    // Reads from localStorage (inv_user), falls back to JWT parsing.
    getUser: function () {
      try {
        var user = JSON.parse(localStorage.getItem('inv_user'));
        if (user && user.role) return user;
      } catch (_) {}
      // Fallback: parse JWT payload directly
      try {
        var token = localStorage.getItem('inv_token');
        if (!token) return null;
        var payload = JSON.parse(atob(token.split('.')[1]));
        return { id: payload.userId, username: payload.username, role: payload.role };
      } catch (_) {}
      return null;
    },

    // ─── Get auth token ────────────────────────────────────────────────────
    getToken: function () {
      return localStorage.getItem('inv_token');
    },

    // ─── Get auth headers for API calls ────────────────────────────────────
    getHeaders: function () {
      var token = this.getToken();
      return token
        ? { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
        : { 'Content-Type': 'application/json' };
    },

    // ─── Get display name (safe) ───────────────────────────────────────────
    getDisplayName: function () {
      var user = this.getUser();
      return user ? user.displayName || user.username || '-' : '-';
    },

    // ─── Require any authenticated user ────────────────────────────────────
    // Returns user object. Redirects to login if invalid.
    requireAuth: function () {
      var user = this.getUser();
      var token = this.getToken();
      if (!token || !user) {
        this.redirectToLogin();
        return null;
      }
      return user;
    },

    // ─── Require specific role ─────────────────────────────────────────────
    // Returns user object. Redirects to login/403 if role doesn't match.
    requireRole: function (role) {
      var user = this.requireAuth();
      if (!user) return null;
      if (user.role !== role) {
        this.redirectToLogin();
        return null;
      }
      return user;
    },

    // ─── Non-blocking role check ───────────────────────────────────────────
    hasRole: function (role) {
      var user = this.getUser();
      return !!user && user.role === role;
    },

    // ─── Shorthand role checks ─────────────────────────────────────────────
    isRoot: function () {
      return this.hasRole('root');
    },
    isManager: function () {
      return this.hasRole('manager');
    },
    isStaff: function () {
      return this.hasRole('staff');
    },

    // ─── Redirect to login ─────────────────────────────────────────────────
    redirectToLogin: function () {
      window.location.href = 'inv-login.html';
    },

    // ─── Logout ────────────────────────────────────────────────────────────
    logout: function () {
      localStorage.removeItem('inv_token');
      localStorage.removeItem('inv_user');
      this.redirectToLogin();
    },

    // ─── Get role badge HTML ───────────────────────────────────────────────
    getRoleBadgeHTML: function () {
      var user = this.getUser();
      if (!user) return '<span class="badge badge-staff">-</span>';
      if (user.role === 'root') {
        return '<span class="badge badge-root">店主 Root</span>';
      }
      return '<span class="badge badge-staff">员工 Staff</span>';
    }
  };

  // ─── Expose globally ───────────────────────────────────────────────────
  global.Auth = AUTH;
  global.requireAuth = function () { return AUTH.requireAuth(); };
  global.requireRole = function (r) { return AUTH.requireRole(r); };
  global.logout = function () { AUTH.logout(); };
})(window);
