// ==UserScript==
// @name         RealPrize / LoneStar Casino – Auto Claim Popup
// @namespace    SweepsEdge
// @version      1.9.4
// @description  On RealPrize and LoneStar Casino: clicks daily/grand prize COLLECT and any button whose text says collect / claim / free spins (incl. image-based Claim Now popups, CLAIM PRIZE, SPIN & WIN), and closes popups that show a price (e.g. 4.99, 19.99)
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
//
// v1.6.1 – added explicit support for image-based "Claim Now" popups
//          (cdn.lonestarcasino.com/pops/... images + any "Claim Now" text)
// v1.6.3 – fixed CPU spike/tab freeze: debounced the MutationObserver (was
//          running a full scan on every class/style mutation, unbounded),
//          throttled the tryPressLogin DOM walk to ~2x/sec, and stopped
//          re-clicking the same launch button (CLAIM PRIZE/SPIN & WIN) node
//          repeatedly
// v1.6.4 – widened CLAIM_TEXT_RE to also match "claim reward" (icon-only
//          LoneStar popup used aria-label="Claim reward" with no visible
//          button text, so the image-based path's aria-label fallback was
//          never matching)
// v1.6.5 – added @updateURL/@downloadURL header (Tampermonkey already had
//          it set in its own per-script settings; the script file itself
//          just never documented it)
// v1.7.0 – removed auto-login (tryPressLogin and all its login-only helpers
//          and config); login on both realprize.com and lonestarcasino.com
//          is now handled by the AutoLogin Sites Chrome extension, which
//          dispatches genuinely trusted clicks (chrome.debugger) — this
//          script's synthetic-event clicks could never reliably do that
// v1.7.1 – fixed findImageBasedClaimNow's last-resort fallback: the
//          unbounded img.closest('...[class*="btn"]...') walk had no depth
//          limit, so on realprize.com it matched all the way up to the
//          game-lobby carousel/banner wrapper (whose class happened to
//          contain "button") instead of an actual small Claim Now element.
//          That made the script repeatedly "click" the entire banner
//          (hundreds of game tiles) many times per second, which in turn
//          crashed the site's own click handler (TypeError: Cannot read
//          properties of undefined (reading 'id') in site_120n.js). Added
//          a text-length guard (<200 chars) so an oversized match — a sign
//          .closest() grabbed something far bigger than a button — is
//          skipped instead of clicked.
// v1.7.2 – v1.7.1 only fixed the *last-resort* closest() fallback, but the
//          real culprit was one loop up: the "walk up to 8 ancestor levels"
//          loop's "is the parent itself a clickable claim element" check had
//          no size guard at all, so on realprize.com it matched the same
//          oversized carousel/banner container well before ever reaching
//          the last-resort branch — confirmed still reproducing after the
//          v1.7.1 fix. Added the identical <200-char length guard to that
//          check too.
// v1.8.0 – realprize.com only: daily prize COLLECT and grand prize COLLECT
//          are no longer clicked here (moved to the Collector-App "RealPrize"
//          profile). Every other path (broad search, image popups, generic
//          popups) also skips anything inside #daily_prize_wrap on that site.
//          Gifts, Claim Now popups and CLAIM PRIZE / SPIN & WIN unchanged.
//          LoneStar keeps the daily collect in this script for now.
// v1.8.1 – LoneStar only: logs/saves what it clicks and any daily-prize
//          popup it sees (localStorage 'autoclaim_lonestar_dumps', console
//          [AutoClaim][dump]) so the daily can be moved to Collector-App.
//          Clicking behaviour unchanged.
// v1.9.0 – Collector-App no longer clicks the RealPrize / LoneStar daily prize
//          (those profiles now only open the site every 12h to keep the session
//          logged in), so this script owns all claiming again:
//          * removed DAILY_VIA_COLLECTOR / inDailyPopup (v1.8.0): daily prize and
//            grand prize COLLECT are clicked on realprize.com again
//          * removed the LoneStar dump code (v1.8.1)
//          * CLAIM_TEXT_RE now also matches "claim" and "free spin(s)" on their own
//            (not only "claim now"); generic matches must be short (<=80 chars),
//            not a countdown ("Claim in 03:12:11"), not disabled, not a link to
//            another page, and are clicked at most 2 times per element / 6 times
//            per text per page load (no endless re-click loops)
//          * NEW popup closer: a modal/dialog/fixed overlay whose text shows a
//            price ($4.99, 19.99, 9.99 USD ...) is closed (close/X button, "no
//            thanks" style button, then Escape). Amounts followed by SC/GC/coins/
//            bonus/free are not treated as prices. Popups the user opened
//            themselves (trusted click shortly before) are left alone
//          * claim buttons inside a popup that shows a price are NOT clicked
//            (could be a purchase button) - SKIP_CLAIM_IN_PRICE_POPUPS
// v1.9.1 – never click anything that belongs to the Collector-App extension's on-page UI
//          (#collector-app-overlay-root Run/Stop buttons, debug log, log panel). The
//          "Lonestar/RealPrize Free Spins" profile buttons matched the new "free spin(s)"
//          text and got clicked, stopping/restarting the profile in an endless loop.
// v1.9.2 – bare "Free Spins" buttons (e.g. LoneStar's top-right nav button) are no longer clicked
//          on page load; free-spin-only labels are clicked only inside a popup/dialog layer.
// v1.9.4 – free-claim detection matches any element with Claim Now text (not just buttons), and clicks it inside popups.
// v1.9.3 – fixed header/nav no longer counts as a popup (nav Free Spins click); popups with a plain Claim/Collect button are not closed/skipped as price popups.
(function () {
    'use strict';

    const POLL_INTERVAL_MS       = 800;
    const CLAIM_COOLDOWN_MS      = 5000;
    const GRAND_PRIZE_DELAYS_MS  = [5000, 7500, 10000];
    // v1.9.0: any short "collect" / "claim" / "free spin(s)" button counts
    // (previously only claim now / collect / claim bonus / claim reward).
    const CLAIM_TEXT_RE          = /\b(claim|collect|free\s*spins?)\b/i;
    const GENERIC_TEXT_MAX_LEN   = 80;   // longer text = a paragraph/container, not a button
    const COUNTDOWN_RE           = /\b\d{1,2}:\d{2}\b|\b(in|available|unlocks?)\s+\d+\s*[dhm]\b/i;
    const MAX_CLICKS_PER_NODE    = 2;
    const MAX_CLICKS_PER_TEXT    = 6;

    // v1.9.0 popup closer
    const CLOSE_PRICE_POPUPS           = true;  // close popups that show a price
    const SKIP_CLAIM_IN_PRICE_POPUPS   = true;  // never click collect/claim inside a popup that shows a price
    const USER_OPENED_GRACE_MS         = 6000;  // popup that appears within this long after a real user click is left alone
    const CLOSE_RETRY_MS               = 2000;
    const MAX_CLOSE_TRIES              = 4;
    // Strong price: has a $ sign or USD ($4.99, $19.99, $5, 9.99 USD).
    // Weak price: bare 4.99 / 19.99 / x.95 / x.49 - only counts if the popup also has a
    // purchase word (so a reward like "0.49 SC" in a free popup is never mistaken for a price).
    const PRICE_STRONG_RE  = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\b\d+(?:\.\d{2})?\s?USD\b/gi;
    const PRICE_WEAK_RE    = /\b\d{1,3}(?:,\d{3})*\.(?:99|95|49)\b/g;
    const PURCHASE_WORD_RE = /\b(buy|purchase|offer|deal|only|special|limited|best\s*value|checkout|pay|order|save|\d+%\s*off|most\s*popular|get\s+(?:it|now|offer))\b/i;
    const PRICE_NOT_RE_AFTER  = /^\s*(sc|gc|sweeps?|gold|coins?|free|bonus|k\b|m\b)/i;   // "$5 FREE", "2.99 SC"
    const PROTECTED_POPUP_SEL = '[aria-label*="prize" i], #daily_prize_wrap, #daily_prize_popup'; // never auto-closed

    // Launch-window button scan
    const LAUNCH_SCAN_DURATION_MS = 60000;
    const LAUNCH_SCAN_INTERVAL_MS = 10000;
    const LAUNCH_BUTTON_MATCHERS  = [
        { name: 'CLAIM PRIZE', re: /claim\s*prize/i },
        { name: 'SPIN & WIN',  re: /spin\s*&\s*win/i }
    ];


    let lastClaimAt        = 0;
    let grandPrizeArmed    = false;
    let grandPrizeTimers   = [];
    let launchScanUntil    = 0;
    let launchScanTimer    = null;
    let lastLaunchCheckAt  = 0;
    const clickedLaunchButtons = new WeakSet(); // avoid re-clicking the same node

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

    // ── v1.9.0: price detection, popup finding, click guards ───────────────────
    let lastUserClickAt = 0;
    ['pointerdown', 'click'].forEach(ev => document.addEventListener(ev, e => {
        if (e.isTrusted) lastUserClickAt = Date.now();
    }, true));

    function hasPrice(text) {
        if (!text) return false;
        for (const m of text.matchAll(PRICE_STRONG_RE)) {
            const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
            if (PRICE_NOT_RE_AFTER.test(after)) continue;
            return true;
        }
        if (!PURCHASE_WORD_RE.test(text)) return false;
        for (const m of text.matchAll(PRICE_WEAK_RE)) {
            const after  = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
            const before = text.slice(Math.max(0, m.index - 6), m.index);
            if (PRICE_NOT_RE_AFTER.test(after) || /\b(sc|gc)\s*$/i.test(before)) continue;
            return true;
        }
        return false;
    }

    const POPUP_EXPLICIT_SEL = '[role="dialog"], [aria-modal="true"], dialog[open], .genpop.showitbig';
    const POPUP_LOOSE_SEL    = POPUP_EXPLICIT_SEL + ', [class*="modal" i], [class*="popup" i], [class*="overlay" i], [class*="dialog" i]';

    function isFixedLayer(el) {
        let n = el;
        for (let i = 0; i < 6 && n && n !== document.body; i++, n = n.parentElement) {
            let pos = '';
            try { pos = window.getComputedStyle(n).position; } catch (_) {}
            if (pos === 'fixed') return true;
        }
        return false;
    }

    // Visible popup-like layers (outermost only, small enough to be a popup, not the page).
    function popupRoots() {
        let nodes;
        try { nodes = Array.from(document.querySelectorAll(POPUP_LOOSE_SEL)); } catch (_) { return []; }
        const picked = [];
        for (const el of nodes) {
            if (el === document.body || el === document.documentElement) continue;
            if (!isVisibleLoose(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 150 || r.height < 100) continue;
            const explicit = el.matches(POPUP_EXPLICIT_SEL);
            if (!explicit && !isFixedLayer(el)) continue;
            if (cleanText(el).length > 2500) continue; // a page wrapper, not a popup
            picked.push(el);
        }
        return picked.filter(el => !picked.some(o => o !== el && o.contains(el)));
    }

    // Nearest popup layer around el (or null).
    function popupAround(el) {
        let n = el;
        for (let i = 0; i < 14 && n && n !== document.body; i++, n = n.parentElement) {
            if (n.matches && n.matches(POPUP_EXPLICIT_SEL)) return n;
        }
        n = el;
        for (let i = 0; i < 14 && n && n !== document.body; i++, n = n.parentElement) {
            let pos = '';
            try { pos = window.getComputedStyle(n).position; } catch (_) {}
            // v1.9.3: a fixed header/nav bar is not a popup (its Free Spins button was being clicked)
            if (pos === 'fixed' && n.getBoundingClientRect().width >= 150 && n.getBoundingClientRect().height >= 100 &&
                !(n.matches && n.matches('header, nav, [role="navigation"]'))) return n;
        }
        return null;
    }

    // v1.9.3: a popup with a plain Claim/Collect button is a free reward, never closed/skipped as a price popup
    function hasFreeClaimButton(pop) {
        if (!pop || !pop.querySelectorAll) return false;
        return !!findFreeClaimEl(pop);
    }
    // v1.9.4: any visible element (button or not) whose text is just "Claim Now" / "Claim" / "Collect" ...
    function findFreeClaimEl(pop) {
        const re = /^(claim|collect)(\s+(now|reward|bonus|prize|free\s*spins?))?!?$/i;
        const els = Array.from(pop.querySelectorAll('*')).filter(b => isVisibleLoose(b) && re.test(cleanText(b)));
        return els.find(b => !els.some(o => o !== b && b.contains(o))) || null; // innermost match
    }

    const nodeClicks = new WeakMap();
    const textClicks = new Map();
    function labelOf(el) {
        return cleanText(el) || (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '';
    }
    function noteClick(el) {
        nodeClicks.set(el, (nodeClicks.get(el) || 0) + 1);
        const key = labelOf(el).toLowerCase();
        textClicks.set(key, (textClicks.get(key) || 0) + 1);
    }
    // generic = broad text match (strict guards); false = specific popup paths (only the price/loop guards)
    // v1.9.1: elements that belong to the Collector-App extension UI must never be clicked
    const COLLECTOR_UI_SEL = '#collector-app-overlay-root, #collector-app-debug-log, #__collector_log_panel';
    function inCollectorUi(el) {
        let n = el;
        for (let i = 0; i < 12 && n; i++) {
            if (n.nodeType === 1 && n.matches && n.matches(COLLECTOR_UI_SEL)) return true;
            if (n.nodeType === 1 && n.closest && n.closest(COLLECTOR_UI_SEL)) return true;
            const root = n.getRootNode && n.getRootNode();
            n = root && root.host ? root.host : null; // climb out of shadow roots
        }
        return false;
    }

    function allowClick(el, generic) {
        if (!el || inCollectorUi(el)) return false;
        if ((nodeClicks.get(el) || 0) >= MAX_CLICKS_PER_NODE) return false;
        const label = labelOf(el);
        if ((textClicks.get(label.toLowerCase()) || 0) >= MAX_CLICKS_PER_TEXT) return false;
        if (generic) {
            if (!label || label.length > GENERIC_TEXT_MAX_LEN) return false;
            if (COUNTDOWN_RE.test(label)) return false;
            const a = el.closest && el.closest('a[href]');
            if (a) {
                try {
                    const u = new URL(a.getAttribute('href'), location.href);
                    const here = location.origin + location.pathname + location.search;
                    if (/^(javascript|mailto|tel):/i.test(a.getAttribute('href'))) return false;
                    if (u.origin + u.pathname + u.search !== here) return false; // navigates away
                } catch (_) { return false; }
            }
        }
        if (SKIP_CLAIM_IN_PRICE_POPUPS) {
            const pop = popupAround(el);
            if (pop && !pop.matches(PROTECTED_POPUP_SEL) && !hasFreeClaimButton(pop) && hasPrice(cleanText(pop))) return false;
        }
        return true;
    }

    // ── v1.9.0: close popups that show a price ─────────────────────────────────
    const popupState = new WeakMap();
    function findCloseButton(root) {
        const all = (sel) => { try { return Array.from(root.querySelectorAll(sel)); } catch (_) { return []; } };
        const clickable = (el) => {
            const t = el.closest('button, a, [role="button"]') || el;
            return (isVisibleLoose(t) && !t.disabled) ? t : null;
        };
        const buyish = /\b(buy|purchase|get|claim|collect|spin|play|checkout|pay|\$)/i;
        // 1) explicitly labelled close controls
        const explicitSel = ['[aria-label*="close" i]', '[title*="close" i]', '[data-testid*="close" i]',
            '[data-test*="close" i]', 'img[alt*="close" i]', '[aria-label*="dismiss" i]'];
        for (const sel of explicitSel) {
            for (const el of all(sel)) {
                const t = clickable(el);
                if (t && !buyish.test(cleanText(t))) return t;
            }
        }
        // 2) class/id based, but only small controls (an X), never big containers
        for (const el of all('[class*="close" i], [id*="close" i], [class*="dismiss" i]')) {
            const t = clickable(el);
            if (!t) continue;
            const r = t.getBoundingClientRect();
            if (r.width <= 140 && r.height <= 140 && !buyish.test(cleanText(t))) return t;
        }
        // 3) text buttons: x, close, no thanks, maybe later ...
        for (const el of all('button, a, [role="button"]')) {
            const txt = cleanText(el);
            if (/^(×|✕|✖|x|close|no,?\s*thanks|not\s*now|maybe\s*later|skip|dismiss|later)$/i.test(txt) && isVisibleLoose(el) && !el.disabled) return el;
        }
        // 4) icon-only small button in the top-right corner of the popup
        const rr = root.getBoundingClientRect();
        let best = null, bestRight = -1;
        for (const el of all('button, [role="button"]')) {
            if (!isVisibleLoose(el) || el.disabled || cleanText(el)) continue;
            const r = el.getBoundingClientRect();
            if (r.width > 90 || r.height > 90) continue;
            if (r.top > rr.top + rr.height * 0.3 || r.right < rr.left + rr.width * 0.6) continue;
            if (r.right > bestRight) { best = el; bestRight = r.right; }
        }
        return best;
    }

    function sendEscape() {
        const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
        [document.activeElement, document, document.body].forEach(t => {
            try { if (t) t.dispatchEvent(new KeyboardEvent('keydown', opts)); } catch (_) {}
            try { if (t) t.dispatchEvent(new KeyboardEvent('keyup', opts)); } catch (_) {}
        });
    }

    let lastPopupScanAt = 0;
    function closePricePopups() {
        if (!CLOSE_PRICE_POPUPS) return;
        if (now() - lastPopupScanAt < 700) return; // throttle: mutation bursts must not run this every 150ms
        lastPopupScanAt = now();
        const roots = [];
        for (const root of popupRoots()) {
            if (root.matches(PROTECTED_POPUP_SEL) || root.querySelector(PROTECTED_POPUP_SEL)) continue;
            const text = cleanText(root);
            if (!hasPrice(text) || hasFreeClaimButton(root)) continue;
            // Register every price popup the first time it is seen (even if only one is closed per pass),
            // so "opened by you" is judged against when it APPEARED, not when it got its turn.
            if (!popupState.has(root)) {
                const userOpened = (now() - lastUserClickAt) < USER_OPENED_GRACE_MS;
                popupState.set(root, { tries: 0, last: 0, userOpened });
                log(`Price popup seen${userOpened ? ' (opened by you - leaving it)' : ''}: "${text.slice(0, 80)}"`);
            }
            roots.push(root);
        }
        for (const root of roots) {
            const st = popupState.get(root);
            if (st.userOpened || st.tries >= MAX_CLOSE_TRIES) continue;
            if (now() - st.last < CLOSE_RETRY_MS) continue;
            st.last = now();
            st.tries++;
            const btn = st.tries < 3 ? findCloseButton(root) : null;
            if (btn) {
                log(`Closing price popup (try ${st.tries}) via "${cleanText(btn) || btn.getAttribute('aria-label') || btn.tagName}"`);
                humanClick(btn);
            } else {
                log(`Closing price popup (try ${st.tries}) via Escape`);
                sendEscape();
            }
            return; // one popup per pass
        }
    }

    // ── Human-like click emulation ─────────────────────────────────────────────
    function humanClick(el) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width  * (0.35 + Math.random() * 0.3);
        const y = rect.top  + rect.height * (0.35 + Math.random() * 0.3);

        const base = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            screenX: x + (window.screenX || 0),
            screenY: y + (window.screenY || 0),
            button: 0,
            buttons: 1,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
        };

        el.dispatchEvent(new MouseEvent('mousemove',   { ...base, buttons: 0 }));
        el.dispatchEvent(new PointerEvent('pointermove', { ...base, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('mouseover',   { ...base, buttons: 0 }));
        el.dispatchEvent(new MouseEvent('mouseenter',  { ...base, buttons: 0 }));
        el.dispatchEvent(new PointerEvent('pointerover',  { ...base, buttons: 0 }));
        el.dispatchEvent(new PointerEvent('pointerenter', { ...base, buttons: 0 }));

        const downDelay = 40 + Math.random() * 90;

        setTimeout(() => {
            el.dispatchEvent(new PointerEvent('pointerdown', base));
            el.dispatchEvent(new MouseEvent('mousedown', base));

            setTimeout(() => {
                const up = { ...base, buttons: 0 };
                el.dispatchEvent(new PointerEvent('pointerup', up));
                el.dispatchEvent(new MouseEvent('mouseup', up));
                el.dispatchEvent(new MouseEvent('click', up));
                try { el.click(); } catch (_) {}
                lastClaimAt = now();
            }, 30 + Math.random() * 60);
        }, downDelay);
    }

    function realClick(el)   { humanClick(el); }
    function robustClick(el) { humanClick(el); }

    function isVisible(el) {
        const style = window.getComputedStyle(el);
        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            el.offsetParent !== null
        );
    }

    function isVisibleLoose(el) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0;
    }

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
    function gatherDeep(selector) {
        const out = [];
        collectDeep(document, selector, out);
        return out;
    }

    function cleanText(el) {
        return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    }

    function clearGrandPrizeTimers() {
        grandPrizeTimers.forEach(id => clearTimeout(id));
        grandPrizeTimers = [];
    }

    // ── Auto-login helpers ────────────────────────────────────────────────────
    // (tryPressLogin and its other login-only helpers were removed in v1.7.0 —
    // see changelog above. innermostOnly is kept: findAnyCollectButton still
    // uses it.)
    function innermostOnly(list) {
        return list.filter(el => !list.some(other => other !== el && el.contains(other)));
    }

    // ── Grand prize COLLECT ────────────────────────────────────────────────────
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

    function armGrandPrizeWatch() {
        if (grandPrizeArmed) return;
        grandPrizeArmed = true;
        clearGrandPrizeTimers();
        log(`Arming grand prize watch (checks at ${GRAND_PRIZE_DELAYS_MS.join('ms, ')}ms)`);
        GRAND_PRIZE_DELAYS_MS.forEach(delay => {
            const id = setTimeout(() => {
                if (!grandPrizeArmed) return;
                log(`Grand prize delayed check at ${delay}ms…`);
                checkGrandPrizeCollect();
            }, delay);
            grandPrizeTimers.push(id);
        });
    }

    // ── Daily prize COLLECT ────────────────────────────────────────────────────
    function checkDailyCollect() {
        const btn = document.getElementById('daily_button');
        if (!btn) return;
        if (btn.closest('#grand_prize_finished_container')) return;
        if (!isVisible(btn)) return;

        const label = (btn.innerText || btn.textContent || '').trim().toUpperCase();
        if (label === '' || label === 'CLAIMED' || label === 'DONE') return;

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
        armGrandPrizeWatch();
    }

    // ── Broad Collect / Claim Now search ───────────────────────────────────────
    function findAnyCollectButton() {
        const candidates = gatherDeep(
            'button, a, [role="button"], [class*="btn" i], [class*="button" i], [class*="collect" i], [id*="collect" i], [class*="claim" i], [id*="claim" i]'
        );

        const visible = candidates.filter(el => {
            if (!isVisibleLoose(el)) return false;
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
            if (!CLAIM_TEXT_RE.test(labelOf(el)) || !allowClick(el, true)) return false;
            // v1.9.2: a bare "Free Spins" label (e.g. the top-right nav button) is only clicked inside a popup
            if (!/\b(claim|collect)\b/i.test(labelOf(el)) && !popupAround(el)) return false;
            return true;
        });

        // v1.9.4: "Claim Now" text that is not inside a button-like element, but is inside a popup
        if (!visible.length) {
            for (const pop of popupRoots()) {
                const el = findFreeClaimEl(pop);
                if (el && allowClick(el, false)) { visible.push(el); break; }
            }
        }
        return innermostOnly(visible);
    }

    // ── Image-based Claim Now popup (the one you showed) ───────────────────────
    function findImageBasedClaimNow() {
        // Look for the specific popup images used by LoneStar
        const imgs = gatherDeep('img[src*="cdn.lonestarcasino.com/pops/"], img[src*="/pops/"]');

        for (const img of imgs) {
            if (!isVisibleLoose(img)) continue;

            // Walk up a few levels looking for a Claim Now / Collect button
            let parent = img.parentElement;
            for (let i = 0; i < 8 && parent; i++) {
                // Search inside this parent for a claim/collect button
                const btns = parent.querySelectorAll('button, a, [role="button"], [class*="btn" i], [class*="button" i]');
                for (const btn of btns) {
                    if (!isVisibleLoose(btn)) continue;
                    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
                    if (CLAIM_TEXT_RE.test(cleanText(btn)) && allowClick(btn, false)) {
                        return btn;
                    }
                }

                // Also check if the parent itself is a clickable claim element.
                // Same <200-char length guard as the last-resort branch below:
                // this walk goes up to 8 ancestor levels, which on realprize.com
                // was already enough to reach the surrounding carousel/banner
                // (hundreds of chars of unrelated game-tile text) before ever
                // finding a real button. Anything that long isn't a Claim Now
                // element — skip it instead of clicking it.
                const parentText = cleanText(parent);
                if (parentText.length < 200 && CLAIM_TEXT_RE.test(parentText) && isVisibleLoose(parent) && allowClick(parent, false)) {
                    return parent;
                }

                parent = parent.parentElement;
            }

            // Last resort: only click the clickable container if it actually has
            // claim/collect text (content or aria-label) — otherwise store/promo
            // tiles that merely reuse the /pops/ image path get clicked by mistake.
            const clickableParent = img.closest('button, a, [role="button"], [onclick], [class*="btn" i], [class*="button" i]');
            if (clickableParent && isVisibleLoose(clickableParent)) {
                const ariaLabel = clickableParent.getAttribute('aria-label') || '';
                const parentText = cleanText(clickableParent);
                // Guard: .closest() has no depth limit, so on this site it can walk
                // past the real button and match a huge ancestor (e.g. the whole
                // carousel/banner wrapper, whose class happens to contain "button").
                // A real Claim Now element's text is short; anything long means we
                // grabbed something far bigger than a button — skip it.
                if (parentText.length < 200 && (CLAIM_TEXT_RE.test(parentText) || CLAIM_TEXT_RE.test(ariaLabel)) && allowClick(clickableParent, false)) {
                    return clickableParent;
                }
            }
        }
        return null;
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
        // v1.9.0: close price popups first (not subject to the claim cooldown)
        closePricePopups();
        if (onCooldown()) return;

        // 1. Generic bonus popups
        const popups = document.querySelectorAll('.genpop.showitbig');
        for (const popup of popups) {
            if (!isVisible(popup)) continue;
            const target = findClaimTarget(popup);
            if (!target || !allowClick(target, false)) continue;
            log(`Popup found → clicking: ${target.tagName} [data-link="${popup.getAttribute('data-link')}"]`);
            noteClick(target);
            realClick(target);
            return;
        }

        // 2. Grand prize collect
        if (checkGrandPrizeCollect()) return;

        // 3. Regular daily COLLECT
        checkDailyCollect();

        // 4. Image-based Claim Now popup (the new one you reported)
        const imageClaim = findImageBasedClaimNow();
        if (imageClaim) {
            log(`Image-based Claim Now popup found → clicking "${cleanText(imageClaim) || imageClaim.tagName}"`);
            noteClick(imageClaim);
            realClick(imageClaim);
            return;
        }

        // 5. Broad search – any “Collect / Claim Now / Claim Bonus” button
        const anyCollects = findAnyCollectButton();
        if (anyCollects.length) {
            const best = anyCollects.find(el => {
                const t = cleanText(el).toUpperCase();
                return t !== 'CLAIMED' && t !== 'DONE' && t !== '';
            }) || anyCollects[0];

            log(`Broad Collect/Claim Now button found → clicking "${cleanText(best)}"`);
            noteClick(best);
            realClick(best);
        }
    }

    // ── Launch-window button scan ──────────────────────────────────────────────
    function clickLaunchButtons() {
        lastLaunchCheckAt = now();
        const btns = [];
        collectDeep(document, 'button, [role="button"]', btns);

        let clicked = 0;
        for (const btn of btns) {
            const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text || inCollectorUi(btn)) continue;

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
            if (clickedLaunchButtons.has(btn)) continue; // already clicked this exact node

            log(`"${match.name}" found → clicking`);
            robustClick(btn);
            clickedLaunchButtons.add(btn);
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
        clickLaunchButtons();
        if (launchScanTimer) return;
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

    // Re-arm on SPA navigation
    (function hookSpaNav() {
        const fire = () => {
            armLaunchScan('SPA navigation');
        };
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
    // Debounced: on pages with live animations (spinning wheel, countdown
    // ticks, hover states) class/style attributes can mutate dozens of times
    // per second. Running the full scan synchronously on every mutation
    // record was pegging the main thread and freezing/crashing the tab.
    // Coalesce bursts into one scan per 150ms instead.
    let mutationDebounceTimer = null;
    const observer = new MutationObserver(() => {
        if (mutationDebounceTimer) return;
        mutationDebounceTimer = setTimeout(() => {
            mutationDebounceTimer = null;
            scanAndClaim();
            if (now() < launchScanUntil && now() - lastLaunchCheckAt > 500) {
                clickLaunchButtons();
            }
        }, 150);
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
    log(`Loaded on ${location.hostname} – watching for popups, daily collect, grand prize, Claim Now (incl. image popups), and launch buttons…`);
})();
