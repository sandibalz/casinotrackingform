// ==UserScript==
// @name         Chanced Auto Claim Promo Code
// @namespace    https://chanced.com/
// @version      1.1.0
// @description  When the Get Coins dialog's Promotion Codes tab is open with a code already filled in (e.g. from the autologin URL), clicks Submit once per code.
// @match        https://chanced.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/chancedautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/chancedautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Codes we've already hit Submit for, so a re-render/re-scan doesn't
    // click Submit twice for the same code. Keyed by the code text itself
    // (not the DOM element) because the input can be unmounted/remounted
    // by React when the dialog/tab re-renders.
    const submittedCodes = new Set();

    function log(msg) {
        console.log(`[Chanced AutoClaim] ${msg}`);
    }

    function isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
    }

    function robustClick(el) {
        // Plain .click() isn't always reliable on React-driven handlers —
        // dispatch a real pointer/mouse sequence instead.
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

    // The "Get Coins" dialog is Radix UI: tabs/tabpanels toggle
    // data-state="active"/"inactive" rather than being added/removed from
    // the DOM. That's far more stable than chanced.com's Tailwind utility
    // class names, so key off role="dialog" / role="tabpanel" + data-state
    // instead.
    //
    // The page can have MORE THAN ONE role="dialog" open at once (e.g. the
    // OneTrust cookie-consent "Privacy Preference Center" also uses
    // role="dialog") — don't assume the first dialog in the DOM is the Get
    // Coins one. Check every dialog and only match the tabpanel that
    // actually has both a code input and a submit button.
    function findActivePromoPanel() {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        for (const dialog of dialogs) {
            const panels = dialog.querySelectorAll('[role="tabpanel"][data-state="active"]');
            for (const panel of panels) {
                const input = panel.querySelector('input[type="text"], input:not([type])');
                const submitBtn = panel.querySelector('button[type="submit"]');
                if (input && submitBtn) return { input, submitBtn };
            }
        }
        return null;
    }

    function scan() {
        const found = findActivePromoPanel();
        if (!found) return;
        const { input, submitBtn } = found;

        const code = (input.value || '').trim();
        if (!code) return;                       // nothing filled in yet
        if (submittedCodes.has(code)) return;     // already tried this one
        if (submitBtn.disabled) return;
        if (!isVisible(submitBtn)) return;

        submittedCodes.add(code);
        log(`submitting code "${code}"`);
        robustClick(submitBtn);
    }

    // Initial pass.
    scan();

    // Re-scan whenever the DOM changes (dialog opening, tab switching,
    // React re-renders after the URL-prefilled code lands).
    const observer = new MutationObserver(() => scan());
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-state', 'disabled']
    });

    // Safety-net poll: React often updates an <input>'s value via the DOM
    // property rather than the "value" attribute, which MutationObserver
    // can't see, so a periodic check is needed to notice code being filled.
    setInterval(scan, 1000);
})();
