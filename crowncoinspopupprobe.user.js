// ==UserScript==
// @name         CrownCoins Popup Probe
// @namespace    sandibalz
// @version      0.1.1
// @description  v0.1.1 (10/6/26): a wrapper div filled by an iframe (Crown Jackpot div._cover_ around the minigames frame) now hands the close to the probe copy running inside that frame (X click there), and the frame reply lists its buttons; eventTrigger purchase offer + Jackpot named correctly. v0.1.0: Test harness for the Collector-App CrownCoinsCasino profile. Watches/logs every popup/overlay (log-only by default). "Run Test": settle + popup sweeps -> read GC+SC (flip CC/SC and back) -> hamburger > Rewards > Daily Bonus tile -> CLOSES the Daily Bonus popup WITHOUT claiming (never clicks the canvas or anything containing it) -> read GC+SC again. Each close tries X button, Escape, backdrop click and records which worked. Leave Auto-run/Auto-close OFF during real Collector-App runs so the two don't race.
// @match        https://crowncoinscasino.com/*
// @match        https://*.crowncoinscasino.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/crowncoinspopupprobe.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/crowncoinspopupprobe.user.js
// ==/UserScript==
// NOTE: the Crown Jackpot popup lives in IFRAME[data="metagames-warm-frame"]. If the log says that frame is
// cross-origin with "no probe inside", add an @match line for the host it prints, so this script also runs in it.

