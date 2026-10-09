// ==UserScript==
// @name         Punt Auto Claim Promo Code
// @namespace    https://punt.com/
// @version      1.2.1
// @description  When the Get Coins dialog's Promotion Codes tab is open with a code already filled in (e.g. from the autologin URL), clicks Submit once per code. v1.2.0: logs each run (found / clicked / site response) per owner in Tampermonkey storage and shows a live log overlay.
// @match        https://punt.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/puntautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/puntautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // Codes we've already hit Submit for, so a re-render/re-scan doesn't
    // click Submit twice for the same code. Keyed by the code text itself
    // (not the DOM element) because the input can be unmounted/remounted
    // by React when the dialog/tab re-renders.
    const submittedCodes = new Set();

    function log(msg) {
        console.log(`[Punt AutoClaim] ${msg}`);
    }


    // ---- v1.2.0: per-owner run log (stored in Tampermonkey) + live overlay ----
    const SITE = 'Punt';
    const RESULT_RE = /error|invalid|maximum|already|expired|not valid|reached|success|claimed|congrat|added|received|reward/i;
    const ERROR_RE = /error|invalid|maximum|already|expired|not valid|reached|failed/i;
    const runLog = [];          // this page run only, shown in the overlay
    let overlayEl = null, overlayBody = null;

    function getOwner(forcePrompt) {
        let owner = GM_getValue('owner', '');
        if (!owner || forcePrompt) {
            const a = prompt('Who is this browser for? (Ben, Cindy, Tyler, Jessica)', owner || '');
            if (a && a.trim()) { owner = a.trim(); GM_setValue('owner', owner); }
        }
        return owner || 'Unknown';
    }

    function record(event, detail) {
        const entry = { t: new Date().toISOString(), site: SITE, event, detail: detail || '' };
        runLog.push(entry);
        const key = 'claimLog_' + getOwner();
        let hist = GM_getValue(key, []);
        hist.push(entry);
        if (hist.length > 300) hist = hist.slice(-300);
        GM_setValue(key, hist);
        renderOverlay();
    }

    function fmt(e) {
        return e.t.slice(11, 19) + ' ' + e.event + (e.detail ? ' - ' + e.detail : '');
    }

    function ensureOverlay() {
        if (overlayEl || !document.body) return;
        overlayEl = document.createElement('div');
        overlayEl.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:340px;max-height:220px;background:#111;color:#eee;font:12px/1.4 monospace;border:1px solid #555;border-radius:6px;box-shadow:0 2px 10px #000a;display:flex;flex-direction:column;';
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;justify-content:space-between;padding:4px 8px;background:#222;border-radius:6px 6px 0 0;';
        const title = document.createElement('span');
        title.textContent = SITE + ' AutoClaim - ' + getOwner();
        const btns = document.createElement('span');
        const copy = document.createElement('button');
        copy.textContent = 'Copy';
        copy.style.cssText = 'margin-right:6px;cursor:pointer;';
        copy.onclick = () => { try { navigator.clipboard.writeText(runLog.map(fmt).join('\n')); } catch (e) {} };
        const close = document.createElement('button');
        close.textContent = 'x';
        close.style.cssText = 'cursor:pointer;';
        close.onclick = () => { overlayEl.remove(); overlayEl = null; overlayBody = null; };
        btns.append(copy, close);
        bar.append(title, btns);
        overlayBody = document.createElement('div');
        overlayBody.style.cssText = 'padding:6px 8px;overflow:auto;white-space:pre-wrap;';
        overlayEl.append(bar, overlayBody);
        document.body.appendChild(overlayEl);
    }

    function renderOverlay() {
        ensureOverlay();
        if (overlayBody) {
            overlayBody.textContent = runLog.map(fmt).join('\n');
            overlayBody.scrollTop = overlayBody.scrollHeight;
        }
    }

    function showHistory() {
        const hist = GM_getValue('claimLog_' + getOwner(), []);
        runLog.length = 0;
        hist.slice(-40).forEach(e => runLog.push(e));
        renderOverlay();
    }

    GM_registerMenuCommand('Show full claim log (' + SITE + ')', showHistory);
    GM_registerMenuCommand('Change owner', () => { getOwner(true); });

    // After clicking Submit, watch for the site's toast/message and record it.
    function watchResult(code, before) {
        let tries = 0;
        const iv = setInterval(() => {
            tries++;
            const lines = (document.body ? document.body.innerText : '').split('\n').map(x => x.trim()).filter(Boolean);
            const fresh = lines.filter(l => !before.has(l) && l.length < 200 && RESULT_RE.test(l));
            if (fresh.length) {
                clearInterval(iv);
                const text = fresh.join(' | ');
                record(ERROR_RE.test(text) ? 'RESULT-ERROR' : 'RESULT-SUCCESS', text);
            } else if (tries >= 20) {
                clearInterval(iv);
                record('RESULT-NONE', 'no message seen within 8s of clicking Submit');
            }
        }, 400);
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
        const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1 };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', base));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseup', base));
        el.dispatchEvent(new MouseEvent('click', base));
    }

    // The "Get Coins" dialog is Radix UI: tabs/tabpanels toggle
    // data-state="active"/"inactive" rather than being added/removed from
    // the DOM. That's far more stable than punt.com's Tailwind utility
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
        record('dialog-found', 'code ' + code);
        const before = new Set((document.body ? document.body.innerText : '').split('\n').map(x => x.trim()).filter(Boolean));
        try { robustClick(submitBtn); } catch (err) { record('click-ERROR', String(err)); return; }
        record('submit-clicked', 'code ' + code);
        watchResult(code, before);
    }

    record('script-loaded', location.pathname);

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
