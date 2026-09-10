// ==UserScript==
// @name         RealPrize / LoneStar Casino – Auto Claim Popup
// @namespace    SweepsEdge
// @version      1.6.2
// @description  Detects bonus popups, daily prize COLLECT, grand prize COLLECT, any "Collect" / "Claim Now" button anywhere on the page (including image-based Claim Now popups), CLAIM PRIZE / SPIN & WIN buttons for 1 min after launch, and auto-presses the Login button once the email + password fields are filled, on RealPrize and LoneStar Casino
// @author       SweepsEdge
// @match        *://*.realprize.com/*
// @match        *://*.lonestarcasino.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
//
// NOTE: if you see NO "[AutoClaim]" lines in the console on the page that has the
// wheel, the widget is in a cross-origin iframe. Run this in the console on that
// page to find its origin, then add a matching @match line above:
//   [...document.querySelectorAll('iframe')].map(f => f.src)
//
// v1.6.1 – added explicit support for image-based "Claim Now" popups
//          (cdn.lonestarcasino.com/pops/... images + any "Claim Now" text)
(function () {
    'use strict';

    const POLL_INTERVAL_MS       = 800;
    const CLAIM_COOLDOWN_MS      = 5000;
    const GRAND_PRIZE_DELAYS_MS  = [5000, 7500, 10000];
    const CLAIM_TEXT_RE          = /\b(claim\s*now|collect|claim\s*bonus)\b/i;

    // Launch-window button scan
    const LAUNCH_SCAN_DURATION_MS = 60000;
    const LAUNCH_SCAN_INTERVAL_MS = 10000;
    const LAUNCH_BUTTON_MATCHERS  = [
        { name: 'CLAIM PRIZE', re: /claim\s*prize/i },
        { name: 'SPIN & WIN',  re: /spin\s*&\s*win/i }
    ];

    // Auto-login config
    const LOGIN_COOLDOWN_MS  = 3000;
    const LOGIN_MIN_PW_LEN   = 6;
    const MAX_LOGIN_SUBMITS  = 3;
    const LOGIN_SUBMIT_RE    = /^(log\s?in|sign\s?in|log\s?in\s?now)$/i;
    const LOGIN_EMAIL_OPT_RE = /^(log|sign)\s?in\s+with\s+e-?mail$/i;
    const LOGIN_OPENER_RE    = /^(log\s?in|sign\s?in)$/i;

    let lastClaimAt        = 0;
    let grandPrizeArmed    = false;
    let grandPrizeTimers   = [];
    let launchScanUntil    = 0;
    let launchScanTimer    = null;
    let lastLaunchCheckAt  = 0;
    let lastLoginActionAt  = 0;
    let loginSubmits       = 0;
    let loginComplete      = false;
    let loginModalOpened   = false;

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
    function loginClickable(el) {
        if (!el) return false;
        if (el.disabled) return false;
        if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
        return isVisibleLoose(el);
    }

    function innermostOnly(list) {
        return list.filter(el => !list.some(other => other !== el && el.contains(other)));
    }

    function matchLoginControls(re) {
        const raw = gatherDeep('button, a, [role="button"], [class*="btn" i], [class*="button" i]');
        const hit = raw.filter(el => re.test(cleanText(el)) && loginClickable(el));
        return innermostOnly(hit);
    }

    function visibleFilledPassword() {
        return gatherDeep('input[type="password"]').find(
            i => isVisibleLoose(i) && i.value && i.value.length >= LOGIN_MIN_PW_LEN
        ) || null;
    }

    function anyVisiblePassword() {
        return gatherDeep('input[type="password"]').some(isVisibleLoose);
    }

    function emailFieldReady() {
        const users = gatherDeep('input').filter(i => {
            if (!isVisibleLoose(i)) return false;
            const type = (i.type || 'text').toLowerCase();
            if (type === 'email') return true;
            if (type !== 'text' && type !== 'tel') return false;
            const meta = `${i.name || ''} ${i.id || ''} ${i.autocomplete || ''} ${i.placeholder || ''}`.toLowerCase();
            return /(e-?mail|user|login|phone|account)/.test(meta);
        });
        if (users.length === 0) return true;
        return users.some(i => i.value && i.value.trim());
    }

    function tryPressLogin() {
        if (loginComplete) return;
        if (now() - lastLoginActionAt < LOGIN_COOLDOWN_MS) return;

        const pw = visibleFilledPassword();
        if (pw) {
            const form = pw.closest('form');
            let submit = null;
            if (form) {
                submit = innermostOnly(
                    [...form.querySelectorAll('button, [role="button"], input[type="submit"]')].filter(b =>
                        loginClickable(b) && (
                            LOGIN_SUBMIT_RE.test(cleanText(b)) ||
                            (b.type === 'submit' && LOGIN_SUBMIT_RE.test((b.value || '').trim()))
                        )
                    )
                )[0] || null;

                if (!submit) {
                    const submits = [...form.querySelectorAll('button[type="submit"], input[type="submit"]')]
                        .filter(loginClickable);
                    if (submits.length === 1) submit = submits[0];
                }
            }
            if (!submit) {
                submit = matchLoginControls(LOGIN_SUBMIT_RE).find(b => b.tagName !== 'A') || null;
            }
            if (submit && emailFieldReady()) {
                log(`Login fields filled → pressing "${cleanText(submit) || submit.value || 'submit'}"`);
                robustClick(submit);
                lastLoginActionAt = now();
                if (++loginSubmits >= MAX_LOGIN_SUBMITS) {
                    loginComplete = true;
                    log(`Reached ${MAX_LOGIN_SUBMITS} login attempts – auto-login disabled for this page load`);
                }
            } else if (submit) {
                log('Password filled but email field still empty – waiting for autofill');
            }
            return;
        }

        const emailOpt = matchLoginControls(LOGIN_EMAIL_OPT_RE)[0];
        if (emailOpt) {
            log('Opening "Login with Email" pane');
            robustClick(emailOpt);
            lastLoginActionAt = now();
            return;
        }

        if (anyVisiblePassword()) return;

        if (!loginModalOpened) {
            const opener = matchLoginControls(LOGIN_OPENER_RE)[0];
            if (opener) {
                log('Opening login modal');
                robustClick(opener);
                loginModalOpened = true;
                lastLoginActionAt = now();
            }
        }
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
            const text = cleanText(el);
            return CLAIM_TEXT_RE.test(text);
        });

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
                    if (CLAIM_TEXT_RE.test(cleanText(btn))) {
                        return btn;
                    }
                }

                // Also check if the parent itself is a clickable claim element
                if (CLAIM_TEXT_RE.test(cleanText(parent)) && isVisibleLoose(parent)) {
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
                if (CLAIM_TEXT_RE.test(cleanText(clickableParent)) || CLAIM_TEXT_RE.test(ariaLabel)) {
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
        try { tryPressLogin(); } catch (e) { log('login attempt error: ' + e.message); }
        if (onCooldown()) return;

        // 1. Generic bonus popups
        const popups = document.querySelectorAll('.genpop.showitbig');
        for (const popup of popups) {
            if (!isVisible(popup)) continue;
            const target = findClaimTarget(popup);
            if (!target) continue;
            log(`Popup found → clicking: ${target.tagName} [data-link="${popup.getAttribute('data-link')}"]`);
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
            loginModalOpened = false;
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
    const observer = new MutationObserver(() => {
        scanAndClaim();
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
    try { tryPressLogin(); } catch (_) {}
    log(`Loaded on ${location.hostname} – watching for popups, daily collect, grand prize, Claim Now (incl. image popups), launch buttons, and login…`);
})();
