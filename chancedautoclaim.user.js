// ==UserScript==
// @name         Chanced Auto Claim Promo Code
// @namespace    https://chanced.com/
// @version      1.2.5
// @description  When the Get Coins dialog's Promotion Codes tab is open with a code already filled in (e.g. from the autologin URL), clicks Submit once per code. v1.2.0: logs each run (found / clicked / site response) per owner in Tampermonkey storage and shows a live log overlay.
// @match        https://chanced.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/chancedautoclaim.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/chancedautoclaim.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 10/26/26 badge dock: ONE shared, collapsed, open-shadow-root dock for every on-page chip/pill/log (Collector-App,
    // AutoLogin, Tampermonkey). Whoever runs first creates it; everyone else appends a section to #bd-sections (use the
    // CSS `order` property: lower = nearer the bottom). Collapsed = a 9px edge tab only; page querySelector/text scans
    // can't see inside it, and nothing outside the tab/open panel takes clicks. Keep this block identical in every script
    // that uses the dock (a copy lives in background.js pageAppendCollectorLog).
    function getDock() {
      let host = document.getElementById('__badge-dock');
      if (host && host.shadowRoot && host.shadowRoot.getElementById('bd-sections')) return host.shadowRoot;
      if (host) host.remove();
      host = document.createElement('div');
      host.id = '__badge-dock';
      host.style.cssText = 'position:fixed;left:0;bottom:37px;width:0;height:0;z-index:2147483647;pointer-events:none;';
      const sr = host.attachShadow({ mode: 'open' });
      const mk = (tag, id) => { const e = document.createElement(tag); if (id) e.id = id; return e; };
      const st = mk('style');
      st.textContent = ':host{all:initial}' +
        '#bd-tab{position:fixed;left:0;bottom:37px;width:9px;height:44px;background:#37474f;opacity:.55;border-radius:0 6px 6px 0;cursor:pointer;pointer-events:auto}' +
        '#bd-tab:hover{opacity:1}:host([data-alert]) #bd-tab{background:#c62828;opacity:.9}' +
        '#bd-panel{position:fixed;left:12px;bottom:37px;display:none;align-items:flex-end;gap:6px;pointer-events:auto}' +
        ':host([data-open]) #bd-panel{display:flex}' +
        '#bd-sections{display:flex;flex-direction:column-reverse;align-items:flex-start;gap:3px}' +
        '#bd-popups{display:flex;align-items:flex-end}';
      const tab = mk('div', 'bd-tab'); tab.title = 'Badges';
      const panel = mk('div', 'bd-panel');
      const sections = mk('div', 'bd-sections'), popups = mk('div', 'bd-popups');
      panel.appendChild(sections); panel.appendChild(popups);
      sr.appendChild(st); sr.appendChild(tab); sr.appendChild(panel);
      let pinned = false, t = null;
      const open = () => { host.setAttribute('data-open', ''); host.removeAttribute('data-alert'); };
      const close = () => { pinned = false; host.removeAttribute('data-open'); };
      tab.addEventListener('mouseenter', () => { clearTimeout(t); open(); });
      tab.addEventListener('click', () => { if (pinned) close(); else { pinned = true; open(); } });
      host.addEventListener('mouseenter', () => clearTimeout(t));
      host.addEventListener('mouseleave', () => { if (pinned) return; clearTimeout(t); t = setTimeout(() => { if (!popups.childElementCount) close(); }, 800); });
      host.addEventListener('dock-collapse', close);
      (document.body || document.documentElement).appendChild(host);
      return sr;
    }
    function dockFind(id) { const h = document.getElementById('__badge-dock'); return h && h.shadowRoot ? h.shadowRoot.getElementById(id) : null; }


    // Codes we've already hit Submit for, so a re-render/re-scan doesn't
    // click Submit twice for the same code. Keyed by the code text itself
    // (not the DOM element) because the input can be unmounted/remounted
    // by React when the dialog/tab re-renders.
    const submittedCodes = new Set();

    function log(msg) {
        console.log(`[Chanced AutoClaim] ${msg}`);
    }


    // ---- v1.2.0: per-owner run log (stored in Tampermonkey) + live overlay ----
    const SITE = 'Chanced';
    const RESULT_RE = /error|invalid|maximum|already|expired|not valid|reached|success|claimed|congrat|added|received|reward/i;
    const ERROR_RE = /error|invalid|maximum|already|expired|not valid|reached|failed/i;
    const runLog = [];          // this page run only, shown in the overlay
    let overlayEl = null, overlayBody = null, overlayBox = null, overlayPill = null, overlayOpen = false;

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
        // v1.2.2: collapsed pill (like Popup Closer's) in a shared bottom-left stack; click to open the log, click again to collapse.
        const stack = getDock().getElementById('bd-sections'); // 10/26/26: shared badge dock (was #tm-badge-stack)
        overlayEl = document.createElement('div');
        overlayEl.style.cssText = 'order:40;display:flex;flex-direction:column;align-items:flex-start;gap:2px;pointer-events:none;';
        const box = document.createElement('div');
        box.style.cssText = 'display:none;width:340px;max-height:220px;background:#111;color:#eee;font:12px/1.4 monospace;border:1px solid #555;border-radius:6px;box-shadow:0 2px 10px #000a;flex-direction:column;pointer-events:auto;';
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;justify-content:space-between;padding:4px 8px;background:#222;border-radius:6px 6px 0 0;';
        const title = document.createElement('span');
        title.textContent = SITE + ' AutoClaim - ' + getOwner();
        const copy = document.createElement('button');
        copy.textContent = 'Copy';
        copy.style.cssText = 'cursor:pointer;';
        copy.onclick = () => { try { navigator.clipboard.writeText(runLog.map(fmt).join('\n')); } catch (e) {} };
        bar.append(title, copy);
        overlayBody = document.createElement('div');
        overlayBody.style.cssText = 'padding:6px 8px;overflow:auto;white-space:pre-wrap;';
        box.append(bar, overlayBody);
        overlayPill = document.createElement('div');
        overlayPill.style.cssText = 'background:#111;color:#9f9;font:11px/1.4 sans-serif;padding:4px 8px;border-radius:6px;opacity:.85;cursor:pointer;pointer-events:auto;';
        overlayPill.onclick = () => { overlayOpen = !overlayOpen; renderOverlay(); };
        overlayBox = box;
        overlayEl.append(box, overlayPill);
        stack.appendChild(overlayEl);
    }

    function renderOverlay() {
        ensureOverlay();
        if (overlayBody) {
            overlayBody.textContent = runLog.map(fmt).join('\n');
            overlayBox.style.display = overlayOpen ? 'flex' : 'none';
            const warns = runLog.filter(x => ERROR_RE.test(x.detail || '') || /error/i.test(x.event || '')).length;
            overlayPill.textContent = '\u2713 ' + SITE + ' AutoClaim: ' + runLog.length + ' events' + (warns ? ' (' + warns + ' warn)' : '') + (overlayOpen ? '' : ' \u25B8');
            overlayPill.style.color = warns ? '#ff8a80' : '#9f9';
            if (overlayOpen) overlayBody.scrollTop = overlayBody.scrollHeight;
        }
    }

    function showHistory() {
        const hist = GM_getValue('claimLog_' + getOwner(), []);
        runLog.length = 0;
        hist.slice(-40).forEach(e => runLog.push(e));
        overlayOpen = true;
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

    // 10/28/26: wait a few seconds after load before claiming (location services were still initializing)
    const CLAIM_START_DELAY_MS = 10000;
    const claimReadyAt = Date.now() + CLAIM_START_DELAY_MS;

    function scan() {
        if (Date.now() < claimReadyAt) return;
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