(function () {
  'use strict';
  const VERSION = '0.1.1';
  const IS_TOP = window.top === window;

  const SEL = {
    balance: '#gc_balance #balance',
    switcher: '[data-testid="coin-switcher"]',
    menu: '[data-testid="menuButton"]',
    menuItem: '.side-menu__action',
    dailyTile: '[data-testid="rewards-view-daily-bonus-btn"]',
    dailyCanvas: '[class*="_portal_"] [class*="_content_"] canvas',
    appAnchors: ['#gc_balance', '[data-testid="menuButton"]'],
  };
  const OVERLAY_RE = /modal|popup|pop-up|dialog|overlay|backdrop|portal|offer|jackpot|lightbox|drawer|animation|metagames/i;
  const CLOSE_TEXT_RE = /^(×|✕|✖|x|close|no thanks|not now|later|maybe later|skip|dismiss)$/i;
  const CLOSE_LABEL_RE = /close|dismiss|cross|exit|\bx\b|cancel/i;
  const DANGER_RE = /claim|collect|buy|purchase|deposit|redeem|spin|play|opt.?in|join|bet|wager|get coins/i;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const cls = el => (el && typeof el.className === 'string') ? el.className : (el && el.getAttribute && el.getAttribute('class')) || '';
  const isOurs = el => !!(el && el.closest && el.closest('#ccprobe-host'));
  const hasCanvas = el => !!(el && (el.tagName === 'CANVAS' || (el.querySelector && el.querySelector('canvas'))));

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
  }

  // Stable selector: #id, data-testid/data attr, or hashed CSS-module classes as [class*="_name_"]
  function stableSel(el) {
    if (!el || !el.tagName) return '?';
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    const tid = el.getAttribute('data-testid');
    if (tid) return `${tag}[data-testid="${tid}"]`;
    const al = el.getAttribute('aria-label');
    if (al) return `${tag}[aria-label="${al}"]`;
    const data = el.getAttribute('data');
    const parts = cls(el).split(/\s+/).filter(Boolean).slice(0, 2).map(c => {
      const m = c.match(/^(_?[A-Za-z][A-Za-z0-9]*)_[a-z0-9]{4,6}_\d+$/);
      return m ? `[class*="${m[1]}_"]` : `.${c}`;
    });
    return tag + parts.join('') + (data ? `[data="${data}"]` : '');
  }

  function knownName(n) {
    const innerFr = n.querySelector && n.querySelector('iframe');
    const c = cls(n) + ' ' + n.id + ' ' + (n.getAttribute && (n.getAttribute('data') || '')) + ' ' + (n.src || '') +
      ' ' + (innerFr ? (innerFr.getAttribute('data') || '') + ' ' + (innerFr.src || '') : '');
    if (/eventTrigger/i.test(c)) return 'Purchase offer (eventTrigger)';
    if (/metagames|minigames|jackpot/i.test(c)) return 'Crown Jackpot / metagames iframe';
    if (hasCanvas(n) && /_portal_|_content_/.test(c + ' ' + (n.innerHTML || '').slice(0, 300))) return 'Daily Bonus popup (canvas - tapping it CLAIMS)';
    if (hasCanvas(n)) return 'Canvas popup (maybe Daily Bonus)';
    if (/metagames|jackpot/i.test(c)) return 'Crown Jackpot / metagames iframe';
    if (/offerBgImage|offer/i.test(c) || (n.querySelector && n.querySelector('img.offerBgImage,[class*="offer"]'))) return 'Offer popup';
    if (/claimRewardsAnimation/i.test(c)) return 'Claim-rewards animation';
    if (n.tagName === 'IFRAME') return 'Iframe overlay';
    return 'Unknown overlay';
  }

  function describe(n) {
    const r = n.getBoundingClientRect();
    let iframeSrc = '';
    const fr = n.tagName === 'IFRAME' ? n : (n.querySelector && n.querySelector('iframe'));
    if (fr) iframeSrc = (fr.src || '').replace(/[?#].*$/, '');
    return {
      name: knownName(n),
      sel: stableSel(n),
      text: (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90),
      rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      iframe: iframeSrc,
    };
  }

  // Elements actually on top of the page (hit-tested on a 5x5 grid), excluding the app shell
  function findOverlays(doc = document, frameMode = false) {
    const vw = doc.defaultView.innerWidth, vh = doc.defaultView.innerHeight, area = vw * vh;
    const anchors = frameMode ? [] : SEL.appAnchors.map(s => doc.querySelector(s)).filter(Boolean);
    const found = new Set();
    for (let ix = 1; ix <= 5; ix++) for (let iy = 1; iy <= 5; iy++) {
      const hit = doc.elementFromPoint(vw * ix / 6, vh * iy / 6);
      if (!hit || isOurs(hit)) continue;
      let best = null;
      for (let n = hit; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
        if (anchors.some(a => n.contains(a))) break;
        const cs = getComputedStyle(n), r = n.getBoundingClientRect(), a = r.width * r.height;
        const flagged = OVERLAY_RE.test(cls(n) + ' ' + n.id + ' ' + (n.getAttribute('data') || '')) ||
          n.getAttribute('role') === 'dialog' || n.getAttribute('aria-modal') === 'true';
        const pos = cs.position === 'fixed' || cs.position === 'absolute';
        if ((flagged && pos && a >= area * 0.08) ||
            (n.tagName === 'IFRAME' && a >= area * 0.6) ||
            (cs.position === 'fixed' && a >= area * 0.6 && (parseInt(cs.zIndex, 10) || 0) >= 10)) best = n;
      }
      if (frameMode && !best && hit !== doc.body && hit !== doc.documentElement) {
        // inside the metagames frame: take the outermost fixed/absolute ancestor of whatever is clickable
        for (let n = hit; n && n !== doc.body; n = n.parentElement) {
          const p = getComputedStyle(n).position;
          if (p === 'fixed' || p === 'absolute') best = n;
        }
      }
      if (best) found.add(best);
    }
    const list = [...found];
    return list.filter(a => !list.some(b => b !== a && b.contains(a)));
  }

  function isHit(n) {
    const doc = n.ownerDocument, vw = doc.defaultView.innerWidth, vh = doc.defaultView.innerHeight;
    for (let ix = 1; ix <= 5; ix++) for (let iy = 1; iy <= 5; iy++) {
      const h = doc.elementFromPoint(vw * ix / 6, vh * iy / 6);
      if (h && (h === n || n.contains(h))) return true;
    }
    return false;
  }

  function closeCandidates(root) {
    const rr = root.getBoundingClientRect();
    const out = [];
    for (const el of root.querySelectorAll('button,[role="button"],a,svg,img,div,span,i')) {
      if (isOurs(el) || hasCanvas(el) || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 90 || r.height > 90 || r.width < 6 || r.height < 6) continue;
      const txt = (el.innerText || el.textContent || '').trim();
      const label = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt'),
        el.id, cls(el), el.getAttribute('data-testid')].filter(Boolean).join(' ');
      if (DANGER_RE.test(txt) || DANGER_RE.test(label)) continue;
      let score = 0;
      if (CLOSE_LABEL_RE.test(label)) score += 3;
      if (CLOSE_TEXT_RE.test(txt)) score += 3;
      const corner = r.left > rr.left + rr.width * 0.65 && r.top < rr.top + rr.height * 0.3;
      const iconBtn = !txt && (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
      if (corner && iconBtn) score += 3; else if (corner && score) score += 1;
      if (score >= 3) out.push({ el, score });
    }
    // prefer the clickable ancestor over its inner svg/span
    const els = out.map(o => o.el);
    return out.filter(o => !els.some(p => p !== o.el && p.contains(o.el) && /BUTTON|A/.test(p.tagName)))
      .sort((a, b) => b.score - a.score).slice(0, 3).map(o => o.el);
  }

  function fire(el, x, y) {
    if (hasCanvas(el)) return false; // safety: never click the canvas or anything containing it (= claim)
    const win = el.ownerDocument.defaultView;
    if (x == null) { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: win, button: 0 };
    el.dispatchEvent(new win.PointerEvent('pointerdown', { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new win.MouseEvent('mousedown', o));
    el.dispatchEvent(new win.PointerEvent('pointerup', { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new win.MouseEvent('mouseup', o));
    el.dispatchEvent(new win.MouseEvent('click', o));
    return true;
  }

  function pressEscape(doc = document) {
    const win = doc.defaultView;
    for (const t of [doc.activeElement || doc.body, doc]) {
      for (const type of ['keydown', 'keyup']) {
        t.dispatchEvent(new win.KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      }
    }
  }

  // A point on the overlay's dark area (not on its content, not on a canvas, not on a button)
  function backdropPoint(n, content) {
    const r = n.getBoundingClientRect(), doc = n.ownerDocument;
    if (!content) {
      let bestA = 0;
      for (const c of n.querySelectorAll('*')) {
        const cr = c.getBoundingClientRect(), a = cr.width * cr.height;
        if (a > bestA && a < r.width * r.height * 0.85 && (c.innerText || '').trim()) { bestA = a; content = c; }
      }
    }
    const pts = [[r.left + 25, r.top + r.height / 2], [r.right - 25, r.top + r.height / 2],
      [r.left + r.width / 2, r.top + 25], [r.left + r.width / 2, r.bottom - 25], [150, 430]];
    for (const [x, y] of pts) {
      const h = doc.elementFromPoint(x, y);
      if (!h || isOurs(h) || !(h === n || n.contains(h))) continue;
      if (hasCanvas(h) || (content && content.contains(h))) continue;
      if (h.closest('button,a,[role="button"]')) continue;
      return { x: Math.round(x), y: Math.round(y), el: h };
    }
    return null;
  }

  /* ---------------- frame side (metagames iframe) ---------------- */
  if (!IS_TOP) {
    window.addEventListener('message', async e => {
      const d = e.data;
      if (!d || d.ccprobe !== 'close') return;
      const ovs = findOverlays(document, true);
      const reply = { ccprobeReply: d.id, host: location.host, overlays: ovs.map(describe), ok: false, how: '', tried: [],
        buttons: [...document.querySelectorAll('button,[role="button"]')].filter(visible).slice(0, 12)
          .map(b => `${stableSel(b)} "${(b.innerText || '').trim().slice(0, 20)}"`) };
      const roots = ovs.length ? ovs : [document.body];
      for (const root of roots) {
        for (const c of closeCandidates(root)) {
          reply.tried.push('X ' + stableSel(c));
          fire(c); await sleep(1200);
          if (!root.isConnected || !visible(root) || !isHit(root)) { reply.ok = true; reply.how = 'X button in frame: ' + stableSel(c); break; }
        }
        if (reply.ok) break;
      }
      if (!reply.ok) {
        reply.tried.push('Escape'); pressEscape(document); await sleep(1000);
        if (roots.every(r => !r.isConnected || !visible(r) || !isHit(r))) { reply.ok = true; reply.how = 'Escape in frame'; }
      }
      e.source.postMessage(reply, '*');
    });
    return;
  }

  /* ---------------- top page ---------------- */
  const T0 = Date.now();
  const session = { start: new Date().toLocaleString(), vp: `${innerWidth}x${innerHeight} @${devicePixelRatio}x`, entries: [] };
  const stats = new Map(); // sel -> {name, seen, ok:{how:count}, fail}
  let busy = false;
  const S = (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } };
  const SET = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* ignore */ } };

  let saveT = null;
  function saveSession() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const all = S('ccprobe_sessions', []).filter(s => s.start !== session.start);
      all.push({ ...session, entries: session.entries.slice(-400) });
      SET('ccprobe_sessions', all.slice(-8));
    }, 1000);
  }

  function log(kind, msg, level = '') {
    const t = ((Date.now() - T0) / 1000).toFixed(1);
    session.entries.push({ t, kind, msg, level });
    console.log(`[CCProbe] +${t}s [${kind}] ${msg}`);
    renderLine({ t, kind, msg, level });
    saveSession();
  }

  function stat(n) {
    const d = describe(n);
    if (!stats.has(d.sel)) stats.set(d.sel, { name: d.name, seen: 0, ok: {}, fail: 0 });
    return stats.get(d.sel);
  }

  const pending = new Map();
  window.addEventListener('message', e => {
    const d = e.data;
    if (d && d.ccprobeReply && pending.has(d.ccprobeReply)) { pending.get(d.ccprobeReply)(d); pending.delete(d.ccprobeReply); }
  });
  function askFrame(fr) {
    return new Promise(res => {
      const id = 'p' + Math.random().toString(36).slice(2);
      pending.set(id, res);
      try { fr.contentWindow.postMessage({ ccprobe: 'close', id }, '*'); } catch (e) { /* ignore */ }
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res(null); } }, 6000);
    });
  }

  function fillingIframe(n) {
    if (!n.querySelectorAll) return null;
    const r = n.getBoundingClientRect();
    for (const f of n.querySelectorAll('iframe')) {
      const fr = f.getBoundingClientRect();
      if (visible(f) && fr.width * fr.height >= r.width * r.height * 0.5) return f;
    }
    return null;
  }

  async function closeOverlay(n, opts = {}) {
    const d = describe(n), st = stat(n);
    const gone = () => !n.isConnected || !visible(n) || !isHit(n);
    const ok = how => { st.ok[how] = (st.ok[how] || 0) + 1; log('close', `CLOSED ${d.name} ${d.sel} via ${how}`, 'good'); return how; };
    const tried = [];

    // iframe overlay (Crown Jackpot lives here) - also a wrapper (e.g. div._cover_) that an iframe fills
    const fr = n.tagName === 'IFRAME' ? n : fillingIframe(n);
    if (fr) {
      let sameDoc = null;
      try { sameDoc = fr.contentDocument; } catch (e) { /* cross-origin */ }
      if (sameDoc && sameDoc.body) {
        for (const c of closeCandidates(sameDoc.body)) {
          tried.push('X ' + stableSel(c)); fire(c); await sleep(1200);
          if (gone()) return ok(`X button inside same-origin iframe: ${stableSel(c)}`);
        }
      } else {
        const rep = await askFrame(fr);
        if (!rep) {
          log('close', `${d.name}: cross-origin frame (${d.iframe || 'no src'}) - no probe inside. Add "// @match ${(d.iframe || '').replace(/^(https?:\/\/[^/]+).*/, '$1')}/*" to the header.`, 'warn');
        } else {
          log('close', `frame ${rep.host}: overlays ${JSON.stringify(rep.overlays)} tried ${rep.tried.join(', ') || 'nothing'} | buttons in frame: ${rep.buttons.join(', ') || 'none'}`);
          await sleep(500);
          if (rep.ok || gone()) return ok(rep.how || 'frame reported closed');
        }
      }
    } else {
      for (const c of closeCandidates(n)) {
        tried.push('X ' + stableSel(c)); fire(c); await sleep(1200);
        if (gone()) return ok(`X button ${stableSel(c)}`);
      }
    }

    tried.push('Escape'); pressEscape(); await sleep(1000);
    if (gone()) return ok('Escape key');

    if (!fr && (OVERLAY_RE.test(cls(n)) || opts.content || n.getAttribute('role') === 'dialog')) {
      const pt = backdropPoint(n, opts.content);
      if (!pt) tried.push('backdrop (no safe point - every point hit the popup content/canvas)');
      else {
        tried.push(`backdrop (${pt.x},${pt.y}) on ${stableSel(pt.el)}`);
        if (fire(pt.el, pt.x, pt.y)) { await sleep(1200); if (gone()) return ok(`backdrop click at (${pt.x},${pt.y}) on ${stableSel(pt.el)}`); }
      }
    }
    st.fail++;
    log('close', `FAILED to close ${d.name} ${d.sel} - tried: ${tried.join(' | ') || 'no close button found'}`, 'bad');
    return null;
  }

  async function sweep(label, rounds = 3) {
    let closed = 0;
    for (let i = 0; i < rounds; i++) {
      const ovs = findOverlays();
      if (!ovs.length) { if (i === 0) log('sweep', `${label}: page clear`); return closed; }
      for (const n of ovs) {
        const d = describe(n);
        log('sweep', `${label}: on top -> ${d.name} ${d.sel} [${d.rect}] "${d.text}"${d.iframe ? ' iframe=' + d.iframe : ''}`, 'warn');
        if (await closeOverlay(n)) closed++;
      }
      await sleep(800);
    }
    const left = findOverlays();
    if (left.length) log('sweep', `${label}: still on top after ${rounds} rounds: ${left.map(stableSel).join(', ')}`, 'bad');
    return closed;
  }

  // Watcher: logs overlays as they appear/disappear (log-only unless Auto-close is on)
  const live = new Set();
  let watchT = null;
  function watchTick() {
    const now = new Set(findOverlays());
    for (const n of now) if (!live.has(n)) {
      const d = describe(n); stat(n).seen++;
      log('watch', `APPEARED ${d.name} ${d.sel} [${d.rect}] "${d.text}"${d.iframe ? ' iframe=' + d.iframe : ''}`, 'warn');
      if (S('ccprobe_autoclose', false) && !busy) closeOverlay(n);
    }
    for (const n of live) if (!now.has(n)) log('watch', `gone: ${stableSel(n)}`);
    live.clear(); now.forEach(n => live.add(n));
  }
  new MutationObserver(() => { clearTimeout(watchT); watchT = setTimeout(watchTick, 500); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
  setInterval(watchTick, 3000); // the metagames iframe changes inside without mutating our DOM

  async function waitFor(sel, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const el = document.querySelector(sel); if (el && visible(el)) return el; await sleep(300); }
    return null;
  }

  function obstruction(el) {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const h = document.elementFromPoint(x, y);
    if (!h || h === el || el.contains(h) || isOurs(h)) return null;
    return h;
  }

  async function pathClick(target, label) {
    const el = typeof target === 'string' ? await waitFor(target, 8000) : target;
    if (!el) { log('path', `${label}: NOT FOUND (${target})`, 'bad'); return false; }
    let ob = obstruction(el);
    if (ob) {
      log('path', `${label}: a real (Collector-App) click would hit ${stableSel(ob)} instead - sweeping`, 'warn');
      await sweep(`blocking ${label}`);
      ob = obstruction(el);
      if (ob) log('path', `${label}: STILL covered by ${stableSel(ob)} - Collector-App would skip this; clicking synthetically anyway`, 'bad');
    }
    if (!fire(el)) { log('path', `${label}: refused (element contains a canvas)`, 'bad'); return false; }
    log('path', `${label}: clicked ${stableSel(el)}`);
    return true;
  }

  function readNow() {
    const el = document.querySelector(SEL.balance);
    const raw = el ? el.textContent.trim() : '';
    const m = document.body.getAttribute('data-jp-coin') || '?';
    return { m, raw, v: raw ? parseFloat(raw.replace(/[^0-9.]/g, '')) : null };
  }

  async function readBoth(tag) {
    const res = { GC: null, SC: null };
    const a = readNow();
    res[a.m === 'SC' ? 'SC' : 'GC'] = a.v;
    log('balance', `${tag}: showing ${a.m} = "${a.raw || 'not found'}"`);
    if (!await pathClick(SEL.switcher, `${tag}: flip CC/SC`)) return res;
    await sleep(3000); await sweep(`${tag}: after flip`);
    const b = readNow();
    if (b.m === a.m) log('balance', `${tag}: coin mode did not change (still ${b.m})`, 'bad');
    else res[b.m === 'SC' ? 'SC' : 'GC'] = b.v;
    log('balance', `${tag}: showing ${b.m} = "${b.raw || 'not found'}"`);
    await pathClick(SEL.switcher, `${tag}: flip back`);
    await sleep(3000); await sweep(`${tag}: after flip back`);
    const c = readNow();
    if (c.m !== a.m) log('balance', `${tag}: did not return to ${a.m} (now ${c.m})`, 'warn');
    log('balance', `${tag} BALANCE: GC ${res.GC} | SC ${res.SC}`, res.GC != null && res.SC != null ? 'good' : 'bad');
    return res;
  }

  async function openAndCloseReward() {
    await sweep('before menu');
    if (!await pathClick(SEL.menu, 'hamburger menu')) return;
    await sleep(2000);
    const item = [...document.querySelectorAll(SEL.menuItem)].find(e => /rewards/i.test(e.textContent));
    if (!item) { log('path', 'side menu "Rewards" item NOT FOUND (.side-menu__action)', 'bad'); return; }
    await pathClick(item, 'side menu Rewards');
    await sleep(3000);
    const tile = await waitFor(SEL.dailyTile, 6000);
    if (!tile) { log('path', `Daily Bonus tile NOT FOUND (${SEL.dailyTile})`, 'bad'); return; }
    log('path', `Daily Bonus tile text: "${tile.innerText.replace(/\s+/g, ' ').trim()}"`);
    await pathClick(tile, 'Daily Bonus tile');
    await sleep(3000);
    const canvas = document.querySelector(SEL.dailyCanvas);
    if (!canvas) { log('path', 'no Daily Bonus popup appeared (not ready yet / timer running?)', 'warn'); }
    else {
      const ov = canvas.closest('[class*="_portal_"]') || canvas.parentElement;
      const content = canvas.closest('[class*="_content_"]');
      log('path', `REWARD WINDOW REACHED - ${stableSel(ov)} (NOT claiming; closing it)`, 'good');
      await closeOverlay(ov, { content });
      if (document.querySelector(SEL.dailyCanvas) && visible(document.querySelector(SEL.dailyCanvas)))
        log('path', 'Daily Bonus popup still open - close it by hand WITHOUT tapping the wheel/canvas', 'bad');
    }
    await sleep(1000);
    await sweep('after reward window');
    if (!document.querySelector(SEL.switcher) || obstruction(document.querySelector(SEL.switcher))) {
      log('path', 'header not reachable (Rewards view still covering?) - trying Escape', 'warn');
      pressEscape(); await sleep(1500); await sweep('after Escape');
    }
  }

  async function runTest() {
    if (busy) return;
    busy = true; setStatus('running...');
    const settle = Math.max(0, parseInt(S('ccprobe_settle', 20), 10) || 0);
    log('test', `=== Run Test v${VERSION} - viewport ${session.vp} - settle ${settle}s ===`, 'good');
    try {
      const end = Date.now() + settle * 1000;
      await sleep(2000);
      while (Date.now() < end) { await sweep('settle', 2); await sleep(2500); }
      const before = await readBoth('START');
      await openAndCloseReward();
      await sleep(2000);
      const after = await readBoth('END');
      const same = before.GC === after.GC && before.SC === after.SC;
      log('test', `GC ${before.GC} -> ${after.GC} | SC ${before.SC} -> ${after.SC} ${same ? '(unchanged, as expected - nothing claimed)' : '(CHANGED - check what got clicked)'}`, same ? 'good' : 'bad');
    } catch (e) { log('test', 'ERROR ' + (e && e.stack || e), 'bad'); }
    log('test', summary(), 'good');
    busy = false; setStatus('idle');
  }

  function summary() {
    if (!stats.size) return 'SUMMARY: no popups seen';
    const lines = [...stats].map(([sel, s]) => {
      const oks = Object.entries(s.ok).map(([h, c]) => `${h} x${c}`).join('; ');
      return `  ${s.name} ${sel}: seen ${s.seen}, closed [${oks || 'never'}], failed ${s.fail}`;
    });
    return 'SUMMARY:\n' + lines.join('\n');
  }

  function sessionText(s) {
    return `CrownCoins Popup Probe v${VERSION} - session ${s.start} - viewport ${s.vp}\n` +
      s.entries.map(e => `+${e.t}s [${e.kind}] ${e.msg}`).join('\n');
  }

  /* ---------------- panel ---------------- */
  const host = document.createElement('div');
  host.id = 'ccprobe-host';
  host.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;';
  const sh = host.attachShadow({ mode: 'open' });
  sh.innerHTML = `<style>
    .p{width:380px;font:11px/1.35 Consolas,monospace;background:#111c;color:#ddd;border:1px solid #555;border-radius:6px;backdrop-filter:blur(2px)}
    .h{display:flex;gap:4px;align-items:center;padding:4px 6px;background:#222;border-radius:6px 6px 0 0;cursor:move;flex-wrap:wrap}
    .h b{flex:1;color:#fc6}
    button{font:11px sans-serif;padding:2px 6px;cursor:pointer;background:#333;color:#eee;border:1px solid #666;border-radius:3px}
    button:hover{background:#444}
    .o{display:flex;gap:8px;padding:3px 6px;align-items:center;border-bottom:1px solid #333}
    .o input[type=number]{width:40px;background:#222;color:#eee;border:1px solid #555}
    .l{max-height:38vh;overflow:auto;padding:3px 6px;white-space:pre-wrap;word-break:break-word}
    .good{color:#7e7}.warn{color:#fd6}.bad{color:#f77}.min .o,.min .l{display:none}
  </style>
  <div class="p"><div class="h"><b>CC Probe <span id="st">idle</span></b>
    <button id="run">Run Test</button><button id="sw">Sweep</button><button id="cp">Copy</button><button id="cpa">Copy all</button><button id="clr">Clear</button><button id="min">_</button></div>
    <div class="o"><label>settle <input id="set" type="number" min="0" max="120"> s</label>
      <label><input id="ar" type="checkbox"> Auto-run on load</label><label><input id="ac" type="checkbox"> Auto-close</label></div>
    <div class="l" id="log"></div></div>`;
  (document.body || document.documentElement).appendChild(host);
  const $ = id => sh.getElementById(id);
  const logEl = $('log');
  function renderLine(e) {
    const div = document.createElement('div');
    div.className = e.level; div.textContent = `+${e.t}s [${e.kind}] ${e.msg}`;
    logEl.appendChild(div); logEl.scrollTop = logEl.scrollHeight;
  }
  function setStatus(s) { $('st').textContent = s; }
  $('set').value = S('ccprobe_settle', 20);
  $('ar').checked = S('ccprobe_autorun', false);
  $('ac').checked = S('ccprobe_autoclose', false);
  $('set').onchange = () => SET('ccprobe_settle', parseInt($('set').value, 10) || 0);
  $('ar').onchange = () => SET('ccprobe_autorun', $('ar').checked);
  $('ac').onchange = () => SET('ccprobe_autoclose', $('ac').checked);
  $('run').onclick = runTest;
  $('sw').onclick = async () => { if (busy) return; busy = true; setStatus('sweeping'); await sweep('manual sweep'); log('sweep', summary()); busy = false; setStatus('idle'); };
  $('cp').onclick = () => { GM_setClipboard(sessionText(session) + '\n' + summary()); setStatus('copied'); };
  $('cpa').onclick = () => { GM_setClipboard(S('ccprobe_sessions', []).map(sessionText).join('\n\n')); setStatus('copied all'); };
  $('clr').onclick = () => { SET('ccprobe_sessions', []); session.entries = []; logEl.textContent = ''; stats.clear(); };
  $('min').onclick = () => sh.querySelector('.p').classList.toggle('min');
  // drag
  sh.querySelector('.h').addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    const r = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const mv = ev => { host.style.left = (ev.clientX - dx) + 'px'; host.style.top = (ev.clientY - dy) + 'px'; host.style.bottom = 'auto'; };
    const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  });
  // keep the panel alive through SPA re-renders
  setInterval(() => { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); }, 2000);

  log('watch', `loaded v${VERSION} on ${location.pathname} - viewport ${session.vp} (watching, log-only)`);
  if (S('ccprobe_autorun', false)) setTimeout(runTest, 4000);
})();
