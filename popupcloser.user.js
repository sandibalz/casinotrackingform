// ==UserScript==
// @name         Popup Closer (per-site list)
// @namespace    https://github.com/sandibalz/casinotrackingform
// @version      1.5.1
// @description  Closes pop-ups you teach it (e.g. the "Add this web app to your device" bar) on the sites you add. Does nothing on a site that has no rule. Add rules from the Tampermonkey menu.
// @match        *://*/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/popupcloser.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/popupcloser.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---- Built-in rules (shared: these come with the GitHub copy, so every owner gets them) ----
  // Rules added from the Tampermonkey menu are saved only in THAT browser. To share one with everyone, use the menu item
  // "Copy my rules (to share via GitHub)", paste the lines into DEFAULT_RULES below, bump @version, and push to GitHub.
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
    {"host":"spinblitz.com","name":"Free benefits on all packages","text":"Free benefits on all packages","close":"[aria-label=\"Button\"]"},
    {"host":"spinblitz.com","name":"Add this web app to your devic","text":"Add this web app to your device","close":"[data-testid=\"button-base\"]"},
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

  // ---- helpers ----
  const visible = (el) => {
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 8 && r.height > 8 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const isPositioned = (el) => { const p = getComputedStyle(el).position; return p === 'fixed' || p === 'absolute' || p === 'sticky' || el.getAttribute('role') === 'dialog' || el.tagName === 'DIALOG'; };

  function autoCloseButton(pop) {
    const cands = [...pop.querySelectorAll('button, [role="button"], a, [aria-label], [class*="close" i], [class*="dismiss" i]')].filter(visible);
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
    let re; try { re = new RegExp(rule.text, 'i'); } catch (e) { return null; }
    const want = squash(rule.text.replace(/\\(.)/g, '$1'));
    const found = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!isPositioned(el) || !visible(el)) continue;
      if (el.id === 'popupcloser-toast' || el.id === 'popupcloser-pick') continue;
      const t = el.innerText || '';
      if (t.length > 600) continue;
      // also look at image alt text / file names (banner titles like "Daily Offer" are often a picture, not text)
      const imgs = [...el.querySelectorAll('img')].map((i) => (i.alt || '') + ' ' + ((i.currentSrc || i.src || '').split('?')[0].split('/').pop())).join(' ');
      const hay = t + ' ' + imgs;
      if (!re.test(hay) && !(want.length >= 6 && squash(hay).indexOf(want) >= 0)) continue;
      const r = el.getBoundingClientRect();
      found.push({ el, area: r.width * r.height });
    }
    found.sort((a, b) => a.area - b.area); // smallest popup that still holds the text and a close button
    for (const f of found) {
      let btn = null;
      if (rule.close) { // 1.4.0: skip matches that are action buttons (generic selectors like [data-testid="button-base"] also hit Buy/Get buttons)
        try { btn = [...f.el.querySelectorAll(rule.close)].find((b) => visible(b) && !ACTION_TXT.test((b.textContent || '').trim())) || null; } catch (e) {}
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

  // ---- watcher ----
  const counts = new Map();
  let lastRun = 0, timer = null;
  function sweep() {
    const rules = rulesHere(); if (!rules.length) return;
    for (const rule of rules) {
      const n = counts.get(rule) || 0; if (n >= MAX_CLOSES_PER_RULE) continue;
      const hit = findPopup(rule); if (!hit) continue;
      counts.set(rule, n + 1);
      try { hit.btn.click(); console.log(LOG, 'closed "' + (rule.name || rule.text) + '"'); toast('Closed: ' + (rule.name || rule.text)); } catch (e) { console.warn(LOG, 'click failed', e); }
    }
  }
  function schedule() { const now = Date.now(); clearTimeout(timer); timer = setTimeout(() => { lastRun = Date.now(); sweep(); }, Math.max(300, 1000 - (now - lastRun))); }
  if (rulesHere().length) {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(sweep, 3000); sweep();
  }

  // ---- adding rules (Tampermonkey menu) ----
  function addRule(r) { const all = userRules(); all.push(r); sv(KEY, all); alert('Saved: ' + r.host + ' -> "' + r.text + '"\nReload the page to start it.'); }

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

  function addByTyping() {
    const h = prompt('Site (hostname, no www):', host); if (!h) return;
    const phrase = prompt('A phrase that is always in the popup:'); if (!phrase) return;
    addRule({ host: h.trim().replace(/^www\./, ''), name: phrase.slice(0, 30), text: esc(phrase.trim()), close: '' });
  }

  function manage() {
    const all = userRules();
    if (!all.length) { alert('No rules added yet.\n\nBuilt-in: ' + DEFAULT_RULES.map((r) => r.host + ' -> ' + r.text).join('; ')); return; }
    const n = prompt('Your rules (type a number to DELETE it, blank = cancel):\n' + all.map((r, i) => (i + 1) + '. ' + r.host + ' -> "' + r.text.replace(/\\/g, '') + '"').join('\n'));
    const i = parseInt(n, 10) - 1; if (i >= 0 && i < all.length) { all.splice(i, 1); sv(KEY, all); alert('Deleted. Reload the page.'); }
  }

  function copyRules() {
    const all = userRules();
    if (!all.length) { alert('You have no menu-added rules to copy.'); return; }
    const txt = all.map((r) => '    ' + JSON.stringify({ host: r.host, name: r.name, text: r.text.replace(/\\(.)/g, '$1'), close: r.close || '' }) + ',').join('\n');
    try { GM_setClipboard(txt); alert('Copied ' + all.length + ' rule line(s). Paste them inside DEFAULT_RULES in the script file, bump @version, push to GitHub. (Then delete them from your own list so they are not doubled.)'); }
    catch (e) { prompt('Copy these lines into DEFAULT_RULES:', txt); }
  }

  try {
    GM_registerMenuCommand('➕ Add popup (click its X)', () => pickMode('x'));
    GM_registerMenuCommand('➕ Add popup (click its text)', () => pickMode('text'));
    GM_registerMenuCommand('➕ Add popup by typing…', addByTyping);
    GM_registerMenuCommand('📋 Show / delete my rules', manage);
    GM_registerMenuCommand('📤 Copy my rules (to share via GitHub)', copyRules);
    GM_registerMenuCommand('▶ Run closer now (this page)', () => { sweep(); const r = rulesHere(); toast(r.length ? 'Ran ' + r.length + ' rule(s)' : 'No rules for ' + host); });
  } catch (e) {}
})();
