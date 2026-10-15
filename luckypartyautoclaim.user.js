// ==UserScript==
// @name         LuckyParty Auto Claim Now
// @namespace    https://luckparty.com/
// @version      1.3.3
// @description  Closes any popups (including iframe-embedded ones) blocking the way, then finds <div class="button-content">Claim Now</div> on luckparty.com and clicks the Claim Now button. Leaves the Coin Store dialog alone, and leaves any popup with its own unclaimed "Claim Now" button alone too (so it gets claimed, not closed).
// @match        https://luckparty.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/luckypartyautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/luckypartyautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ---- badge (10/14/26): collapsed bottom-left pill with a log; click to open/close. Same look as Popup Closer's. ----
    const BADGE_NAME = 'LuckyParty Auto Claim', BADGE_VER = '1.3.3';
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

    // Elements we've already clicked, so we don't spam-click the same button.
    const clicked = new WeakSet();
    const closedPopups = new WeakSet();
    let crossOriginNoted = false;

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
            // 10/15/26: the site dropped the FreeCoinsDialog.tsx marker (store was being closed the moment it opened) - the store now renders FreeReward.tsx / StoreItem.tsx, so match those and the free-reward markup too.
            if (node.querySelector && node.querySelector('[data-sentry-source-file="FreeCoinsDialog.tsx"], [data-sentry-source-file="FreeReward.tsx"], [data-sentry-source-file="StoreItem.tsx"], .free-rewards, .free-reward__button')) return true;
            node = node.parentElement;
        }
        return false;
    }

    // Some popups (confirmed 9/10/26: the "Limited Time Gift" free-offer
    // dialog, FreeOfferDialog.tsx) carry their own unclaimed "Claim Now"
    // button as a sibling of the close icon, inside the same dialog. If
    // closePopups() closes that dialog first (it runs before findClaimDivs()
    // on every scan pass), the reward is forfeited — the claim button never
    // gets clicked. Rather than hardcode another named-component exemption
    // like isCoinStoreDialog, generalize: don't close a popup that still has
    // an unclaimed "Claim Now" div.button-content anywhere in it. Once a
    // click actually claims it, the button's text/state changes, this check
    // stops matching, and the now-empty popup is free to be closed on a
    // later pass same as normal.
    function hasUnclaimedClaimButton(target) {
        let node = target;
        for (let i = 0; i < 12 && node; i++) {
            if (node.querySelectorAll) {
                const has = Array.from(node.querySelectorAll('div.button-content'))
                    .some(el => el.textContent.trim().toLowerCase() === 'claim now');
                if (has) return true;
            }
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
        if (blockedFrameCount > 0 && !crossOriginNoted) {
            crossOriginNoted = true; // 10/15/26: log once - logging every pass updated the badge, which re-triggered the observer (page froze)
            badgeLog(`[Auto Claim Now] ${blockedFrameCount} cross-origin iframe(s) present — can't check those for popups.`);
        }
        for (const iconEl of found) {
            const target = closeTargetFor(iconEl);
            if (closedPopups.has(target)) continue;
            if (!isVisible(target)) continue;
            if (isCoinStoreDialog(target)) continue; // leave the Coin Store popup open
            if (hasUnclaimedClaimButton(target)) continue; // let scan() claim it first, don't close it out from under the claim

            closedPopups.add(target);
            badgeLog('[Auto Claim Now] closing popup', target);
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
            badgeLog('[Auto Claim Now] clicking', target);
            target.click();
        }
    }

    // Initial pass.
    scan();

    // Re-scan whenever the DOM changes (SPA re-renders, delayed loads, etc.).
    // Note: this only observes the top document — a mutation purely inside an
    // iframe's own document won't trigger it, which is what the interval poll
    // below is for.
    // 10/15/26: ignore the badge's own DOM updates (they re-triggered this observer in a loop and froze the page) and debounce the rest.
    let scanTimer = null;
    const observer = new MutationObserver((muts) => {
        const onlyBadge = muts.every((m) => {
            const t = m.target && (m.target.nodeType === 1 ? m.target : m.target.parentElement);
            return t && t.closest && t.closest('#tm-badge-stack');
        });
        if (onlyBadge) return;
        if (scanTimer) return;
        scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 200);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety-net poll in case a mutation slips through (or happens inside an iframe).
    setInterval(scan, 2000);
})();
