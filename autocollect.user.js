// ==UserScript==
// @name         Auto Login & Collect (Casino Sites)
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Per-site, click-to-teach automation: waits 10s doing nothing first (for a CAPTCHA you solve by hand — this script never tries to detect or solve one itself), then clicks into saved login fields (forces sites that ignore browser autofill to notice the values), clicks Login, and polls for popups + Collect (buttons that aren't there yet or ever) using a saved selector with a text/attribute-based fallback if the selector stops matching — including inside same-origin iframes, since a close/collect button living in a widget iframe is a common reason it can't be found. Shows a persistent on-screen log of what actually happened. Runs everywhere but is a complete no-op until you teach it on a given site. Separate from the SC-tracking script so it can be enabled/disabled independently.
// @author       Grok
// @run-at       document-idle
// @match        https://*/*
// @match        http://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/autocollect.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/autocollect.user.js
// ==/UserScript==

(function() {
  'use strict';

  // This script is intentionally @match'd on every site (https://*/* and http://*/*) so you
  // can teach it on any new site without ever needing a script update — but it does nothing
  // at all on a site until you've actually taught it via the menu command below. No floating
  // button is shown unless this hostname already has a saved config, to avoid cluttering
  // every page you visit.

  function getConfig(hostname) {
    return GM_getValue(`autoCollectConfig_${hostname}`, null);
  }

  function saveConfig(hostname, config) {
    GM_setValue(`autoCollectConfig_${hostname}`, config);
  }

  // Generate a robust CSS selector for an element, preferring attribute-contains selectors
  // over exact class names to survive webpack hash changes (same approach used by the SC
  // tracking script's own element picker).
  function generateSelector(el) {
    for (const attr of ['data-test', 'data-testid', 'data-id']) {
      if (el.getAttribute(attr)) {
        return `${el.tagName.toLowerCase()}[${attr}="${el.getAttribute(attr)}"]`;
      }
    }
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }
    const parts = [];
    let current = el;
    const rootBody = (el.ownerDocument && el.ownerDocument.body) || document.body;
    while (current && current !== rootBody && parts.length < 5) {
      let seg = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      const stableClass = Array.from(current.classList || []).find(c =>
        !/^[a-z]+-[a-zA-Z0-9]{5,}$/.test(c) && !/_{2}[a-zA-Z0-9]{6}/.test(c) && c.length > 2
      );
      if (stableClass) {
        seg += `.${CSS.escape(stableClass)}`;
      } else {
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(s => s.tagName === current.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(current) + 1;
            seg += `:nth-of-type(${idx})`;
          }
        }
      }
      parts.unshift(seg);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  // ── Iframe traversal ─────────────────────────────────────────────────────────
  // A close/collect button can sit inside an <iframe> (a widget or modal loaded as its own
  // page), and document.querySelector/elementFromPoint never look inside one — they only
  // ever see the document they're called on. Same-origin iframes can be reached via
  // .contentDocument; cross-origin ones throw a SecurityError on that access and there is no
  // way around that from here — the browser enforces it. These helpers walk into every
  // same-origin iframe (recursively, for an iframe-inside-an-iframe) and keep a list of any
  // cross-origin ones they had to give up on, so a failure can at least explain why.
  function collectFrameDocuments(root, docsOut, blockedOut) {
    docsOut.push(root);
    let iframes;
    try { iframes = root.querySelectorAll('iframe'); } catch (_) { return; }
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

  // Chain of <iframe> elements from doc's window up to (not including) the top window —
  // used to translate a same-origin iframe's own local coordinates into top-document
  // coordinates for drawing the picker's highlight box.
  function getFrameChain(doc) {
    const chain = [];
    let win;
    try { win = doc.defaultView; } catch (_) { return chain; }
    while (win && win !== window.top) {
      let fe = null;
      try { fe = win.frameElement; } catch (_) { fe = null; }
      if (!fe) break;
      chain.unshift(fe);
      win = win.parent;
    }
    return chain;
  }

  function absoluteRectFor(el) {
    const rect = el.getBoundingClientRect();
    let top = rect.top, left = rect.left;
    for (const fe of getFrameChain(el.ownerDocument)) {
      const fr = fe.getBoundingClientRect();
      top += fr.top;
      left += fr.left;
    }
    return { top, left, width: rect.width, height: rect.height };
  }

  // Minimal click-to-pick: highlights the hovered element, and on click hands the generated
  // selector back via onPicked(selector, el). Escape cancels.
  //
  // Listens on the top document AND on every reachable same-origin iframe document, not just
  // the top one — a mousemove/click that happens inside an iframe never bubbles out to the
  // parent document's listeners (that's enforced by the browser, same-origin or not), so a
  // single top-level listener can never see a hover/click that lands inside one. Any
  // cross-origin iframe still can't be reached at all — nothing under the picker can change
  // that — so its contents just can't be picked directly.
  function pickElementGeneric(onPicked, onCancel) {
    const highlight = document.createElement('div');
    Object.assign(highlight.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '10000003',
      border: '3px solid #4CAF50', borderRadius: '4px',
      background: 'rgba(76, 175, 80, 0.15)', display: 'none'
    });
    document.body.appendChild(highlight);

    const tooltip = document.createElement('div');
    Object.assign(tooltip.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '10000004',
      background: '#222', color: '#fff', padding: '6px 10px', borderRadius: '4px',
      fontSize: '12px', fontFamily: 'monospace', maxWidth: '400px',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'none'
    });
    document.body.appendChild(tooltip);

    let active = true;

    const onMove = (e) => {
      if (!active) return;
      const el = e.target;
      if (!el || el === highlight || el === tooltip) return;
      const rect = absoluteRectFor(el);
      Object.assign(highlight.style, {
        display: 'block', top: rect.top + 'px', left: rect.left + 'px',
        width: rect.width + 'px', height: rect.height + 'px'
      });
      const text = (el.textContent || '').trim().substring(0, 60);
      const tag = el.tagName.toLowerCase();
      tooltip.textContent = el.ownerDocument !== document ? `<${tag}> "${text}" (in iframe)` : `<${tag}> "${text}"`;
      Object.assign(tooltip.style, { display: 'block', top: (rect.top - 30) + 'px', left: rect.left + 'px' });
    };

    const cleanup = () => {
      active = false;
      for (const doc of pickableDocs) {
        try {
          doc.removeEventListener('mousemove', onMove, true);
          doc.removeEventListener('click', onClick, true);
          doc.removeEventListener('keydown', onKey, true);
        } catch (_) { /* frame may have navigated away mid-pick */ }
      }
      highlight.remove();
      tooltip.remove();
    };

    const onClick = (e) => {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const el = e.target;
      if (!el || el === highlight || el === tooltip) return;
      const selector = generateSelector(el);
      cleanup();
      onPicked(selector, el);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { cleanup(); if (onCancel) onCancel(); }
    };

    const pickableDocs = [];
    const blockedFrames = [];
    collectFrameDocuments(document, pickableDocs, blockedFrames);
    for (const doc of pickableDocs) {
      doc.addEventListener('mousemove', onMove, true);
      doc.addEventListener('click', onClick, true);
      doc.addEventListener('keydown', onKey, true);
    }
    if (blockedFrames.length) {
      logLine(`ℹ️ Picker: ${blockedFrames.length} iframe(s) on this page are cross-origin — anything inside those can't be picked directly.`);
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Persistent on-screen log ────────────────────────────────────────────────
  // A live, stays-put log of what the flow actually did, instead of a toast that vanishes
  // in a few seconds. Lives in a shadow DOM (page CSS can't hide it) anchored to <html>
  // (some sites clip position:fixed children of <body>), with a max z-index, and re-attaches
  // itself if a page re-render carries it off. Has a Copy button so you can paste the run
  // back to report a problem.
  let logHost = null;
  let logBody = null;

  function ensureLogPanel() {
    if (logHost && document.documentElement.contains(logHost)) return logBody;

    logHost = document.createElement('div');
    logHost.id = 'ac-log-host';
    Object.assign(logHost.style, {
      position: 'fixed', bottom: '10px', right: '10px', zIndex: '2147483647',
      width: '360px', maxWidth: '92vw', pointerEvents: 'auto'
    });
    const shadow = logHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .ac-log { all: initial; display:block; font: 11px/1.4 Consolas, Menlo, monospace;
        background:#111; color:#ddd; border:1px solid #444; border-radius:6px;
        box-shadow:0 4px 12px rgba(0,0,0,0.4); }
      .ac-log-head { all: initial; box-sizing:border-box; display:flex; align-items:center;
        justify-content:space-between; width:100%; font: bold 12px/1.4 Arial, Helvetica, sans-serif;
        color:#fff; background:#222; padding:6px 8px; border-radius:5px 5px 0 0; }
      .ac-log-head .ac-btns { display:flex; gap:4px; }
      .ac-log-head button { all: unset; box-sizing:border-box; cursor:pointer; padding:2px 7px;
        background:#444; color:#fff; border-radius:3px; font: 11px/1.4 Arial, Helvetica, sans-serif; }
      .ac-log-head button:hover { background:#555; }
      .ac-log-body { max-height:240px; overflow-y:auto; padding:8px; white-space:pre-wrap; word-break:break-word; }
      .ac-log-line { margin-bottom:3px; }
    `;
    shadow.appendChild(style);

    const box = document.createElement('div');
    box.className = 'ac-log';
    const head = document.createElement('div');
    head.className = 'ac-log-head';
    const title = document.createElement('span');
    title.textContent = '🤖 Auto-Collect log';
    const btns = document.createElement('div');
    btns.className = 'ac-btns';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    btns.appendChild(copyBtn);
    btns.appendChild(closeBtn);
    head.appendChild(title);
    head.appendChild(btns);

    const body = document.createElement('div');
    body.className = 'ac-log-body';

    box.appendChild(head);
    box.appendChild(body);
    shadow.appendChild(box);

    copyBtn.onclick = () => {
      const text = Array.from(body.children).map(l => l.textContent).join('\n');
      const done = () => { copyBtn.textContent = 'Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      } else {
        fallbackCopy(text, done);
      }
    };
    function fallbackCopy(text, done) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
      } catch (_) { /* clipboard blocked on this site — nothing more we can do */ }
    }
    closeBtn.onclick = () => { logHost.remove(); logHost = null; logBody = null; };

    (document.documentElement || document.body).appendChild(logHost);
    logBody = body;
    return logBody;
  }

  function logLine(msg) {
    const body = ensureLogPanel();
    const line = document.createElement('div');
    line.className = 'ac-log-line';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
    console.log(`[AutoCollect] ${msg}`);
  }

  // ── Click helpers ────────────────────────────────────────────────────────────

  // Full pointer + mouse sequence — React (and similar) widgets often ignore a bare .click().
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
  }

  // Forces a framework (React, etc.) that tracks its own internal form state to notice a
  // value the browser's saved-password autofill set directly on the DOM — autofill doesn't
  // go through the framework's normal typing/input handling, so its internal state can stay
  // "empty" even though the field visually shows the saved value, and Login then reads that
  // stale internal state and treats the field as blank. Re-setting .value through the native
  // property setter and firing a real 'input'/'change' event (the standard trick for this)
  // makes the framework pick it up, the same way actually clicking into the field by hand
  // (as a workaround) does.
  function nudgeField(el) {
    try {
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
      if (nativeSetter) nativeSetter.call(el, el.value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    } catch (_) { /* best-effort */ }
  }

  function looksClickable(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ── Selector + fallback matching ────────────────────────────────────────────
  // A taught target is saved as { selector, helper }, not just a bare CSS selector, so it
  // can still be found if the saved selector stops matching (a class name changed, the
  // element moved in the DOM, this is a different popup than the one taught). `helper` is
  // built at teach time from whatever's actually stable about that kind of element: for a
  // button/link, its visible text; for a form field, its autocomplete/name/placeholder/type
  // — CSS selectors built from hashed class names or DOM position are the most likely to
  // break, so this gives every taught target a second way to be found.
  // Configs saved before this existed just have a bare string here — normalizeTarget()
  // makes both shapes look the same to the rest of the script.
  function normalizeTarget(x) {
    if (!x) return { selector: '', helper: null };
    if (typeof x === 'string') return { selector: x, helper: null };
    return { selector: x.selector || '', helper: x.helper || null };
  }

  function describeElement(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      return {
        kind: 'field',
        type: (el.type || '').toLowerCase(),
        name: el.name || '',
        placeholder: el.placeholder || '',
        autocomplete: el.autocomplete || '',
        ariaLabel: el.getAttribute('aria-label') || ''
      };
    }
    return {
      kind: 'clickable',
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
    };
  }

  function findByHelperIn(root, helper) {
    if (!helper) return null;
    if (helper.kind === 'field') {
      const candidates = Array.from(root.querySelectorAll('input, textarea, select'));
      if (helper.autocomplete) {
        const m = candidates.find(el => (el.autocomplete || '').toLowerCase() === helper.autocomplete.toLowerCase());
        if (m) return m;
      }
      if (helper.name) {
        const m = candidates.find(el => el.name === helper.name && (!helper.type || (el.type || '').toLowerCase() === helper.type));
        if (m) return m;
      }
      if (helper.placeholder) {
        const m = candidates.find(el => (el.placeholder || '') === helper.placeholder);
        if (m) return m;
      }
      if (helper.ariaLabel) {
        const m = candidates.find(el => (el.getAttribute('aria-label') || '') === helper.ariaLabel);
        if (m) return m;
      }
      if (helper.type) {
        const m = candidates.find(el => (el.type || '').toLowerCase() === helper.type);
        if (m) return m; // last resort — e.g. only one password field on the page
      }
      return null;
    }
    if (!helper.text) return null;
    const candidates = root.querySelectorAll('button, a, [role="button"], .btn, .button');
    const norm = helper.text.toLowerCase();
    const normText = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const el of candidates) {
      if (normText(el) === norm) return el;
    }
    for (const el of candidates) {
      const t = normText(el);
      if (t && (t.includes(norm) || norm.includes(t))) return el;
    }
    return null;
  }

  // ── Cross-frame lookups ──────────────────────────────────────────────────────
  // Same rationale as the picker above: a taught selector/helper is checked against the top
  // document first, then against every reachable same-origin iframe document in turn (a
  // close/collect button living inside a widget iframe is the most likely reason a taught
  // target stops being found). blockedFrameCount tells the caller how many iframes couldn't
  // be looked into at all (cross-origin), so a failure can say why instead of just "not found".
  function queryDeep(selector) {
    const docs = [], blocked = [];
    collectFrameDocuments(document, docs, blocked);
    for (const d of docs) {
      let el = null;
      try { el = d.querySelector(selector); } catch (_) { el = null; }
      if (el) return { el, blockedFrameCount: blocked.length };
    }
    return { el: null, blockedFrameCount: blocked.length };
  }

  function findByHelperDeep(helper) {
    const docs = [], blocked = [];
    collectFrameDocuments(document, docs, blocked);
    for (const d of docs) {
      const el = findByHelperIn(d, helper);
      if (el) return { el, blockedFrameCount: blocked.length };
    }
    return { el: null, blockedFrameCount: blocked.length };
  }

  function labelFor(x) {
    const t = normalizeTarget(x);
    if (!t.selector && !t.helper) return 'Not set';
    let extra = '';
    if (t.helper) {
      if (t.helper.kind === 'field') {
        const hint = t.helper.autocomplete || t.helper.name || t.helper.placeholder || t.helper.type;
        if (hint) extra = ` (${hint})`;
      } else if (t.helper.text) {
        extra = ` ("${t.helper.text}")`;
      }
    }
    return `📌 ${t.selector || '[no selector — text/attribute match only]'}${extra}`;
  }

  // Polls for `selector` up to timeoutMs (some popups/buttons aren't there yet, or are never
  // there this run), clicks it once found, then checks back after the click to see whether
  // anything about the element actually changed — instead of just assuming the click "worked"
  // the moment it's dispatched. Retries the click once if nothing changed.
  async function waitAndClick(target, label, { timeoutMs = 15000, intervalMs = 1000 } = {}) {
    const t = normalizeTarget(target);
    if (!t.selector && !t.helper) { logLine(`⏭ No ${label} saved — skipping`); return false; }

    const start = Date.now();
    let el = null;
    let usedFallback = false;
    let blockedFrameCount = 0;
    while (Date.now() - start < timeoutMs) {
      el = null;
      if (t.selector) {
        const r = queryDeep(t.selector);
        blockedFrameCount = r.blockedFrameCount;
        if (r.el) el = r.el;
      }
      if ((!el || !looksClickable(el)) && t.helper) {
        const r = findByHelperDeep(t.helper);
        blockedFrameCount = r.blockedFrameCount;
        if (r.el && looksClickable(r.el)) { el = r.el; usedFallback = true; }
      }
      if (el && looksClickable(el)) break;
      el = null;
      await sleep(intervalMs);
    }
    if (!el) {
      const how = t.helper ? ' (tried the saved selector and a text/attribute fallback, including same-origin iframes)' : ' (including same-origin iframes)';
      logLine(`⚠️ ${label} not found/clickable within ${Math.round(timeoutMs / 1000)}s${how}`);
      if (blockedFrameCount) {
        logLine(`ℹ️ Heads up: this page has ${blockedFrameCount} cross-origin iframe(s) I can't see inside — if ${label} lives in one of those, this script can't reach it directly from here.`);
      }
      return false;
    }
    if (usedFallback) {
      logLine(`ℹ️ ${label}: saved selector didn't match — found it via a text/attribute fallback instead`);
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      const before = { disabled: el.disabled, text: (el.textContent || '').trim() };
      robustClick(el);
      logLine(`🖱 Clicked ${label}${attempt > 1 ? ' (retry)' : ''}`);
      await sleep(900);
      const changed = !el.isConnected || el.disabled !== before.disabled || (el.textContent || '').trim() !== before.text;
      if (changed) return true;
      if (attempt === 2) {
        logLine(`⚠️ ${label} was clicked but nothing on the page changed — the click may not have registered. You may need to click it by hand.`);
      }
    }
    return false;
  }

  // manual=true (from "▶ Run Now" or the menu command) runs even if "run automatically" isn't
  // enabled — useful for testing/re-running without a full page reload.
  async function runFlow(manual = false) {
    const hostname = window.location.hostname;
    const config = getConfig(hostname);
    if (!config || (!manual && !config.enabled)) return;

    logLine(`▶ Starting run on ${hostname}${manual ? ' (manual)' : ' (auto)'}`);

    // Fixed 10s pause — deliberately the very first thing the flow does, before touching
    // login fields or Login at all. A CAPTCHA can show up the moment the page loads, before
    // you've clicked anything, and any click during that window can interfere with solving
    // it by hand. This script never tries to detect or bypass a CAPTCHA itself.
    logLine('⏳ Waiting 10s before doing anything (gives a CAPTCHA time to appear/be solved)…');
    await sleep(10000);

    // Click into any saved login fields (username, password, ...) BEFORE clicking Login.
    // Some sites visually show the browser's saved autofill but don't register it internally
    // until the field is actually focused/interacted with — see nudgeField() above.
    for (const raw of (config.preLoginSelectors || [])) {
      const t = normalizeTarget(raw);
      let el = null;
      let usedFallback = false;
      if (t.selector) {
        const r = queryDeep(t.selector);
        if (r.el) el = r.el;
      }
      if (!el && t.helper) {
        const r = findByHelperDeep(t.helper);
        if (r.el) { el = r.el; usedFallback = true; }
      }
      if (el) {
        nudgeField(el);
        logLine(`👆 Focused login field (${t.selector || '[fallback match]'})${usedFallback ? ' — via text/attribute fallback' : ''}`);
      } else {
        logLine(`⚠️ Login field not found: ${t.selector || '(no selector saved)'}`);
      }
      await sleep(300);
    }

    await waitAndClick(config.loginSelector, 'Login button', { timeoutMs: 5000, intervalMs: 500 });

    // Popup-close buttons: poll for each — a given popup isn't always the one that shows up
    // on any particular run, so a fixed one-shot check misses it more often than not.
    for (let i = 0; i < (config.popupCloseSelectors || []).length; i++) {
      await waitAndClick(config.popupCloseSelectors[i], `popup-close button #${i + 1}`, { timeoutMs: 5000, intervalMs: 800 });
    }

    // Collect button: same story — the post-login screen isn't always ready the moment we
    // get here, so poll for it instead of a single fixed-delay attempt.
    await waitAndClick(config.collectSelector, 'Collect button', { timeoutMs: 20000, intervalMs: 1000 });

    logLine('✅ Run finished');
  }

  function openModal() {
    const hostname = window.location.hostname;
    const container = document.createElement('div');
    const shadow = container.attachShadow({ mode: 'open' });
    Object.assign(container.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      zIndex: '1000001', maxWidth: '440px', width: '90vw'
    });

    const style = document.createElement('style');
    style.textContent = `
      .ac-modal { all: initial; font: 13px/1.4 Arial, Helvetica, sans-serif;
        background:#fff; padding:16px; border:2px solid #000; border-radius:8px;
        box-shadow:0 4px 8px rgba(0,0,0,0.2); color:#000; display:block;
        box-sizing:border-box; max-height:80vh; overflow-y:auto; }
      .ac-modal * { box-sizing:border-box; font: inherit; }
      .ac-modal h3 { margin:0 0 8px; font-size:15px; }
      .ac-hint { font-size:11px; color:#888; margin-bottom:10px; }
      .ac-row { display:flex; align-items:center; gap:6px; margin-bottom:8px; }
      .ac-row span { flex:1; font-size:11px; color:#2196F3; word-break:break-all; }
      .ac-btn { padding:6px 10px; border:none; border-radius:4px; cursor:pointer; color:#fff; font-size:12px; }
      .ac-list-item { display:flex; align-items:center; gap:6px; font-size:11px; color:#2196F3; margin-bottom:4px; word-break:break-all; }
      .ac-list-item button { flex-shrink:0; }
      .ac-toggle { display:flex; align-items:center; gap:6px; font-size:12px; margin:12px 0; }
      .ac-btn-row { display:flex; gap:6px; margin-top:12px; flex-wrap:wrap; }
      .ac-status { font-size:11px; color:#666; margin-top:8px; min-height:14px; }
    `;
    shadow.appendChild(style);

    const modal = document.createElement('div');
    modal.className = 'ac-modal';

    const title = document.createElement('h3');
    title.textContent = '🤖 Auto Login & Collect';
    modal.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'ac-hint';
    hint.textContent = `For ${hostname}. It always waits 10 seconds before touching anything, in case a CAPTCHA needs solving by hand. If this site doesn't seem to notice your saved username/password until you click into each field yourself, add them below (click username, then password) — the automation will click into them first. Then teach it which buttons to click: Login, then (optionally) any popup/ad close buttons, then Collect. Popups and Collect are polled for, since they aren't always there right away. Buttons inside a same-origin iframe can be picked normally; a cross-origin iframe's contents can't be reached at all, and picking will say so.`;
    modal.appendChild(hint);

    let config = getConfig(hostname) || { loginSelector: '', popupCloseSelectors: [], collectSelector: '', preLoginSelectors: [], enabled: false };

    const fieldListWrap = document.createElement('div');
    modal.appendChild(fieldListWrap);
    const fieldBtn = document.createElement('button'); fieldBtn.className = 'ac-btn'; fieldBtn.style.background = '#3f51b5'; fieldBtn.textContent = '🎯 Add Login Field (username, password, ...)';
    modal.appendChild(fieldBtn);

    const loginRow = document.createElement('div'); loginRow.className = 'ac-row'; loginRow.style.marginTop = '10px';
    const loginLabel = document.createElement('span');
    const loginBtn = document.createElement('button'); loginBtn.className = 'ac-btn'; loginBtn.style.background = '#ff9800'; loginBtn.textContent = '🎯 Set Login Button';
    loginRow.appendChild(loginLabel); loginRow.appendChild(loginBtn);
    modal.appendChild(loginRow);

    const popupListWrap = document.createElement('div');
    modal.appendChild(popupListWrap);
    const popupBtn = document.createElement('button'); popupBtn.className = 'ac-btn'; popupBtn.style.background = '#ff9800'; popupBtn.textContent = '🎯 Add Popup-Close Button';
    modal.appendChild(popupBtn);

    const collectRow = document.createElement('div'); collectRow.className = 'ac-row'; collectRow.style.marginTop = '10px';
    const collectLabel = document.createElement('span');
    const collectBtn = document.createElement('button'); collectBtn.className = 'ac-btn'; collectBtn.style.background = '#ff9800'; collectBtn.textContent = '🎯 Set Collect Button';
    collectRow.appendChild(collectLabel); collectRow.appendChild(collectBtn);
    modal.appendChild(collectRow);

    const toggleRow = document.createElement('label'); toggleRow.className = 'ac-toggle';
    const toggleCheckbox = document.createElement('input'); toggleCheckbox.type = 'checkbox';
    toggleRow.appendChild(toggleCheckbox);
    toggleRow.appendChild(document.createTextNode('Run automatically whenever this page loads'));
    modal.appendChild(toggleRow);

    const status = document.createElement('div'); status.className = 'ac-status';
    modal.appendChild(status);

    const btnRow = document.createElement('div'); btnRow.className = 'ac-btn-row';
    const runBtn = document.createElement('button'); runBtn.className = 'ac-btn'; runBtn.style.background = '#009688'; runBtn.textContent = '▶ Run Now';
    const clearBtn = document.createElement('button'); clearBtn.className = 'ac-btn'; clearBtn.style.background = '#9e9e9e'; clearBtn.textContent = '🗑 Clear All';
    const closeBtn = document.createElement('button'); closeBtn.className = 'ac-btn'; closeBtn.style.background = '#f44336'; closeBtn.textContent = 'Close';
    btnRow.appendChild(runBtn); btnRow.appendChild(clearBtn); btnRow.appendChild(closeBtn);
    modal.appendChild(btnRow);

    shadow.appendChild(modal);

    function render() {
      loginLabel.textContent = labelFor(config.loginSelector);
      collectLabel.textContent = labelFor(config.collectSelector);
      fieldListWrap.innerHTML = '';
      (config.preLoginSelectors || []).forEach((sel, i) => {
        const item = document.createElement('div'); item.className = 'ac-list-item';
        const span = document.createElement('span'); span.textContent = `${i + 1}. ${labelFor(sel)}`;
        const rm = document.createElement('button'); rm.className = 'ac-btn'; rm.style.background = '#9e9e9e'; rm.style.padding = '2px 6px'; rm.textContent = '✕';
        rm.onclick = () => {
          config.preLoginSelectors.splice(i, 1);
          saveConfig(hostname, config);
          render();
        };
        item.appendChild(span); item.appendChild(rm);
        fieldListWrap.appendChild(item);
      });
      popupListWrap.innerHTML = '';
      (config.popupCloseSelectors || []).forEach((sel, i) => {
        const item = document.createElement('div'); item.className = 'ac-list-item';
        const span = document.createElement('span'); span.textContent = labelFor(sel);
        const rm = document.createElement('button'); rm.className = 'ac-btn'; rm.style.background = '#9e9e9e'; rm.style.padding = '2px 6px'; rm.textContent = '✕';
        rm.onclick = () => {
          config.popupCloseSelectors.splice(i, 1);
          saveConfig(hostname, config);
          render();
        };
        item.appendChild(span); item.appendChild(rm);
        popupListWrap.appendChild(item);
      });
      toggleCheckbox.checked = !!config.enabled;
      toggleCheckbox.disabled = !(config.loginSelector && config.collectSelector);
      renderFloatingButton();
    }

    toggleCheckbox.addEventListener('change', () => {
      config.enabled = toggleCheckbox.checked;
      saveConfig(hostname, config);
    });

    // If the picker couldn't drill past an <iframe> (only possible for a cross-origin one —
    // a same-origin iframe's contents are picked directly, see pickElementGeneric), the thing
    // that actually got saved is the outer iframe itself, which won't do anything useful when
    // clicked. Say so immediately rather than let it silently fail at run time.
    function iframeWarning(el) {
      return el.tagName === 'IFRAME'
        ? ' ⚠️ That’s the outer <iframe>, not something inside it — this one is cross-origin, so the script can’t reach into it directly.'
        : '';
    }

    fieldBtn.onclick = () => {
      container.style.display = 'none';
      status.textContent = 'Click a login field on the page (e.g. username, then run this again for password)...';
      pickElementGeneric((selector, el) => {
        config.preLoginSelectors = config.preLoginSelectors || [];
        config.preLoginSelectors.push({ selector, helper: describeElement(el) });
        saveConfig(hostname, config);
        container.style.display = '';
        status.textContent = `✅ Login field #${config.preLoginSelectors.length} saved.${iframeWarning(el)}`;
        render();
      }, () => { container.style.display = ''; status.textContent = 'Cancelled.'; });
    };

    loginBtn.onclick = () => {
      container.style.display = 'none';
      status.textContent = 'Click the Login button on the page...';
      pickElementGeneric((selector, el) => {
        config.loginSelector = { selector, helper: describeElement(el) };
        saveConfig(hostname, config);
        container.style.display = '';
        status.textContent = `✅ Login button saved.${iframeWarning(el)}`;
        render();
      }, () => { container.style.display = ''; status.textContent = 'Cancelled.'; });
    };

    popupBtn.onclick = () => {
      container.style.display = 'none';
      status.textContent = 'Click a popup/ad close button on the page (Escape to cancel)...';
      pickElementGeneric((selector, el) => {
        config.popupCloseSelectors = config.popupCloseSelectors || [];
        config.popupCloseSelectors.push({ selector, helper: describeElement(el) });
        saveConfig(hostname, config);
        container.style.display = '';
        status.textContent = `✅ Popup-close button #${config.popupCloseSelectors.length} saved.${iframeWarning(el)}`;
        render();
      }, () => { container.style.display = ''; status.textContent = 'Cancelled.'; });
    };

    collectBtn.onclick = () => {
      container.style.display = 'none';
      status.textContent = 'Click the Collect button on the page...';
      pickElementGeneric((selector, el) => {
        config.collectSelector = { selector, helper: describeElement(el) };
        saveConfig(hostname, config);
        container.style.display = '';
        status.textContent = `✅ Collect button saved.${iframeWarning(el)}`;
        render();
      }, () => { container.style.display = ''; status.textContent = 'Cancelled.'; });
    };

    runBtn.onclick = () => {
      status.textContent = 'Running now — see the log panel in the corner of the page for live progress.';
      runFlow(true);
    };

    clearBtn.onclick = () => {
      GM_deleteValue(`autoCollectConfig_${hostname}`);
      config = { loginSelector: '', popupCloseSelectors: [], collectSelector: '', preLoginSelectors: [], enabled: false };
      status.textContent = 'Cleared everything for this site.';
      render();
    };

    closeBtn.onclick = () => { document.body.removeChild(container); };

    document.body.appendChild(container);
    render();
  }

  // Small floating button, shown only on a hostname that already has a saved config — keeps
  // every other site you visit completely untouched visually. Use the Tampermonkey menu
  // command (right-click the extension icon → this script) to open setup on a NEW site.
  let floatingBtn = null;
  function renderFloatingButton() {
    const hostname = window.location.hostname;
    const hasConfig = !!getConfig(hostname);
    if (hasConfig && !floatingBtn) {
      floatingBtn = document.createElement('button');
      floatingBtn.textContent = '🤖 Auto-Collect';
      Object.assign(floatingBtn.style, {
        position: 'fixed', bottom: '10px', left: '10px', zIndex: '1000000',
        padding: '10px', background: '#4CAF50', color: '#fff', border: 'none',
        borderRadius: '4px', cursor: 'pointer'
      });
      floatingBtn.onclick = openModal;
      document.body.appendChild(floatingBtn);
    } else if (!hasConfig && floatingBtn) {
      floatingBtn.remove();
      floatingBtn = null;
    }
  }

  function boot() {
    if (!document.body) { setTimeout(boot, 500); return; }
    renderFloatingButton();
    runFlow(false);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }

  GM_registerMenuCommand('🤖 Setup Auto-Collect for this site', openModal);
  GM_registerMenuCommand('▶ Run Auto-Collect Now', () => runFlow(true));
})();
