/**
 * balance.js — Universal Balance Display (Web version)
 * Loads exchange rates and updates balance display across all pages.
 */
const BalanceManager = {
  _rates: null,
  _RATES_KEY: 'trustex_web_rates',

  formatNumber(num, decimals = 2) {
    return num.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).replace(/,/g, '.');
  },

  async loadRates() {
    if (this._rates && this._rates.ts && Date.now() - this._rates.ts < 60000) return this._rates;
    try {
      const cached = JSON.parse(localStorage.getItem(this._RATES_KEY) || 'null');
      if (cached && cached.ts && Date.now() - cached.ts < 5 * 60 * 1000) {
        this._rates = cached;
        return cached;
      }
    } catch(e) {}
    try {
      const res = await fetch('/api/exchange/rate');
      if (res.ok) {
        const payload = await res.json();
        if (payload.data) {
          this._rates = {
            rub_to_usdt: payload.data.rub_to_usdt,
            usdt_to_rub: payload.data.usdt_to_rub,
            eur_to_usdt: payload.data.eur_to_usdt,
            usdt_to_eur: payload.data.usdt_to_eur,
            byn_to_usdt: payload.data.byn_to_usdt,
            usdt_to_byn: payload.data.usdt_to_byn,
            BTC: payload.data.rates?.BTC || 0,
            ETH: payload.data.rates?.ETH || 0,
            TON: payload.data.rates?.TON || 0,
            ts: Date.now()
          };
          localStorage.setItem(this._RATES_KEY, JSON.stringify(this._rates));
          return this._rates;
        }
      }
    } catch(e) {}
    try {
      const cached = JSON.parse(localStorage.getItem(this._RATES_KEY) || 'null');
      if (cached) { this._rates = cached; return cached; }
    } catch(e) {}
    this._rates = { rub_to_usdt: 0.012, usdt_to_rub: 83.33, eur_to_usdt: 1.089, usdt_to_eur: 0.9183, byn_to_usdt: 0.3058, usdt_to_byn: 3.27, BTC: 84000, ETH: 3200, TON: 3.5, ts: 0 };
    return this._rates;
  },

  _ensureRates() {
    if (this._rates) return this._rates;
    try {
      const cached = JSON.parse(localStorage.getItem(this._RATES_KEY) || 'null');
      if (cached && cached.rub_to_usdt) {
        if (!cached.byn_to_usdt) { cached.byn_to_usdt = 0.3058; cached.usdt_to_byn = 3.27; }
        this._rates = cached;
        return cached;
      }
    } catch(e) {}
    return { rub_to_usdt: 0.012, usdt_to_rub: 83.33, eur_to_usdt: 1.089, usdt_to_eur: 0.9183, byn_to_usdt: 0.3058, usdt_to_byn: 3.27, BTC: 84000, ETH: 3200, TON: 3.5, ts: 0 };
  },

  rubToUsd(rubAmount) {
    const r = this._ensureRates();
    return rubAmount * (r.rub_to_usdt || 0.012);
  },
  eurToUsd(eurAmount) {
    const r = this._ensureRates();
    return eurAmount * (r.eur_to_usdt || 1.089);
  },
  bynToUsd(bynAmount) {
    const r = this._ensureRates();
    return bynAmount * (r.byn_to_usdt || 0.3058);
  },
  cryptoPrice(currency) {
    const r = this._ensureRates();
    return r[currency] || 0;
  },
  getRates() {
    return this._ensureRates();
  },

  async init() {
    try {
      await this.loadRates();
      if (!Auth.isLoggedIn()) return;

      const res = await Auth.apiFetch('/api/profile');
      if (res.ok) {
        const data = await res.json();
        if (data.data) this.updateBalanceElements(data.data);
      }
    } catch (error) { /* silent */ }
  },

  updateBalanceElements(user) {
    const b = (f) => parseFloat(user['balance_' + f] ?? user[f]) || 0;
    const balanceUsdt = b('usdt');
    const balanceBtc = b('btc');
    const balanceRub = b('rub');
    const balanceEur = b('eur');
    const balanceByn = b('byn');
    const balanceTon = b('ton');
    const balanceEth = b('eth');

    const rubInUsd = this.rubToUsd(balanceRub);
    const eurInUsd = this.eurToUsd(balanceEur);
    const bynInUsd = this.bynToUsd(balanceByn);
    const totalUsd = balanceUsdt + rubInUsd + eurInUsd + bynInUsd;

    const fmt = this.formatNumber.bind(this);
    const updates = {
      'userUsdtBalance': `${fmt(balanceUsdt)} USDT`,
      'usdt-balance': `${fmt(balanceUsdt)} USDT`,
      'bal-USDT': `${fmt(balanceUsdt)} USDT`,
      'usdtBalance': `${fmt(balanceUsdt)} $`,
      'btc-balance': `${fmt(balanceBtc, 8)} BTC`,
      'bal-BTC': `${fmt(balanceBtc, 8)} BTC`,
      'btcBalance': `${fmt(balanceBtc, 8)} $`,
      'rub-balance': `${fmt(balanceRub)} ₽`,
      'bal-RUB': `${fmt(balanceRub)} ₽`,
      'rubBalance': `${fmt(balanceRub)} ₽`,
      'bal-EUR': `${fmt(balanceEur)} €`,
      'eurBalance': `${fmt(balanceEur)} €`,
      'bal-BYN': `${fmt(balanceByn)} Br`,
      'bynBalance': `${fmt(balanceByn)} Br`,
      'bal-TON': `${fmt(balanceTon, 4)} TON`,
      'tonBalance': `${fmt(balanceTon, 4)} $`,
      'bal-ETH': `${fmt(balanceEth, 6)} ETH`,
      'ethBalance': `${fmt(balanceEth, 6)} $`,
      'available-balance': `${fmt(balanceUsdt)} USDT`,
    };

    for (const [id, value] of Object.entries(updates)) {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = value;
        el.classList.remove('skeleton');
        el.classList.add('loaded');
      }
    }

    window.USER_BALANCES = {
      usdt: balanceUsdt, btc: balanceBtc, rub: balanceRub, eur: balanceEur,
      byn: balanceByn, ton: balanceTon, eth: balanceEth, totalUsd: totalUsd,
      min_deposit: parseFloat(user.min_deposit) || 0,
      min_withdraw: parseFloat(user.min_withdraw) || 0
    };
  },

  async refresh() {
    try {
      await this.loadRates();
      const res = await Auth.apiFetch('/api/profile');
      if (res.ok) {
        const data = await res.json();
        if (data.data) this.updateBalanceElements(data.data);
        return data.data;
      }
    } catch(e) {}
    return null;
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  await BalanceManager.loadRates();
  const p = window.location.pathname;
  if (p === '/' || p === '/index.html' || p === '/wallet.html') return;
  BalanceManager.init();
});
