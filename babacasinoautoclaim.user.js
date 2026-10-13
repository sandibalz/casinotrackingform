// ==UserScript==
// @name         Baba Casino Auto Claim Freebie
// @namespace    https://play.babacasino.com/
// @version      1.1.0
// @description  Clicks COLLECT on Baba Casino's "Freebie on the house" popup (and the Daily Bonus popup) as soon as it appears. Claim only - never touches PLAY NOW or other popups.
// @match        https://play.babacasino.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/babacasinoautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/babacasinoautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Daily Bonus is an auto-popup on load when ready: ngb-modal-window.sweep-modal-daily-bonus
    // COLLECT = .collect-btn (closing with the X also collects, but COLLECT is explicit).
    // Freebie popup (seen live 10/13): .collect-freebie-modal button.apply-button "COLLECT"
    const COLLECT_SEL = '.collect-freebie-modal button.apply-button, .sweep-modal-daily-bonus .collect-btn';
    const COLLECT_RE = /^\s*collect\s*$/i;
    const COOLDOWN_MS = 5000;
    let lastClick = 0;

    function log(msg) { console.log(`[Baba AutoClaim] ${msg}`); }

    function isVisible(el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none';
    }

    function robustClick(el) {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1 };
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
