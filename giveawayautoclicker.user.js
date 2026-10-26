// ==UserScript==
// @name Multi-Site Giveaway Auto-Clicker
// @namespace http://tampermonkey.net/
// @version 1.10.2
// @description Automatically clicks giveaway buttons — now relentlessly clicks until "Subscribed" on Playfame group
// @author Anonymous
// @match https://*.playfame.com/*
// @match https://*.mcluck.com/*
// @match https://*.hellomillions.com/*
// @match https://*.spinblitz.com/*
// @match https://*.cardcrush.com/*
// @run-at document-idle
// @grant none
// @updateURL https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/giveawayautoclicker.user.js
// @downloadURL https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/giveawayautoclicker.user.js
// ==/UserScript==
// v1.10.0 – removed lonestarcasino.com/realprize.com support (dropped the
//           two @match lines, the handleLonestarGroup branch in handlePage,
//           and the handleLonestarGroup method itself). That LoneStar-group
//           fixed 3-loop click sequence was racing tampermonkey-
//           realprizeautoclaim-canonical.js's continuous popup watcher on
//           the same .genpop.showitbig / [data-link="get_fs"] claim popup,
//           and was the likely cause of a live TypeError crash in the
//           site's own click handler (see that script's v1.7.1 changelog
//           and this index's Cross-script overlaps note, 9/17/26).
//           PlayFame group and stake.us logic are untouched.
(function() {
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

    // ---- badge (10/14/26): collapsed bottom-left pill with a log; click to open/close. Same look as Popup Closer's. ----
    const BADGE_NAME = 'Giveaway Auto-Clicker', BADGE_VER = '1.10.2';
    const badgeLines = []; let badgeOpen = false, badgePill = null, badgeBox = null, badgeWarn = 0;
    function badgeRender() {
        try {
            if (window.top !== window.self || !document.body) return;
            if (!badgePill || !badgePill.isConnected) {
                const stack = getDock().getElementById('bd-sections'); // 10/26/26: shared badge dock (was #tm-badge-stack)
                const wrap = document.createElement('div');
                wrap.style.cssText = 'order:40;display:flex;flex-direction:column;align-items:flex-start;gap:2px;pointer-events:none;';
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
            if (badgeWarn > (window.__badgeAlerted_giveawayautoclicker || 0)) { window.__badgeAlerted_giveawayautoclicker = badgeWarn; const dh = document.getElementById('__badge-dock'); if (dh && !dh.hasAttribute('data-open')) dh.setAttribute('data-alert', ''); }
        } catch (e) {}
    }
    function badgeAdd(text, warn) {
        badgeLines.push(new Date().toLocaleTimeString() + ' ' + text);
        if (badgeLines.length > 60) badgeLines.shift();
        if (warn || /error|fail|abort|giving up|can't|cannot/i.test(text)) badgeWarn++;
        badgeRender();
    }
    // console.log that also lands in the pill (element arguments are shown as <tag>)
    function badgeLog(...args) {
        console.log(...args);
        badgeAdd(args.map((a) => (a && a.nodeType === 1) ? '<' + a.tagName.toLowerCase() + '>' : String(a)).join(' ').replace(/^\[[^\]]*\]\s*/, ''));
    }
    badgeRender();

    class GiveawayAutomation {
        constructor() {
            this.hostname = window.location.hostname.toLowerCase();
            this.maxWaitTime = 30000;
            this.countdownInterval = null;
            this.persistentInterval = null;  // For Playfame group retry loop
            badgeLog("[GiveawayAutomation] Initialized for hostname:", this.hostname);
            this.init();
        }

        init() {
            if (sessionStorage.getItem('giveawayAborted')) {
                badgeLog("[GiveawayAutomation] ABORTED STATE DETECTED: Skipping automation");
                return;
            }

            if (document.readyState === "loading") {
                document.addEventListener('DOMContentLoaded', () => this.handlePage());
            } else {
                this.handlePage();
            }
        }

        async handlePage() {
            badgeLog("[GiveawayAutomation] Processing page:", window.location.href);

            if (this.hostname.includes('playfame.com') || this.hostname.includes('mcluck.com') ||
                this.hostname.includes('hellomillions.com') || this.hostname.includes('spinblitz.com')||
                this.hostname.includes('cardcrush.com')) {
                await this.handlePlayfameGroup_Persistent();
            }
            else if (this.hostname.includes('stake.us')) {
                await this.handleStake();
            }
        }

        // ──────────────────────────────────────────────────────────────
        // PERSISTENT PLAYFAME GROUP – KEEPS TRYING UNTIL SUBSCRIBED
        // ──────────────────────────────────────────────────────────────
        async handlePlayfameGroup_Persistent() {
            badgeLog("[GiveawayAutomation] Starting PERSISTENT mode for Playfame group (will retry until Subscribed)");

            const maxTotalTime = 300000; // 5 minutes max
            const startTime = Date.now();

            this.persistentInterval = setInterval(() => {
                if (Date.now() - startTime > maxTotalTime) {
                    badgeLog("[GiveawayAutomation] 5-minute timeout reached — giving up");
                    clearInterval(this.persistentInterval);
                    return;
                }

                // Success check: "Subscribed" button (disabled)
                if (this.isSubscribed()) {
                    badgeLog("[GiveawayAutomation] SUCCESS: SUBSCRIBED STATE DETECTED!");
                    clearInterval(this.persistentInterval);
                    this.createCountdownPopup();
                    this.startCountdown();
                    return;
                }

                // Find and click "Enter Giveaway" if it's clickable
                const button = this.findEnterGiveawayButton();
                if (button && !button.disabled && button.getAttribute('data-disabled') !== 'true' && this.isElementVisible(button)) {
                    badgeLog("[GiveawayAutomation] Clicking Enter Giveaway →", button.textContent.trim());
                    button.click();
                }
            }, 3000); // Check every 3 seconds
        }

        findEnterGiveawayButton() {
            // Primary known class
            let btn = document.querySelector('.GiveawayInfo_submitButton__rxRrB');
            if (btn && btn.textContent.trim().toLowerCase().includes('enter giveaway') &&
                btn.getAttribute('data-disabled') !== 'true' && !btn.disabled) {
                return btn;
            }

            // Fallback: any visible button with the right text
            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
                const text = b.textContent.trim().toLowerCase();
                if ((text.includes('enter giveaway') || text.includes('enter now')) &&
                    !b.disabled && b.getAttribute('data-disabled') !== 'true' && this.isElementVisible(b)) {
                    return b;
                }
            }
            return null;
        }

        isSubscribed() {
            // Main button disabled + says Subscribed
            const main = document.querySelector('.GiveawayInfo_submitButton__rxRrB[disabled]');
            if (main && main.textContent.trim().toLowerCase().includes('subscribed')) return true;

            // Inside actions div
            const divBtn = document.querySelector('.GiveawayInfo_actions__jvyhu button[disabled]');
            if (divBtn && divBtn.textContent.trim().toLowerCase().includes('subscribed')) return true;

            return false;
        }

        // ──────────────────────────────────────────────────────────────
        // ORIGINAL FUNCTIONS (unchanged)
        // ──────────────────────────────────────────────────────────────
        createCountdownPopup() {
            const popup = document.createElement('div');
            popup.id = 'giveaway-automation-popup';
            popup.style.position = 'fixed';
            popup.style.top = '50%';
            popup.style.left = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
            popup.style.backgroundColor = '#fff';
            popup.style.padding = '20px';
            popup.style.border = '2px solid #000';
            popup.style.zIndex = '9999';
            popup.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
            popup.style.textAlign = 'center';
            popup.innerHTML = `
                <h3>Giveaway Entered!</h3>
                <p>Tab will close in <span id="countdown">60</span> seconds.</p>
                <button id="abort-close" style="padding: 10px 20px; cursor: pointer;">Abort</button>
            `;
            document.body.appendChild(popup);
            return popup;
        }

        startCountdown() {
            let timeLeft = 60;
            const countdownElement = document.getElementById('countdown');
            this.countdownInterval = setInterval(() => {
                timeLeft--;
                countdownElement.textContent = timeLeft;
                if (timeLeft <= 0) {
                    clearInterval(this.countdownInterval);
                    window.location.href = 'about:blank';
                }
            }, 1000);
            document.getElementById('abort-close').addEventListener('click', () => {
                clearInterval(this.countdownInterval);
                const popup = document.getElementById('giveaway-automation-popup');
                if (popup) popup.remove();
                sessionStorage.setItem('giveawayAborted', 'true');
                badgeLog("[GiveawayAutomation] Tab close aborted by user");
            });
        }

        async handleStake() {
            badgeLog("[GiveawayAutomation] Handling Stake.us logic");
            try {
                const buttonSelectors = [
                    'button[data-testid*="giveaway-enter" i]',
                    'button[aria-label*="Enter Giveaway" i]',
                    'button[class*="enter-giveaway" i]',
                    'button[class*="btn-enter" i]'
                ];
                let button = null;
                for (const selector of buttonSelectors) {
                    button = await this.waitForElement(selector, this.maxWaitTime);
                    if (button && button.textContent.toLowerCase().includes('enter giveaway') && !button.disabled && this.isElementVisible(button)) {
                        badgeLog("[GiveawayAutomation] Found Stake.us button:", button.textContent.trim());
                        break;
                    }
                }
                if (!button) {
                    const allButtons = document.querySelectorAll('button');
                    for (const btn of allButtons) {
                        if (btn.textContent.toLowerCase().includes('enter giveaway') && !btn.disabled && this.isElementVisible(btn)) {
                            button = btn;
                            break;
                        }
                    }
                }
                if (button) {
                    button.click();
                    badgeLog("[GiveawayAutomation] Clicked Stake.us giveaway button");
                    this.createCountdownPopup();
                    this.startCountdown();
                }
            } catch (e) { console.error(e); }
        }

        isElementVisible(elem) {
            if (!elem) return false;
            const style = window.getComputedStyle(elem);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }

        waitForElement(selector, timeout = 10000) {
            return new Promise(resolve => {
                const el = document.querySelector(selector);
                if (el) { resolve(el); return; }
                const observer = new MutationObserver((_, obs) => {
                    const found = document.querySelector(selector);
                    if (found) { obs.disconnect(); resolve(found); }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
            });
        }

        sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    }

    if (!window.giveawayAutomationInitialized) {
        window.giveawayAutomationInitialized = true;
        new GiveawayAutomation();
    }
})();
