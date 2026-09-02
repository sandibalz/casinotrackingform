// ==UserScript==
// @name        Auto Login to Casinos (Unified, Improved Google Button Detection)
// @namespace   Violentmonkey Scripts
// @match       https://sportzino.com/login*
// @match       https://www.zulacasino.com/login*
// @match       https://www.fortunecoins.com/login*
// @match       https://www.yaycasino.com/login*
// @match       https://americanluck.com/login*
// @match       https://winbonanza.com/login*
// @match       https://fortunewins.com/login*
// @match       https://www.fortunewins.com/login*
// @match       https://reelzappy.com/login*
// @match       https://luckparty.com/login*
// @match       https://www.luckparty.com/login*
// @grant       none
// @version     3.5
// @description Waits for captcha to solve, then auto-clicks the correct login button for each casino. Shows an on-screen log so you can see it working.
// @updateURL   https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/autologincasinos.user.js
// @downloadURL https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/autologincasinos.user.js
// ==/UserScript==
(function() {
    'use strict';

    const SITE_MAP = {
        "yaycasino.com": {
            type: "custom",
            selector: 'button[type="submit"].loginFormButtton[data-sentry-component="YayButton"], button.yay-button.primary.loginFormButtton.xl[type="submit"]',
            text: "Log In",
            clickMode: "click" // React/Next.js form — use real pointer events, not form submit
        },
        "winbonanza.com": {
            type: "custom",
            selector: 'button[data-testid="login-submit-button"].loginFormButtton',
            text: "Log In"
        },
        "reelzappy.com": {
            type: "custom",
            selector: 'button[data-testid="login-submit-button"]', // cleaner
            text: "Log In"
        },
        "americanluck.com": { type: "google" },
        "sportzino.com":    { type: "google" },
        "zulacasino.com":   { type: "google" },
        "fortunecoins.com": { type: "google" },
        "fortunewins.com":  { type: "google" },
        "luckparty.com": {
            type: "password",
            // Real username/password form, not Google SSO. Explicit id selectors so we
            // never touch the separate "LOGIN WITH AN EMAIL LINK" magic-link button.
            emailSelector: '#field-email',
            passwordSelector: '#field-password',
            loginButtonSelector: 'button.login-btn[type="submit"]',
            loginButtonText: "Login"
        }
    };

    function getSiteConfig() {
        const host = window.location.hostname;
        for (const domain in SITE_MAP) {
            if (host.includes(domain)) return SITE_MAP[domain];
        }
        return null;
    }

    // ---- On-screen log panel -------------------------------------------------
    // Everything still goes to console.log too, but a floating panel means you
    // don't have to open DevTools to see whether the script is doing anything.
    let logHost = null;
    let logList = null;

    function ensureLogPanel() {
        if (logHost && logHost.isConnected) return;
        const host = document.createElement('div');
        host.id = 'autologin-log-host';
        host.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:2147483647;';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                .panel {
                    font: 11px/1.4 -apple-system, Segoe UI, Arial, sans-serif;
                    background: rgba(20,20,20,0.92);
                    color: #eee;
                    padding: 6px 8px;
                    border-radius: 8px;
                    width: 260px;
                    max-height: 150px;
                    overflow-y: auto;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.5);
                }
                .title { color: #7fd1ff; font-weight: bold; margin-bottom: 3px; }
                .line { white-space: pre-wrap; word-break: break-word; margin-bottom: 1px; }
                .line.warn { color: #ffb84d; }
            </style>
            <div class="panel">
                <div class="title">Auto Login</div>
                <div id="lines"></div>
            </div>
        `;
        document.documentElement.appendChild(host);
        logHost = host;
        logList = shadow.getElementById('lines');

        // Re-attach if the page ever tears the host out (SPA re-renders, etc.)
        setInterval(() => {
            if (!document.documentElement.contains(logHost)) {
                document.documentElement.appendChild(logHost);
            }
        }, 2000);
    }

    function uiLog(msg, isWarn) {
        console.log('[AutoLogin] ' + msg);
        try {
            ensureLogPanel();
            const line = document.createElement('div');
            line.className = 'line' + (isWarn ? ' warn' : '');
            line.textContent = new Date().toLocaleTimeString() + ' — ' + msg;
            logList.appendChild(line);
            while (logList.children.length > 8) logList.removeChild(logList.firstChild);
        } catch (_) {
            // Page may not allow DOM writes this early (rare) — console.log above still fired.
        }
    }

    function findGoogleButton() {
        // LuckParty-style: <button class="google"><img alt="Google" ...></button>
        const byGoogleClass = document.querySelector('button.google img[alt="Google"]')?.closest('button') ||
                               document.querySelector('.social-login button.google');
        if (byGoogleClass) return byGoogleClass;

        // Generic fallback: any button containing a Google-alt image
        const byIcon = document.querySelector('button.sso-button img[alt="Google"]')?.closest('button') ||
                        document.querySelector('button img[alt="Google"]')?.closest('button');
        if (byIcon) return byIcon;

        const buttons = document.querySelectorAll("button.sso-button");
        for (const btn of buttons) {
            const textSpan = btn.querySelector(".button-text");
            if (!textSpan) continue;
            if (textSpan.textContent.trim().toLowerCase().includes("google")) return btn;
        }
        return null;
    }

    function humanClick(el) {
        if (!el || el.disabled) return false;

        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2 + (Math.random() * 3 - 1.5);
        const y = rect.top + rect.height / 2 + (Math.random() * 3 - 1.5);

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
            detail: 1
        };

        // Focus first
        el.focus();

        // Pointer + mouse sequence (many anti-bot systems watch these)
        el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseover', base));
        el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mousedown', base));
        el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
        el.dispatchEvent(new MouseEvent('mouseup', base));
        el.dispatchEvent(new MouseEvent('click', base));

        return true;
    }

    function nudgeField(el) {
        // Autofilled/saved values don't always fire the input/change events a site's
        // own JS listens for, so it can treat the field as "empty" until a real click
        // touches it. Re-set the value via the native setter (bypasses any framework
        // override) and fire input/change so the site's state catches up.
        // IMPORTANT: never force-clear a field — if it's already empty (autofill
        // hasn't landed yet, or the site cleared it) there is nothing safe to "nudge".
        if (!el || !el.value) return;
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, el.value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function submitViaForm(btn) {
        const form = btn.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
            form.requestSubmit(btn);
            uiLog(`requestSubmit used for ${location.hostname}`);
            return true;
        } else if (form) {
            form.submit();
            uiLog(`form.submit() used for ${location.hostname}`);
            return true;
        }
        return false;
    }

    function clickLoginButton(retryUntil = Date.now() + 20000) {
        const config = getSiteConfig();
        if (!config) {
            uiLog("No site config found for " + location.hostname, true);
            return;
        }

        if (config.type === "custom") {
            // Prefer the most reliable selector for reelzappy, fall back to configured selector
            let btn = document.querySelector('button[data-testid="login-submit-button"]') ||
                      document.querySelector(config.selector);

            if (btn) {
                uiLog(`Custom button found for ${location.hostname} — disabled=${btn.disabled}, text="${btn.innerText.trim()}"`);
            }

            if (btn && !btn.disabled) {
                const btnText = btn.querySelector(".button-content")?.textContent.trim() ??
                                btn.innerText.trim();

                if (!config.text || btnText === config.text) {
                    if (config.clickMode === "click") {
                        // React/Next.js sites: dispatch real pointer events on the button.
                        humanClick(btn);
                        uiLog(`Clicked login button for ${location.hostname}`);
                        // Belt-and-suspenders: if still on the login page shortly after, try native submit.
                        setTimeout(() => {
                            if (/\/login/.test(location.pathname)) {
                                uiLog("Still on login page after click — trying form submit as backup");
                                submitViaForm(btn);
                            }
                        }, 800);
                    } else if (!submitViaForm(btn)) {
                        // No form — fall back to simulated human click
                        humanClick(btn);
                        uiLog(`Clicked login button for ${location.hostname}`);
                    }
                    return;
                }
            }

            if (Date.now() < retryUntil) {
                uiLog("Custom button not ready yet, retrying...");
                setTimeout(() => clickLoginButton(retryUntil), 300);
            } else {
                uiLog("Custom login button not found/ready after retries.", true);
            }
        } else if (config.type === "password") {
            const emailField = document.querySelector(config.emailSelector);
            const passwordField = document.querySelector(config.passwordSelector);
            const btn = document.querySelector(config.loginButtonSelector);

            if (!emailField || !passwordField || !btn) {
                if (Date.now() < retryUntil) {
                    uiLog("Waiting for email/password fields and Login button to appear...");
                    setTimeout(() => clickLoginButton(retryUntil), 300);
                } else {
                    uiLog("Email/password fields or Login button never appeared.", true);
                }
                return;
            }

            if (btn.disabled) {
                if (Date.now() < retryUntil) {
                    setTimeout(() => clickLoginButton(retryUntil), 300);
                } else {
                    uiLog("Login button stayed disabled after retries.", true);
                }
                return;
            }

            if (!emailField.value || !passwordField.value) {
                // Don't touch the fields until the browser has actually put saved
                // values in them — nudging an empty field just confirms "empty" to
                // the site's own React/JS state and can wipe out a slightly-later
                // real autofill.
                if (Date.now() < retryUntil) {
                    // Length only — never logs the actual value — so we can see from the
                    // on-screen panel whether the browser has genuinely committed a value
                    // yet, even while it visually looks filled in.
                    uiLog(`Waiting for saved email/password to autofill (currently sees ${emailField.value.length} / ${passwordField.value.length} chars)...`);
                    setTimeout(() => clickLoginButton(retryUntil), 500);
                } else {
                    uiLog("Email/password never registered a value after 20s — log in manually this time.", true);
                }
                return;
            }

            uiLog(`Email + password detected (${emailField.value.length} / ${passwordField.value.length} chars) — clicking into both fields...`);
            humanClick(emailField);
            nudgeField(emailField);
            humanClick(passwordField);
            nudgeField(passwordField);

            setTimeout(() => {
                uiLog(`After clicking in: ${emailField.value.length} / ${passwordField.value.length} chars`);
                if (!emailField.value || !passwordField.value) {
                    uiLog("Email/password went blank after clicking in — not submitting. Please log in manually.", true);
                    return;
                }
                const btnText = btn.innerText.trim();
                // Case-insensitive: some sites CSS-uppercase the button (innerText
                // reflects the rendered "LOGIN" even though the real text is "Login").
                if (!config.loginButtonText || btnText.toLowerCase() === config.loginButtonText.toLowerCase()) {
                    uiLog("Clicking Login...");
                    humanClick(btn);
                    setTimeout(() => {
                        if (/\/login/.test(location.pathname)) {
                            uiLog("Still on login page after clicking Login — trying form submit as backup");
                            submitViaForm(btn);
                        }
                    }, 800);
                } else {
                    uiLog(`Login button text mismatch: "${btnText}"`, true);
                }
            }, 200);
        } else {
            const btn = findGoogleButton();
            if (btn) {
                humanClick(btn);
                uiLog("Clicked Google login button");
            } else if (Date.now() < retryUntil) {
                uiLog("Google button not ready yet, retrying...");
                setTimeout(() => clickLoginButton(retryUntil), 300);
            } else {
                uiLog("Google login button not found after retries.", true);
            }
        }
    }

    function waitForCaptchaSolved() {
        uiLog("Active on " + location.hostname + " — watching for CAPTCHA-solved signal...");
        const interval = setInterval(() => {
            const captchaDiv = document.querySelector("div.capsolver-solver-info");
            if (captchaDiv && captchaDiv.innerText.trim() === "Captcha solved!") {
                uiLog("Captcha solved — waiting 12s before login click...");
                clearInterval(interval);
                setTimeout(clickLoginButton, 12000);
            }
        }, 200);

        setTimeout(() => {
            clearInterval(interval);
            uiLog("Captcha signal timed out after 30s — attempting login anyway.", true);
            clickLoginButton();
        }, 30000);
    }

    waitForCaptchaSolved();
})();
