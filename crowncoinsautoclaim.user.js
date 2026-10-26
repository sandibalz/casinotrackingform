// ==UserScript==
// @name         CrownCoins Auto Claim Freebie
// @namespace    https://crowncoinscasino.com/
// @version      1.2.1
// @description  Closes CrownCoins' random popups (sales/offers) until the free-reward popup with a Claim button appears, then clicks Claim. Never clicks anything showing a price.
// @match        https://crowncoinscasino.com/*
// @match        https://*.crowncoinscasino.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/crowncoinsautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/crowncoinsautoclaim.user.js
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


    const NAME = 'CrownCoins Auto Claim', VER = '1.2.1';
    const CLAIM_RE = /^\s*claim( now)?\s*$/i;
    const PRICE_RE = /\$\s*\d/;
    const CLAIM_COOLDOWN_MS = 3000;
    const CLOSE_COOLDOWN_MS = 1500;
    const CLOSE_WINDOW_MS = 180000;   // keep closing popups for 3 min after load (or until the claim result is seen)
    const startedAt = Date.now();
    let lastClaim = 0, lastClose = 0, awaiting = 0, claimed = false;

    // Close buttons seen live (probe catalog 10/6/26 + 10/16/26). Purchase offers / Flash Sale: #event_trigger_close_btn.
    // Crown Jackpot (inside the game. frame): jackpot-lobby-close. Anything else is only closed by the generic
    // data-testid / layout-close rule below. No backdrop clicks, no canvas clicks (tapping the canvas = collect).
    const CLOSE_SELECTORS = [
        '#event_trigger_close_btn',
        '[data-testid="jackpot-lobby-close"]',
        '[data-testid="layout-close-btn"]'
    ];

    // ---- badge (top frame only), same look as Yay/Zula ----
    const lines = []; let open = false, pill = null, box = null, warn = 0;
    function render() {
        try {
            if (window.top !== window.self || !document.body) return;
            if (!pill || !pill.isConnected) {
                const stack = getDock().getElementById('bd-sections'); // 10/26/26: shared badge dock (was #tm-badge-stack)
                const wrap = document.createElement('div');
                wrap.style.cssText = 'order:40;display:flex;flex-direction:column;align-items:flex-start;gap:2px;pointer-events:none;';
                box = document.createElement('div');
                box.style.cssText = 'display:none;width:320px;max-height:200px;overflow:auto;background:#111;color:#eee;font:11px/1.4 monospace;border:1px solid #555;border-radius:6px;padding:6px 8px;white-space:pre-wrap;box-shadow:0 2px 10px #000a;pointer-events:auto;';
                pill = document.createElement('div');
                pill.style.cssText = 'background:#111;color:#9f9;font:11px/1.4 sans-serif;padding:4px 8px;border-radius:6px;opacity:.85;cursor:pointer;pointer-events:auto;';
                pill.addEventListener('click', () => { open = !open; render(); });
                wrap.append(box, pill); stack.appendChild(wrap);
            }
            box.style.display = open ? 'block' : 'none';
            if (open) { box.textContent = lines.length ? lines.join('\n') : '(nothing yet)'; box.scrollTop = box.scrollHeight; }
            pill.textContent = '✓ ' + NAME + ' v' + VER + ': ' + lines.length + ' events' + (warn ? ' (' + warn + ' warn)' : '') + (open ? '' : ' ▸');
            pill.style.color = warn ? '#ff8a80' : '#9f9';
        } catch (e) {}
    }
    // v1.1.0: per-owner run log saved in Tampermonkey storage (same scheme as Punt/Chanced: claimLog_<owner>, last 300)
    const SITE = 'CrownCoins', isTop = window.top === window.self;
    function getOwner(forcePrompt) {
        let owner = GM_getValue('owner', '');
        if (isTop && (!owner || forcePrompt)) {
            const a = prompt('Who is this browser for? (Ben, Cindy, Tyler, Jessica)', owner || '');
            if (a && a.trim()) { owner = a.trim(); GM_setValue('owner', owner); }
        }
        return owner || 'Unknown';
    }
    function persist(msg) {
        try {
            const key = 'claimLog_' + getOwner();
            let hist = GM_getValue(key, []);
            const i = msg.indexOf(':'), ev = /^[A-Z-]+(:|$)/.test(msg) ? msg.split(':')[0] : 'info';
            hist.push({ t: new Date().toISOString(), site: SITE, event: ev, detail: (isTop ? '' : '[frame] ') + msg });
            if (hist.length > 300) hist = hist.slice(-300);
            GM_setValue(key, hist);
        } catch (e) {}
    }
    if (isTop) {
        GM_registerMenuCommand('Show full claim log (' + SITE + ')', () => {
            const hist = GM_getValue('claimLog_' + getOwner(), []);
            lines.length = 0;
            hist.slice(-40).forEach(e => lines.push(e.t.slice(11, 19) + ' ' + e.detail));
            open = true; render();
        });
        GM_registerMenuCommand('Change owner', () => { getOwner(true); });
    }
    function log(msg, isWarn) {
        const where = window.top === window.self ? '' : '[frame] ';
        console.log('[CrownCoins AutoClaim] ' + where + msg);
        persist(msg);
        if (window.top !== window.self) return;   // frames log to console only
        lines.push(new Date().toLocaleTimeString() + ' ' + msg);
        if (lines.length > 60) lines.shift();
        if (isWarn || /error|fail|giving up/i.test(msg)) warn++;
        render();
    }
    render();
    log('script-loaded on ' + location.hostname);

    function isVisible(el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none' && s.opacity !== '0';
    }

    function robustClick(el) {   // (el is re-pointed at the innermost element under the click point)
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);   // CrownCoins listens on the inner element (button__content), not the <button>
        if (top && el.contains(top)) el = top;
        const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', base));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseup', base));
        el.dispatchEvent(new MouseEvent('click', base));
    }

    // The popup (container) a button lives in: nearest ancestor that looks like a dialog/overlay, else a few levels up.
    // Tight popup box: walk up from the element while the ancestor is still popup-sized (<= 700 px wide, < 90% of the
    // viewport tall). A full-page overlay/wrapper would pull in the lobby's own "$" text and block the claim.
    function popupOf(el) {
        let p = el;
        for (let i = 0; i < 12 && p.parentElement && p.parentElement !== document.body; i++) {
            const r = p.parentElement.getBoundingClientRect();
            if (r.width > 700 || r.height > window.innerHeight * 0.9) break;
            p = p.parentElement;
        }
        return p;
    }

    function findClaimButton() {
        for (const b of document.querySelectorAll('button, [role="button"], a, div[class*="btn" i], div[class*="button" i]')) {
            if (b.children.length > 2) continue;
            if (!CLAIM_RE.test(b.textContent || '') || b.disabled || !isVisible(b)) continue;
            if (b.closest('#tm-badge-stack')) continue;
            const pop = popupOf(b);
            if (PRICE_RE.test(pop.innerText || '')) continue;   // a purchase offer, never touched
            return b;
        }
        return null;
    }

    function findCloseButton() {
        for (const sel of CLOSE_SELECTORS) {
            for (const el of document.querySelectorAll(sel)) if (isVisible(el)) return { el, sel };
        }
        return null;
    }

    // After a click, look for a success / error message.
    function checkResult() {
        if (!awaiting) return;
        const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
        if (/successfully claimed|reward claimed|claimed successfully|you('ve| have) (claimed|received)/i.test(txt)) {
            awaiting = 0; claimed = true; log('RESULT-SUCCESS');
        } else if (Date.now() - awaiting > 8000) {
            awaiting = 0; log('RESULT-NONE: no success text within 8 s (check balance)', true);
        }
    }

    // "OOPS! You've already claimed this promo code..." popup with a GOT IT! button: log it and dismiss it.
    const GOTIT_RE = /^\s*got it!?\s*$/i, ALREADY_RE = /already claimed/i;
    let lastGotIt = 0;
    function handleAlreadyClaimed() {
        if (Date.now() - lastGotIt < 3000) return false;
        for (const b of document.querySelectorAll('button, [role="button"], a, div[class*="btn" i], div[class*="button" i]')) {
            if (b.children.length > 2 || !GOTIT_RE.test(b.textContent || '') || b.disabled || !isVisible(b)) continue;
            if (!ALREADY_RE.test(document.body.innerText || '')) return false;
            lastGotIt = Date.now(); awaiting = 0; claimed = true;
            log('RESULT-ALREADY: promo already claimed - clicking GOT IT');
            try { robustClick(b); } catch (e) { log('got-it click error: ' + e.message); }
            return true;
        }
        return false;
    }

    function scan() {
        render();
        if (handleAlreadyClaimed()) return;   // re-attach the pill if the site's re-render wiped it
        checkResult();
        const now = Date.now();

        if (now - lastClaim >= CLAIM_COOLDOWN_MS) {
            const btn = findClaimButton();
            if (btn) {
                lastClaim = now;
                log('clicking Claim: "' + (btn.textContent || '').trim() + '"');
                try { robustClick(btn); awaiting = now; } catch (e) { log('claim click error: ' + e.message); }
                return;
            }
        }

        if (claimed || now - startedAt > CLOSE_WINDOW_MS) return;
        if (now - lastClose < CLOSE_COOLDOWN_MS) return;
        const c = findCloseButton();
        if (!c) return;
        lastClose = now;
        const pop = popupOf(c.el);
        const label = (pop.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50);
        log('closing popup via ' + c.sel + (label ? ' ("' + label + '")' : ''));
        try { robustClick(c.el); } catch (e) { log('close click error: ' + e.message); }
    }

    scan();
    let pending = null;
    new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; scan(); }, 150);
    }).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 1000);
})();
