// ==UserScript==
// @name         Zula Auto Claim Now
// @namespace    https://www.zulacasino.com/
// @version      1.1.0
// @description  Clicks the CLAIM NOW button on Zula Casino's gift/bonus dialogs (e.g. "Limited-Time Gift") as soon as they appear.
// @match        https://www.zulacasino.com/*
// @match        https://zulacasino.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/zulaautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/zulaautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ---- badge (10/14/26): collapsed bottom-left pill with a log; click to open/close. Same look as Popup Closer's. ----
    const BADGE_NAME = 'Zula Auto Claim', BADGE_VER = '1.1.0';
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
    function badgeAdd(text, warn) {
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
        const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1 };
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
