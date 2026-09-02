// ==UserScript==
// @name         Auto Close Tab with Exclusion List
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @description  Auto closes tabs after 15 minutes, with a movable mini popup with icons to disable for specific tabs or add sites to exclusion list, only runs on main tab. Popup lives in a shadow DOM anchored to <html> with a re-attach watchdog so it can't be hidden/clipped or wiped out by a site's own CSS/JS.
// @author       Grok
// @run-at       document-idle
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/autoclosetab.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/autoclosetab.user.js
// ==/UserScript==
(function() {
    'use strict';
    // Only run in the top-level window (main tab), not in iframes
    if (window.self !== window.top) {
        return;
    }
    // Initialize excluded sites list
    let excludedSites = GM_getValue('excludedSites', []);
    // Get current hostname
    const currentHost = window.location.hostname;
    // Check if current site is in excluded list
    if (excludedSites.includes(currentHost)) {
        return;
    }
    // Session storage keys
    const END_TIME_KEY = 'autoCloseEndTime';
    const DISABLED_KEY = 'autoCloseDisabled';
    // Check if disabled for this tab session
    const isDisabled = sessionStorage.getItem(DISABLED_KEY) === 'true';
    if (isDisabled) {
        return;
    }
    // Get end time from session storage
    const endTimeStr = sessionStorage.getItem(END_TIME_KEY);
    const now = Date.now();
    const fifteenMinutes = 15 * 60 * 1000;
    let endTime = endTimeStr ? parseInt(endTimeStr, 10) : null;
    let shouldShowPopup = false;
    if (endTime && endTime > now) {
        // Resume timer if still valid
        setTimeout(() => {
            try {
                window.close();
                // Fallback to about:blank if window.close() fails
                setTimeout(() => {
                    if (window.location.href !== 'about:blank') {
                        window.location.href = 'about:blank';
                    }
                }, 1000);
            } catch (e) {
                window.location.href = 'about:blank';
            }
        }, endTime - now);
    } else {
        // New timer, show popup
        endTime = now + fifteenMinutes;
        sessionStorage.setItem(END_TIME_KEY, endTime.toString());
        setTimeout(() => {
            // Double-check not disabled before closing
            if (sessionStorage.getItem(DISABLED_KEY) !== 'true') {
                try {
                    window.close();
                    // Fallback to about:blank if window.close() fails
                    setTimeout(() => {
                        if (window.location.href !== 'about:blank') {
                            window.location.href = 'about:blank';
                        }
                    }, 1000);
                } catch (e) {
                    window.location.href = 'about:blank';
                }
            }
        }, fifteenMinutes);
        shouldShowPopup = true;
    }
    if (!shouldShowPopup) {
        return;
    }
    // Host element: anchors the popup to <html> instead of <body>, and is
    // the thing that's actually position:fixed. Some sites put a CSS
    // transform / overflow:hidden / small height on <body>, which creates a
    // new containing block for fixed children and silently clips or
    // mispositions anything appended there (the #1 cause of "popup isn't
    // visible on some sites"). Anchoring to <html> instead avoids that.
    const popupHost = document.createElement('div');
    popupHost.id = 'tm-autoclose-popup-host';
    popupHost.style.position = 'fixed';
    popupHost.style.top = '10px';
    popupHost.style.right = '10px';
    popupHost.style.zIndex = '2147483647';
    popupHost.style.pointerEvents = 'auto';
    // Shadow DOM: fully isolates the popup's markup from page CSS, so a
    // site's own stylesheet (e.g. broad `div{display:none}`-style resets,
    // aggressive CSS frameworks) can't reach in and hide it. Only the host
    // element above is exposed to the page; everything visual lives inside.
    const shadow = popupHost.attachShadow({ mode: 'open' });

    // Create mini popup container
    const popup = document.createElement('div');
    popup.style.padding = '5px';
    popup.style.background = '#fff';
    popup.style.border = '1px solid #000';
    popup.style.cursor = 'move'; // Indicate draggable
    popup.style.userSelect = 'none'; // Prevent text selection while dragging
    popup.style.display = 'flex';
    popup.style.gap = '5px';
    popup.style.borderRadius = '3px';
    popup.style.fontSize = '16px';
    popup.style.fontFamily = 'sans-serif';
    // Disable icon (checkmark)
    const disableIcon = document.createElement('span');
    disableIcon.textContent = '✓';
    disableIcon.style.cursor = 'pointer';
    disableIcon.style.padding = '2px 5px';
    disableIcon.style.color = '#28a745';
    disableIcon.title = 'Disable for this tab';
    popup.appendChild(disableIcon);
    // Exclude icon (stop sign)
    const excludeIcon = document.createElement('span');
    excludeIcon.textContent = '⛔';
    excludeIcon.style.cursor = 'pointer';
    excludeIcon.style.padding = '2px 5px';
    excludeIcon.title = 'Never close this site';
    popup.appendChild(excludeIcon);
    shadow.appendChild(popup);

    // Append host to <html>, falling back to <body> if <html> is somehow
    // unavailable.
    (document.documentElement || document.body).appendChild(popupHost);

    // Watchdog: some sites tear down and rebuild large chunks of the DOM
    // (SPA route changes, aggressive re-renders), which can carry off the
    // popup along with whatever else was there. Re-attach it if it ever
    // goes missing, as long as it's still supposed to be showing.
    const watchdog = setInterval(() => {
        if (sessionStorage.getItem(DISABLED_KEY) === 'true') {
            clearInterval(watchdog);
            return;
        }
        if (!document.documentElement.contains(popupHost)) {
            document.documentElement.appendChild(popupHost);
        }
    }, 2000);

    // Make popup draggable
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    popup.addEventListener('mousedown', (e) => {
        // Prevent dragging if clicking on icons
        if (e.target === disableIcon || e.target === excludeIcon) return;
        isDragging = true;
        initialX = e.clientX - currentX;
        initialY = e.clientY - currentY;
        popup.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            popupHost.style.left = `${currentX}px`;
            popupHost.style.top = `${currentY}px`;
            popupHost.style.right = 'auto'; // Override initial right positioning
        }
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
        popup.style.cursor = 'move';
    });
    // Initialize position
    currentX = window.innerWidth - popupHost.offsetWidth - 10; // Align with initial right: 10px
    currentY = 10; // Align with initial top: 10px
    popupHost.style.left = `${currentX}px`;
    // Handle disable icon
    disableIcon.addEventListener('click', () => {
        sessionStorage.setItem(DISABLED_KEY, 'true');
        clearInterval(watchdog);
        popupHost.remove();
    });
    // Handle exclude icon
    excludeIcon.addEventListener('click', () => {
        if (!excludedSites.includes(currentHost)) {
            excludedSites.push(currentHost);
            GM_setValue('excludedSites', excludedSites);
            alert(`${currentHost} added to never-close list`);
        }
        sessionStorage.setItem(DISABLED_KEY, 'true');
        clearInterval(watchdog);
        popupHost.remove();
    });
})();
