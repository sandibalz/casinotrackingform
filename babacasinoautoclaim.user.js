// ==UserScript==
// @name         Baba Casino Auto Claim Freebie
// @namespace    https://play.babacasino.com/
// @version      1.2.0
// @description  Clicks COLLECT on Baba Casino's "Freebie on the house" popup (and the Daily Bonus popup) as soon as it appears. Claim only - never touches PLAY NOW or other popups.
// @match        https://play.babacasino.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/babacasinoautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/babacasinoautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ---- badge (10/14/26): collapsed bottom-left pill with a log; click to open/close. Same look as Popup Closer's. ----
    const BADGE_NAME = 'Baba Auto Claim', BADGE_VER = '1.2.0';
    const badgeLines = []; let badgeOpen = false, badgePill = null, badgeBox = null, badgeWarn = 0;
    function badgeRender() {
        try {
            if (window.top !== window.self || !document.body) return;
            if (!badgePill || !badgePill.isConnected) {
                let stack = document.getElementById('tm-badge-stack');
                if (!stack) {
                    stack = document.createElement('div'); stack.id = 'tm-badge-stack';
                    stack.style.cssText = 'position:fixed;left:12px;bottom:168px;z-index:2147483646;display:flex;flex-direction:column-reverse;align-items:flex-start;gap:2px;pointer-events:none;';
                    document.body.appendChild(stack);
                }
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:2px;pointer-events:none;';
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
        } catch (e) {}
    }
    // v1.2.0: per-owner run log saved in Tampermonkey storage (same scheme as Punt/Chanced: claimLog_<owner>, last 300)
    const LOG_SITE = 'Baba', isTopFrame = window.top === window.self;
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

    // Daily Bonus is an auto-popup on load when ready: ngb-modal-window.sweep-modal-daily-bonus
    // COLLECT = .collect-btn (closing with the X also collects, but COLLECT is explicit).
    // Freebie popup (seen live 10/13): .collect-freebie-modal button.apply-button "COLLECT"
    const COLLECT_SEL = '.collect-freebie-modal button.apply-button, .sweep-modal-daily-bonus .collect-btn';
    const COLLECT_RE = /^\s*collect\s*$/i;
    const COOLDOWN_MS = 5000;
    let lastClick = 0;

    function log(msg) { console.log(`[Baba AutoClaim] ${msg}`); badgeAdd(msg); }

    function isVisible(el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none';
    }

    function robustClick(el) {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', base));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseup', base));
        el.dispatchEvent(new MouseEvent('click', base));
    }

    function scan() {
        if (Date.now() - lastClick < COOLDOWN_MS) return;
        for (const b of document.querySelectorAll(COLLECT_SEL)) {
            if (b.disabled || !isVisible(b) || !COLLECT_RE.test(b.textContent)) continue;
            lastClick = Date.now();
            log('clicking COLLECT (' + (b.closest('.collect-freebie-modal') ? 'Freebie' : 'Daily Bonus') + ')');
            robustClick(b);
            return;
        }
    }

    scan();

    let pending = null;
    new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; scan(); }, 150);
    }).observe(document.documentElement, { childList: true, subtree: true });

    setInterval(scan, 1000);
})();
