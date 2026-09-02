// ==UserScript==
// @name         RealPrize / LoneStar Casino – Auto Claim Popup
// @namespace    SweepsEdge
// @version      1.4.0
// @description  Detects bonus popups, daily prize COLLECT, grand prize COLLECT, plus CLAIM PRIZE / SPIN & WIN buttons for 1 min after launch on RealPrize and LoneStar Casino
// @author       SweepsEdge
// @match        *://*.realprize.com/*
// @match        *://*.lonestarcasino.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/realprizeautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/realprizeautoclaim.user.js
// ==/UserScript==
//
// NOTE: if you see NO "[AutoClaim]" lines in the console on the page that has the
// wheel, the widget is in a cross-origin iframe. Run this in the console on that
// page to find its origin, then add a matching @match line above:
//   [...document.querySelectorAll('iframe')].map(f => f.src)

(function () {
    'use strict';

    const POLL_INTERVAL_MS       = 800;
    const CLAIM_COOLDOWN_MS      = 5000;
    const GRAND_PRIZE_DELAYS_MS  = [5000, 7500, 10000]; // retry at 5s, 7.5s, 10s after daily collect
    const CLAIM_TEXT_RE          = /\b(claim\s*now|collect|claim\s*bonus)\b/i;

    // Launch-window button scan (CLAIM PRIZE / SPIN & WIN)
    const LAUNCH_SCAN_DURATION_MS = 60000;  // keep looking for 1 minute post launch
    const LAUNCH_SCAN_INTERVAL_MS = 10000;  // rescan every 10 seconds
    const LAUNCH_BUTTON_MATCHERS  = [
        { name: 'CLAIM PRIZE', re: /claim\s*prize/i },
        { name: 'SPIN & WIN',  re: /spin\s*&\s*win/i }
    ];

    let lastClaimAt        = 0;
    let grandPrizeArmed    = false; // true after a daily collect fires
    let grandPrizeTimers   = [];    // holds pending setTimeout IDs

    let launchScanUntil    = 0;
    let launchScanTimer    = null;
    let lastLaunchCheckAt  = 0;

    // ── Helpers ────────────────────────────────────────────────────────────────

    function log(msg) {
        console.log(`[AutoClaim] ${msg}`);
    }

    function now() {
        return Date.now();
    }

    function onCooldown() {
        return (now() - lastClaimAt) < CLAIM_COOLDOWN_MS;
    }

    function realClick(el) {
        try {
            el.dispatchEvent(new MouseEvent('click', {
                bubbles: true, cancelable: true, view: window
            }));
        } catch (_) {
            el.click();
        }
        lastClaimAt = now();
    }

    // Full pointer + mouse sequence – React widgets often ignore a bare click
    function robustClick(el) {
        const opts = { bubbles: true, cancelable: true, view: window };
        try {
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
        } catch (_) {
            try { el.click(); } catch (__) {}
        }
        lastClaimAt = now();
    }

    function isVisible(el) {
        const style = window.getComputedStyle(el);
        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            el.offsetParent !== null
        );
    }

    // Looser test for the animated launch buttons (opacity/scale transitions,
    // absolute positioning) – only rejects genuinely hidden / zero-size nodes.
    function isVisibleLoose(el) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0;
    }

    // querySelectorAll that also descends into open shadow roots
    function collectDeep(root, selector, out) {
        let nodes;
        try { nodes = root.querySelectorAll(selector); } catch (_) { return; }
        for (const n of nodes) out.push(n);
        let all;
        try { all = root.querySelectorAll('*'); } catch (_) { return; }
        for (const el of all) {
            if (el.shadowRoot) collectDeep(el.shadowRoot, selector, out);
        }
    }

    function clearGrandPrizeTimers() {
        grandPrizeTimers.forEach(id => clearTimeout(id));
        grandPrizeTimers = [];
    }

    // ── Grand prize COLLECT ────────────────────────────────────────────────────

    /**
     * Looks specifically for #daily_button inside #grand_prize_finished_container.
     * The container must have the "is-collect" class and be visible.
     */
    function checkGrandPrizeCollect() {
        const container = document.getElementById('grand_prize_finished_container');
        if (!container) return false;
        if (!container.classList.contains('is-collect')) return false;
        if (!isVisible(container)) return false;

        const btn = container.querySelector('#daily_button');
        if (!btn) return false;

        const label = (btn.innerText || btn.textContent || '').trim().toUpperCase();
        if (label === '' || label === 'CLAIMED' || label === 'DONE') return false;

        log(`Grand prize COLLECT button found → clicking`);
        realClick(btn);
        grandPrizeArmed = false;
        clearGrandPrizeTimers();
        return true;
    }

    /**
     * Arms a series of delayed attempts to catch the grand prize popup
     * that appears 5–10 seconds after the regular daily collect.
     */
    function armGrandPrizeWatch() {
        if (grandPrizeArmed) return; // already watching
        grandPrizeArmed = true;
        clearGrandPrizeTimers();

        log(`Arming grand prize watch (checks at ${GRAND_PRIZE_DELAYS_MS.join('ms, ')}ms)`);

        GRAND_PRIZE_DELAYS_MS.forEach(delay => {
            const id = setTimeout(() => {
                if (!grandPrizeArmed) return; // already claimed, abort
                log(`Grand prize delayed check at ${delay}ms…`);
                checkGrandPrizeCollect();
            }, delay);
            grandPrizeTimers.push(id);
        });
    }

    // ── Daily prize COLLECT ────────────────────────────────────────────────────

    function checkDailyCollect() {
        // Only target #daily_button that is NOT inside the grand prize container
        const btn = document.getElementById('daily_button');
        if (!btn) return;
        if (btn.closest('#grand_prize_finished_container')) return; // handled separately
        if (!isVisible(btn)) return;

        const label = (btn.innerText || btn.textContent || '').trim().toUpperCase();
        if (label === '' || label === 'CLAIMED' || label === 'DONE') return;

        // Skip if today's section already shows a claimed checkmark
        const popup = btn.closest('#daily_prize_popup');
        if (popup) {
            const todaySection = popup.querySelector('#daily-today');
            if (todaySection) {
                const claimed = todaySection.querySelector('.claimed_check');
                if (claimed && isVisible(claimed)) return;
            }
        }

        log(`Daily COLLECT button found → clicking; arming grand prize watch`);
        realClick(btn);
        armGrandPrizeWatch(); // kick off delayed grand prize checks
    }

    // ── Generic popup scanner ──────────────────────────────────────────────────

    function findClaimTarget(popup) {
        const candidates = popup.querySelectorAll('button, a, [role="button"], .btn, .button');
        for (const el of candidates) {
            if (CLAIM_TEXT_RE.test(el.innerText || el.textContent || '')) {
                return el;
            }
        }
        const link = popup.getAttribute('data-link');
        if (link === 'get_fs' || link === 'get_bonus') {
            return popup;
        }
        return null;
    }

    function scanAndClaim() {
        if (onCooldown()) return;

        // 1. Generic bonus popups (highest priority)
        const popups = document.querySelectorAll('.genpop.showitbig');
        for (const popup of popups) {
            if (!isVisible(popup)) continue;
            const target = findClaimTarget(popup);
            if (!target) continue;
            log(`Popup found → clicking: ${target.tagName} [data-link="${popup.getAttribute('data-link')}"]`);
            realClick(target);
            return;
        }

        // 2. Grand prize collect (check opportunistically in case it appeared
        //    without going through the daily collect path, e.g. page reload)
        if (checkGrandPrizeCollect()) return;

        // 3. Regular daily COLLECT button
        checkDailyCollect();
    }

    // ── Launch-window button scan (CLAIM PRIZE / SPIN & WIN) ───────────────────

    function clickLaunchButtons() {
        lastLaunchCheckAt = now();

        const btns = [];
        collectDeep(document, 'button, [role="button"]', btns);

        let clicked = 0;
        for (const btn of btns) {
            const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) continue;

            const match = LAUNCH_BUTTON_MATCHERS.find(m => m.re.test(text));
            if (!match) continue;

            if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
                log(`"${match.name}" present but disabled – skipping`);
                continue;
            }
            if (!isVisibleLoose(btn)) {
                log(`"${match.name}" present but not visible – skipping`);
                continue;
            }

            log(`"${match.name}" found → clicking`);
            robustClick(btn);
            clicked++;
        }

        if (clicked === 0) {
            const candidates = btns
                .map(b => (b.textContent || '').replace(/\s+/g, ' ').trim())
                .filter(t => /spin|claim|prize|win/i.test(t));
            log(`Launch scan: ${btns.length} buttons in DOM, no clickable match. ` +
                `Text candidates: ${candidates.length ? candidates.map(s => `"${s}"`).join(', ') : 'none'}`);
        }
    }

    function armLaunchScan(reason) {
        launchScanUntil = now() + LAUNCH_SCAN_DURATION_MS;
        log(`Launch-window button scan armed (${reason}) – every ` +
            `${LAUNCH_SCAN_INTERVAL_MS}ms for ${LAUNCH_SCAN_DURATION_MS}ms`);

        clickLaunchButtons(); // immediate first pass

        if (launchScanTimer) return; // interval already running; window just got extended
        launchScanTimer = setInterval(() => {
            if (now() >= launchScanUntil) {
                clearInterval(launchScanTimer);
                launchScanTimer = null;
                log(`Launch-window button scan finished`);
                return;
            }
            clickLaunchButtons();
        }, LAUNCH_SCAN_INTERVAL_MS);
    }

    // Re-arm the 1-min window on SPA route changes (client-side navigation)
    (function hookSpaNav() {
        const fire = () => armLaunchScan('SPA navigation');
        for (const fn of ['pushState', 'replaceState']) {
            const orig = history[fn];
            history[fn] = function () {
                const r = orig.apply(this, arguments);
                setTimeout(fire, 300);
                return r;
            };
        }
        window.addEventListener('popstate', () => setTimeout(fire, 300));
    })();

    // ── MutationObserver ───────────────────────────────────────────────────────

    const observer = new MutationObserver(() => {
        scanAndClaim();
        // during the launch window, also react to DOM changes (throttled)
        if (now() < launchScanUntil && now() - lastLaunchCheckAt > 500) {
            clickLaunchButtons();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
    });

    // ── Polling fallback ───────────────────────────────────────────────────────

    setInterval(scanAndClaim, POLL_INTERVAL_MS);

    armLaunchScan('page load');

    log(`Loaded on ${location.hostname} – watching for popups, daily collect, grand prize, and launch buttons…`);

})();
