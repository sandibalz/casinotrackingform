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
// @version     3.2
// @description Waits for captcha to solve, then auto-clicks the correct login button for each casino.
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
        if (!el) return;
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
            console.log(`requestSubmit used for ${location.hostname}`);
            return true;
        } else if (form) {
            form.submit();
            console.log(`form.submit() used for ${location.hostname}`);
            return true;
        }
        return false;
    }

    function clickLoginButton(retryUntil = Date.now() + 8000) {
        const config = getSiteConfig();
        if (!config) {
            console.log("No site config found.");
            return;
        }

        if (config.type === "custom") {
            // Prefer the most reliable selector for reelzappy, fall back to configured selector
            let btn = document.querySelector('button[data-testid="login-submit-button"]') ||
                      document.querySelector(config.selector);

            if (btn) {
                console.log(`Custom button found for ${location.hostname} — disabled=${btn.disabled}, text="${btn.innerText.trim()}"`);
            }

            if (btn && !btn.disabled) {
                const btnText = btn.querySelector(".button-content")?.textContent.trim() ??
                                btn.innerText.trim();

                if (!config.text || btnText === config.text) {
                    if (config.clickMode === "click") {
                        // React/Next.js sites: dispatch real pointer events on the button.
                        humanClick(btn);
                        console.log(`humanClick used for ${location.hostname}`);
                        // Belt-and-suspenders: if still on the login page shortly after, try native submit.
                        setTimeout(() => {
                            if (/\/login/.test(location.pathname)) {
                                console.log("Still on login page after humanClick — trying form submit as backup");
                                submitViaForm(btn);
                            }
                        }, 800);
                    } else if (!submitViaForm(btn)) {
                        // No form — fall back to simulated human click
                        humanClick(btn);
                        console.log(`humanClick used for ${location.hostname}`);
                    }
                    return;
                }
            }

            if (Date.now() < retryUntil) {
                console.log("Custom button not ready yet, retrying...");
                setTimeout(() => clickLoginButton(retryUntil), 300);
            } else {
                console.log("Custom login button not found/ready after retries.");
            }
        } else if (config.type === "password") {
            const emailField = document.querySelector(config.emailSelector);
            const passwordField = document.querySelector(config.passwordSelector);
            const btn = document.querySelector(config.loginButtonSelector);

            if (emailField && passwordField && btn && !btn.disabled) {
                // Click into each field first — saved/autofilled values don't always
                // register with the site's own JS until a real click touches the field.
                humanClick(emailField);
                nudgeField(emailField);
                humanClick(passwordField);
                nudgeField(passwordField);

                setTimeout(() => {
                    const btnText = btn.innerText.trim();
                    if (!config.loginButtonText || btnText === config.loginButtonText) {
                        humanClick(btn);
                        console.log(`humanClick used for ${location.hostname} (password login)`);
                        setTimeout(() => {
                            if (/\/login/.test(location.pathname)) {
                                console.log("Still on login page after humanClick — trying form submit as backup");
                                submitViaForm(btn);
                            }
                        }, 800);
                    } else {
                        console.log(`Login button text mismatch for ${location.hostname}: "${btnText}"`);
                    }
                }, 200);
                return;
            }

            if (Date.now() < retryUntil) {
                console.log("Password login fields/button not ready yet, retrying...");
                setTimeout(() => clickLoginButton(retryUntil), 300);
            } else {
                console.log("Password login fields/button not found after retries.");
            }
        } else {
            const btn = findGoogleButton();
            if (btn) {
                humanClick(btn);
                console.log("Clicked Google login button");
            } else if (Date.now() < retryUntil) {
                console.log("Google button not ready yet, retrying...");
                setTimeout(() => clickLoginButton(retryUntil), 300);
            } else {
                console.log("Google login button not found after retries.");
            }
        }
    }

    function waitForCaptchaSolved() {
        const interval = setInterval(() => {
            const captchaDiv = document.querySelector("div.capsolver-solver-info");
            if (captchaDiv && captchaDiv.innerText.trim() === "Captcha solved!") {
                console.log("Captcha solved detected! Waiting 8s before login click...");
                clearInterval(interval);
                setTimeout(clickLoginButton, 12000);
            }
        }, 200);

        setTimeout(() => {
            clearInterval(interval);
            console.log("Captcha timeout — attempting login anyway");
            clickLoginButton();
        }, 30000);
    }

    waitForCaptchaSolved();
})();
