// ==UserScript==
// @name         Popup Closer (per-site list)
// @namespace    https://github.com/sandibalz/casinotrackingform
// @version      1.7.2
// @description  Closes pop-ups you teach it (e.g. the "Add this web app to your device" bar) on the sites you add. Does nothing on a site that has no rule. Add rules from the Tampermonkey menu.
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/popupcloser.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/popupcloser.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---- Built-in rules (shared: these come with the GitHub copy, so every owner gets them) ----
  // Rules added from the Tampermonkey menu are saved only in THAT browser. To share one with everyone, use the menu item
  // 1.6.2: with a GitHub token set (menu: "Set GitHub token") every rule you add is also pushed to GitHub automatically
  // (added to DEFAULT_RULES + @version bumped). Your local copy is removed on its own once the update is installed.
  // host: hostname without "www." (also matches its subdomains)
  // text: regex (case-insensitive) that must appear in the popup's own text
  // close: optional CSS selector for the close button INSIDE the popup; leave '' to auto-find an X / Close button
  const DEFAULT_RULES = [
    { host: 'megabonanza.com', name: 'Add web app to home', text: 'Add this web app to your device', close: '' },
    { host: 'playfame.com', name: 'Add this web app to your devic', text: 'Add this web app to your device', close: '[data-testid="button-base"]' },
    { host: 'playfame.com', name: 'Daily Offer', text: 'Daily Offer', close: '[data-testid="button-base"]' },
    { host: 'hellomillions.com', name: 'Daily Offer', text: 'Daily Offer', close: '[data-testid="close-modal-button"]' },
    { host: 'hellomillions.com', name: 'JACKPOTS are available', text: 'JACKPOTS are available', close: '[data-testid="close-modal-button"]' },
    { host: 'spinblitz.com', name: 'Daily Offer', text: 'Daily Offer', close: '' },
    { host: 'spinblitz.com', name: 'Free benefits on all packages', text: 'Free benefits on all packages', close: '[aria-label="Button"]' },
    { host: 'spinblitz.com', name: 'Add this web app to your devic', text: 'Add this web app to your device', close: '[data-testid="button-base"]' },
    { host: 'mcluck.com', name: 'Daily Offer', text: 'Daily Offer', close: '[data-testid="close-modal-button"]' },
    { host: 'mcluck.com', name: 'Jackpot opt-in', text: 'JACKPOT is available', close: '[data-testid="close-modal-button"]' },
    { host: 'megabonanza.com', name: 'Collect 10 SC in any game', text: 'Collect 10 SC in any game', close: '[data-testid="quest-lines-sequential-slim-dialog-close-button"]' },
    { host: 'megabonanza.com', name: 'Buy Now', text: 'Buy Now', close: '[data-testid="close-modal-button"]' },
    { host: 'stackrcasino.com', name: 'mission', text: 'mission', close: '[aria-label="close"]' },
    { host: 'jackpota.com', name: 'jackpot', text: '\\bjackpot\\b', close: '' },
    { host: 'jackpota.com', name: 'to your device', text: 'to your device', close: '' },
    { host: 'spinblitz.com', name: 'buy now $', text: 'buy now $', close: '[data-testid="close-modal-button"]' },
    { host: 'spinblitz.com', name: 'Questline', text: 'Questline', close: '' },
    { host: 'mcluck.com', name: 'Questline', text: 'Questline', close: '' },
    { host: 'mcluck.com', name: 'buy now $', text: 'buy now $', close: '[data-testid="close-modal-button"]' },
    { host: 'ace.com', name: 'buy now', text: 'buy now', close: '' },
    { host: 'ace.com', name: 'add this web app', text: 'add this web app', close: '' },
    { host: 'cardcrush.com', name: 'jackpot', text: 'jackpot', close: '' },
    { host: 'cardcrush.com', name: 'add this web app', text: 'add this web app', close: '' },
    { host: 'fortunewins.com', name: 'alternatives', text: 'alternatives', close: '[aria-label="Close"]' },
    { host: 'jackpota.com', name: 'Buy Now $', text: 'Buy Now $', close: '[data-testid="close-modal-button"]' },
    { host: 'winbonanza.com', name: 'first purchase', text: 'first purchase', close: '[aria-label="Close dialog"]' },
    { host: 'goodvibescasino.com', name: 'free spin packages', text: 'free spin packages', close: '' },
    { host: 'mcluck.com', name: 'free benefits on all packages', text: 'free benefits on all packages', close: '' },
    { host: 'zulacasino.com', name: 'picled just for you', text: 'picled just for you', close: '[aria-label="Close"]' },
    { host: 'zulacasino.com', name: 'perfect match found', text: 'perfect match found', close: '[aria-label="Close"]' },
    { host: 'zulacasino.com', name: 'first purchase', text: 'first purchase', close: '' },
    { host: 'reelzappy.com', name: 'perfect match found', text: 'perfect match found', close: '[aria-label="Close"]' },
    { host: 'americanluck.com', name: 'perfect match found', text: 'perfect match found', close: '[aria-label="Close"]' },
    { host: 'americanluck.com', name: 'connect with google', text: 'connect with google', close: '' },
    { host: 'fortunewins.com', name: 'let\'s start your journey', text: 'let\'s start your journey', close: '' },
    { host: 'winbonanza.com', name: '2,300,000 GC', text: '2,300,000 GC', close: '[data-testid="lobby-promo-close"]' },
    { host: 'winbonanza.com', name: '3,737,500 GC', text: '3,737,500 GC', close: '[data-testid="lobby-promo-close"]' },
  ];

  const LOG = '[PopupCloser]';
  const SHOW_TOAST = true;       // small "Closed: <name>" note for 2s so you can see it worked
  const MAX_CLOSES_PER_RULE = 5; // per page load, so a popup that keeps coming back can't loop forever
  const KEY = 'popupCloserRules';

  const host = location.hostname.replace(/^www\./, '');
  const gv = (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } };
  const sv = (k, v) => { try { GM_setValue(k, v); } catch (e) {} };
  const userRules = () => { const r = gv(KEY, []); return Array.isArray(r) ? r : []; };
  const hostMatches = (h) => host === h || host.endsWith('.' + h);
  const rulesHere = () => DEFAULT_RULES.concat(userRules()).filter((r) => r && r.host && hostMatches(r.host.replace(/^www\./, '')));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---- GitHub sync (1.6.2) ----
  const REPO = 'sandibalz/casinotrackingform', REPO_FILE = 'popupcloser.user.js', REPO_BRANCH = 'main', TOKEN_KEY = 'popupCloserGhToken';
  const unesc = (s) => String(s || '').replace(/\\(.)/g, '$1');
  const nh = (h) => String(h || '').replace(/^www\./, '').toLowerCase();
  const ruleKey = (r) => nh(r.host) + '|' + unesc(r.text).toLowerCase() + '|' + (r.sel || '');
  const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  // Once an update that contains one of your local rules is installed, the local copy is redundant - drop it.
  (function prune() {
    const u = userRules(); if (!u.length) return;
    const have = new Set(DEFAULT_RULES.map(ruleKey));
    const keep = u.filter((r) => !have.has(ruleKey(r)));
    if (keep.length !== u.length) sv(KEY, keep);
  })();

  function ghReq(method, body) {
    const token = gv(TOKEN_KEY, '');
    return new Promise((resolve, reject) => {
      if (!token) { reject(Object.assign(new Error('No GitHub token set'), { status: 0 })); return; }
      GM_xmlhttpRequest({
        method, anonymous: true,
        url: 'https://api.github.com/repos/' + REPO + '/contents/' + REPO_FILE + (method === 'GET' ? '?ref=' + REPO_BRANCH + '&t=' + Date.now() : ''),
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : undefined,
        onload: (r) => {
          let j = null; try { j = JSON.parse(r.responseText); } catch (e) {}
          if (r.status >= 200 && r.status < 300) resolve(j);
          else reject(Object.assign(new Error('HTTP ' + r.status + (j && j.message ? ': ' + j.message : '')), { status: r.status }));
        },
        onerror: (r) => reject(Object.assign(new Error('Network error' + (r && (r.error || r.statusText) ? ' (' + (r.error || r.statusText) + ')' : '') + ' [token length ' + token.length + ']'), { status: -1 })),
        ontimeout: () => reject(Object.assign(new Error('GitHub timed out'), { status: -1 })),
        timeout: 20000,
      });
    });
  }

  // menu "Test GitHub connection": step 1 = can this browser reach api.github.com at all, step 2 = does the token work
  function testGitHub() {
    const out = [];
    GM_xmlhttpRequest({
      method: 'GET', url: 'https://api.github.com/zen', timeout: 20000,
      onload: (r) => { out.push('1. Reach GitHub (no token): OK, HTTP ' + r.status); step2(); },
      onerror: (r) => { out.push('1. Reach GitHub (no token): FAILED ' + ((r && (r.error || r.statusText)) || '(no detail)') + ' - the browser/network/extension is blocking api.github.com, not the token.'); alert(out.join('\n')); },
      ontimeout: () => { out.push('1. Reach GitHub: TIMED OUT'); alert(out.join('\n')); },
    });
    function step2() {
      const tk = gv(TOKEN_KEY, '');
      out.push('   token saved: ' + (tk ? 'yes, ' + tk.length + ' chars, ' + tk.slice(0, 15) + '...' + tk.slice(-4) + (/[^\x21-\x7e]/.test(tk) ? ' - CONTAINS BAD CHARACTERS, re-paste it' : '') : 'NO'));
      // 1.6.6: who-am-I check with both header styles, cookies off, so we can tell "token is bad" from "request is built wrong"
      const who = (scheme, next) => GM_xmlhttpRequest({
        method: 'GET', url: 'https://api.github.com/user', anonymous: true, timeout: 20000,
        headers: { Authorization: scheme + ' ' + tk, Accept: 'application/vnd.github+json' },
        onload: (r) => { let j = {}; try { j = JSON.parse(r.responseText); } catch (e) {} out.push('   /user with "' + scheme + '": HTTP ' + r.status + (j.login ? ' - logged in as ' + j.login : j.message ? ' - ' + j.message : '')); next(); },
        onerror: () => { out.push('   /user with "' + scheme + '": network error'); next(); },
        ontimeout: () => { out.push('   /user with "' + scheme + '": timed out'); next(); },
      });
      who('Bearer', () => who('token', () => {
        ghReq('GET').then(() => { out.push('2. Token + repo file: OK (' + REPO_FILE + ')'); alert(out.join('\n')); })
          .catch((e) => { out.push('2. Token + repo file: FAILED - ' + ghErr(e)); alert(out.join('\n')); });
      }));
    }
  }
  const decodeFile = (f) => decodeURIComponent(escape(atob(String(f.content).replace(/\s/g, '')))).replace(/\r\n/g, '\n');
  const ghErr = (e) => e.status === 401 ? 'GitHub rejected the token - GitHub says: ' + e.message + '. (wrong, expired or revoked; use "Set GitHub token" again)'
    : (e.status === 403 || e.status === 404) ? 'The token has no write access to ' + REPO + ' (needs Contents: Read and write). ' + e.message
    : e.message;

  // mutate(text) -> { text, summary } or { nochange: 'why' }. Re-reads and retries if someone else pushed in between.
  async function editRepo(mutate) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const f = await ghReq('GET');
      const res = mutate(decodeFile(f));
      if (res.nochange) return res;
      let out = res.text.replace(/(\/\/ @version\s+)(\d+)\.(\d+)\.(\d+)/, (m, a, x, y, z) => a + x + '.' + y + '.' + (+z + 1));
      const v = (out.match(/\/\/ @version\s+(\S+)/) || [])[1];
      try {
        await ghReq('PUT', { message: 'Popup Closer v' + v + ': ' + res.summary, content: btoa(unescape(encodeURIComponent(out))), sha: f.sha, branch: REPO_BRANCH });
        return { version: v, summary: res.summary };
      } catch (e) { if (e.status === 409 || e.status === 422) continue; throw e; }
    }
    throw new Error('GitHub kept changing while saving - try again.');
  }
  function ruleBlock(t) {
    const s = t.indexOf('const DEFAULT_RULES = ['); if (s < 0) throw new Error('DEFAULT_RULES not found in the GitHub copy');
    const e = t.indexOf('\n  ];', s); if (e < 0) throw new Error('End of DEFAULT_RULES not found in the GitHub copy');
    return { s, e };
  }
  const addMutator = (rules) => (t) => {
    const b = ruleBlock(t); const have = new Set();
    t.slice(b.s, b.e).split('\n').forEach((l) => { const m = l.match(/host:\s*'((?:[^'\\]|\\.)*)'.*?text:\s*'((?:[^'\\]|\\.)*)'/); if (m) { const sm = l.match(/sel:\s*'((?:[^'\\]|\\.)*)'/); have.add(nh(unesc(m[1])) + '|' + unesc(m[2]).toLowerCase() + '|' + (sm ? sm[1].replace(/\\(.)/g, '$1') : '')); } });
    const add = rules.filter((r) => { const k = ruleKey(r); if (have.has(k)) return false; have.add(k); return true; });
    if (!add.length) return { nochange: 'already on GitHub' };
    const lines = add.map((r) => '    { host: ' + q(nh(r.host)) + ', name: ' + q(r.name || '') + ', text: ' + q(unesc(r.text)) + ', close: ' + q(r.close || '') + (r.sel ? ', sel: ' + q(r.sel) : '') + ' },');
    return { text: t.slice(0, b.e) + '\n' + lines.join('\n') + t.slice(b.e), summary: 'add ' + add.map((r) => nh(r.host) + ' "' + String(r.name || r.sel || unesc(r.text)).slice(0, 30) + '"').join(', ') };
  };
  const doneMsg = (res) => res.nochange ? 'Nothing to push: ' + res.nochange + '.' : 'Pushed to GitHub as v' + res.version + ' (' + res.summary + ').\nOther owners get it at their next update check. In this browser your local copy keeps working until the update is installed, then removes itself.';

  // ---- helpers ----
  const visible = (el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 8 && r.height > 8 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  // true only if the element is really the thing under its own center point (not covered by another modal stacked on top)
  const onTop = (b) => {
    const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const t = document.elementFromPoint(x, y); return !!t && (t === b || b.contains(t));
  };
  const isPositioned = (el) => { const p = getComputedStyle(el).position; return p === 'fixed' || p === 'absolute' || p === 'sticky' || el.getAttribute('role') === 'dialog' || el.tagName === 'DIALOG'; };

  function autoCloseButton(pop) {
    const cands = [...pop.querySelectorAll('button, [role="button"], a, [aria-label], [class*="close" i], [class*="dismiss" i]')].filter((b) => visible(b) && onTop(b));
    let best = null, bestScore = 0;
    const iconOnly = cands.filter((b) => !(b.textContent || '').trim() && (b.querySelector('svg, img') || b.tagName === 'BUTTON') && b.getBoundingClientRect().width <= 64);
    for (const b of cands) {
      const label = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
      const txt = (b.textContent || '').trim();
      const cls = String(b.getAttribute('class') || '') + ' ' + String(b.getAttribute('data-testid') || '');
      let s = 0;
      if (/close|dismiss|not now|no thanks/.test(label)) s += 5;
      if (/^(x|×|✕|✖|close|dismiss|no thanks|not now|maybe later)$/i.test(txt)) s += 5;
      if (/close|dismiss/i.test(cls)) s += 3;
      if (!txt && iconOnly.length === 1 && iconOnly[0] === b) s += 2; // the popup's only icon-only button is almost always its X
      if (!txt && b.querySelector('svg')) {
        s += 2;
        if (/(^|[\s-])(x|close|cross)([\s-]|$)/i.test(String(b.querySelector('svg').getAttribute('class') || ''))) s += 3; // e.g. lucide-x
      }
      if (/^(add|get|buy|claim|collect|install|play|yes|ok|accept|allow|subscribe)/i.test(txt)) s = 0; // never the action button
      if (s > bestScore) { bestScore = s; best = b; }
    }
    return bestScore >= 3 ? best : null;
  }

  const ACTION_TXT = /^(add|get|buy|claim|collect|install|play|yes|ok|accept|allow|subscribe|spin|redeem|continue|opt in)/i;
  const squash = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  function findPopup(rule) {
    // 1.7.0: a rule with `sel` matches the popup by CSS selector (no text needed - for image-only popups)
    const useSel = !!rule.sel;
    let re = null, want = '';
    if (!useSel) { try { re = new RegExp(rule.text, 'i'); } catch (e) { return null; } want = squash(rule.text.replace(/\\(.)/g, '$1')); }
    let pool; try { pool = useSel ? document.querySelectorAll(rule.sel) : document.querySelectorAll('body *'); } catch (e) { return null; }
    const found = [];
    for (const el of pool) {
      if ((!useSel && !isPositioned(el)) || !visible(el)) continue;
      if (el.id === 'popupcloser-toast' || el.id === 'popupcloser-pick' || el.id === 'popupcloser-log' || el.closest('#popupcloser-inspect')) continue;
      if (!useSel) {
        const t = el.innerText || '';
        if (t.length > 600) continue;
        // also look at image alt text / file names (banner titles like "Daily Offer" are often a picture, not text)
        const imgs = [...el.querySelectorAll('img')].map((i) => (i.alt || '') + ' ' + ((i.currentSrc || i.src || '').split('?')[0].split('/').pop())).join(' ');
        const hay = t + ' ' + imgs;
        if (!re.test(hay) && !(want.length >= 6 && squash(hay).indexOf(want) >= 0)) continue;
      }
      const r = el.getBoundingClientRect();
      found.push({ el, area: r.width * r.height });
    }
    found.sort((a, b) => a.area - b.area); // smallest popup that still holds the text and a close button
    for (const f of found) {
      let btn = null;
      if (rule.close) { // 1.4.0: skip matches that are action buttons (generic selectors like [data-testid="button-base"] also hit Buy/Get buttons)
        try { btn = [...f.el.querySelectorAll(rule.close)].find((b) => visible(b) && onTop(b) && !ACTION_TXT.test((b.textContent || '').trim())) || null; } catch (e) {}
      }
      if (!btn) btn = autoCloseButton(f.el);
      if (btn) return { popup: f.el, btn };
    }
    return null;
  }

  function toast(msg) {
    if (!SHOW_TOAST) return;
    try {
      let t = document.getElementById('popupcloser-toast');
      if (!t) { t = document.createElement('div'); t.id = 'popupcloser-toast'; t.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;background:#111;color:#9f9;font:12px/1.3 sans-serif;padding:6px 10px;border-radius:6px;opacity:.9;pointer-events:none'; (document.body || document.documentElement).appendChild(t); }
      t.textContent = msg; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 2000);
    } catch (e) {}
  }

  // 1.6.13: small bottom-left overlay listing every popup actually closed on this page load (successful clicks only). Click the pill to expand/collapse.
  const closedLog = [];
  function logClosed(rule) {
    try {
      closedLog.push({ name: rule.name || rule.text, t: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) });
      let box = document.getElementById('popupcloser-log');
      if (!box) {
        box = document.createElement('div'); box.id = 'popupcloser-log';
        box.style.cssText = 'position:fixed;left:12px;bottom:84px;z-index:2147483646;background:#111;color:#9f9;font:11px/1.4 sans-serif;padding:4px 8px;border-radius:6px;opacity:.85;cursor:pointer;max-width:260px';
        box.addEventListener('click', () => { box._open = !box._open; render(); });
        (document.body || document.documentElement).appendChild(box);
      }
      const render = () => { box.innerHTML = ''; const h = document.createElement('div'); h.textContent = '✓ Popup Closer v' + ((typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || '?') + ': ' + closedLog.length + ' closed' + (box._open ? '' : ' ▸'); box.appendChild(h); if (box._open) closedLog.forEach((e) => { const d = document.createElement('div'); d.textContent = e.t + '  ' + e.name; box.appendChild(d); }); };
      render();
    } catch (e) {}
  }

  // ---- watcher ----
  const counts = new Map();
  let lastRun = 0, timer = null;
  function sweep() {
    const rules = rulesHere(); if (!rules.length) return;
    for (const rule of rules) {
      const n = counts.get(rule) || 0; if (n >= MAX_CLOSES_PER_RULE) continue;
      const hit = findPopup(rule); if (!hit) continue;
      counts.set(rule, n + 1);
      try { hit.btn.click(); console.log(LOG, 'closed "' + (rule.name || rule.text) + '"'); toast('Closed: ' + (rule.name || rule.text)); logClosed(rule); } catch (e) { console.warn(LOG, 'click failed', e); }
    }
  }
  function schedule() { const now = Date.now(); clearTimeout(timer); timer = setTimeout(() => { lastRun = Date.now(); sweep(); }, Math.max(300, 1000 - (now - lastRun))); }
  if (rulesHere().length) {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(sweep, 3000); sweep();
  }

  // ---- adding rules (Tampermonkey menu) ----
  function addRule(r) {
    const all = userRules(); all.push(r); sv(KEY, all);
    const head = 'Saved: ' + r.host + ' -> ' + (r.sel ? 'selector ' + r.sel : '"' + unesc(r.text) + '"') + '\nReload the page to start it.\n\n';
    if (!gv(TOKEN_KEY, '')) { alert(head + 'Not pushed to GitHub (no token set - menu: "Set GitHub token").'); return; }
    editRepo(addMutator([r])).then((res) => alert(head + doneMsg(res))).catch((e) => alert(head + 'GitHub push FAILED (rule is still saved locally): ' + ghErr(e)));
  }

  function setToken() {
    const t = prompt('Paste the GitHub token (fine-grained, ' + REPO + ', Contents: Read and write). Blank = remove it:', '');
    if (t === null) return;
    if (t.trim() && !/^[A-Za-z0-9_]{20,255}$/.test(t.trim())) { alert('That does not look like a GitHub token (' + t.trim().length + ' characters; a token is one unbroken word of letters/numbers/underscores, starting github_pat_). Copy the token from GitHub again and retry. Nothing was saved.'); return; }
    sv(TOKEN_KEY, t.trim());
    if (!t.trim()) { alert('Token removed from this browser.'); return; }
    ghReq('GET').then(() => alert('Token works.')).catch((e) => alert('Saved, but the test failed: ' + ghErr(e)));
  }

  function pushLocal() {
    const all = userRules(); if (!all.length) { alert('No local rules to push.'); return; }
    editRepo(addMutator(all)).then((res) => alert(doneMsg(res))).catch((e) => alert('GitHub push FAILED: ' + ghErr(e)));
  }

  function removeFromGitHub() {
    ghReq('GET').then((f) => {
      const t = decodeFile(f); const b = ruleBlock(t);
      const rows = t.slice(b.s, b.e).split('\n').filter((l) => /^\s*\{.*\},?\s*$/.test(l));
      if (!rows.length) { alert('No built-in rules on GitHub.'); return; }
      const n = prompt('Built-in rules on GitHub (type a number to DELETE it for everyone, blank = cancel):\n' + rows.map((l, i) => (i + 1) + '. ' + l.trim()).join('\n'));
      const i = parseInt(n, 10) - 1; if (!(i >= 0 && i < rows.length)) return;
      const line = rows[i];
      return editRepo((tt) => { const bb = ruleBlock(tt); const blk = tt.slice(bb.s, bb.e); const at = blk.indexOf(line); if (at < 0) return { nochange: 'that rule is already gone' };
        const from = bb.s + at; return { text: tt.slice(0, from - 1) + tt.slice(from + line.length), summary: 'remove ' + line.trim().slice(0, 60) }; })
        .then((res) => alert(res.nochange ? 'Nothing to remove: ' + res.nochange + '.' : 'Removed on GitHub as v' + res.version + '.'));
    }).catch((e) => alert('GitHub FAILED: ' + ghErr(e)));
  }

  function stableSelector(btn) {
    for (const a of ['data-testid', 'aria-label', 'id']) { const v = btn.getAttribute(a); if (v && v.length < 60) return a === 'id' ? '#' + CSS.escape(v) : '[' + a + '="' + v.replace(/"/g, '\\"') + '"]'; }
    return '';
  }

  // best phrase to match on: the longest text line in the popup that is not a button label
  function bestPhrase(pop) {
    const btnTxt = new Set([...pop.querySelectorAll('button,[role="button"],a')].map((b) => (b.textContent || '').trim()));
    const lines = (pop.innerText || '').split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 8 && !btnTxt.has(l));
    lines.sort((x, y) => y.length - x.length);
    return (lines[0] || (pop.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 90);
  }
  const popupOf = (el) => { let p = el.nodeType === 1 ? el : el.parentElement; while (p && p !== document.body && !isPositioned(p)) p = p.parentElement; return p && p !== document.body ? p : null; };

  // mode 'x': you click the popup's close button; mode 'text': you click the popup's text.
  // Either way the phrase is captured from the page and shown prefilled (Enter to accept, or edit it).
  function pickMode(mode) {
    const bar = document.createElement('div'); bar.id = 'popupcloser-pick';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#c2185b;color:#fff;font:14px sans-serif;padding:8px;text-align:center';
    bar.textContent = mode === 'x' ? "Popup Closer: click the popup's X / close button (Esc to cancel)" : "Popup Closer: click the popup's text (Esc to cancel)";
    document.documentElement.appendChild(bar);
    const done = () => { bar.remove(); document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') done(); };
    const onClick = (e) => {
      if (bar.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation(); done();
      const pop = popupOf(e.target);
      if (!pop) { alert('Could not tell which popup that belongs to. Try again, or use "Add popup by typing".'); return; }
      let phrase = bestPhrase(pop), close = '';
      if (mode === 'x') { const btn = e.target.closest('button,[role="button"],a') || e.target; close = stableSelector(btn); }
      else if (e.target.tagName === 'IMG') { const fn = ((e.target.currentSrc || e.target.src || '').split('?')[0].split('/').pop() || '').match(/[a-z]{5,}/i); phrase = (e.target.alt && !/image|icon|logo/i.test(e.target.alt) ? e.target.alt : (fn ? fn[0] : phrase)); }
      else { const t = (e.target.innerText || e.target.textContent || '').replace(/\s+/g, ' ').trim(); if (t.length >= 8 && t.length <= 120) phrase = t; }
      const ok = prompt('Phrase that is always in this popup (captured from the page - Enter to accept, or edit):', phrase);
      if (!ok) return;
      addRule({ host, name: ok.slice(0, 30), text: esc(ok.trim()), close });
    };
    document.addEventListener('click', onClick, true); document.addEventListener('keydown', onKey, true);
  }

  // ---- 1.7.0: Inspect popup - click a popup (nothing closes or triggers) and get a ready-made rule ----
  function popupSelector(el) {
    const cands = [];
    for (let n = el, d = 0; n && n !== document.body && d < 4; n = n.parentElement, d++) {
      const tid = n.getAttribute('data-testid'); if (tid && tid.length < 60) cands.push('[data-testid="' + tid.replace(/"/g, '\\"') + '"]');
      const id = n.id; if (id && id.length < 40 && !/\d{4,}/.test(id) && !/^popupcloser-/.test(id)) cands.push('#' + CSS.escape(id));
      const al = n.getAttribute('aria-label'); if (al && al.length < 60 && n.getAttribute('role') === 'dialog') cands.push('[role="dialog"][aria-label="' + al.replace(/"/g, '\\"') + '"]');
      const cls = String(n.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      const mod = cls.map((c) => c.match(/^(_[A-Za-z]+_)/)).filter(Boolean).map((m) => '[class*="' + m[1] + '"]');
      const plain = cls.filter((c) => /^[a-z][a-z-]{3,30}$/i.test(c) && !/^(css|sc|jsx|ng|ant)-/i.test(c));
      mod.forEach((m) => cands.push(n.tagName.toLowerCase() + m));
      if (plain.length) { cands.push(n.tagName.toLowerCase() + '.' + plain.slice(0, 2).join('.')); cands.push('.' + plain[0]); }
    }
    for (const c of cands) { try { const m = document.querySelectorAll(c); if (m.length >= 1 && m.length <= 2 && [...m].some((x) => x === el || x.contains(el) || el.contains(x))) return c; } catch (e) {} }
    return '';
  }

  function inspectMode() {
    const bar = document.createElement('div'); bar.id = 'popupcloser-pick';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1565c0;color:#fff;font:14px sans-serif;padding:8px;text-align:center';
    bar.textContent = 'Popup Closer: click the popup anywhere - nothing will close (Esc to cancel)';
    document.documentElement.appendChild(bar);
    const EV = ['pointerdown', 'mousedown', 'mouseup', 'pointerup', 'touchstart', 'touchend', 'click'];
    const stop = (e) => { if (bar.contains(e.target)) return; e.preventDefault(); e.stopImmediatePropagation(); };
    const done = () => { bar.remove(); EV.forEach((n) => window.removeEventListener(n, onEv, true)); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') done(); };
    const onEv = (e) => {
      if (bar.contains(e.target)) return;
      stop(e);
      if (e.type !== 'click') return;
      const target = e.target;
      setTimeout(() => { done(); showInspect(target); }, 50);
    };
    EV.forEach((n) => window.addEventListener(n, onEv, true));
    document.addEventListener('keydown', onKey, true);
  }

  function showInspect(target) {
    const pop = popupOf(target) || target;
    const opts = []; // { label, rule }
    const closeBtn = autoCloseButton(pop);
    const close = closeBtn ? stableSelector(closeBtn) : '';
    const seen = new Set();
    const add = (label, rule) => { const k = JSON.stringify(rule); if (seen.has(k)) return; seen.add(k); opts.push({ label, rule }); };
    const lines = (pop.innerText || '').split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 3 && l.length <= 90);
    lines.slice(0, 8).forEach((l) => add('Text: ' + l, { host, name: l.slice(0, 30), text: esc(l), close }));
    const imgs = [...pop.querySelectorAll('img')].concat(target.tagName === 'IMG' ? [target] : []);
    imgs.forEach((i) => {
      const alt = (i.alt || '').trim();
      if (alt.length >= 4 && !/^(image|icon|logo)$/i.test(alt)) add('Image alt: ' + alt, { host, name: alt.slice(0, 30), text: esc(alt), close });
      const fn = (i.currentSrc || i.src || '').split('?')[0].split('/').pop() || '';
      (fn.replace(/\.[a-z0-9]+$/i, '').match(/[A-Za-z]{5,}/g) || []).forEach((w) => add('Image file word: ' + w + '  (' + fn.slice(0, 40) + ')', { host, name: w.slice(0, 30), text: esc(w), close }));
    });
    const sel = popupSelector(pop);
    if (sel) add('Selector (no text needed): ' + sel, { host, name: (lines[0] || sel).slice(0, 30), text: '', close, sel });

    const box = document.createElement('div'); box.id = 'popupcloser-inspect';
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:440px;max-width:94vw;background:#111;color:#eee;font:12px/1.4 sans-serif;padding:10px;border-radius:8px;box-shadow:0 2px 12px #000;max-height:90vh;overflow:auto';
    const mk = (tag, css, txt) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; box.appendChild(e); return e; };
    mk('div', 'font-weight:bold;margin-bottom:6px', 'Popup Closer - inspect (nothing was closed)');
    mk('div', 'margin-bottom:4px;color:#9cf', 'Close button: ' + (close || (closeBtn ? '(auto-detected, no stable selector)' : 'NOT FOUND - rule may not close it')));
    if (!opts.length) { mk('div', 'color:#f99;margin:6px 0', 'Found no text, image words or stable selector here. Try clicking a different spot on the popup, or use "Add popup by typing".'); }
    const sel_ = document.createElement('select'); sel_.style.cssText = 'width:100%;margin:4px 0;font:12px sans-serif';
    opts.forEach((o, i) => { const op = document.createElement('option'); op.value = i; op.textContent = o.label; sel_.appendChild(op); });
    if (opts.length) { mk('div', '', 'Match this popup by:'); box.appendChild(sel_); }
    const ta = mk('textarea', 'width:100%;height:56px;font:11px monospace;box-sizing:border-box;margin-top:4px');
    ta.readOnly = true;
    const status = mk('div', 'margin:4px 0;color:#9f9', '');
    const line = (r) => '{ host: ' + q(nh(r.host)) + ', name: ' + q(r.name || '') + ', text: ' + q(unesc(r.text)) + ', close: ' + q(r.close || '') + (r.sel ? ', sel: ' + q(r.sel) : '') + ' },';
    const cur = () => (opts[+sel_.value] || {}).rule;
    const refresh = () => {
      const r = cur(); if (!r) { ta.value = ''; return; }
      ta.value = line(r);
      const hit = findPopup(r);
      status.textContent = hit ? 'Test: this rule finds the popup and its close button right now.' : 'Test: this rule would NOT close it right now (popup or close button not matched).';
      status.style.color = hit ? '#9f9' : '#fc6';
    };
    sel_.addEventListener('change', refresh);
    const row = mk('div', 'display:flex;gap:6px;margin-top:6px');
    const btn = (txt, fn) => { const b = document.createElement('button'); b.textContent = txt; b.style.cssText = 'padding:4px 10px;font:12px sans-serif;cursor:pointer'; b.addEventListener('click', fn); row.appendChild(b); };
    btn('Add this rule', () => { const r = cur(); if (!r) return; box.remove(); addRule(r); });
    btn('Copy line', () => { const r = cur(); if (!r) return; try { GM_setClipboard(line(r)); status.textContent = 'Copied.'; } catch (e) { ta.select(); } });
    btn('Close panel', () => box.remove());
    document.documentElement.appendChild(box);
    refresh();
  }

  function addByTyping() {
    const h = prompt('Site (hostname, no www):', host); if (!h) return;
    const phrase = prompt('A phrase that is always in the popup:'); if (!phrase) return;
    addRule({ host: h.trim().replace(/^www\./, ''), name: phrase.slice(0, 30), text: esc(phrase.trim()), close: '' });
  }

  function manage() {
    const all = userRules();
    if (!all.length) { alert('No rules added yet.\n\nBuilt-in: ' + DEFAULT_RULES.map((r) => r.host + ' -> ' + r.text).join('; ')); return; }
    const n = prompt('Your rules (type a number to DELETE it, blank = cancel):\n' + all.map((r, i) => (i + 1) + '. ' + r.host + ' -> ' + (r.sel ? 'selector ' + r.sel : '"' + r.text.replace(/\\/g, '') + '"')).join('\n'));
    const i = parseInt(n, 10) - 1; if (i >= 0 && i < all.length) { all.splice(i, 1); sv(KEY, all); alert('Deleted. Reload the page.'); }
  }

  function copyRules() {
    const all = userRules();
    if (!all.length) { alert('You have no menu-added rules to copy.'); return; }
    const txt = all.map((r) => '    ' + JSON.stringify(Object.assign({ host: r.host, name: r.name, text: r.text.replace(/\\(.)/g, '$1'), close: r.close || '' }, r.sel ? { sel: r.sel } : {})) + ',').join('\n');
    try { GM_setClipboard(txt); alert('Copied ' + all.length + ' rule line(s). (Manual fallback - normally "Push my local rules to GitHub" does this for you.)'); }
    catch (e) { prompt('Copy these lines into DEFAULT_RULES:', txt); }
  }

  try {
    GM_registerMenuCommand('➕ Add popup (click its X)', () => pickMode('x'));
    GM_registerMenuCommand('➕ Add popup (click its text)', () => pickMode('text'));
    GM_registerMenuCommand('🔎 Inspect popup (click it, nothing closes)', inspectMode);
    GM_registerMenuCommand('➕ Add popup by typing…', addByTyping);
    GM_registerMenuCommand('📋 Show / delete my rules', manage);
    GM_registerMenuCommand('⬆ Push my local rules to GitHub', pushLocal);
    GM_registerMenuCommand('🗑 Remove a built-in rule (on GitHub)', removeFromGitHub);
    GM_registerMenuCommand('🔑 Set GitHub token', setToken);
    GM_registerMenuCommand('🔍 Test GitHub connection', testGitHub);
    GM_registerMenuCommand('📤 Copy my rules (manual fallback)', copyRules);
    GM_registerMenuCommand('▶ Run closer now (this page)', () => { sweep(); const r = rulesHere(); toast(r.length ? 'Ran ' + r.length + ' rule(s)' : 'No rules for ' + host); });
  } catch (e) {}
})();
