// ==UserScript==
// @name         LuckyParty Auto Claim Now
// @namespace    https://luckparty.com/
// @version      1.2.0
// @description  Closes any popups (including iframe-embedded ones) blocking the way, then finds <div class="button-content">Claim Now</div> on luckparty.com and clicks the Claim Now button. Leaves the Coin Store dialog alone.
// @match        https://luckparty.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/luckypartyautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/luckypartyautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Elements we've already clicked, so we don't spam-click the same button.
    const clicked = new WeakSet();
    const closedPopups = new WeakSet();

    // ---- Popup closing (including same-origin iframe popups) -----------------
    // luckparty.com's popups render their close button as an <img class=
    // "close-popup-button__close-icon"> that's often sitting inside an iframe,
    // which document.querySelector from the top document can't reach at all.
    // Walk every same-origin iframe (recursively) and check each one's own
    // document too. A cross-origin iframe can't be reached from here — nothing
    // to be done about those.
    function collectFrameDocuments(root, docsOut, blockedOut) {
        docsOut.push(root);
        let iframes = [];
        try { iframes = Array.from(root.querySelectorAll('iframe')); } catch (_) { iframes = []; }
        for (const f of iframes) {
            let doc = null;
            try { doc = f.contentDocument; } catch (_) { doc = null; }
            if (doc) {
                collectFrameDocuments(doc, docsOut, blockedOut);
            } else {
                blockedOut.push(f);
            }
        }
    }

    function findPopupCloseIcons() {
        const docs = [], blocked = [];
        collectFrameDocuments(document, docs, blocked);
        const found = [];
        for (const d of docs) {
            let els = [];
            try { els = Array.from(d.querySelectorAll('.close-popup-button__close-icon')); } catch (_) { els = []; }
            found.push(...els);
        }
        return { found, blockedFrameCount: blocked.length };
    }

    function closeTargetFor(iconEl) {
        // The clickable handler is usually on a wrapping button/link, not the icon itself.
        return iconEl.closest('button, [role="button"], a') || iconEl;
    }

    // The Coin Store dialog (its React component renders with
    // data-sentry-source-file="FreeCoinsDialog.tsx" on elements inside it,
    // e.g. its info-icon image) is opened deliberately - by the collector
    // automation or by hand - and has to stay open. Everything else this
    // script finds via .close-popup-button__close-icon is fair game, but the
    // Store dialog happens to use that same close icon, so it needs its own
    // explicit exemption rather than being caught by the generic closer.
    // Walk a bounded number of ancestors up from the close target looking for
    // that marker anywhere in the same dialog's subtree, rather than checking
    // the whole document (which could wrongly protect an unrelated popup that
    // happens to be open elsewhere at the same time as the Store).
    function isCoinStoreDialog(target) {
        let node = target;
        for (let i = 0; i < 12 && node; i++) {
            if (node.querySelector && node.querySelector('[data-sentry-source-file="FreeCoinsDialog.tsx"]')) return true;
            node = node.parentElement;
        }
        return false;
    }

    function robustClick(el) {
        // Plain .click() doesn't reliably trigger React-driven handlers on this site
        // for the popup close button — dispatch a real pointer/mouse sequence instead.
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
        const base = { bubbles: true, cancelable: true, view, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', base));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseup', base));
        el.dispatchEvent(new MouseEvent('click', base));
    }

    function closePopups() {
        const { found, blockedFrameCount } = findPopupCloseIcons();
        if (blockedFrameCount > 0) {
            console.log(`[Auto Claim Now] ${blockedFrameCount} cross-origin iframe(s) present — can't check those for popups.`);
        }
        for (const iconEl of found) {
            const target = closeTargetFor(iconEl);
            if (closedPopups.has(target)) continue;
            if (!isVisible(target)) continue;
            if (isCoinStoreDialog(target)) continue; // leave the Coin Store popup open

            closedPopups.add(target);
            console.log('[Auto Claim Now] closing popup', target);
            robustClick(target);
        }
    }

    // ---- Claim Now button -----------------------------------------------------
    function findClaimDivs() {
        return Array.from(document.querySelectorAll('div.button-content'))
            .filter(el => el.textContent.trim().toLowerCase() === 'claim now');
    }

    function clickTargetFor(div) {
        // The visible label is the inner div; the real click handler is usually
        // on an ancestor button/anchor. Fall back to the div itself.
        return div.closest('button, a, [role="button"], .button, [class*="btn"]') || div;
    }

    function isVisible(el) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
    }

    function scan() {
        // Clear any popups blocking the way first, every pass.
        closePopups();

        for (const div of findClaimDivs()) {
            const target = clickTargetFor(div);
            if (clicked.has(target)) continue;
            if (target.disabled) continue;
            if (!isVisible(target)) continue;

            clicked.add(target);
            console.log('[Auto Claim Now] clicking', target);
            target.click();
        }
    }

    // Initial pass.
    scan();

    // Re-scan whenever the DOM changes (SPA re-renders, delayed loads, etc.).
    // Note: this only observes the top document — a mutation purely inside an
    // iframe's own document won't trigger it, which is what the interval poll
    // below is for.
    const observer = new MutationObserver(() => scan());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety-net poll in case a mutation slips through (or happens inside an iframe).
    setInterval(scan, 2000);
})();
