// ==UserScript==
// @name         Zula Auto Claim Now
// @namespace    https://www.zulacasino.com/
// @version      1.2.1
// @description  Clicks the CLAIM NOW button on Zula Casino's gift/bonus dialogs (e.g. "Limited-Time Gift") as soon as they appear.
// @match        https://www.zulacasino.com/*
// @match        https://zulacasino.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/zulaautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/zulaautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 10/26/26 badge dock: ONE shared, collapsed, open-shadow-root dock for every on-page chip/pill/log (Collector-App,
    // AutoLogin, Tampermonkey). Whoever runs first creates it; everyone else appends a section to #bd-sections (use the
    // CSS `order` property: lower = nearer the bottom). Collapsed = a 9px edge tab only; page querySelector/text scans
    // can't see inside it, and nothing outside the tab/open panel takes clicks. Keep this block identical in every script
    // that uses the dock (a copy lives in background.js pageAppendCollectorLog).
    function getDock() {
      let host = document.getElementById('__badge-dock');
      if (host && host.shadowRoot && host.shadowRoot.getElementById('bd-sections')) return host.shadowRoot;
      if (host) host.remove();
      host = document.createElement('div');
      host.id = '__badge-dock';
      host.style.cssText = 'position:fixed;left:0;bottom:37px;width:0;height:0;z-index:2147483647;pointer-events:none;';
      const sr = host.attachShadow({ mode: 'open' });
      const mk = (tag, id) => { const e = document.createElement(tag); if (id) e.id = id; return e; };
      const st = mk('style');
      st.textContent = ':host{all:initial}' +
        '#bd-tab{position:fixed;left:0;bottom:37px;width:9px;height:44px;background:#37474f;opacity:.55;border-radius:0 6px 6px 0;cursor:pointer;pointer-events:auto}' +
        '#bd-tab:hover{opacity:1}:host([data-alert]) #bd-tab{background:#c62828;opacity:.9}' +
        '#bd-panel{position:fixed;left:12px;bottom:37px;display:none;align-items:flex-end;gap:6px;pointer-events:auto}' +
        ':host([data-open]) #bd-panel{display:flex}' +
        '#bd-sections{display:flex;flex-direction:column-reverse;align-items:flex-start;gap:3px}' +
        '#bd-popups{display:flex;align-items:flex-end}';
      const tab = mk('div', 'bd-tab'); tab.title = 'Badges';
      const panel = mk('div', 'bd-panel');
      const sections = mk('div', 'bd-sections'), popups = mk('div', 'bd-popups');
      panel.appendChild(sections); panel.appendChild(popups);
      sr.appendChild(st); sr.appendChild(tab); sr.appendChild(panel);
      let pinned = false, t = null;
      const open = () => { host.setAttribute('data-open', ''); host.removeAttribute('data-alert'); };
      const close = () => { pinned = false; host.removeAttribute('data-open'); };
      tab.addEventListener('mouseenter', () => { clearTimeout(t); open(); });
      tab.addEventListener('click', () => { if (pinned) close(); else { pinned = true; open(); } });
      host.addEventListener('mouseenter', () => clearTimeout(t));
      host.addEventListener('mouseleave', () => { if (pinned) return; clearTimeout(t); t = setTimeout(() => { if (!popups.childElementCount) close(); }, 800); });
      host.addEventListener('dock-collapse', close);
      (document.body || document.documentElement).appendChild(host);
      return sr;
    }
    function dockFind(id) { const h = document.getElementById('__badge-dock'); return h && h.shadowRoot ? h.shadowRoot.getElementById(id) : null; }


    // ---- badge (10/14/26): collapsed bottom-left pill with a log; click to open/close. Same look as Popup Closer's. ----
    const BADGE_NAME = 'Zula Auto Claim', BADGE_VER = '1.2.1';
    const badgeLines = []; let badgeOpen = false, badgePill = null, badgeBox = null, badgeWarn = 0;
    function badgeRender() {
        try {
            if (window.top !== window.self || !document.body) return;
            if (!badgePill || !badgePill.isConnected) {
                const stack = getDock().getElementById('bd-sections'); // 10/26/26: shared badge dock (was #tm-badge-stack)
                const wrap = document.createElement('div');
                wrap.style.cssText = 'order:40;display:flex;flex-direction:column;align-items:flex-start;gap:2px;pointer-events:none;';
                badgeBox = document.createElement('div');
                badgeBox.style.cssText = 'display:none;width:320px;max-height:200px;overflow:auto;background:#111;color:#eee;font:11px/1.4 monospace;border:1px solid #555;border-radius:6px;padding:6px 8px;white-space:pre-wrap;box-shadow:0 2px 10px #000a;pointer-events:auto;';
                badgePill = document.createElement('div');
                badgePill.style.cssText = 'background:#111;color:#9f9;font:11px/1.4 sans-serif;padding:4px 8px;border-radius:6px;opacity:.85;cursor:pointer;pointer-events:auto;';
                badgePill.addEventListener('click', () => { badgeOpen = !badgeOpen; badgeRender(); });
                wrap.append(badgeBox, badgePill); stack.appendChild(wrap);
            }
            badgeBox.style.display = badgeOpen ? 'block' : 'none';
            if (badgeOpen) { badgeBox.textContent = badgeLines.length ? badgeLines.join('\n') : '(nothing yet)'; badgeBox.scrollTop = badgeBox.scrollHeight; }
            badgePill.textContent = '✓ ' + BADGE_NAME + ' v' + BADGE_VER + ': ' + badgeLines.length + ' events' + (badgeWarn ? ' (' + badgeWarn + ' warn)' : '') + (badgeOpen ? '' : ' ▸');
            badgePill.style.color = badgeWarn ? '#ff8a80' : '#9f9';
            if (badgeWarn > (window.__badgeAlerted_zulaautoclaim || 0)) { window.__badgeAlerted_zulaautoclaim = badgeWarn; const dh = document.getElementById('__badge-dock'); if (dh && !dh.hasAttribute('data-open')) dh.setAttribute('data-alert', ''); }
        } catch (e) {}
    }
    // v1.2.0: per-owner run log saved in Tampermonkey storage (same scheme as Punt/Chanced: claimLog_<owner>, last 300)
    const LOG_SITE = 'Zula', isTopFrame = window.top === window.self;
    function getOwner(forcePrompt) {
        let owner = GM_getValue('owner', '');
        if (isTopFrame && (!owner || forcePrompt)) {
            const a = prompt('Who is this browser for? (Ben, Cindy, Tyler, Jessica)', owner || '');
            if (a && a.trim()) { owner = a.trim(); GM_setValue('owner', owner); }
        }
        return owner || 'Unknown';
    }
    function persistLog(text) {
        try {
            const key = 'claimLog_' + getOwner();
            let hist = GM_getValue(key, []);
            const m = /^RESULT-[A-Z]+/.exec(text);
            hist.push({ t: new Date().toISOString(), site: LOG_SITE, event: m ? m[0] : 'info', detail: (isTopFrame ? '' : '[frame] ') + text });
            if (hist.length > 300) hist = hist.slice(-300);
            GM_setValue(key, hist);
        } catch (e) {}
    }
    if (isTopFrame) {
        GM_registerMenuCommand('Show full claim log (' + LOG_SITE + ')', () => {
            const hist = GM_getValue('claimLog_' + getOwner(), []);
            badgeLines.length = 0;
            hist.slice(-40).forEach(e => badgeLines.push(e.t.slice(11, 19) + ' ' + e.detail));
            badgeOpen = true; badgeRender();
        });
        GM_registerMenuCommand('Change owner', () => { getOwner(true); });
    }
    function badgeAdd(text, warn) {
        persistLog(text);
        badgeLines.push(new Date().toLocaleTimeString() + ' ' + text);
        if (badgeLines.length > 60) badgeLines.shift();
        if (warn || /error|fail|abort|giving up|can't|cannot/i.test(text)) badgeWarn++;
        badgeRender();
    }
    // console.log that also lands in the pill (element arguments are shown as <tag>)
    function badgeLog(...args) {
        console.log(...args);
        badgeAdd(args.map((a) => (a && a.nodeType === 1) ? '<' + a.tagName.toLowerCase() + '>' : String(a)).join(' ').replace(/^\[[^\]]*\]\s*/, ''));
    }
    badgeRender();

    const CLAIM_RE = /^\s*claim( now)?\s*$/i;
    const COOLDOWN_MS = 3000;   // allow a later, different gift popup, but never double-click one
    let lastClick = 0;

    function log(msg) {
        console.log(`[Zula AutoClaim] ${msg}`);
        badgeAdd(msg);
    }

    function isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
    }

    function robustClick(el) {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', base));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseup', base));
        el.dispatchEvent(new MouseEvent('click', base));
    }

    // Zula's popups render inside .app-dialog-container as
    // <div class="base-dialog__button-container"><button class="base-dialog__button">CLAIM NOW</button>.
    // Match on that class + the button text so the X/close and other dialog buttons are never clicked.
    function findClaimButton() {
        const btns = document.querySelectorAll('.app-dialog-container button.base-dialog__button');
        for (const b of btns) {
            if (CLAIM_RE.test(b.textContent) && !b.disabled && isVisible(b)) return b;
        }
        return null;
    }

    function scan() {
        if (Date.now() - lastClick < COOLDOWN_MS) return;
        const btn = findClaimButton();
        if (!btn) return;
        lastClick = Date.now();
        log('clicking CLAIM NOW');
        robustClick(btn);
    }

    scan();

    let pending = null;
    new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; scan(); }, 150);
    }).observe(document.documentElement, { childList: true, subtree: true });

    // Safety-net poll for popups that appear without a DOM mutation we catch.
    setInterval(scan, 1000);
})();
