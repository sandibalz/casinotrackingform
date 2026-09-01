// ==UserScript==
// @name         Casino Google Form Input (Reliable + Lightweight)
// @namespace    http://tampermonkey.net/
// @version      1.58.4
// @description  Popup form to submit SC data to a Google Form; full per-site
// @author       Grok / sandibalz
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/trackingform.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/trackingform.user.js
// @grant        none
// ==/UserScript==
// @match        https://play.babacasino.com/*
// @match        https://lobby.chumbacasino.com/*
// @match        https://play.clubs.poker/*
// @match        https://play.clubspoker.com/*
// @match        https://crowncoinscasino.com/*
// @match        https://www.fortunecoins.com/*
// @match        https://goldtreasurecasino.com/*
// @match        https://luckylandcasino.com/*
// @match        https://play.luckylandcasino.com/*
// @match        https://luckparty.com/*
// @match        https://fun.high5casino.com/*
// @match        https://luckybird.io/*
// @match        https://www.jefebet.com/*
// @match        https://www.ace.com/*
// @match        https://modo.us/*
// @match        https://myprize.us/*
// @match        https://www.jackpotdaily.com/*
// @match        https://app.icasino.com/*
// @match        https://www.rollingriches.com/*
// @match        https://legacyarcade.com/*
// @match        https://legacycasino.com/*
// @match        https://play.rubysweeps.com/*
// @match        https://sportzino.com/*
// @match        https://www.vivaro.us/*
// @match        https://www.yaycasino.com/*
// @match        https://fortunewins.com/*
// @match        https://www.wowvegas.com/*
// @match        https://www.zulacasino.com/*
// @match        https://sidepot.us/*
// @match        https://casino.click/*
// @match        https://play.globalpoker.com/*
// @match        https://www.goldenheartsgames.com/*
// @match        https://kickr.com/*
// @match        https://game.cidercasino.com/*
// @match        https://www.mojogo.com/*
// @match        https://www.legendz.com/*
// @match        https://lonestarcasino.com/*
// @match        https://www.pulsz.com/*
// @match        https://www.pulszbingo.com/*
// @match        https://realprize.com/*
// @match        https://www.spinpals.com/*
// @match        https://stake.us/*
// @match        https://www.themoneyfactory.com/*
// @match        https://chipnwin.com/*
// @match        https://www.hellomillions.com/*
// @match        https://www.jackpota.com/*
// @match        https://luckyhands.com/*
// @match        https://www.mcluck.com/*
// @match        https://www.megabonanza.com/*
// @match        https://moozi.com/*
// @match        https://www.spinblitz.com/*
// @match        https://www.playfame.com/*
// @match        https://scrooge.casino/*
// @match        https://market.scrooge.casino/*
// @match        https://spree.com/*
// @match        https://crazycoinscasino.com/*
// @match        https://www.stackrcasino.com/*
// @match        https://luckystake.com/*
// @match        https://lunalandcasino.com/*
// @match        https://americanluck.com/*
// @match        https://getzoot.us/*
// @match        https://www.rolla.com/*
// @match        https://game.jackpotgo.com/*
// @match        https://game.lavishluck.net/*
// @match        https://blitzmania.com/*
// @match        https://chanced.com/*
// @match        https://coinz.us/*
// @match        https://daracasino.com/*
// @match        https://dimesweeps.com/*
// @match        https://globalpoker.com/*
// @match        https://goodvibescasino.com/*
// @match        https://jackpotgo.com/*
// @match        https://mrgoodwin.com/*
// @match        https://play.rebet.app/*
// @match        https://punt.com/*
// @match        https://reelzappy.com/*
// @match        https://sixty6.com/*
// @match        https://smilescasino.com/*
// @match        https://speedsweeps.com/*
// @match        https://spinquest.com/*
// @match        https://sweetsweeps.com/*
// @match        https://www.cardcrush.com/*
// @match        https://www.coinsbackcasino.com/*
// @match        https://www.play.dogghousecasino.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// ==/UserScript==

