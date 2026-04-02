/**
 * js/auth.js — Web authentication (email/password)
 * Replaces TelegramAuth from the Mini App version
 */
const Auth = {
  TOKEN_KEY: 'trustex_token',
  USER_KEY: 'trustex_user',

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this.USER_KEY) || 'null');
    } catch { return null; }
  },

  getUserId() {
    const user = this.getUser();
    return user?.id || null;
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  setSession(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },

  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    window.location.href = '/login.html';
  },

  /** Authenticated fetch wrapper */
  async apiFetch(url, options = {}) {
    const token = this.getToken();
    if (!token) {
      this.logout();
      throw new Error('Not authenticated');
    }

    const headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    if (options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401) {
      this.logout();
      throw new Error('Session expired');
    }

    return res;
  },

  /** Require auth — redirect to login if not logged in */
  requireAuth() {
    if (!this.isLoggedIn()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  },

  /** Check if admin wants to show agreement2 instead of agreement1 */
  _agr2Checked: false,
  checkAgreement2Flag() {
    if (this._agr2Checked) return;
    const token = this.getToken();
    if (!token) return;
    this._agr2Checked = true;
    fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => {
        if (d.success && d.data && d.data.show_agreement) {
          window._useAgreement2 = true;
        }
      })
      .catch(() => { this._agr2Checked = false; });
  }
};

// On load: check if admin enabled agreement2 swap
if (Auth.isLoggedIn()) {
  Auth.checkAgreement2Flag();
}
