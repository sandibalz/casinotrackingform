// ==UserScript==
// @name         Instagram Contest Comment Helper
// @namespace    http://tampermonkey.net/
// @version      1.4.7
// @description  Instagram "comment your answer + #tag" contests (ONLY on posts by usernames listed in POSTERS): reads the comments, finds the most common answer among comments that carry the post's hashtag, and types that comment into the comment box. NEVER clicks Post - you review it and post it yourself.
// @match        https://www.instagram.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @updateURL    https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/instagramcontestcomment.user.js
// @downloadURL  https://raw.githubusercontent.com/sandibalz/casinotrackingform/main/instagramcontestcomment.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Config ----------
  const AUTO_RUN = true;        // scan automatically when a post page opens
  const AUTO_FILL = true;       // type the winning comment into the box (it never posts)
  const START_DELAY_MS = 2500;  // wait after the post opens before scanning
  const MAX_SCROLL_STEPS = 8;   // how many times to scroll the comment panel to load more
  const SCROLL_PAUSE_MS = 900;
  const MIN_VOTES = 3;          // auto-fill only if at least this many tagged comments agree
  const TAG_OVERRIDE = '';      // e.g. '#playfame' to force the required hashtag
  const LOG = '[IG Contest]';
  // The script does NOTHING on a post unless its poster is listed here (Instagram username, no @).
  const POSTERS = ['play.fame', 'hellomillions.official', 'spinblitz.official', 'mcluck.com.official', 'americanluckcasino', 'spreecasino', 'wowvegascom', 'rollacasino', 'modo_casino', 'casinofanaticandy'];
  const norm = p => String(p || '').trim().toLowerCase().replace(/^@/, '');
  const BUILTIN = new Set(POSTERS.map(norm)); // the shared list; the Tampermonkey menu adds to it via GitHub
  const RESERVED = new Set(['reels', 'reel', 'explore', 'direct', 'accounts', 'p', 'stories', 'tv', 'about', 'legal', 'web', 'popular', 'developer']);

  // This script has no code path that clicks Post / presses Enter. Do not add one.

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log(LOG, ...a);

  async function waitFor(fn, timeout = 10000, step = 300) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  const isPostPage = () => /^\/(?:[^/]+\/)?(?:p|reel)\/[^/]+/.test(location.pathname);
  const shortcode = () => (location.pathname.match(/\/(?:p|reel)\/([^/]+)/) || [])[1] || '';

  // ---------- Comment box ----------
  const BOX_SEL = 'textarea[aria-label*="comment" i], textarea[placeholder*="comment" i], ' +
    '[contenteditable="true"][aria-label*="comment" i], div[role="textbox"][aria-label*="comment" i]';

  function findBox() {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(d => d.querySelector(BOX_SEL));
    const scope = dialog || document;
    return [...scope.querySelectorAll(BOX_SEL)].find(e => e.getClientRects().length) || null;
  }

  const findRoot = box => box.closest('article, [role="dialog"], main') || document.body;

  // ---------- Poster of the open post ----------
  // /<user>/p/<code>/ URLs name the poster directly; otherwise take the first profile link in the post (its header).
  function posterName() {
    const m = location.pathname.match(/^\/([^/]+)\/(?:p|reel)\//);
    if (m) return m[1].toLowerCase();
    const box = findBox();
    const root = box ? findRoot(box) : document.querySelector('main');
    if (!root) return '';
    for (const a of root.querySelectorAll('a[href]')) {
      const h = (a.getAttribute('href') || '').match(/^\/([^/]+)\/$/);
      if (h && !RESERVED.has(h[1].toLowerCase()) && a.textContent.trim()) return h[1].toLowerCase();
    }
    return '';
  }

  // ---------- Comment rows ----------
  const keyOf = a => (a.getAttribute('href') || '').split('?')[0];

  function commentLinks(root) {
    return [...root.querySelectorAll('a[href*="/c/"]')].filter(a => /\/c\/\d+\/(?:r\/\d+\/?)?$/.test(keyOf(a)));
  }

  // Climb from a comment's timestamp link to the largest ancestor that still holds only that one comment.
  function rowFor(link, root) {
    let node = link;
    while (node.parentElement && node.parentElement !== root) {
      const p = node.parentElement;
      if (/^(UL|OL|MAIN|ARTICLE|BODY|FORM)$/.test(p.tagName)) break;
      if (p.querySelector('textarea, [contenteditable="true"], form')) break;
      if (new Set(commentLinks(p).map(keyOf)).size > 1) break;
      node = p;
    }
    return node;
  }

  const NOISE = new Set(['Edited', 'Pinned', 'Verified', '•', '·']);

  function rowParts(row) {
    let user = '';
    for (const a of row.querySelectorAll('a[href]')) {
      const m = (a.getAttribute('href') || '').match(/^\/([^/]+)\/$/);
      if (m && a.textContent.trim()) { user = m[1]; break; }
    }
    const skip = n => {
      for (let p = n.parentElement; p; p = p.parentElement) {
        if (p.matches('button, [role="button"], time, svg, textarea, form')) return true;
        if (p.tagName === 'A') {
          const h = p.getAttribute('href') || '';
          if (/\/c\/\d+\//.test(h) || (user && h === '/' + user + '/')) return true;
        }
        if (p === row) break;
      }
      return false;
    };
    const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let text = '';
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const s = n.nodeValue;
      if (!s || skip(n) || NOISE.has(s.trim())) continue;
      if (n.parentElement.closest('a') && text && !/\s$/.test(text)) text += ' ';
      text += s;
    }
    return { user, text: text.replace(/\s+/g, ' ').trim() };
  }

  const TAG_RE = /#[\p{L}\p{N}_]+/gu;
  const tagsIn = t => (t.match(TAG_RE) || []).map(x => x.toLowerCase());
  const answerOf = t => t.replace(TAG_RE, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

  function parseComments(root) {
    const seen = new Set();
    const out = [];
    for (const a of commentLinks(root)) {
      const key = keyOf(a);
      if (/\/r\/\d+/.test(key) || seen.has(key)) continue; // top-level comments only, not replies
      seen.add(key);
      const row = rowFor(a, root);
      const { user, text } = rowParts(row);
      out.push({ key, user, text, tags: tagsIn(text), answer: answerOf(text) });
    }
    return out;
  }

  function captionTags(root, rows) {
    const out = new Map();
    root.querySelectorAll('a[href^="/explore/tags/"]').forEach(a => {
      if (rows.some(r => r.contains(a))) return;
      const t = a.textContent.trim();
      if (t.startsWith('#')) out.set(t.toLowerCase(), t);
    });
    return out;
  }

  // ---------- Which hashtag does the post ASK for? ----------
  // Reads the caption sentence like "Drop your answer in the comments + #PlayFame." and returns the hashtag(s) in it.
  const CUE_RE = /\b(comments?|commenting|answer|drop|reply|respond|type|write|include|add|use|using|tell)\b|\+/i;

  function captionText(root, rows) {
    const link = [...root.querySelectorAll('a[href^="/explore/tags/"]')]
      .find(a => !rows.some(r => r.contains(a)) && a.textContent.trim().startsWith('#'));
    if (!link) return '';
    let node = link.parentElement;
    while (node && node !== root) {
      if (rows.some(r => node.contains(r)) || node.querySelector('textarea, [contenteditable="true"], form')) return '';
      const t = node.innerText || node.textContent || '';
      if (t.replace(TAG_RE, '').trim().length >= 20) return t;
      node = node.parentElement;
    }
    return '';
  }

  function instructionTags(text, caps) {
    const found = [];
    for (const s of text.split(/(?<=[.!?])\s*|\n+/)) {
      const tags = tagsIn(s);
      if (!tags.length || tags.length > 2 || !CUE_RE.test(s)) continue; // 3+ tags in a row = a hashtag dump, not an instruction
      for (const t of tags) if (caps.has(t) && !found.includes(t)) found.push(t);
    }
    return found;
  }

  // ---------- Loading more comments ----------
  function scrollParent(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY;
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 5) return p;
    }
    return null;
  }

  async function loadAll(root) {
    const first = commentLinks(root)[0];
    const sc = first && scrollParent(first);
    const y = window.scrollY;
    let last = -1, still = 0;
    for (let i = 0; i < MAX_SCROLL_STEPS; i++) {
      const n = new Set(commentLinks(root).map(keyOf)).size;
      if (n === last) { if (++still >= 2) break; } else still = 0;
      last = n;
      const more = root.querySelector('svg[aria-label="Load more comments"]');
      if (more) (more.closest('button, [role="button"]') || more).click();
      if (sc) sc.scrollTop = sc.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
      await sleep(SCROLL_PAUSE_MS);
    }
    if (sc) sc.scrollTop = 0; else window.scrollTo(0, y);
  }

  // ---------- Filling the box (never submits) ----------
  const boxText = b => ('value' in b ? b.value : b.textContent) || '';

  async function fillBox(box, text) {
    for (let i = 0; i < 3; i++) {
      await sleep(i ? 800 : 600); // let Instagram finish rendering the box; retry if the first try didn't stick
      const b = (i && findBox()) || box;
      b.focus();
      if (b.tagName === 'TEXTAREA' || b.tagName === 'INPUT') {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(b), 'value').set;
        setter.call(b, text);
        b.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        document.execCommand('selectAll', false);
        document.execCommand('insertText', false, text);
      }
      await sleep(400); // Instagram re-renders the box after input; re-find it before checking
      const now = findBox();
      if (boxText(b).includes(text) || (!!now && boxText(now).includes(text))) return true;
    }
    return false;
  }

  const guardKey = () => 'igch_filled_' + shortcode();
  const wasFilled = () => { try { return !!sessionStorage.getItem(guardKey()); } catch (e) { return false; } };
  const markFilled = () => { try { sessionStorage.setItem(guardKey(), '1'); } catch (e) { /* ignore */ } };

  // ---------- Scan ----------
  let busy = false;

  async function scan(opts = {}) {
    const res = { status: '', tag: '', tally: [], pick: '', filled: false, total: 0, tagged: 0 };
    if (busy) { res.status = 'Already scanning...'; return res; }
    busy = true;
    try {
      const box = await waitFor(findBox, 10000);
      if (!box) { res.status = 'No comment box found.'; return res; }
      const root = findRoot(box);
      if (!(await waitFor(() => commentLinks(root).length, 8000))) { res.status = 'No comments yet.'; return res; }
      await loadAll(root);

      const rows = commentLinks(root).map(a => rowFor(a, root));
      const comments = parseComments(root);
      res.total = comments.length;
      const caps = captionTags(root, rows);

      const useCount = t => comments.filter(c => c.tags.includes(t)).length;
      let reqTag = TAG_OVERRIDE.toLowerCase();
      // 1) the hashtag the caption's instruction names ("...comments + #PlayFame"); 2) otherwise the caption hashtag commenters used most
      const asked = reqTag ? [] : instructionTags(captionText(root, rows), caps);
      if (!reqTag && asked.length) reqTag = asked.slice().sort((a, b) => useCount(b) - useCount(a))[0];
      let crowdTag = '', best = 0;
      for (const t of caps.keys()) { const n = useCount(t); if (n > best) { best = n; crowdTag = t; } }
      if (!reqTag) reqTag = crowdTag;
      if (!reqTag && !caps.size) { res.status = 'No hashtag found in the caption.'; return res; }
      // The caption has hashtags but doesn't ask for one and no commenter uses any: no hashtag required, count every comment.
      const noTag = !reqTag;
      res.tag = noTag ? '' : (caps.get(reqTag) || reqTag);
      res.tagFrom = noTag ? 'none required' : TAG_OVERRIDE ? 'override' : asked.length ? 'caption instruction' : 'most used by commenters';
      if (asked.length && crowdTag && crowdTag !== reqTag) {
        res.note = 'Commenters mostly used ' + (caps.get(crowdTag) || crowdTag) + ' - the post asks for ' + res.tag + '.';
      }

      const tagged = comments.filter(c => c.answer && (noTag || c.tags.includes(reqTag)));
      res.tagged = tagged.length;
      const groups = new Map();
      for (const c of tagged) {
        const g = groups.get(c.answer) || { count: 0, raws: new Map() };
        g.count++;
        const raw = noTag ? (c.text.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim() || c.text) : c.text;
        g.raws.set(raw, (g.raws.get(raw) || 0) + 1);
        groups.set(c.answer, g);
      }
      const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
      res.tally = sorted.slice(0, 6).map(([ans, g]) => [ans, g.count]);
      if (!sorted.length) { res.status = 'No tagged answers yet.'; return res; }

      const [, top] = sorted[0];
      const tie = sorted[1] && sorted[1][1].count === top.count;
      const hasCap = s => (res.tag && s.includes(res.tag) ? 1 : 0);
      res.pick = [...top.raws.entries()].sort((a, b) => (hasCap(b[0]) - hasCap(a[0])) || (b[1] - a[1]))[0][0];

      const fillIt = opts.fill ?? AUTO_FILL;
      if (!fillIt) { res.status = 'Scan only (fill off).'; return res; }
      if (!opts.force) {
        if (top.count < MIN_VOTES) { res.status = 'Only ' + top.count + ' vote(s) so far - not filled.'; return res; }
        if (wasFilled()) { res.status = 'Already filled once for this post.'; return res; }
      }
      if (boxText(box).trim()) { res.status = 'Comment box already has text - left alone.'; return res; }
      if (await fillBox(box, res.pick)) {
        markFilled();
        res.filled = true;
        res.status = tie ? 'TIE for first place - typed one of them. Check it and edit if needed, then click Post yourself.' : 'Typed into the box. Review it, then click Post yourself.';
      } else {
        res.status = 'Could not type into the box.';
      }
      return res;
    } finally {
      busy = false;
    }
  }

  // ---------- Badge ----------
  const BADGE_ID = 'igch-badge';
  const removeBadge = () => { const b = document.getElementById(BADGE_ID); if (b) b.remove(); };

  function el(tag, text, css) {
    const e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (css) e.style.cssText = css;
    return e;
  }

  function render(res) {
    removeBadge();
    const b = el('div', null,
      'position:fixed;bottom:16px;left:76px;z-index:2147483647;width:250px;padding:10px 12px;' +
      'background:rgba(20,20,24,.94);color:#f1f1f1;font:12px/1.4 system-ui,sans-serif;' +
      'border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.4)');
    b.id = BADGE_ID;
    const head = el('div', null, 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px');
    head.appendChild(el('b', 'IG Contest Helper'));
    const x = el('span', '×', 'cursor:pointer;font-size:16px;padding:0 4px');
    x.onclick = removeBadge;
    head.appendChild(x);
    b.appendChild(head);

    if (res.tag || res.tagFrom) b.appendChild(el('div', 'Tag: ' + (res.tag || 'none required') + ' (' + res.tagFrom + ') · ' + res.tagged + ' of ' + res.total + ' comments'));
    if (res.note) b.appendChild(el('div', res.note, 'margin-top:4px;color:#f0c36d'));
    if (res.tally.length) b.appendChild(el('div', 'Votes: ' + res.tally.map(([a, n]) => (a || '?').toUpperCase() + ' ' + n).join(' · ')));
    if (res.pick) b.appendChild(el('div', 'Pick: ' + res.pick, 'margin-top:4px;font-weight:600'));
    b.appendChild(el('div', res.status, 'margin-top:4px;color:' + (res.filled ? '#7dd87d' : '#f0c36d')));

    const row = el('div', null, 'display:flex;gap:6px;margin-top:8px');
    const btn = (label, fn) => {
      const e = el('button', label, 'flex:1;padding:4px 6px;border:0;border-radius:6px;background:#3b3b46;color:#fff;cursor:pointer;font:inherit');
      e.onclick = async () => { e.disabled = true; render(await fn()); };
      return e;
    };
    row.appendChild(btn('Rescan', () => scan({ fill: false })));
    row.appendChild(btn('Fill now', () => scan({ force: true })));
    b.appendChild(row);
    document.body.appendChild(b);
  }

  // ---------- Navigation (Instagram is a single-page app) ----------
  let lastPath = '';

  async function onNav() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    removeBadge();
    if (!isPostPage() || !AUTO_RUN) return;
    await sleep(START_DELAY_MS);
    if (location.pathname !== lastPath) return;
    const poster = await waitFor(posterName, 8000);
    if (location.pathname !== lastPath) return;
    if (!poster || !isAllowed(poster)) { log('skipped - poster not in list:', poster || '(unknown)'); return; }
    const res = await scan();
    log(res);
    if (location.pathname === lastPath) render(res);
  }

  // ---------- Poster list: this browser + GitHub (Tampermonkey menu) ----------
  const REPO = 'sandibalz/casinotrackingform', REPO_FILE = 'instagramcontestcomment.user.js', REPO_BRANCH = 'main';
  const TOKEN_KEY = 'igContestGhToken', LOCAL_KEY = 'igContestLocalPosters';
  const gv = (k, d) => { try { return GM_getValue(k, d); } catch (e) { return d; } };
  const sv = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* ignore */ } };
  const localPosters = () => { const r = gv(LOCAL_KEY, []); return Array.isArray(r) ? r.map(norm).filter(Boolean) : []; };
  const isAllowed = p => BUILTIN.has(p) || localPosters().includes(p);
  const validName = p => /^[a-z0-9._]{1,30}$/.test(p);
  // Once an update that contains a local poster is installed, the local copy is redundant - drop it.
  (function prune() {
    const u = localPosters(), keep = u.filter(p => !BUILTIN.has(p));
    if (keep.length !== u.length) sv(LOCAL_KEY, keep);
  })();

  function ghReq(method, body) {
    const token = gv(TOKEN_KEY, '');
    return new Promise((resolve, reject) => {
      if (!token) { reject(Object.assign(new Error('No GitHub token set'), { status: 0 })); return; }
      GM_xmlhttpRequest({
        method, anonymous: true,
        url: 'https://api.github.com/repos/' + REPO + '/contents/' + REPO_FILE + (method === 'GET' ? '?ref=' + REPO_BRANCH + '&t=' + Date.now() : ''),
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : undefined,
        onload: r => {
          let j = null; try { j = JSON.parse(r.responseText); } catch (e) { /* ignore */ }
          if (r.status >= 200 && r.status < 300) resolve(j);
          else reject(Object.assign(new Error('HTTP ' + r.status + (j && j.message ? ': ' + j.message : '')), { status: r.status }));
        },
        onerror: r => reject(Object.assign(new Error('Network error' + (r && (r.error || r.statusText) ? ' (' + (r.error || r.statusText) + ')' : '')), { status: -1 })),
        ontimeout: () => reject(Object.assign(new Error('GitHub timed out'), { status: -1 })),
        timeout: 20000,
      });
    });
  }
  const decodeFile = f => decodeURIComponent(escape(atob(String(f.content).replace(/\s/g, '')))).replace(/\r\n/g, '\n');
  const ghErr = e => e.status === 401 ? 'GitHub rejected the token - ' + e.message + '. (wrong, expired or revoked; use "Set GitHub token" again)'
    : (e.status === 403 || e.status === 404) ? 'The token has no write access to ' + REPO + ' (needs Contents: Read and write), or ' + REPO_FILE + ' is not in the repo yet. ' + e.message
    : e.message;

  // mutate(text) -> { text, summary } or { nochange: 'why' }. Re-reads and retries if someone else pushed in between.
  async function editRepo(mutate) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const f = await ghReq('GET');
      const res = mutate(decodeFile(f));
      if (res.nochange) return res;
      const out = res.text.replace(/(\/\/ @version\s+)(\d+)\.(\d+)\.(\d+)/, (m, a, x, y, z) => a + x + '.' + y + '.' + (+z + 1));
      const v = (out.match(/\/\/ @version\s+(\S+)/) || [])[1];
      try {
        await ghReq('PUT', { message: 'Instagram Contest Helper v' + v + ': ' + res.summary, content: btoa(unescape(encodeURIComponent(out))), sha: f.sha, branch: REPO_BRANCH });
        return { version: v, summary: res.summary };
      } catch (e) { if (e.status === 409 || e.status === 422) continue; throw e; }
    }
    throw new Error('GitHub kept changing while saving - try again.');
  }

  // Edits only the "const POSTERS = [...]" line of the GitHub copy.
  const LIST_RE = /^([ \t]*const POSTERS = )\[([^\]]*)\];/m;
  const listOf = t => {
    const m = t.match(LIST_RE);
    if (!m) throw new Error('POSTERS list not found in the GitHub copy');
    return (m[2].match(/'([^']*)'/g) || []).map(s => norm(s.slice(1, -1)));
  };
  const withList = (t, arr) => t.replace(LIST_RE, (m, a) => a + '[' + arr.map(p => "'" + p + "'").join(', ') + '];');
  const addMutator = names0 => t => {
    const names = names0.map(norm), have = listOf(t), add = names.filter((n, i) => !have.includes(n) && names.indexOf(n) === i);
    if (!add.length) return { nochange: 'already on GitHub' };
    return { text: withList(t, have.concat(add)), summary: 'add ' + add.join(', ') };
  };
  const removeMutator = name => t => {
    const have = listOf(t);
    if (!have.includes(name)) return { nochange: 'not in the GitHub list' };
    return { text: withList(t, have.filter(p => p !== name)), summary: 'remove ' + name };
  };
  const doneMsg = res => res.nochange ? 'Nothing to push: ' + res.nochange + '.'
    : 'Pushed to GitHub as v' + res.version + ' (' + res.summary + ').\nOther owners get it at their next Tampermonkey update check.';

  function rescanNow() { lastPath = ''; onNav(); }

  function addPoster(raw) {
    const name = norm(raw), head = '@' + name + ': ';
    if (!validName(name)) { alert('"' + raw + '" does not look like an Instagram username (letters, numbers, . and _ only).'); return; }
    if (!BUILTIN.has(name) && !localPosters().includes(name)) sv(LOCAL_KEY, localPosters().concat(name));
    rescanNow();
    if (!gv(TOKEN_KEY, '')) { alert(head + 'added in this browser only (no GitHub token set - menu: "Set GitHub token").'); return; }
    editRepo(addMutator([name]))
      .then(res => alert(head + 'works now in this browser.\n' + doneMsg(res)))
      .catch(e => alert(head + 'works in this browser, but the GitHub push FAILED: ' + ghErr(e)));
  }
  function addByTyping() {
    const t = prompt('Instagram username to add (no @):', '');
    if (t && t.trim()) addPoster(t);
  }
  function addCurrent() {
    const p = isPostPage() ? posterName() : '';
    if (!p) { addByTyping(); return; }
    if (isAllowed(p)) { alert('@' + p + ' is already on the list.'); return; }
    if (confirm('Add @' + p + ' (the poster of this post)?')) addPoster(p);
  }
  function showPosters() {
    const l = localPosters().filter(p => !BUILTIN.has(p));
    alert('Shared list (GitHub copy):\n' + ([...BUILTIN].join(', ') || '(none)') + '\n\nOnly in this browser (not pushed yet):\n' + (l.join(', ') || '(none)'));
  }
  function removePoster() {
    const all = [...new Set([...BUILTIN, ...localPosters()])];
    if (!all.length) { alert('No posters on the list.'); return; }
    const n = prompt('Type a number to REMOVE a poster (blank = cancel). Shared ones are removed on GitHub for everyone:\n' +
      all.map((p, i) => (i + 1) + '. ' + p + (BUILTIN.has(p) ? '' : ' (this browser only)')).join('\n'), '');
    const p = all[(parseInt(n, 10) || 0) - 1];
    if (!p) return;
    sv(LOCAL_KEY, localPosters().filter(x => x !== p));
    if (!BUILTIN.has(p)) { alert('Removed @' + p + ' from this browser.'); return; }
    if (!gv(TOKEN_KEY, '')) { alert('Not removed on GitHub (no token set). It stays on the shared list.'); return; }
    editRepo(removeMutator(p))
      .then(res => alert(res.nochange ? 'Nothing to remove: ' + res.nochange + '.' : 'Removed @' + p + ' on GitHub as v' + res.version + '.\nThis browser keeps using it until the update installs.'))
      .catch(e => alert('GitHub FAILED: ' + ghErr(e)));
  }
  function pushLocal() {
    const l = localPosters().filter(p => !BUILTIN.has(p));
    if (!l.length) { alert('No local-only posters to push.'); return; }
    if (!gv(TOKEN_KEY, '')) { alert('No GitHub token set (menu: "Set GitHub token").'); return; }
    editRepo(addMutator(l)).then(res => alert(doneMsg(res))).catch(e => alert('GitHub FAILED: ' + ghErr(e)));
  }
  function setToken() {
    const t = prompt('Paste the GitHub token (fine-grained, ' + REPO + ', Contents: Read and write). Blank = remove it:', '');
    if (t === null) return;
    if (t.trim() && !/^[A-Za-z0-9_]{20,255}$/.test(t.trim())) { alert('That does not look like a GitHub token (a token is one unbroken word of letters/numbers/underscores, starting github_pat_). Nothing was saved.'); return; }
    sv(TOKEN_KEY, t.trim());
    if (!t.trim()) { alert('Token removed from this browser.'); return; }
    ghReq('GET').then(() => alert('Token works.')).catch(e => alert('Saved, but the test failed: ' + ghErr(e)));
  }

  try {
    GM_registerMenuCommand("➕ Add this post's poster", addCurrent);
    GM_registerMenuCommand('➕ Add poster by typing…', addByTyping);
    GM_registerMenuCommand('📋 Show posters', showPosters);
    GM_registerMenuCommand('🗑 Remove a poster', removePoster);
    GM_registerMenuCommand('⬆ Push my local posters to GitHub', pushLocal);
    GM_registerMenuCommand('🔑 Set GitHub token (also tests it)', setToken);
  } catch (e) { /* menu not available */ }

  window.__igContest = { scan, parseComments, findBox, posterName };
  setInterval(onNav, 1000);
  onNav();
})();
