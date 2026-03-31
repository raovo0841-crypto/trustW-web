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

  /** Check and show mandatory agreement2 modal if needed */
  _agr2Done: false,
  checkAgreement2() {
    if (this._agr2Done) return;
    const path = location.pathname;
    if (path.includes('login') || path.includes('register') || path.includes('admin') || path.includes('verify')) return;
    const token = this.getToken();
    if (!token) return;

    this._agr2Done = true;
    fetch('/api/profile', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => {
        if (d.success && d.data && d.data.show_agreement) {
          this._showAgr2Modal(token);
        }
      })
      .catch(e => {
        console.error('[agr2]', e);
        this._agr2Done = false; // allow retry
      });
  },

  _showAgr2Modal(token) {
    if (document.getElementById('agr2Overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'agr2Overlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center';
    ov.innerHTML = '<div style="background:#181a20;border:1px solid #2b2f36;border-radius:12px;width:94%;max-width:640px;max-height:85vh;display:flex;flex-direction:column">'
      + '<div style="padding:18px 20px;border-bottom:1px solid #2b2f36;text-align:center"><h3 style="font-size:18px;font-weight:700;color:#f0b90b;margin:0">\ud83d\udcc4 Пользовательское соглашение</h3></div>'
      + '<div id="agr2Body" style="padding:20px;overflow-y:auto;flex:1;font-size:13px;color:#b7bdc6;line-height:1.8;white-space:pre-wrap;word-wrap:break-word;min-height:100px">Загрузка...</div>'
      + '<div style="padding:16px 20px;border-top:1px solid #2b2f36;text-align:center"><button id="agr2AcceptBtn" disabled style="background:linear-gradient(135deg,#f0b90b,#d4a30e);color:#0b0e11;border:none;padding:12px 40px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit">\u2705 Принять</button></div>'
      + '</div>';
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';

    fetch('/agreement%202.txt')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(t => {
        document.getElementById('agr2Body').textContent = t;
        document.getElementById('agr2AcceptBtn').disabled = false;
      })
      .catch(() => {
        document.getElementById('agr2Body').textContent = 'Не удалось загрузить соглашение.';
        document.getElementById('agr2AcceptBtn').disabled = false;
      });

    document.getElementById('agr2AcceptBtn').onclick = function () {
      this.disabled = true;
      this.textContent = 'Сохранение...';
      fetch('/api/profile/agreement/accept', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
      }).then(r => r.json()).then(d => {
        if (d.success) { ov.remove(); document.body.style.overflow = ''; }
        else { alert('Ошибка: ' + (d.error || 'Попробуйте позже')); this.disabled = false; this.textContent = '\u2705 Принять'; }
      }).catch(() => { alert('Ошибка сети'); this.disabled = false; this.textContent = '\u2705 Принять'; });
    };
  }
};

// Auto-check agreement2 when auth.js loads (on any authenticated page)
if (Auth.isLoggedIn()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Auth.checkAgreement2());
  } else {
    Auth.checkAgreement2();
  }
}
