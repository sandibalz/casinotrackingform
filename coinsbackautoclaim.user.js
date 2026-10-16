// ==UserScript==
// @name         CoinsBack Auto Redeem Promo Code
// @namespace    https://www.coinsbackcasino.com/
// @version      1.1.0
// @description  On CoinsBack's Promo Codes page, once the CapSolver extension reports "Captcha solved!" and the code box is filled (e.g. from ?code=), clicks Redeem once per code, logs what the site shows, then clicks "Maybe later" on the "Bonus claimed!" popup.
// @match        https://www.coinsbackcasino.com/account/promo-codes*
// @match        https://coinsbackcasino.com/account/promo-codes*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/coinsbackautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/coinsbackautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ---- badge: collapsed bottom-left pill with a log; click to open/close (same look as Zula / Yay Auto Claim). ----
    const BADGE_NAME = 'CoinsBack Auto Redeem', BADGE_VER = '1.1.0';
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
    function log(msg, warn) {
        console.log('[CoinsBack AutoRedeem] ' + msg);
        badgeAdd(msg, warn);
    }
    badgeRender();

    const REDEEM_RE = /^\s*redeem\s*$/i;
    const SOLVED_RE = /captcha solved/i;
    const WAIT_AFTER_SOLVED_MS = 800;   // small settle after the solver says solved, before clicking
    const RESULT_WAIT_MS = 8000;

    const clickedCodes = new Set();     // code text already clicked this page load (never double-click the same code)
    let solvedSince = 0;                // when "Captcha solved!" was first seen for the current attempt
    let waitingLogged = false;
    let resultWatch = null;             // { code, t0, seen:Set }

    function isVisible(el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none';
    }

    // CapSolver extension's on-page status: <div id="capsolver-solver-tip-button"><div class="capsolver-solver-info">Captcha solved!</div></div>
    function captchaSolved() {
        const tip = document.querySelector('#capsolver-solver-tip-button');
        return !!(tip && SOLVED_RE.test(tip.textContent || ''));
    }

    // The promo form: <form> with an input[placeholder="Enter promo code"] and <button type="submit">Redeem</button>.
    function findForm() {
        const input = document.querySelector('input[placeholder="Enter promo code"]');
        if (!input) return null;
        const form = input.closest('form');
        if (!form) return null;
        const btn = Array.from(form.querySelectorAll('button')).find((b) => b.type === 'submit' && REDEEM_RE.test(b.textContent));
        return btn ? { input, form, btn } : null;
    }

    function robustClick(el) {
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', base));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseup', base));
        el.dispatchEvent(new MouseEvent('click', base));
    }

    // Any visible toast / alert / status text on the page (site toast libraries vary), minus our own pill and the CapSolver tip.
    function toastTexts() {
        const sel = '[data-sonner-toast],[role="status"],[role="alert"],[class*="toast" i],[class*="Toastify" i],[class*="notification" i],[class*="snackbar" i]';
        const out = [];
        document.querySelectorAll(sel).forEach((e) => {
            if (e.closest('#tm-badge-stack') || e.closest('#capsolver-solver-tip-button') || e.closest('[role="dialog"]')) return;
            if (!isVisible(e)) return;
            const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
            if (t === (document.title || '').trim()) return;   // Next.js route announcer (role=alert span holding the page title)
            if (t && t.length < 300) out.push(t);
        });
        return out;
    }

    // After the click, record every new toast text for a few seconds. RESULT-* lines are classified from the text;
    // anything unrecognised is logged as RESULT-TEXT so the real wording can be seen and matched later.
    function watchResult() {
        if (!resultWatch) return;
        for (const t of toastTexts()) {
            if (resultWatch.seen.has(t)) continue;
            resultWatch.seen.add(t);
            if (/already (been )?(claimed|redeemed|used)/i.test(t)) log('RESULT-ALREADY: ' + t.slice(0, 140));
            else if (/success|redeemed!|claimed!|added|congrat|you (got|received|have been)/i.test(t)) log('RESULT-SUCCESS: ' + t.slice(0, 140));
            else if (/invalid|expired|error|fail|not found|limit|maximum|ineligible|try again|too many/i.test(t)) log('RESULT-ERROR: ' + t.slice(0, 140), true);
            else log('RESULT-TEXT: ' + t.slice(0, 140));
        }
        if (Date.now() - resultWatch.t0 > RESULT_WAIT_MS) {
            if (!resultWatch.seen.size) log('RESULT-NONE: no toast/alert text seen within ' + (RESULT_WAIT_MS / 1000) + ' s', true);
            resultWatch = null;
        }
    }

    // After a successful redeem the site opens a dialog (seen live 10/16/26): "Bonus claimed! We just added 10 Free Rounds on <game>! ..."
    // with buttons "Play <game>" (submit) and "Maybe later". Click ONLY "Maybe later" - never the Play button.
    let lastPopupClick = 0;
    function closeBonusPopup() {
        if (Date.now() - lastPopupClick < 3000) return;
        for (const d of document.querySelectorAll('[role="dialog"]')) {
            if (d.getAttribute('data-state') === 'closed' || !isVisible(d)) continue;
            const txt = (d.innerText || '').replace(/\s+/g, ' ').trim();
            if (!/bonus claimed/i.test(txt)) continue;
            const later = Array.from(d.querySelectorAll('button')).find((b) => /^\s*maybe later\s*$/i.test(b.textContent) && !b.disabled && isVisible(b));
            if (!later) continue;
            lastPopupClick = Date.now();
            log('RESULT-POPUP: ' + txt.replace(/\s*(Play .*?)?\s*Maybe later\s*$/i, '').slice(0, 140));
            log('clicking Maybe later');
            try { robustClick(later); } catch (e) { log('click error: ' + e.message, true); }
            return;
        }
    }

    function scan() {
        watchResult();
        closeBonusPopup();
        const f = findForm();
        if (!f) return;
        const code = (f.input.value || '').trim();
        if (!code) return;                                   // nothing filled in - never click an empty box
        if (clickedCodes.has(code.toUpperCase())) return;    // this code was already clicked
        if (f.btn.disabled || !isVisible(f.btn)) return;

        if (!captchaSolved()) {
            solvedSince = 0;
            if (!waitingLogged) { waitingLogged = true; log('code present, waiting for "Captcha solved!"'); }
            return;
        }
        if (!solvedSince) { solvedSince = Date.now(); log('captcha solved - clicking Redeem shortly'); return; }
        if (Date.now() - solvedSince < WAIT_AFTER_SOLVED_MS) return;

        clickedCodes.add(code.toUpperCase());
        log('clicking Redeem (code length ' + code.length + ')');
        try {
            robustClick(f.btn);
            resultWatch = { code: code.toUpperCase(), t0: Date.now(), seen: new Set() };
        } catch (e) { log('click error: ' + e.message, true); }
    }

    scan();

    let pending = null;
    new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; scan(); }, 150);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    // Safety-net poll (the solver text can change without a mutation we catch).
    setInterval(scan, 1000);
})();
