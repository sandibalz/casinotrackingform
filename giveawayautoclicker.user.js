// ==UserScript==
// @name Multi-Site Giveaway Auto-Clicker
// @namespace http://tampermonkey.net/
// @version 1.9.1
// @description Automatically clicks giveaway buttons — now relentlessly clicks until "Subscribed" on Playfame group
// @author Anonymous
// @match https://*.playfame.com/*
// @match https://*.mcluck.com/*
// @match https://*.hellomillions.com/*
// @match https://*.lonestarcasino.com/*
// @match https://*.realprize.com/*
// @match https://*.spinblitz.com/*
// @match https://*.cardcrush.com/*
// @run-at document-idle
// @grant none
// @updateURL https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/giveawayautoclicker.user.js
// @downloadURL https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/giveawayautoclicker.user.js
// ==/UserScript==
(function() {
    'use strict';
    class GiveawayAutomation {
        constructor() {
            this.hostname = window.location.hostname.toLowerCase();
            this.maxWaitTime = 30000;
            this.countdownInterval = null;
            this.persistentInterval = null;  // For Playfame group retry loop
            console.log("[GiveawayAutomation] Initialized for hostname:", this.hostname);
            this.init();
        }

        init() {
            if (sessionStorage.getItem('giveawayAborted')) {
                console.log("[GiveawayAutomation] ABORTED STATE DETECTED: Skipping automation");
                return;
            }

            if (document.readyState === "loading") {
                document.addEventListener('DOMContentLoaded', () => this.handlePage());
            } else {
                this.handlePage();
            }
        }

        async handlePage() {
            console.log("[GiveawayAutomation] Processing page:", window.location.href);

            if (this.hostname.includes('playfame.com') || this.hostname.includes('mcluck.com') ||
                this.hostname.includes('hellomillions.com') || this.hostname.includes('spinblitz.com')||
                this.hostname.includes('cardcrush.com')) {
                await this.handlePlayfameGroup_Persistent();
            }
            else if (this.hostname.includes('stake.us')) {
                await this.handleStake();
            }
            else if (this.hostname.includes('lonestarcasino.com') || this.hostname.includes('realprize.com')) {
                await this.handleLonestarGroup();
            }
        }

        // ──────────────────────────────────────────────────────────────
        // PERSISTENT PLAYFAME GROUP – KEEPS TRYING UNTIL SUBSCRIBED
        // ──────────────────────────────────────────────────────────────
        async handlePlayfameGroup_Persistent() {
            console.log("[GiveawayAutomation] Starting PERSISTENT mode for Playfame group (will retry until Subscribed)");

            const maxTotalTime = 300000; // 5 minutes max
            const startTime = Date.now();

            this.persistentInterval = setInterval(() => {
                if (Date.now() - startTime > maxTotalTime) {
                    console.log("[GiveawayAutomation] 5-minute timeout reached — giving up");
                    clearInterval(this.persistentInterval);
                    return;
                }

                // Success check: "Subscribed" button (disabled)
                if (this.isSubscribed()) {
                    console.log("[GiveawayAutomation] SUCCESS: SUBSCRIBED STATE DETECTED!");
                    clearInterval(this.persistentInterval);
                    this.createCountdownPopup();
                    this.startCountdown();
                    return;
                }

                // Find and click "Enter Giveaway" if it's clickable
                const button = this.findEnterGiveawayButton();
                if (button && !button.disabled && button.getAttribute('data-disabled') !== 'true' && this.isElementVisible(button)) {
                    console.log("[GiveawayAutomation] Clicking Enter Giveaway →", button.textContent.trim());
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
                console.log("[GiveawayAutomation] Tab close aborted by user");
            });
        }

        async handleStake() {
            console.log("[GiveawayAutomation] Handling Stake.us logic");
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
                        console.log("[GiveawayAutomation] Found Stake.us button:", button.textContent.trim());
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
                    console.log("[GiveawayAutomation] Clicked Stake.us giveaway button");
                    this.createCountdownPopup();
                    this.startCountdown();
                }
            } catch (e) { console.error(e); }
        }

        async handleLonestarGroup() {
            console.log("[GiveawayAutomation] Handling LonestarCasino/RealPrize logic");
            let clickCount = 0;
            try {
                for (let i = 1; i <= 3; i++) {
                    // (your original 3-loop logic — unchanged)
                    const claimButton = document.querySelector('.claimbon_btn');
                    if (claimButton && claimButton.textContent.trim().toLowerCase() === 'claim' && this.isElementVisible(claimButton)) {
                        claimButton.click(); clickCount++;
                        await this.sleep(1000);
                    }
                    const popupButton = document.querySelector('#claimnewpop');
                    if (popupButton && popupButton.textContent.trim().toLowerCase().includes('claim') &&
                        (this.isElementVisible(popupButton) || document.querySelector('#newpopmsg')?.style.display !== 'none')) {
                        popupButton.click(); clickCount++;
                        await this.sleep(2000);
                    }
                    const unlockButton = document.querySelector('.genpop.showitbig [data-link="get_fs"]');
                    if (unlockButton && this.isElementVisible(unlockButton)) {
                        unlockButton.click(); clickCount++;
                        await this.sleep(1000);
                    }
                    if (i < 3) await this.sleep(3000);
                }
                if (clickCount > 0) {
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
