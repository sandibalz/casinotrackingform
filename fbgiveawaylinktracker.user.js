// ==UserScript==
// @name         Facebook Giveaway Link Tracker
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Floating popup on Facebook to log a giveaway code/link + site + date straight into the "Extra Codes" tab of the Casino SC Tracking sheet, via the same Apps Script Web App the "Giveaway Link" claim button uses. Owner is the same 4-owner identity used everywhere else (Ben/Cindy/Tyler/Jessica), asked once per browser and saved locally. v2.0.0: was previously a standalone POST to a Google Form into its own "Giveaway Links" tab (Owner/Link/Date only, no Site) — that tab was a dead end, disconnected from the "Extra Codes" pool the claim button actually reads from. Rebuilt to add a required Site field and submit straight to the Giveaway Link Rotation Backend's addCode action instead, so this form is now the real intake path for "Extra Codes".
// @author       Ben
// @run-at       document-idle
// @match        https://www.facebook.com/*
// @match        https://facebook.com/*
// @match        https://m.facebook.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/fbgiveawaylinktracker.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/fbgiveawaylinktracker.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- Owner identity ---
  // Same pattern as trackingform.user.js: asked once per browser via prompt(), saved with
  // GM_setValue so it survives auto-updates. Uses its own storage key (fbGiveawayOwner) so
  // this script's owner choice is independent of the casino SC tracker's, even though the
  // list of valid names is the same today.
  const VALID_OWNERS = ['Ben', 'Cindy', 'Tyler', 'Jessica'];

  function promptForOwner(currentValue) {
    let choice = null;
    while (!choice) {
      const input = prompt(`Who is logging giveaways on this computer? Type one of: ${VALID_OWNERS.join(', ')}`, currentValue || '');
      if (input === null) {
        return currentValue || VALID_OWNERS[0];
      }
      const match = VALID_OWNERS.find(o => o.toLowerCase() === input.trim().toLowerCase());
      if (match) choice = match;
      else alert(`"${input}" isn't one of: ${VALID_OWNERS.join(', ')}. Try again.`);
    }
    return choice;
  }

  function getOwner() {
    let owner = GM_getValue('fbGiveawayOwner', '');
    if (!owner || !VALID_OWNERS.includes(owner)) {
      owner = promptForOwner(owner);
      GM_setValue('fbGiveawayOwner', owner);
    }
    return owner;
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Change Giveaway Tracker Owner', () => {
      const newOwner = promptForOwner(GM_getValue('fbGiveawayOwner', ''));
      GM_setValue('fbGiveawayOwner', newOwner);
      alert(`Giveaway Tracker owner set to: ${newOwner}`);
    });
  }
  // --- End Owner identity ---

  // --- Giveaway Link Rotation Backend submission (with retry) ---
  // Same standalone Apps Script Web App that trackingform.user.js's "🔗 Giveaway Link"
  // button uses for status/claim — this script only ever calls its addCode action, which
  // appends a row to "Extra Codes" (Site, Code/URL, Notes, Added By, Added Date) under
  // LockService protection. This replaces the old direct-to-Google-Form submission, which
  // wrote into a separate "Giveaway Links" tab that the claim flow never read from.
  const GIVEAWAY_BACKEND_URL = 'https://script.google.com/macros/s/AKfycbybQNnGdymBC40IlxkFPJ3IuOfheLHb8qbFCSBmGEXwTbcZnAAuda5mzXEBjxlQbxBw/exec';
  const VALID_SITES = ['PlayFame', 'HelloMillions', 'McLuck', 'SpinBlitz'];
  const SUBMIT_RETRY_DELAYS_MS = [1500, 4000]; // 2 retries after the first try = 3 attempts total
  const SUBMIT_TIMEOUT_MS = 20000;

  function submitToTracker(fields, { onSuccess, onFinalFailure } = {}) {
    const payloadStr = new URLSearchParams({
      action: 'addCode',
      site: fields.site,
      link: fields.link,
      notes: fields.notes || '',
      owner: fields.owner,
      date: fields.date
    }).toString();
    let attempt = 0;

    function giveUpOrRetry(reason) {
      if (attempt <= SUBMIT_RETRY_DELAYS_MS.length) {
        setTimeout(attemptOnce, SUBMIT_RETRY_DELAYS_MS[attempt - 1]);
      } else if (onFinalFailure) {
        onFinalFailure(reason);
      }
    }

    function attemptOnce() {
      attempt++;
      GM_xmlhttpRequest({
        method: 'POST',
        url: GIVEAWAY_BACKEND_URL,
        data: payloadStr,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: SUBMIT_TIMEOUT_MS,
        onload: (response) => {
          let parsed;
          try {
            parsed = JSON.parse(response.responseText);
          } catch (e) {
            giveUpOrRetry(`bad response${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
            return;
          }
          if (response.status === 200 && parsed && parsed.ok) {
            if (onSuccess) onSuccess(parsed);
          } else {
            const reason = (parsed && parsed.error) || `status ${response.status}`;
            giveUpOrRetry(`${reason}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
          }
        },
        onerror: () => giveUpOrRetry(`network error${attempt > 1 ? ` (attempt ${attempt})` : ''}`),
        ontimeout: () => giveUpOrRetry(`timed out after ${SUBMIT_TIMEOUT_MS / 1000}s${attempt > 1 ? ` (attempt ${attempt})` : ''}`)
      });
    }

    attemptOnce();
  }
  // --- End Giveaway Link Rotation Backend submission ---

  // Facebook's SPA re-renders/replaces large chunks of the page constantly, which can wipe
  // an injected element with no error and no user action involved (same failure mode
  // documented in trackingform.user.js for myprize.us, just far more frequent here). This
  // re-attaches the element if something else detaches it. Returns stop() — call it from
  // the element's own close handler so an intentional close doesn't get fought.
  function keepElementAlive(el, parent = document.body) {
    const observer = new MutationObserver(() => {
      if (!parent.contains(el)) parent.appendChild(el);
    });
    observer.observe(parent, { childList: true });
    return () => observer.disconnect();
  }

  function getTodayISO() {
    // America/New_York, formatted YYYY-MM-DD for the native <input type="date">.
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    return `${map.year}-${map.month}-${map.day}`;
  }

  // Form creation (Shadow DOM, minimal CSS — same styling approach as trackingform.user.js)
  function createForm() {
    const container = document.createElement('div');
    const shadow = container.attachShadow({ mode: 'open' });
    Object.assign(container.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      zIndex: '2147483647', maxWidth: '380px'
    });

    const style = document.createElement('style');
    style.textContent = `
      .form-container { all: initial; font: 14px/1.4 Arial, Helvetica, sans-serif;
        background:#fff; padding:20px; border:2px solid #000;
        border-radius:8px; box-shadow:0 4px 8px rgba(0,0,0,0.2); color:#000;
        display:block; box-sizing:border-box; }
      .form-container * { box-sizing:border-box; font: inherit; }
      label { display:block; margin-bottom:10px; }
      input, select { width:100%; margin-bottom:15px; border:1px solid #000; padding:6px; }
      input[readonly]{ background:#f0f0f0; cursor:not-allowed; }
      .submit-button { width:100%; padding:10px; background:#4CAF50; color:#fff; border:none; border-radius:4px; cursor:pointer; }
      .close-button { width:100%; padding:10px; margin-top:10px; background:#f44336; color:#fff; border:none; border-radius:4px; cursor:pointer; }
      h3 { margin:0 0 12px; font-size:16px; }
    `;
    shadow.appendChild(style);

    const formContainer = document.createElement('div');
    formContainer.className = 'form-container';
    const form = document.createElement('form');

    const title = document.createElement('h3');
    title.textContent = '🎁 Log Giveaway Link';
    form.appendChild(title);

    const makeField = (labelText, value = '', readOnly = false, type = 'text') => {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = type; input.value = value; input.readOnly = readOnly;
      label.appendChild(document.createElement('br'));
      label.appendChild(input);
      form.appendChild(label);
      return input;
    };

    const ownerInput = makeField('Owner*:', getOwner(), true);

    const siteLabel = document.createElement('label');
    siteLabel.textContent = 'Site*:';
    const siteSelect = document.createElement('select');
    siteSelect.add(new Option('Choose a site', ''));
    VALID_SITES.forEach(s => siteSelect.add(new Option(s, s)));
    siteLabel.appendChild(document.createElement('br'));
    siteLabel.appendChild(siteSelect);
    form.appendChild(siteLabel);

    const linkInput = makeField('Giveaway Link*:', window.location.href);
    const dateInput = makeField('Date Found*:', getTodayISO(), false, 'date');

    const submitButton = document.createElement('button');
    submitButton.type = 'submit'; submitButton.textContent = 'Submit'; submitButton.className = 'submit-button';
    const closeButton = document.createElement('button');
    closeButton.type = 'button'; closeButton.textContent = 'Close'; closeButton.className = 'close-button';

    form.appendChild(submitButton); form.appendChild(closeButton);
    formContainer.appendChild(form); shadow.appendChild(formContainer);
    document.body.appendChild(container);
    const stopKeepAlive = keepElementAlive(container);

    form.onsubmit = (e) => {
      e.preventDefault();
      const ownerVal = ownerInput.value.trim();
      const siteVal = siteSelect.value;
      const linkVal = linkInput.value.trim();
      const dateVal = dateInput.value; // YYYY-MM-DD from the native date input
      if (!ownerVal || !siteVal || !linkVal || !dateVal) {
        alert('Owner, Site, Link, and Date are all required.');
        return;
      }

      // Close immediately, same as trackingform.user.js — don't make the user wait on the
      // network round trip. Submission retries in the background; a failure still surfaces
      // via alert() even though the popup has already closed.
      stopKeepAlive();
      document.body.removeChild(container);
      submitToTracker({ owner: ownerVal, site: siteVal, link: linkVal, date: dateVal }, {
        onFinalFailure: (reason) => {
          alert(`Error logging giveaway link after retrying: ${reason}.\nSite: ${siteVal}\nLink: ${linkVal}`);
        }
      });
    };
    closeButton.onclick = () => { stopKeepAlive(); document.body.removeChild(container); };

    // Escape closes the popup without submitting
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        stopKeepAlive();
        if (container.isConnected) document.body.removeChild(container);
        document.removeEventListener('keydown', onKeyDown, true);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
  }

  // Trigger button (bottom-right)
  function createTriggerButton() {
    const buttonContainer = document.createElement('div');
    Object.assign(buttonContainer.style, {
      position: 'fixed', bottom: '10px', right: '10px', zIndex: '2147483647', display: 'flex', gap: '5px'
    });
    const triggerButton = document.createElement('button');
    triggerButton.textContent = '🎁 Log Giveaway';
    Object.assign(triggerButton.style, {
      padding: '10px', background: '#1877F2', color: '#fff', border: 'none',
      borderRadius: '4px', cursor: 'pointer', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px'
    });
    triggerButton.onclick = createForm;
    const closeXButton = document.createElement('button');
    closeXButton.textContent = 'X';
    Object.assign(closeXButton.style, { padding: '5px 8px', background: '#f44336', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' });
    buttonContainer.appendChild(triggerButton); buttonContainer.appendChild(closeXButton);
    document.body.appendChild(buttonContainer);
    const stopKeepAlive = keepElementAlive(buttonContainer);
    closeXButton.onclick = () => { stopKeepAlive(); document.body.removeChild(buttonContainer); };
  }

  // Boot
  function runScript() {
    if (!document.body) { setTimeout(runScript, 500); return; }
    createTriggerButton();

    // Hotkey: Shift+Alt+G to open the giveaway form
    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        createForm();
      }
    });
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    runScript();
  } else {
    document.addEventListener('DOMContentLoaded', runScript);
  }
})();
