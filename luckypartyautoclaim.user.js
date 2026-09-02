// ==UserScript==
// @name         LuckyParty Auto Claim Now
// @namespace    https://luckparty.com/
// @version      1.0.0
// @description  Finds <div class="button-content">Claim Now</div> on luckparty.com and clicks the Claim Now button.
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
    const observer = new MutationObserver(() => scan());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety-net poll in case a mutation slips through.
    setInterval(scan, 2000);
})();
