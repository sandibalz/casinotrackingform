// ==UserScript==
// @name         Auto Login & Collect (Casino Sites)
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Per-site, click-to-teach automation: click Login, pause 10s (for saved-password autofill / a CAPTCHA you solve by hand — this script never tries to detect or solve one itself), close any popups, then click Collect. Runs everywhere but is a complete no-op until you teach it on a given site. Separate from the SC-tracking script so it can be enabled/disabled independently.
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
    while (current && current !== document.body && parts.length < 5) {
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

  // Minimal click-to-pick: highlights the hovered element, and on click hands the generated
  // selector back via onPicked(selector). Escape cancels.
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
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === highlight || el === tooltip) return;
      const rect = el.getBoundingClientRect();
      Object.assign(highlight.style, {
        display: 'block', top: rect.top + 'px', left: rect.left + 'px',
        width: rect.width + 'px', height: rect.height + 'px'
      });
      const text = el.textContent.trim().substring(0, 60);
      const tag = el.tagName.toLowerCase();
      tooltip.textContent = `<${tag}> "${text}"`;
      Object.assign(tooltip.style, { display: 'block', top: (rect.top - 30) + 'px', left: rect.left + 'px' });
    };

    const cleanup = () => {
      active = false;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      highlight.remove();
      tooltip.remove();
    };

    const onClick = (e) => {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === highlight || el === tooltip) return;
      const selector = generateSelector(el);
      cleanup();
      onPicked(selector, el);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { cleanup(); if (onCancel) onCancel(); }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function showToast(lines) {
    const toast = document.createElement('div');
    const shadow = toast.attachShadow({ mode: 'open' });
    Object.assign(toast.style, {
      position: 'fixed', bottom: '70px', right: '10px', zIndex: '1000000', maxWidth: '320px'
    });
    const style = document.createElement('style');
    style.textContent = `
      .toast { all: initial; font: 12px/1.4 Arial, Helvetica, sans-serif; display:block;
        background:#222; color:#fff; padding:10px 12px; border-radius:6px;
        box-shadow:0 4px 8px rgba(0,0,0,0.3); white-space:pre-line; }
    `;
    shadow.appendChild(style);
    const box = document.createElement('div');
    box.className = 'toast';
    box.textContent = '🤖 Auto-Collect:\n' + lines.join('\n');
    shadow.appendChild(box);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
  }

  // manual=true (from "▶ Run Now" or the menu command) runs even if "run automatically" isn't
  // enabled — useful for testing/re-running without a full page reload.
  function runFlow(manual = false) {
    const hostname = window.location.hostname;
    const config = getConfig(hostname);
    if (!config || (!manual && !config.enabled)) return;

    const status = [];
    const tryClick = (selector, label) => {
      if (!selector) { status.push(`⏭ No ${label} saved`); return false; }
      try {
        const el = document.querySelector(selector);
        if (el) { el.click(); status.push(`✅ Clicked ${label}`); return true; }
        status.push(`⚠️ ${label} not found on page`);
        return false;
      } catch (e) {
        status.push(`⚠️ ${label} — saved selector is invalid`);
        return false;
      }
    };

    tryClick(config.loginSelector, 'Login button');

    // Fixed 10s pause before continuing — gives the browser's saved-password autofill time to
    // populate the login form, and gives you a window to solve a CAPTCHA or confirm the login
    // by hand. This script never tries to detect or bypass a CAPTCHA itself.
    setTimeout(() => {
      (config.popupCloseSelectors || []).forEach((sel, i) => tryClick(sel, `popup-close button #${i + 1}`));
      setTimeout(() => {
        tryClick(config.collectSelector, 'Collect button');
        showToast(status);
      }, 800);
    }, 10000);
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
    hint.textContent = `For ${hostname}. Teach it which buttons to click: Login, then (optionally) any popup/ad close buttons, then Collect. After Login it always pauses 10 seconds — enough time for saved autofill to populate, and for you to solve a CAPTCHA or confirm the login by hand — before it closes popups and clicks Collect.`;
    modal.appendChild(hint);

    let config = getConfig(hostname) || { loginSelector: '', popupCloseSelectors: [], collectSelector: '', enabled: false };

    const loginRow = document.createElement('div'); loginRow.className = 'ac-row';
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
      loginLabel.textContent = config.loginSelector ? `📌 ${config.loginSelector}` : 'Not set';
      collectLabel.textContent = config.collectSelector ? `📌 ${config.collectSelector}` : 'Not set';
      popupListWrap.innerHTML = '';
      (config.popupCloseSelectors || []).forEach((sel, i) => {
        const item = document.createElement('div'); item.className = 'ac-list-item';
        const span = document.createElement('span'); span.textContent = `📌 ${sel}`;
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

    loginBtn.onclick = () => {
      container.style.display = 'none';
      status.textContent = 'Click the Login button on the page...';
      pickElementGeneric((selector) => {
        config.loginSelector = selector;
        saveConfig(hostname, config);
        container.style.display = '';
        status.textContent = '✅ Login button saved.';
        render();
      }, () => { container.style.display = ''; status.textContent = 'Cancelled.'; });
    };

    popupBtn.onclick = () => {
      container.style.display = 'none';
      status.textContent = 'Click a popup/ad close button on the page (Escape to cancel)...';
      pickElementGeneric((selector) => {
        config.popupCloseSelectors = config.popupCloseSelectors || [];
        config.popupCloseSelectors.push(selector);
        saveConfig(hostname, config);
        container.style.display = '';
        status.textContent = `✅ Popup-close button #${config.popupCloseSelectors.length} saved.`;
        render();
      }, () => { container.style.display = ''; status.textContent = 'Cancelled.'; });
    };

    collectBtn.onclick = () => {
      container.style.display = 'none';
      status.textContent = 'Click the Collect button on the page...';
      pickElementGeneric((selector) => {
        config.collectSelector = selector;
        saveConfig(hostname, config);
        container.style.display = '';
        status.textContent = '✅ Collect button saved.';
        render();
      }, () => { container.style.display = ''; status.textContent = 'Cancelled.'; });
    };

    runBtn.onclick = () => {
      status.textContent = 'Running now — Login click immediately, then a 10s pause, then popups + Collect...';
      runFlow(true);
    };

    clearBtn.onclick = () => {
      GM_deleteValue(`autoCollectConfig_${hostname}`);
      config = { loginSelector: '', popupCloseSelectors: [], collectSelector: '', enabled: false };
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