(function() {
  'use strict';

  // Config
  const defaultOwner = 'Ben'; // set to this computer's owner name (Ben/Cindy/Tyler/Jessica) — was hardcoded to 'Scott', a leftover from an old version, so auto-submitted entries were landing under a nonexistent owner
  const numericRegex = /^\d{1,3}(,\d{3})*(\.\d+)?$/;
  const scCurrencyRegexDisplay = /^\$\d{1,3}(,\d{3})*(\.\d{2})$/;
  const noAutoSubmitSites = [
    'crowncoinscasino.com','sportzino.com','fun.high5casino.com',
    'goldtreasurecasino.com','luckystake.com','app.icasino.com','www.yaycasino.com','www.zulacasino.com'
  ];
  const extraDelays = { 'www.zulacasino.com': 5000 };

  // Helpers
  const cleanNumber = (value) => {
    const num = parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(num) ? num.toFixed(2) : '';
  };
  const processValue = (value, { divideBy100 = false } = {}) => {
    let num = parseFloat(String(value).replace(/,/g, ''));
    if (!Number.isFinite(num)) return '';
    if (divideBy100) num /= 100;
    return num.toFixed(2);
  };
  const hasSCText = (element, selectors = ['span','div','p']) => {
    const parent = element.closest('*');
    if (!parent) return false;
    const nodes = parent.querySelectorAll(selectors.join(','));
    for (const sib of nodes) {
      if (/SC|SCOIN|Sweep/i.test(sib.textContent.trim())) return true;
    }
    return false;
  };

  // --- Network/API Value Capture ---
  // Hooks fetch/XHR/WebSocket so we can read the same JSON the page's own balance calls
  // receive, instead of scraping DOM text that breaks whenever a site tweaks its
  // markup/classes. Some sites (e.g. FortuneWins' SignalR "gamehub") push balance data
  // over a WebSocket instead of a REST call, hence the WebSocket hook alongside fetch/XHR.
  // unsafeWindow is the actual page window in Tampermonkey's sandbox (unlike a Chrome
  // extension's isolated content-script world), so overriding these here is visible to
  // the page's own code without a separate MAIN-world injection step.
  const MAX_API_CAPTURES = 100;
  const MAX_API_BODY_LENGTH = 500000; // skip absurdly large bodies (bundles, images-as-blobs, etc.)
  const apiCaptures = [];

  function looksLikeJson(text) {
    if (!text || text.length > MAX_API_BODY_LENGTH) return false;
    const trimmed = text.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
  }

  function recordApiCapture(url, method, status, bodyText) {
    if (!looksLikeJson(bodyText)) return;
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e) {
      return; // not actually valid JSON despite the {/[ prefix
    }
    apiCaptures.push({ url, method, status, body: parsed, timestamp: Date.now() });
    if (apiCaptures.length > MAX_API_CAPTURES) apiCaptures.shift();
  }

  (function installNetworkInterceptor() {
    const target = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    const originalFetch = target.fetch;
    target.fetch = function (...args) {
      const promise = originalFetch.apply(this, args);
      promise.then((response) => {
        try {
          const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || String(args[0]);
          const method = (args[1]?.method || 'GET').toUpperCase();
          response.clone().text().then((text) => recordApiCapture(url, method, response.status, text)).catch(() => {});
        } catch (e) {
          // never let capture logic break the page's own fetch
        }
      }).catch(() => {});
      return promise;
    };

    const OriginalXHR = target.XMLHttpRequest;
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function (method, url, ...rest) {
      this.__scApiMethod = method;
      this.__scApiUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    OriginalXHR.prototype.send = function (...args) {
      this.addEventListener('loadend', () => {
        try {
          recordApiCapture(this.__scApiUrl, this.__scApiMethod || 'GET', this.status, this.responseText);
        } catch (e) {
          // ignore — e.g. responseText throws for non-text responseTypes
        }
      });
      return originalSend.apply(this, args);
    };

    // ----- WebSocket -----
    // Several sites (e.g. FortuneWins' SignalR "gamehub") push balance/game state over a
    // WebSocket instead of fetch/XHR, so those two hooks alone never see it. SignalR (and
    // most other WS protocols used for this) frames plain JSON text, sometimes several
    // messages concatenated with a \x1e record-separator — split on that and try each
    // chunk as its own capture.
    const OriginalWebSocket = target.WebSocket;
    if (OriginalWebSocket) {
      target.WebSocket = new Proxy(OriginalWebSocket, {
        construct(TargetClass, args) {
          const ws = new TargetClass(...args);
          const url = String(args[0] || '');
          ws.addEventListener('message', (event) => {
            try {
              if (typeof event.data !== 'string') return; // skip binary frames
              const parts = event.data.split('\x1e').filter(Boolean);
              for (const part of parts) recordApiCapture(url, 'WS', 0, part);
            } catch (e) {
              // never let capture logic break the page's own socket handling
            }
          });
          return ws;
        }
      });
    }
  })();

  // Recursively walks a parsed JSON value, collecting every leaf that looks like a plain
  // number (or a numeric-looking string, since many APIs send balances as strings) as a
  // {path, value} candidate. Capped in depth and result count so a huge/deep response
  // can't hang the picker.
  function scanForNumericFields(obj, prefix = '', results = [], depth = 0) {
    if (depth > 6 || results.length > 300 || obj === null || obj === undefined) return results;

    if (typeof obj === 'number' && Number.isFinite(obj)) {
      results.push({ path: prefix, value: obj });
    } else if (typeof obj === 'string') {
      const cleaned = obj.replace(/,/g, '');
      if (/^-?\d+(\.\d+)?$/.test(cleaned) && cleaned.length > 0 && cleaned.length < 15) {
        results.push({ path: prefix, value: parseFloat(cleaned) });
      }
    } else if (Array.isArray(obj)) {
      obj.slice(0, 20).forEach((item, i) => scanForNumericFields(item, `${prefix}[${i}]`, results, depth + 1));
    } else if (typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        scanForNumericFields(obj[key], prefix ? `${prefix}.${key}` : key, results, depth + 1);
      }
    }
    return results;
  }

  // Balance-ish key names sort first — purely a convenience ordering, doesn't affect
  // what's selectable.
  function candidateRelevanceScore(path) {
    const lower = path.toLowerCase();
    const keywords = ['balance', 'coin', 'amount', 'credit', 'wallet', 'sc', 'fc', 'gc', 'sweep'];
    return keywords.some(k => lower.includes(k)) ? 0 : 1;
  }

  // Simplifies a captured URL down to origin+pathname (dropping query params, which
  // often carry session tokens/cache-busters) for use as the runtime match pattern.
  function simplifyUrlForMatching(url) {
    try {
      const u = new URL(url, window.location.href);
      return u.origin + u.pathname;
    } catch (e) {
      return url;
    }
  }

  function getValueAtJsonPath(obj, path) {
    const parts = path.match(/[^.\[\]]+/g) || [];
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  // Resolves a single {urlPattern, jsonPath, divideBy} config against the most recent
  // matching capture. Shared by the primary and (optional) secondary value lookups so
  // both go through identical matching/sanity-check logic. `label` only affects the
  // wording of the failure reason, so it's readable when two configs are in play
  // (e.g. "Secondary: ... was not found ...").
  function resolveAPIValue(cfg, label) {
    if (!cfg || !cfg.urlPattern || !cfg.jsonPath) {
      return { ok: false, reason: `No ${label} value source configured.` };
    }

    const sorted = [...apiCaptures].sort((a, b) => b.timestamp - a.timestamp);
    const urlMatches = sorted.filter(c => simplifyUrlForMatching(c.url) === cfg.urlPattern);
    if (urlMatches.length === 0) {
      return {
        ok: false,
        reason: `${label}: no captured response yet matches "${cfg.urlPattern}" (${apiCaptures.length} response(s) captured so far this page load — the buffer resets on every reload). Interact with the site or wait for it to re-fetch, then hit Refresh List.`
      };
    }

    for (const capture of urlMatches) {
      const raw = getValueAtJsonPath(capture.body, cfg.jsonPath);
      if (raw === undefined || raw === null) continue;
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
      if (!Number.isFinite(num)) continue;
      const divideBy = cfg.divideBy || 1;
      const final = divideBy !== 1 ? num / divideBy : num;
      if (final < 0 || final > 2000) {
        return {
          ok: false,
          reason: `${label}: found "${cfg.jsonPath}" = ${num}, but ÷${divideBy} = ${final.toFixed(2)}, which is outside the 0–2000 sanity range so it's being rejected. If ${num} looks like a cents value, re-pick it with "×100 scaled" checked.`
        };
      }
      return { ok: true, value: final, raw: num, url: capture.url };
    }

    return {
      ok: false,
      reason: `${label}: "${cfg.jsonPath}" was not found in the ${urlMatches.length} matching response(s) captured so far. If the path includes an array index like [2], the API may return items in a different order between loads — re-pick the value to refresh it.`
    };
  }

  // Diagnostic version of the API read: reports *why* it couldn't produce a value
  // (no config, no matching URL yet, path not found, or value out of sanity range)
  // instead of just returning ''. Used by both tryCustomAPISelector() (collection path,
  // which only cares about the value) and the API Picker's Test button (which shows the
  // reason to the user).
  //
  // Supports an optional `secondary` config alongside the primary one (e.g. LuckyParty's
  // separate redeemable/non-redeemable SC balances) — when present, both are resolved
  // independently and summed into a single combined value.
  function debugCustomAPISelector() {
    const hostname = window.location.hostname;
    const config = GM_getValue(`customAPIConfig_${hostname}`, null);
    if (!config || !config.urlPattern || !config.jsonPath) {
      return { ok: false, reason: 'No API value source saved for this site yet.' };
    }

    const primary = resolveAPIValue(config, config.secondary ? 'Primary' : 'Value');
    if (!primary.ok) return primary;

    if (config.secondary) {
      const secondary = resolveAPIValue(config.secondary, 'Secondary');
      if (!secondary.ok) return secondary;

      const combined = primary.value + secondary.value;
      if (combined < 0 || combined > 2000) {
        return {
          ok: false,
          reason: `Combined value (${primary.value.toFixed(2)} + ${secondary.value.toFixed(2)} = ${combined.toFixed(2)}) is outside the 0–2000 sanity range.`
        };
      }
      return {
        ok: true,
        value: `$${combined.toFixed(2)}`,
        raw: `${primary.raw} + ${secondary.raw}`,
        url: `${primary.url} + ${secondary.url}`
      };
    }

    return { ok: true, value: `$${primary.value.toFixed(2)}`, raw: primary.raw, url: primary.url };
  }

  // Read the live value for a saved API config. Thin wrapper around
  // debugCustomAPISelector() for the normal (non-diagnostic) collection path.
  function tryCustomAPISelector() {
    const result = debugCustomAPISelector();
    return result.ok ? result.value : '';
  }
  // --- End Network/API Value Capture ---

  // --- Element Picker Utilities ---

  // Generate a robust CSS selector for an element, preferring attribute-contains selectors
  // over exact class names to survive webpack hash changes
  function generateSelector(el) {
    // Try data-test or data-testid first (most stable)
    for (const attr of ['data-test', 'data-testid', 'data-id']) {
      if (el.getAttribute(attr)) {
        return `${el.tagName.toLowerCase()}[${attr}="${el.getAttribute(attr)}"]`;
      }
    }
    // Try id
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }
    // Build a path using tag + nth-of-type, with class-contains hints where useful
    const parts = [];
    let current = el;
    while (current && current !== document.body && parts.length < 5) {
      let seg = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      // Add a stable class fragment if one exists (skip hashed-looking classes)
      const stableClass = Array.from(current.classList || []).find(c =>
        // Keep classes that look semantic (no hex hashes, no random 5+ char suffixes)
        !/^[a-z]+-[a-zA-Z0-9]{5,}$/.test(c) && !/_{2}[a-zA-Z0-9]{6}/.test(c) && c.length > 2
      );
      if (stableClass) {
        seg += `.${CSS.escape(stableClass)}`;
      } else {
        // Use nth-of-type for disambiguation
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

  // Extract SC-like numeric value from an element's text
  function extractSCValue(el) {
    // Get text from element and parent
    const texts = [el.textContent.trim()];
    if (el.parentElement) texts.push(el.parentElement.textContent.trim());

    for (const text of texts) {
      const cleaned = text.replace(/(SC|ST:)\s*/gi, '').replace(/,/g, '').trim();
      const match = cleaned.match(/\$?\s*(\d+(\.\d{1,4})?)/);
      if (match) {
        const val = parseFloat(match[1]);
        if (Number.isFinite(val) && val <= 2000) {
          return `$${val.toFixed(2)}`;
        }
      }
    }
    return '';
  }

  // Try custom selector saved for this site
  function tryCustomSelector() {
    const hostname = window.location.hostname;
    const customKey = `customSCSelector_${hostname}`;
    const customUseParent = `customSCUseParent_${hostname}`;
    const selector = GM_getValue(customKey, '');
    if (!selector) return '';

    try {
      const elements = document.querySelectorAll(selector);
      const useParent = GM_getValue(customUseParent, false);
      for (const el of elements) {
        const textSource = useParent && el.parentElement ? el.parentElement : el;
        const val = extractSCValue(textSource);
        if (val && val !== '$0.00') return val;
      }
    } catch (e) {
      // Invalid selector stored, ignore
    }
    return '';
  }

  // SC balance detection (full siteConfigs)
  function findSCBalance() {
    // Try a saved API value source first (set via the API Picker) — most reliable since
    // it reads the same JSON the page itself received, not scraped DOM text.
    const apiVal = tryCustomAPISelector();
    if (apiVal) return apiVal;

    // Then a custom DOM selector (set via element picker)
    const customVal = tryCustomSelector();
    if (customVal) return customVal;

    try {
      const siteConfigs = {
        'www.playfame.com': {
          // Use attribute-contains selector to survive webpack hash changes
          // Matches any span whose class contains "currencyName"
          selector: 'span[class*="currencyName"]',
          textFilter: /SC\s*/i,
          useParentText: true
        },
        'www.mcluck.com': { selector: 'span[data-test="common-header-sc-value"]', textFilter: /SC\s*/i },
        'www.hellomillions.com': { selector: 'span', textFilter: /^SC\s*\d{1,3}(,\d{3})*(\.\d+)?$/i },
        'www.jackpota.com': { selector: 'span', textFilter: /^SC\s*\d{1,3}(,\d{3})*(\.\d+)?$/i },
        'www.spinblitz.com': { selector: 'span[data-test="sc-balance-value"]', textFilter: /SC\s*/i },
        'www.megabonanza.com': {
          selector: 'span[class*="currencyValue"]',
          textFilter: numericRegex,
          scCheck: (element) => {
            let current = element;
            for (let i = 0; i < 5; i++) {
              if (!current) break;
              const parentText = current.textContent || '';
              const parentHTML = current.innerHTML || '';
              if (/SC|SCOIN|Sweep/i.test(parentText) || /SC|SCOIN|Sweep/i.test(parentHTML)) return true;
              const className = current.className || '';
              if (/sc|sweep/i.test(className)) return true;
              current = current.parentElement;
            }
            return false;
          }
        },
        'play.clubs.poker': {
          selector: 'div.SwitchCurrenciesContainer__currency.active span.value',
          textFilter: numericRegex,
          scCheck: (el) => {
            const parent = el.closest('div.SwitchCurrenciesContainer__currency_balance');
            const moneyType = parent?.querySelector('span.money-type')?.textContent?.trim();
            return moneyType === 'SC';
          }
        },
        'play.clubspoker.com': {
          selector: 'div.SwitchCurrenciesContainer__currency.active span.value',
          textFilter: numericRegex,
          scCheck: (el) => {
            const parent = el.closest('div.SwitchCurrenciesContainer__currency_balance');
            const moneyType = parent?.querySelector('span.money-type')?.textContent?.trim();
            return moneyType === 'SC';
          }
        },
        'crowncoinscasino.com': {
          selector: 'div.balance-panel-balance',
          scCheck: (el) => /SC/i.test(el.closest('div.balance-panel')?.textContent?.trim() || '')
        },
        'www.fortunecoins.com': {
          selector: 'button.FCButtonText div.textDecimals.desktop > span, button.FCButtonText div.textDecimals > span',
          textFilter: numericRegex,
          processValue: (value) => processValue(value, { divideBy100: true })
        },
        'goldtreasurecasino.com': { selector: 'div.MuiBox-root p.MuiTypography-body1 span', textFilter: numericRegex },
        'app.icasino.com': { selector: 'div[data-testid="balance-amount"]', textFilter: numericRegex },
        'luckybird.io': { selector: 'div.usd_color.currency-active span.amount', textFilter: numericRegex, processValue: cleanNumber },
        'modo.us': { selector: 'button[value="SC"] span', textFilter: numericRegex },
        'myprize.us': {
          selector: 'div.active-currency-section span.amount',
          textFilter: numericRegex,
          scCheck: (el) => !!el.closest('div.active-currency-section')?.querySelector('img[alt="SC"]'),
          processValue: cleanNumber
        },
        'sportzino.com': { selector: 'span', textFilter: numericRegex },
        'www.wowvegas.com': { selector: 'div.flex-none', textFilter: numericRegex, processValue: cleanNumber },
        'www.yaycasino.com': {
          selector: 'div.FCButtonItem.active button.FCButtonText div.textDecimals span',
          textFilter: numericRegex,
          scCheck: (element) => !!element.closest('button.FCButtonText')?.querySelector('img[alt="SC"]')
        },
        'www.zulacasino.com': { selector: 'button.FCButtonText div.textDecimals > span', textFilter: numericRegex },
        'sidepot.us': { selector: 'span.chakra-text.css-1kwzn99', textFilter: numericRegex },
        'www.rolla.com': { selector: 'span.select-none.text-neutral-300', textFilter: numericRegex },
        'scrooge.casino': {
          selector: 'p:contains("ST:")',
          textFilter: /ST:.*\d{1,3}(,\d{3})*(\.\d+)?/i,
          processValue: (value) => processValue(String(value).replace(/ST:\s*/i, ''), { divideBy100: true })
        },
        'market.scrooge.casino': {
          selector: 'p:contains("ST:")',
          textFilter: /ST:.*\d{1,3}(,\d{3})*(\.\d+)?/i,
          processValue: (value) => processValue(String(value).replace(/ST:\s*/i, ''), { divideBy100: true })
        },
        'casino.click': { selector: 'p.MuiTypography-body1.css-1gs41m9', textFilter: numericRegex },
        'lobby.chumbacasino.com': { selector: 'span.counter__value', textFilter: numericRegex },
        'play.globalpoker.com': {
          selector: 'span',
          textFilter: numericRegex,
          scCheck: (el) => !!el.previousElementSibling && /SC/i.test(el.previousElementSibling.textContent.trim()),
          processValue: cleanNumber
        },
        'www.goldenheartsgames.com': { selector: 'button#coin-sheet-popout-toggle', textFilter: /SC\s*\d{1,3}(,\d{3})*(\.\d+)?/i },
        'kickr.com': { selector: 'span.currency-toggle__column-amount-value', textFilter: numericRegex },
        'www.legendz.com': { selector: 'div.css-bg3st0.eyrgspp0', textFilter: numericRegex },
        'lonestarcasino.com': { selector: 'span.gct', textFilter: /^SC\s*\d{1,3}(,\d{3})*(\.\d+)?$/i },
        'www.stackrcasino.com': {
          selector: 'span.label.off number-flow-react',
          textFilter: numericRegex,
          processValue: (elOrValue) => {
            try {
              if (typeof elOrValue === 'string') return cleanNumber(elOrValue);
              const data = JSON.parse(elOrValue.getAttribute('data'));
              return parseFloat(data.valueAsString).toFixed(2);
            } catch (e) {
              return cleanNumber(elOrValue.textContent);
            }
          }
        },
        'luckystake.com': {
          selector: 'span',
          textFilter: numericRegex,
          scCheck: (el) => {
            const parent = el.closest('div.balance, div.wallet, div.currency');
            const source = parent?.className || parent?.textContent || '';
            return /balance|wallet|currency/i.test(source);
          }
        },
        'lunalandcasino.com': { selector: 'span#balance-sc-coin', textFilter: numericRegex },
        'www.themoneyfactory.com': { selector: 'div.MuiTab-iconWrapper p.MuiTypography-root', textFilter: /^\d{1,3}(,\d{3})*(\.\d+)?\s*SC$/i },
        'chipnwin.com': { selector: 'p.s12__w500__h18', textFilter: /^\d{1,3}(,\d{3})*(\.\d+)?\s*SC$/i },
        'www.pulsz.com': { selector: 'span[data-test="header-sweepstakes-value"]', textFilter: /SC\s*\d{1,3}(,\d{3})*(\.\d+)?/i },
        'www.pulszbingo.com': { selector: 'span[data-test="header-sweepstakes-value"]', textFilter: /SC\s*\d{1,3}(,\d{3})*(\.\d+)?/i },
        'stake.us': {
          selector: 'span.text-neutral-default[data-ds-text="true"]',
          textFilter: /^\d{1,3}(,\d{3})*\.\d{2}$/,
          scCheck: (el) => hasSCText(el, ['span','div']),
          processValue: cleanNumber
        },
        'play.babacasino.com': { selector: 'span.ng-star-inserted', textFilter: numericRegex },
        'www.jefebet.com': { selector: 'div.coin-info', textFilter: /SC\s*\d{1,3}(,\d{3})*(\.\d+)?/i },
        'moozi.com': { selector: 'span.hidden.md\\:block', textFilter: numericRegex },
        'luckyhands.com': { selector: 'div.c2-b.MuiBox-root', textFilter: /SC\s*\d{1,3}(,\d{3})*(\.\d+)?/i },
        'realprize.com': { selector: 'span.gct', textFilter: numericRegex },
        'www.spinpals.com': {
          selector: 'p.font-bold',
          textFilter: numericRegex,
          scCheck: (element) => {
            let current = element;
            for (let i = 0; i < 5; i++) {
              if (!current) break;
              const parentText = current.textContent || '';
              const parentHTML = current.innerHTML || '';
              if (/SC|SCOIN|Sweep/i.test(parentText) || /SC|SCOIN|Sweep/i.test(parentHTML)) return true;
              const className = current.className || '';
              if (/sc|sweep/i.test(className)) return true;
              current = current.parentElement;
            }
            return false;
          }
        },
        'play.rubysweeps.com': { selector: 'a[data-v-0abc4a6e]', textFilter: numericRegex },
        'spree.com': { selector: 'span.digit__num', textFilter: numericRegex },
        'www.vivaro.us': {
          selector: 'span, div, p',
          textFilter: /SC\s*\d{1,3}(,\d{3})*(\.\d+)?/i,
          scCheck: (el) => hasSCText(el, ['span','div','p'])
        },
        'www.rollingriches.com': {
          selector: 'div.sc-coin.coin-list span',
          textFilter: numericRegex,
          scCheck: (el) => /SC/i.test(el.parentElement?.querySelector('span.coin-amount')?.textContent?.trim() || '')
        }
      };

      const hostname = window.location.hostname;
      const config = siteConfigs[hostname];
      if (!config?.selector) return '';

      const elements = document.querySelectorAll(config.selector);
      for (const element of elements) {
        let fullText = element.textContent.trim();
        if (config.useParentText && element.parentElement) {
          fullText = element.parentElement.textContent.trim();
        }
        if (hostname === 'www.stackrcasino.com' && element.tagName.toLowerCase() === 'number-flow-react') {
          try {
            const data = JSON.parse(element.getAttribute('data'));
            fullText = data.valueAsString;
          } catch {}
        }
        const passesFilter = config.textFilter ? config.textFilter.test(fullText)
          : (config.scCheck ? config.scCheck(element) : true);
        if (!passesFilter) continue;

        const raw = fullText.replace(/(SC|ST:)\s*/i, '').replace(/,/g, '');
        const match = raw.match(/^\d+(\.\d{1,4})?/);
        if (!match) continue;

        const decimalValue = parseFloat(match[0]);
        if (!Number.isFinite(decimalValue)) continue;
        if (decimalValue > 2000) continue;

        let finalValue = decimalValue.toFixed(2);
        if (config.processValue) {
          finalValue = config.processValue(element.tagName.toLowerCase() === 'number-flow-react' ? element : match[0]);
        }
        return `$${finalValue}`;
      }
      return '';
    } catch {
      return '';
    }
  }

  // Poll for SC balance
  function getSCBalanceAsync(maxAttempts = 60, intervalMs = 1000) {
    return new Promise((resolve) => {
      let attempts = 0;
      const tryFind = () => {
        const val = findSCBalance();
        if (val && val !== '$0.00') { resolve(val); return true; }
        attempts++;
        if (attempts >= maxAttempts) { resolve(''); return true; }
        return false;
      };
      if (!tryFind()) {
        const int = setInterval(() => { if (tryFind()) clearInterval(int); }, intervalMs);
      }
    });
  }

  // --- Element Picker ---
  function startElementPicker(scInput, pickerBtn, statusLabel, formContainer) {
    // Hide the form so user can click elements behind it
    if (formContainer) formContainer.style.display = 'none';

    const highlight = document.createElement('div');
    Object.assign(highlight.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '10000001',
      border: '3px solid #ff6600', borderRadius: '4px',
      background: 'rgba(255, 102, 0, 0.15)', display: 'none'
    });
    document.body.appendChild(highlight);

    const tooltip = document.createElement('div');
    Object.assign(tooltip.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '10000002',
      background: '#222', color: '#fff', padding: '6px 10px', borderRadius: '4px',
      fontSize: '12px', fontFamily: 'monospace', maxWidth: '400px',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'none'
    });
    document.body.appendChild(tooltip);

    let active = true;
    if (statusLabel) statusLabel.textContent = 'Click the SC balance element on the page...';

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
      const cls = el.className ? `.${Array.from(el.classList).slice(0, 2).join('.')}` : '';
      tooltip.textContent = `<${tag}${cls}> "${text}"`;
      Object.assign(tooltip.style, {
        display: 'block',
        top: (rect.top - 30) + 'px',
        left: rect.left + 'px'
      });
    };

    const cleanup = () => {
      active = false;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      highlight.remove();
      tooltip.remove();
      // Show the form again
      if (formContainer) formContainer.style.display = '';
      pickerBtn.textContent = '🎯 Pick SC Element';
      pickerBtn.style.background = '#ff9800';
    };

    const onClick = (e) => {
      if (!active) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === highlight || el === tooltip) return;

      // Try extracting value from the clicked element and its parent
      let value = extractSCValue(el);
      let useParent = false;

      if (!value && el.parentElement) {
        value = extractSCValue(el.parentElement);
        // Still generate selector for the clicked element, but flag useParent
        if (value) useParent = true;
      }

      // Generate and save selector
      const selector = generateSelector(el);
      const hostname = window.location.hostname;

      if (value) {
        scInput.value = value;
        GM_setValue(`customSCSelector_${hostname}`, selector);
        GM_setValue(`customSCUseParent_${hostname}`, useParent);
        if (statusLabel) {
          statusLabel.textContent = `✅ Saved! Selector: ${selector}`;
          statusLabel.style.color = '#4CAF50';
        }
      } else {
        // No numeric value found — save selector anyway, let user know
        GM_setValue(`customSCSelector_${hostname}`, selector);
        GM_setValue(`customSCUseParent_${hostname}`, false);
        if (statusLabel) {
          statusLabel.textContent = `⚠️ Saved selector but couldn't extract value. Selector: ${selector}`;
          statusLabel.style.color = '#ff9800';
        }
      }

      cleanup();
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        if (statusLabel) {
          statusLabel.textContent = 'Pick cancelled.';
          statusLabel.style.color = '#999';
        }
      }
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);

    // If user clicks the button again to cancel
    pickerBtn._cancelPick = () => {
      cleanup();
      if (statusLabel) {
        statusLabel.textContent = 'Pick cancelled.';
        statusLabel.style.color = '#999';
      }
    };
  }

  // --- API Value Picker (network capture based) ---
  // Separate popup from the main submit form — doesn't touch it. Lets you pick a value
  // straight out of a captured JSON API response instead of a DOM element.
  //
  // Supports picking TWO values that get summed into one total — e.g. LuckyParty exposes
  // redeemable and non-redeemable SC as separate fields; pick the primary one normally,
  // then check "add a second value" and pick the other one. Both are saved under the same
  // per-hostname config and combined live by debugCustomAPISelector().
  function openAPIPickerModal() {
    const hostname = window.location.hostname;
    const container = document.createElement('div');
    const shadow = container.attachShadow({ mode: 'open' });
    Object.assign(container.style, {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      zIndex: '1000001', maxWidth: '480px', width: '90vw'
    });

    const style = document.createElement('style');
    style.textContent = `
      .api-modal { all: initial; font: 13px/1.4 Arial, Helvetica, sans-serif;
        background:#fff; padding:16px; border:2px solid #000; border-radius:8px;
        box-shadow:0 4px 8px rgba(0,0,0,0.2); color:#000; display:block;
        box-sizing:border-box; max-height:80vh; overflow-y:auto; }
      .api-modal * { box-sizing:border-box; font: inherit; }
      .api-modal h3 { margin:0 0 8px; font-size:15px; }
      .api-status { font-size:12px; color:#666; margin-bottom:10px; }
      .api-current { font-size:11px; color:#2196F3; margin-bottom:8px; word-break:break-all; white-space:pre-line; }
      .api-hint { font-size:11px; color:#888; margin-bottom:10px; }
      .api-divide-row, .api-secondary-row { display:flex; align-items:center; gap:6px; font-size:12px; margin-bottom:10px; }
      .api-secondary-row { background:#f3e5f5; padding:6px 8px; border-radius:4px; }
      .api-search { width:100%; padding:6px; margin-bottom:10px; border:1px solid #ccc; }
      .api-capture { border:1px solid #e5e7eb; border-radius:6px; padding:8px; margin-bottom:8px; }
      .api-capture-url { font-family:monospace; font-size:10px; color:#666; word-break:break-all; margin-bottom:6px; }
      .api-candidates { display:flex; flex-wrap:wrap; gap:4px; }
      .api-candidate-btn { font-size:11px; padding:3px 8px; border:1px solid #2196F3; background:#e3f2fd; color:#0d47a1; border-radius:4px; cursor:pointer; }
      .api-candidate-btn:hover { background:#2196F3; color:#fff; }
      .api-candidate-btn.secondary-mode { border-color:#9c27b0; background:#f3e5f5; color:#4a148c; }
      .api-candidate-btn.secondary-mode:hover { background:#9c27b0; color:#fff; }
      .api-empty { font-size:12px; color:#999; padding:10px 0; }
      .api-btn-row { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }
      .api-btn { flex:1; padding:8px; border:none; border-radius:4px; cursor:pointer; color:#fff; font-size:12px; min-width:70px; }
    `;
    shadow.appendChild(style);

    const modal = document.createElement('div');
    modal.className = 'api-modal';

    const title = document.createElement('h3');
    title.textContent = '📡 API Value Picker';
    modal.appendChild(title);

    const hint = document.createElement('div');
    hint.className = 'api-hint';
    hint.textContent = 'Pick a primary value below. If a site splits the balance into two numbers (e.g. redeemable + non-redeemable SC), check "add a second value" and pick the other one — they\'ll be summed automatically.';
    modal.appendChild(hint);

    let currentInfo = null;

    const status = document.createElement('div');
    status.className = 'api-status';

    function updateCurrentInfo() {
      const cfg = GM_getValue(`customAPIConfig_${hostname}`, null);
      if (!cfg || !cfg.urlPattern) {
        if (currentInfo) { currentInfo.remove(); currentInfo = null; }
        clearSecondaryBtn.style.display = 'none';
        return;
      }
      let text = `📌 Primary: ${cfg.jsonPath} (÷${cfg.divideBy || 1}) from ${cfg.urlPattern}`;
      if (cfg.secondary) {
        text += `\n➕ Secondary: ${cfg.secondary.jsonPath} (÷${cfg.secondary.divideBy || 1}) from ${cfg.secondary.urlPattern}`;
      }
      if (!currentInfo) {
        currentInfo = document.createElement('div');
        currentInfo.className = 'api-current';
        modal.insertBefore(currentInfo, status);
      }
      currentInfo.textContent = text;
      clearSecondaryBtn.style.display = cfg.secondary ? '' : 'none';
    }

    modal.appendChild(status);

    const divideRow = document.createElement('label');
    divideRow.className = 'api-divide-row';
    const divideCheckbox = document.createElement('input');
    divideCheckbox.type = 'checkbox';
    divideRow.appendChild(divideCheckbox);
    divideRow.appendChild(document.createTextNode('Value is ×100 scaled (e.g. 6910 means $69.10)'));
    modal.appendChild(divideRow);

    const secondaryRow = document.createElement('label');
    secondaryRow.className = 'api-secondary-row';
    const secondaryCheckbox = document.createElement('input');
    secondaryCheckbox.type = 'checkbox';
    secondaryRow.appendChild(secondaryCheckbox);
    secondaryRow.appendChild(document.createTextNode('➕ This pick is a SECOND value to add to the primary (e.g. non-redeemable SC)'));
    modal.appendChild(secondaryRow);

    // Keep the ×100 checkbox in sync with whichever config (primary/secondary) is
    // currently targeted via the secondary toggle, and live-update an already-saved
    // entry immediately so checking/unchecking doesn't silently do nothing until the
    // next pick.
    divideCheckbox.addEventListener('change', () => {
      const cfg = GM_getValue(`customAPIConfig_${hostname}`, null);
      if (!cfg) return;
      const target = secondaryCheckbox.checked ? cfg.secondary : cfg;
      if (!target || !target.jsonPath) return;
      target.divideBy = divideCheckbox.checked ? 100 : 1;
      GM_setValue(`customAPIConfig_${hostname}`, cfg);
      updateCurrentInfo();
      status.textContent = `Updated "${target.jsonPath}" to ÷${target.divideBy}. Click Test to verify.`;
      status.style.color = '#2196F3';
    });

    secondaryCheckbox.addEventListener('change', () => {
      const cfg = GM_getValue(`customAPIConfig_${hostname}`, null);
      // Reflect whichever entry's divide setting is active, for editing convenience
      const target = secondaryCheckbox.checked ? (cfg && cfg.secondary) : cfg;
      divideCheckbox.checked = !!(target && target.divideBy === 100);
      render(searchInput.value);
    });

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'api-search';
    searchInput.placeholder = 'Filter by value or field name...';
    modal.appendChild(searchInput);

    const list = document.createElement('div');
    modal.appendChild(list);

    function saveSelection(capture, candidate) {
      const cfg = GM_getValue(`customAPIConfig_${hostname}`, null) || {};
      const entry = {
        urlPattern: simplifyUrlForMatching(capture.url),
        jsonPath: candidate.path,
        divideBy: divideCheckbox.checked ? 100 : 1,
        lastValue: candidate.value
      };

      if (secondaryCheckbox.checked) {
        if (!cfg.urlPattern || !cfg.jsonPath) {
          status.textContent = '⚠️ Pick a primary value first (uncheck the box above), then come back and add the secondary value.';
          status.style.color = '#f44336';
          return;
        }
        cfg.secondary = entry;
        GM_setValue(`customAPIConfig_${hostname}`, cfg);
        status.textContent = `✅ Saved secondary! Reading "${candidate.path}" from ${entry.urlPattern} — will be added to the primary value.`;
      } else {
        cfg.urlPattern = entry.urlPattern;
        cfg.jsonPath = entry.jsonPath;
        cfg.divideBy = entry.divideBy;
        cfg.lastValue = entry.lastValue;
        GM_setValue(`customAPIConfig_${hostname}`, cfg);
        status.textContent = `✅ Saved primary! Reading "${candidate.path}" from ${entry.urlPattern}`;
      }
      status.style.color = '#4CAF50';
      updateCurrentInfo();
    }

    function render(term) {
      const byUrl = new Map();
      for (const c of apiCaptures) byUrl.set(c.url, c);
      const captures = [...byUrl.values()].sort((a, b) => b.timestamp - a.timestamp);

      const withCandidates = captures
        .map(c => ({ ...c, candidates: scanForNumericFields(c.body).sort((a, b) => candidateRelevanceScore(a.path) - candidateRelevanceScore(b.path)) }))
        .filter(c => c.candidates.length > 0);

      const lower = term.trim().toLowerCase();
      const filtered = lower
        ? withCandidates
            .map(c => ({ ...c, candidates: c.candidates.filter(cand =>
              cand.path.toLowerCase().includes(lower) ||
              String(cand.value).includes(lower) ||
              cand.value.toLocaleString().toLowerCase().includes(lower)
            ) }))
            .filter(c => c.candidates.length > 0)
        : withCandidates;

      list.innerHTML = '';
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'api-empty';
        empty.textContent = lower ? 'No matches.' : 'Nothing captured yet.';
        list.appendChild(empty);
        return;
      }

      filtered.forEach((c) => {
        const captureEl = document.createElement('div');
        captureEl.className = 'api-capture';
        const urlEl = document.createElement('div');
        urlEl.className = 'api-capture-url';
        urlEl.textContent = `${c.method} ${c.url}`;
        captureEl.appendChild(urlEl);

        const candWrap = document.createElement('div');
        candWrap.className = 'api-candidates';
        c.candidates.slice(0, 30).forEach((cand) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'api-candidate-btn' + (secondaryCheckbox.checked ? ' secondary-mode' : '');
          btn.title = cand.path;
          const shortPath = cand.path.length > 28 ? '…' + cand.path.slice(-26) : cand.path;
          btn.textContent = `${shortPath}: ${cand.value.toLocaleString()}`;
          btn.onclick = () => saveSelection(c, cand);
          candWrap.appendChild(btn);
        });
        captureEl.appendChild(candWrap);
        list.appendChild(captureEl);
      });
    }

    searchInput.addEventListener('input', () => render(searchInput.value));

    const btnRow = document.createElement('div');
    btnRow.className = 'api-btn-row';

    const rescanBtn = document.createElement('button');
    rescanBtn.type = 'button';
    rescanBtn.className = 'api-btn';
    rescanBtn.style.background = '#ff9800';
    rescanBtn.textContent = '🔄 Refresh List';
    rescanBtn.onclick = () => {
      status.textContent = apiCaptures.length
        ? `Captured ${apiCaptures.length} JSON response(s) since page load.`
        : 'Still nothing captured. Try interacting with the site or reloading the page.';
      status.style.color = '#666';
      render(searchInput.value);
    };
    btnRow.appendChild(rescanBtn);

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'api-btn';
    testBtn.style.background = '#009688';
    testBtn.textContent = '🧪 Test';
    testBtn.onclick = () => {
      const result = debugCustomAPISelector();
      status.textContent = result.ok
        ? `✅ Live value: ${result.value} (raw ${result.raw})`
        : `❌ ${result.reason}`;
      status.style.color = result.ok ? '#4CAF50' : '#f44336';
    };
    btnRow.appendChild(testBtn);

    const clearSecondaryBtn = document.createElement('button');
    clearSecondaryBtn.type = 'button';
    clearSecondaryBtn.className = 'api-btn';
    clearSecondaryBtn.style.background = '#ab47bc';
    clearSecondaryBtn.textContent = '🗑 Clear Secondary';
    clearSecondaryBtn.style.display = 'none';
    clearSecondaryBtn.onclick = () => {
      const cfg = GM_getValue(`customAPIConfig_${hostname}`, null);
      if (cfg) {
        delete cfg.secondary;
        GM_setValue(`customAPIConfig_${hostname}`, cfg);
      }
      status.textContent = 'Secondary value cleared. Now reading the primary value only.';
      status.style.color = '#f44336';
      updateCurrentInfo();
    };
    btnRow.appendChild(clearSecondaryBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'api-btn';
    clearBtn.style.background = '#9e9e9e';
    clearBtn.textContent = '🗑 Clear All';
    clearBtn.onclick = () => {
      GM_deleteValue(`customAPIConfig_${hostname}`);
      status.textContent = 'API selector cleared. Will fall back to element picker / built-in detection.';
      status.style.color = '#f44336';
      updateCurrentInfo();
    };
    btnRow.appendChild(clearBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'api-btn';
    closeBtn.style.background = '#f44336';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => { document.body.removeChild(container); };
    btnRow.appendChild(closeBtn);

    modal.appendChild(btnRow);
    shadow.appendChild(modal);
    document.body.appendChild(container);

    // Initial paint
    updateCurrentInfo();
    status.textContent = apiCaptures.length
      ? `Captured ${apiCaptures.length} JSON response(s) since page load. Click a value below to use it.`
      : 'No JSON responses captured yet. Interact with the site (open your balance/wallet), then click Refresh List.';
    render('');
  }
  // --- End API Value Picker ---

  // Form creation (Shadow DOM, minimal CSS)
  function createForm() {
    const container = document.createElement('div');
    const shadow = container.attachShadow({ mode: 'open' });
    Object.assign(container.style, {
      position:'fixed', top:'50%', left:'50%', transform:'translate(-50%, -50%)',
      zIndex:'1000000', maxWidth:'420px'
    });

    const style = document.createElement('style');
    style.textContent = `
      .form-container { all: initial; font: 14px/1.4 Arial, Helvetica, sans-serif;
        background:#fff; padding:20px; border:2px solid #000;
        border-radius:8px; box-shadow:0 4px 8px rgba(0,0,0,0.2); color:#000;
        display:block; box-sizing:border-box; }
      .form-container * { box-sizing:border-box; font: inherit; }
      label { display:block; margin-bottom:10px; }
      input, select { width:100%; margin-bottom:15px; border:1px solid #000; padding:5px; }
      input[readonly]{ background:#f0f0f0; cursor:not-allowed; }
      .submit-button { width:100%; padding:10px; background:#4CAF50; color:#fff; border:none; border-radius:4px; cursor:pointer; }
      .close-button { width:100%; padding:10px; margin-top:10px; background:#f44336; color:#fff; border:none; border-radius:4px; cursor:pointer; }
      .picker-button { width:100%; padding:8px; margin-bottom:8px; background:#ff9800; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:13px; }
      .picker-button:hover { background:#e68a00; }
      .clear-custom-button { width:100%; padding:6px; margin-bottom:10px; background:#9e9e9e; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px; }
      .clear-custom-button:hover { background:#757575; }
      .picker-status { font-size:11px; color:#666; margin-bottom:10px; word-break:break-all; display:block; min-height:16px; }
      .custom-selector-info { font-size:11px; color:#2196F3; margin-bottom:8px; word-break:break-all; display:block; }
    `;
    shadow.appendChild(style);

    const formContainer = document.createElement('div');
    formContainer.className = 'form-container';
    const form = document.createElement('form');

    const makeField = (labelText, value='', readOnly=false, placeholder='') => {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'text'; input.value = value; input.readOnly = readOnly;
      if (placeholder) input.placeholder = placeholder;
      form.appendChild(label); form.appendChild(input);
      return input;
    };

    const casinoInput = makeField('Casino*:', window.location.hostname);
    const ownerInput = makeField('Owner*:', defaultOwner);
    const scInput = makeField('Current SC Amount:', '', false, 'Enter Current SC Amount');
    getSCBalanceAsync().then(val => { if (val) scInput.value = val; });
    makeField('Last Submitted SC Amount:', GM_getValue(`lastSC_${window.location.hostname}`, 'N/A'), true);
    makeField('Last Submission Timestamp:', GM_getValue(`lastSubmitTime_${window.location.hostname}`, 'N/A'), true);

    // --- Element Picker UI ---
    const hostname = window.location.hostname;
    const savedSelector = GM_getValue(`customSCSelector_${hostname}`, '');

    if (savedSelector) {
      const customInfo = document.createElement('span');
      customInfo.className = 'custom-selector-info';
      customInfo.textContent = `📌 Custom selector: ${savedSelector}`;
      form.appendChild(customInfo);
    }

    const pickerStatus = document.createElement('span');
    pickerStatus.className = 'picker-status';
    form.appendChild(pickerStatus);

    const pickerBtn = document.createElement('button');
    pickerBtn.type = 'button';
    pickerBtn.textContent = '🎯 Pick SC Element';
    pickerBtn.className = 'picker-button';
    let picking = false;
    pickerBtn.onclick = () => {
      if (picking && pickerBtn._cancelPick) {
        pickerBtn._cancelPick();
        picking = false;
        return;
      }
      picking = true;
      startElementPicker(scInput, pickerBtn, pickerStatus, container);
    };
    form.appendChild(pickerBtn);

    if (savedSelector) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = '🗑 Clear Custom Selector';
      clearBtn.className = 'clear-custom-button';
      clearBtn.onclick = () => {
        GM_deleteValue(`customSCSelector_${hostname}`);
        GM_deleteValue(`customSCUseParent_${hostname}`);
        pickerStatus.textContent = 'Custom selector cleared. Will use built-in detection.';
        pickerStatus.style.color = '#f44336';
        clearBtn.remove();
      };
      form.appendChild(clearBtn);
    }

    // --- End Element Picker UI ---

    const actionLabel = document.createElement('label');
    actionLabel.textContent = 'Purchase or Redeem:';
    const actionSelect = document.createElement('select');
    ['', 'Purchase', 'Redeem'].forEach(opt => actionSelect.add(new Option(opt || 'Choose', opt)));
    form.appendChild(actionLabel); form.appendChild(actionSelect);

    const amountInput = makeField('Amount:', '', false, 'Enter Amount');
    // Only default to 'Purchase' if nothing has been chosen yet — don't clobber an explicit 'Redeem' selection.
    amountInput.onclick = () => { if (!actionSelect.value) actionSelect.value = 'Purchase'; };

    const submitButton = document.createElement('button');
    submitButton.type = 'submit'; submitButton.textContent = 'Submit'; submitButton.className = 'submit-button';
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close'; closeButton.className = 'close-button';

    form.appendChild(submitButton); form.appendChild(closeButton);
    formContainer.appendChild(form); shadow.appendChild(formContainer);
    document.body.appendChild(container);

    form.onsubmit = (e) => {
      e.preventDefault();
      if (!casinoInput.value.trim() || !ownerInput.value.trim()) {
        alert('Casino and Owner fields are required.'); return;
      }
      const casinoVal = casinoInput.value.trim();
      const hostnameVal = window.location.hostname;
      const scVal = scInput.value.trim();
      const formData = new URLSearchParams({
        'casino': casinoVal,
        'owner': ownerInput.value.trim(),
        'sc': scVal,
        'action': actionSelect.value,
        'amount': amountInput.value.trim()
      });
      // Close immediately — don't make the user wait on the network round trip to the
      // Apps Script Web App (which does several sequential Sheets reads/writes per
      // Purchase/Redeem submission and can take a few seconds). The POST still completes
      // in the background; a failure still surfaces via alert() even though the form
      // has already closed.
      document.body.removeChild(container);
      GM_xmlhttpRequest({
        method:'POST',
        url:'https://script.google.com/macros/s/AKfycbwNp9fJ0OmF3ywcCsv3l1qFeEWagk3TbTW0ih9idbC-pIPSDxuLF8d4Au5dry1oh-hV/exec',
        data: formData.toString(),
        headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
        onload:(response)=>{
          const success = response.status === 200 && /OK/.test(response.responseText || '');
          if (success) {
            GM_setValue(`lastSC_${hostnameVal}`, scVal);
            GM_setValue(`lastSubmitTime_${hostnameVal}`, new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
          } else {
            alert(`Error submitting form for ${casinoVal}. Status: ${response.status}`);
          }
        },
        onerror:()=>{ alert(`Network error submitting form for ${casinoVal}.`); }
      });
    };
    closeButton.onclick = () => { document.body.removeChild(container); };
  }

  // Trigger buttons (bottom-right)
  function createTriggerButtons() {
    const buttonContainer = document.createElement('div');
    Object.assign(buttonContainer.style, {
      position:'fixed', bottom:'10px', right:'10px', zIndex:'1000000', display:'flex', gap:'5px'
    });
    const triggerButton = document.createElement('button');
    triggerButton.textContent = 'Open Casino Form';
    Object.assign(triggerButton.style, { padding:'10px', background:'#2196F3', color:'#fff', border:'none', borderRadius:'4px', cursor:'pointer' });
    triggerButton.onclick = createForm;
    const apiPickerButton = document.createElement('button');
    apiPickerButton.textContent = '📡 API Picker';
    Object.assign(apiPickerButton.style, { padding:'10px', background:'#9c27b0', color:'#fff', border:'none', borderRadius:'4px', cursor:'pointer' });
    apiPickerButton.onclick = openAPIPickerModal;
    const closeXButton = document.createElement('button');
    closeXButton.textContent = 'X';
    Object.assign(closeXButton.style, { padding:'5px 8px', background:'#f44336', color:'#fff', border:'none', borderRadius:'4px', cursor:'pointer' });
    closeXButton.onclick = () => { document.body.removeChild(buttonContainer); };
    buttonContainer.appendChild(triggerButton); buttonContainer.appendChild(apiPickerButton); buttonContainer.appendChild(closeXButton);
    document.body.appendChild(buttonContainer);
  }

  // Auto-submission (SC-only)
  function tryAutoSubmit() {
    const hostname = window.location.hostname;
    if (noAutoSubmitSites.includes(hostname)) return;
    const baseDelay = 10000;
    const extraDelay = extraDelays[hostname] || 0;
    const totalDelay = baseDelay + extraDelay;
    setTimeout(() => {
      getSCBalanceAsync().then(sc => {
        if (sc && scCurrencyRegexDisplay.test(sc) && sc !== '$0.00') {
          const numericValue = parseFloat(sc.replace('$','').replace(/,/g,''));
          if (numericValue > 2000) return;
          const lastSC = GM_getValue(`lastSC_${hostname}`, '');
          if (sc === lastSC) return; // unchanged since last recorded value for this casino — skip, don't log a duplicate row
          const payload = new URLSearchParams({
            'casino': hostname,
            'owner': defaultOwner,
            'sc': sc,
            'action': '',
            'amount': ''
          }).toString();
          GM_xmlhttpRequest({
            method:'POST',
            url:'https://script.google.com/macros/s/AKfycbwNp9fJ0OmF3ywcCsv3l1qFeEWagk3TbTW0ih9idbC-pIPSDxuLF8d4Au5dry1oh-hV/exec',
            data: payload,
            headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
            onload:(response)=>{
              const success = response.status === 200 && /OK/.test(response.responseText || '');
              if (success) {
                GM_setValue(`lastSC_${hostname}`, sc);
                GM_setValue(`lastSubmitTime_${hostname}`, new Date().toLocaleString('en-US',{timeZone:'America/New_York'}));
              }
            }
          });
        }
      });
    }, totalDelay);
  }

  // Boot
  function runScript() {
    if (!document.body) { setTimeout(runScript, 500); return; }
    createTriggerButtons();
    tryAutoSubmit();

    // Hotkey: Shift+Alt+F to open the casino form
    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
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
