// ==UserScript==
// @name         Zula Auto Claim Now
// @namespace    https://www.zulacasino.com/
// @version      1.0.0
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

    const CLAIM_RE = /^\s*claim( now)?\s*$/i;
    const COOLDOWN_MS = 3000;   // allow a later, different gift popup, but never double-click one
    let lastClick = 0;

    function log(msg) {
        console.log(`[Zula AutoClaim] ${msg}`);
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
