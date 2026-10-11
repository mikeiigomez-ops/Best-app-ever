/* Workbench core (Ives): namespace, bus, util, router, ui primitives.
   Registers functions only. No DOM work and no calls into other modules at load. */
(function () {
  "use strict";
  window.WB = window.WB || {};
  const WB = window.WB;

  /* ================================================================ bus */
  const listeners = new Map();
  const bus = {
    on(name, fn) {
      if (typeof fn !== "function") return () => {};
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => bus.off(name, fn);
    },
    once(name, fn) {
      const off = bus.on(name, function wrap(p) { off(); fn(p); });
      return off;
    },
    off(name, fn) {
      const set = listeners.get(name);
      if (set) set.delete(fn);
    },
    emit(name, payload) {
      const set = listeners.get(name);
      if (!set || !set.size) return;
      const p = payload && typeof payload === "object" ? payload : {};
      for (const fn of Array.from(set)) {
        try { fn(p); } catch (err) { console.error("[WB.bus] " + name + " listener failed", err); }
      }
    },
  };

  /* ================================================================ util */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const SVG_TAGS = new Set(["svg", "g", "path", "line", "polyline", "polygon", "circle", "ellipse", "rect",
    "text", "tspan", "defs", "clipPath", "mask", "use", "marker", "pattern", "foreignObject", "symbol"]);

  function append(parent, child) {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) { child.forEach((c) => append(parent, c)); return; }
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  function el(tag, attrs, ...children) {
    const isSvg = SVG_TAGS.has(tag) || tag.indexOf("svg:") === 0;
    const name = tag.indexOf("svg:") === 0 ? tag.slice(4) : tag;
    const node = isSvg ? document.createElementNS(SVG_NS, name) : document.createElement(name);
    if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class" || k === "className") {
          if (isSvg) node.setAttribute("class", v); else node.className = v;
        } else if (k === "text") node.textContent = String(v);
        else if (k === "html") node.innerHTML = v; // trusted, app-authored markup only
        else if (k === "on") { for (const e of Object.keys(v)) if (typeof v[e] === "function") node.addEventListener(e, v[e]); }
        else if (k === "dataset") { for (const d of Object.keys(v)) if (v[d] != null) node.dataset[d] = String(v[d]); }
        else if (k === "style") {
          if (typeof v === "string") node.setAttribute("style", v);
          else for (const s of Object.keys(v)) {
            if (s.indexOf("--") === 0) node.style.setProperty(s, v[s]); else node.style[s] = v[s];
          }
        } else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, String(v));
      }
    }
    append(node, children);
    return node;
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function uid(prefix) {
    let s = "";
    while (s.length < 8) s += Math.random().toString(36).slice(2);
    s = s.slice(0, 8);
    if (!prefix) return s;
    const last = prefix.charAt(prefix.length - 1);
    return prefix + (last === "_" || last === "-" ? "" : "_") + s;
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function debounce(fn, ms) {
    let t = null, lastArgs = null, lastThis = null;
    const d = function (...args) {
      lastArgs = args; lastThis = this;
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(lastThis, lastArgs); }, ms);
    };
    d.cancel = () => { clearTimeout(t); t = null; };
    d.flush = () => { if (t) { clearTimeout(t); t = null; fn.apply(lastThis, lastArgs); } };
    return d;
  }

  function throttle(fn, ms) {
    let last = 0, t = null, lastArgs = null, lastThis = null;
    const run = () => { last = Date.now(); t = null; fn.apply(lastThis, lastArgs); };
    const th = function (...args) {
      lastArgs = args; lastThis = this;
      const wait = ms - (Date.now() - last);
      if (wait <= 0) { clearTimeout(t); run(); }
      else if (!t) t = setTimeout(run, wait);
    };
    th.cancel = () => { clearTimeout(t); t = null; };
    th.flush = () => { if (t) { clearTimeout(t); run(); } };
    return th;
  }

  function fmtUSD(n, cur) {
    const sym = cur || "$";
    if (n == null || !isFinite(n)) return sym + "0";
    const neg = n < 0;
    const a = Math.abs(n);
    let s;
    if (a < 100) {
      const r = Math.round(a * 100) / 100;
      s = r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else s = Math.round(a).toLocaleString("en-US");
    return (neg ? "−" : "") + sym + s;
  }

  function fmtNum(n, digits) {
    if (n == null || !isFinite(n)) return "0";
    const d = digits == null ? (Math.abs(n) >= 100 || Number.isInteger(n) ? 0 : 1) : digits;
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d });
  }

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDay(ms) {
    const d = new Date(ms == null ? Date.now() : ms);
    return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()];
  }
  function fmtDate(ms) {
    const d = new Date(ms == null ? Date.now() : ms);
    return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear();
  }
  function dayNum(ms) {
    const d = new Date(ms == null ? Date.now() : ms);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  }
  function fromDayNum(n) {
    const u = new Date(Math.round(n) * 86400000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate()).getTime();
  }

  let lastBuzz = 0;
  function haptic(ms) {
    const t = Date.now();
    if (t - lastBuzz < 30) return;
    lastBuzz = t;
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) { /* unsupported */ }
  }

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escapeHTML = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => Date.now();

  // per-device UI prefs ("wb:v1:ui"): read-modify-write so other keys survive
  const UI_KEY = "wb:v1:ui";
  function uiPrefs() {
    try { const o = JSON.parse(localStorage.getItem(UI_KEY) || "{}"); return o && typeof o === "object" ? o : {}; }
    catch (e) { return {}; }
  }
  function saveUiPrefs(patch) {
    const o = Object.assign(uiPrefs(), patch);
    try { localStorage.setItem(UI_KEY, JSON.stringify(o)); } catch (e) { /* private mode */ }
    return o;
  }

  /* swallowClick(ms): after a touch hold or long-press completes, the browser still sends a synthetic click when the
     finger lifts. It lands on whatever is under the finger by then (often the scrim of the sheet the hold opened).
     This eats the next click anywhere on the page within ms, in the capture phase, so it never reaches anything. */
  let swallowUntil = 0, swallowArmed = false;
  function swallowClick(ms) {
    swallowUntil = Date.now() + (ms || 450);
    if (swallowArmed) return;
    swallowArmed = true;
    const eat = (e) => {
      if (Date.now() > swallowUntil) { window.removeEventListener("click", eat, true); swallowArmed = false; return; }
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      swallowUntil = 0;
      window.removeEventListener("click", eat, true);
      swallowArmed = false;
    };
    window.addEventListener("click", eat, true);
    setTimeout(() => { if (swallowArmed && Date.now() > swallowUntil) { window.removeEventListener("click", eat, true); swallowArmed = false; } }, (ms || 450) + 50);
  }

  WB.util = { el, $, $$, uid, clamp, lerp, debounce, throttle, fmtUSD, fmtNum, fmtDate, fmtDay, dayNum, fromDayNum,
    haptic, reducedMotion, escapeHTML, sleep, now, uiPrefs, saveUiPrefs, swallowClick };

  /* ================================================================ router */
  const views = new Map();
  const stack = [];          // [{name, params}]
  let idx = -1;              // position in stack
  let cur = null;            // {name, params}
  let historyOK = true;
  let popBound = false;
  const SESSION = uid("rt");  // history entries from an earlier page load are not ours

  function hashFor(name, params) {
    const id = params && (params.id || params.peerKey);
    return "#/" + encodeURIComponent(name) + (id ? "/" + encodeURIComponent(String(id)) : "");
  }
  function parseHash(h) {
    const m = /^#\/([^/?#]+)(?:\/([^/?#]+))?/.exec(h || "");
    if (!m) return null;
    const name = decodeURIComponent(m[1]);
    const params = {};
    if (m[2]) {
      const v = decodeURIComponent(m[2]);
      if (name === "mirror") params.peerKey = v; else params.id = v;
    }
    return { name, params };
  }
  function section(name) { return document.querySelector('#wb-views > .wb-view[data-view="' + name + '"]'); }

  function show(name, params, opts) {
    const target = section(name);
    if (cur) {
      const prev = cur;
      const prevEl = section(prev.name);
      const def = views.get(prev.name);
      if (def && typeof def.leave === "function") {
        try { def.leave(prevEl); } catch (err) { console.error("[WB.router] leave " + prev.name, err); }
      }
      if (prevEl) { prevEl.hidden = true; prevEl.classList.remove("wb-view--active"); }
      bus.emit("view:leave", { view: prev.name, params: prev.params || {} });
    }
    cur = { name, params: params || {} };
    if (target) {
      target.hidden = false;
      target.classList.add("wb-view--active");
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    }
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
    const def = views.get(name);
    if (def && typeof def.enter === "function" && target) {
      try { def.enter(target, cur.params); } catch (err) { console.error("[WB.router] enter " + name, err); }
    } else if (!def) console.warn("[WB.router] no view registered for " + name);
    if (target && opts && opts.focus) {
      try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    bus.emit("view:enter", { view: name, params: cur.params });
  }

  function bindPop() {
    if (popBound) return;
    popBound = true;
    window.addEventListener("popstate", (e) => {
      const st = e.state;
      if (st && st.wb === SESSION && typeof st.i === "number" && stack[st.i]) {
        idx = st.i;
        show(stack[idx].name, stack[idx].params, { focus: true });
        return;
      }
      const parsed = parseHash(location.hash);
      if (parsed && views.has(parsed.name)) {
        stack.splice(idx + 1);
        stack.push(parsed); idx = stack.length - 1;
        show(parsed.name, parsed.params, { focus: true });
      }
    });
  }

  const router = {
    register(name, def) { views.set(name, def || {}); bindPop(); },
    go(name, params, opts) {
      bindPop();
      const p = params || {};
      const replace = !!(opts && opts.replace);
      const entry = { name, params: p };
      if (replace && idx >= 0) stack[idx] = entry;
      else { stack.splice(idx + 1); stack.push(entry); idx = stack.length - 1; }
      if (historyOK) {
        try {
          const state = { wb: SESSION, i: idx };
          const url = hashFor(name, p);
          if (replace || idx === 0) history.replaceState(state, "", url);
          else history.pushState(state, "", url);
        } catch (e) { historyOK = false; }
      }
      show(name, p, { focus: !(opts && opts.boot) });
    },
    back() {
      if (idx > 0) {
        if (historyOK) {
          try { history.back(); return; } catch (e) { historyOK = false; }
        }
        idx -= 1;
        show(stack[idx].name, stack[idx].params, { focus: true });
        return;
      }
      const home = cur && cur.name === "bench" ? "front" : "bench";
      router.go(views.has(home) ? home : "front", {}, { replace: true });
    },
    current() { return cur ? { name: cur.name, params: cur.params } : { name: null, params: {} }; },
    has(name) { return views.has(name); },
    parse() { return parseHash(location.hash); },
  };
  WB.router = router;

  /* ================================================================ icons */
  const ICONS = {
    camera: '<path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.6"/>',
    library: '<rect x="3.5" y="5.5" width="14" height="13" rx="1"/><path d="M6.5 3.5h14v13"/><path d="M3.5 15.5l4-4 3.5 3.5 2-2 4.5 4.5"/><circle cx="13.5" cy="9.5" r="1.3"/>',
    mail: '<rect x="3.5" y="6" width="17" height="12" rx="1"/><path d="M3.8 6.5L12 13l8.2-6.5"/>',
    back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    more: '<circle cx="6" cy="12" r=".9"/><circle cx="12" cy="12" r=".9"/><circle cx="18" cy="12" r=".9"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14" rx="1"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    drive: '<path d="M9 4.5h6l5.5 9.5-3 5.5h-11l-3-5.5z"/><path d="M9 4.5l5.5 9.5h6M15 4.5l-8.5 15M3.5 14h11"/>',
    flame: '<path d="M12 20.5c-3.6 0-6-2.4-6-5.6 0-3.4 3-5.3 3.6-9.4 2.6 1.6 4 4.1 4 6.3 1-.6 1.6-1.7 1.8-2.9 1.6 1.4 2.6 3.6 2.6 6 0 3.2-2.4 5.6-6 5.6z"/>',
    pin: '<path d="M12 21s-6-6.2-6-11a6 6 0 0112 0c0 4.8-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    spark: '<path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5M6.2 6.2l2.6 2.6M15.2 15.2l2.6 2.6M17.8 6.2l-2.6 2.6M8.8 15.2l-2.6 2.6"/>',
    wipe: '<rect x="3.5" y="5" width="17" height="14" rx="1"/><path d="M12 3v18"/><path d="M9 10l-2 2 2 2M15 10l2 2-2 2"/>',
    people: '<circle cx="9" cy="9" r="3"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="8.5" r="2.4"/><path d="M15.5 13.6c2.6-.3 4.6 1.4 5 4.4"/>',
    export: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M5 13v6.5h14V13"/>',
  };
  function icon(name) {
    const body = ICONS[name] || ICONS.spark;
    return '<svg class="wb-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + "</svg>";
  }

  /* ================================================================ hold */
  function hold(target, opts) {
    const o = opts || {};
    const ms = o.ms || 700;
    let active = false, start = 0, raf = 0, sx = 0, sy = 0, pid = null, justDone = 0, via = null;
    const setP = (p) => {
      target.style.setProperty("--hold", p.toFixed(3));
      if (typeof o.onProgress === "function") { try { o.onProgress(p); } catch (err) { console.error(err); } }
    };
    const tick = () => {
      if (!active) return;
      const p = Math.min(1, (performance.now() - start) / ms);
      setP(p);
      if (p >= 1) finish(); else raf = requestAnimationFrame(tick);
    };
    const begin = (how) => {
      if (active) return;
      active = true; via = how; start = performance.now();
      target.classList.add("wb-holding");
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      active = false; via = null; pid = null;
      cancelAnimationFrame(raf);
      target.classList.remove("wb-holding");
    };
    const finish = () => {
      const how = via;
      stop();
      justDone = Date.now();
      // the finger is still down: when it lifts, its click must not land on what the hold just opened
      if (how === "pointer") swallowClick(600);
      haptic(12);
      setTimeout(() => target.style.setProperty("--hold", "0"), 160);
      if (typeof o.onDone === "function") { try { o.onDone(); } catch (err) { console.error(err); } }
    };
    const cancel = () => {
      if (!active) return;
      stop();
      setP(0);
      if (typeof o.onCancel === "function") { try { o.onCancel(); } catch (err) { console.error(err); } }
    };
    const onDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      if (target.disabled || target.getAttribute("aria-disabled") === "true") return;
      // opts.enabled(): a hold that would mean nothing (or something false) never starts filling
      if (typeof o.enabled === "function" && !o.enabled()) { if (typeof o.onRefuse === "function") { try { o.onRefuse(); } catch (err) { console.error(err); } } return; }
      sx = e.clientX; sy = e.clientY; pid = e.pointerId;
      begin("pointer");
    };
    const onMove = (e) => {
      if (!active || via !== "pointer" || e.pointerId !== pid) return;
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
    };
    const onUp = (e) => { if (active && via === "pointer" && (pid == null || e.pointerId === pid)) cancel(); };
    const onKeyDown = (e) => {
      if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
        e.preventDefault();
        if (typeof o.enabled === "function" && !o.enabled()) { if (typeof o.onRefuse === "function") { try { o.onRefuse(); } catch (err) { console.error(err); } } return; }
        begin("key");
      }
      else if (e.key === "Enter" || e.key === " ") e.preventDefault();
    };
    const onKeyUp = (e) => { if ((e.key === "Enter" || e.key === " ") && via === "key") { e.preventDefault(); cancel(); } };
    const onClick = (e) => { if (Date.now() - justDone < 500) { e.preventDefault(); e.stopPropagation(); } };
    // touch: cancelling the touchend after a completed hold stops the compatibility click at the source
    const onTouchEnd = (e) => { if (Date.now() - justDone < 600 && e.cancelable) e.preventDefault(); };
    const onCtx = (e) => { if (active) e.preventDefault(); };
    const onBlur = () => cancel();

    target.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    target.addEventListener("keydown", onKeyDown);
    target.addEventListener("keyup", onKeyUp);
    target.addEventListener("click", onClick, true);
    target.addEventListener("touchend", onTouchEnd, { passive: false });
    target.addEventListener("contextmenu", onCtx);
    target.addEventListener("blur", onBlur);
    setP(0);
    return function dispose() {
      cancelAnimationFrame(raf);
      target.classList.remove("wb-holding");
      target.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("click", onClick, true);
      target.removeEventListener("touchend", onTouchEnd);
      target.removeEventListener("contextmenu", onCtx);
      target.removeEventListener("blur", onBlur);
    };
  }

  /* ================================================================ sheet */
  let openSheet = null;
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function sheetRoot() {
    let r = document.getElementById("wb-sheet-root");
    if (!r) { r = el("div", { id: "wb-sheet-root" }); document.body.appendChild(r); }
    return r;
  }
  function setInert(on) {
    const v = document.getElementById("wb-views");
    if (!v) return;
    if (on) v.setAttribute("inert", ""); else v.removeAttribute("inert");
  }

  function sheet(opts) {
    const o = opts || {};
    if (openSheet) openSheet.close({ instant: true, replaced: true });
    const titleId = uid("wb-sheet-t");
    const disposers = [];
    let closed = false;

    const header = el("div", { class: "wb-sheet__head" },
      el("span", { class: "wb-sheet__grip", "aria-hidden": "true" }),
      o.title ? el("h2", { class: "wb-sheet__title", id: titleId, text: o.title }) : null,
      el("button", { class: "wb-iconbtn wb-sheet__x", type: "button", "aria-label": "Close", html: icon("close"),
        on: { click: () => api.close() } }));

    let body = null;
    if (o.body instanceof Node) body = el("div", { class: "wb-sheet__body" }, o.body);
    else if (o.body != null && o.body !== "") body = el("div", { class: "wb-sheet__body" }, el("p", { class: "wb-sheet__text", text: String(o.body) }));

    const acts = (o.actions || []).filter(Boolean);
    const actRow = acts.length ? el("div", { class: "wb-sheet__actions" }) : null;
    acts.forEach((a) => {
      const kind = a.kind || "quiet";
      const btn = el("button", { type: "button", class: "wb-btn wb-btn--" + kind + (a.hold ? " wb-btn--hold" : "") },
        el("span", { class: "wb-btn__label", text: a.label || "OK" }));
      if (a.disabled) btn.disabled = true;
      const run = () => { if (typeof a.onTap === "function") { try { a.onTap(api.close); } catch (err) { console.error(err); } } else api.close(); };
      if (a.hold) {
        if (!/hold/i.test(a.label || "")) btn.appendChild(el("span", { class: "wb-btn__hold", "aria-hidden": "true", text: "HOLD" }));
        btn.setAttribute("aria-description", "Press and hold to confirm");
        disposers.push(hold(btn, { ms: 700, onDone: run }));
      } else btn.addEventListener("click", run);
      actRow.appendChild(btn);
    });

    const panel = el("div", { class: "wb-sheet", role: "dialog", "aria-modal": "true", tabindex: "-1" }, header, body, actRow);
    if (o.title) panel.setAttribute("aria-labelledby", titleId); else panel.setAttribute("aria-label", "Sheet");
    const scrim = el("div", { class: "wb-scrim", "aria-hidden": "true" });
    const wrap = el("div", { class: "wb-sheet-wrap" }, scrim, panel);
    const returnFocus = document.activeElement;

    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); api.close(); return; }
      if (e.key === "Tab") {
        const f = $$(FOCUSABLE, panel).filter((n) => n.offsetParent !== null || n === document.activeElement);
        if (!f.length) { e.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    // a click in the first moments after opening is the tail of the gesture that opened the sheet, not a dismissal
    const openedAt = Date.now();
    scrim.addEventListener("click", () => { if (Date.now() - openedAt < 350) return; api.close(); });

    // drag down from the header to dismiss
    let dragY = null, dy = 0, t0 = 0;
    header.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      dragY = e.clientY; dy = 0; t0 = performance.now();
      try { header.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      panel.classList.add("is-dragging");
    });
    header.addEventListener("pointermove", (e) => {
      if (dragY == null) return;
      dy = Math.max(0, e.clientY - dragY);
      panel.style.transform = "translateY(" + dy + "px)";
    });
    const endDrag = () => {
      if (dragY == null) return;
      const v = dy / Math.max(1, performance.now() - t0);
      dragY = null;
      panel.classList.remove("is-dragging");
      if (dy > 90 || (dy > 30 && v > 0.6)) api.close();
      else panel.style.transform = "";
    };
    header.addEventListener("pointerup", endDrag);
    header.addEventListener("pointercancel", endDrag);

    const api = {
      el: panel,
      close(how) {
        if (closed) return;
        closed = true;
        const instant = (how && how.instant) || reducedMotion();
        document.removeEventListener("keydown", onKey, true);
        disposers.forEach((d) => d());
        if (openSheet === api) openSheet = null;
        if (!openSheet) setInert(false);
        const done = () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
        if (instant) done();
        else { wrap.classList.remove("is-open"); wrap.classList.add("is-closing"); setTimeout(done, 260); }
        if (!(how && how.replaced) && returnFocus && returnFocus.focus && document.contains(returnFocus)) {
          try { returnFocus.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
        }
        if (typeof o.onClose === "function") { try { o.onClose(); } catch (err) { console.error(err); } }
      },
    };
    openSheet = api;
    sheetRoot().appendChild(wrap);
    setInert(true);
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => {
      wrap.classList.add("is-open");
      const first = actRow && actRow.querySelector("button:not([disabled])");
      const field = body && body.querySelector("input, textarea, select");
      try { (field || first || panel).focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    });
    return api;
  }

  /* ================================================================ toast */
  let toastNow = null;
  function toast(text, opts) {
    const o = opts || {};
    let root = document.getElementById("wb-toast-root");
    if (!root) { root = el("div", { id: "wb-toast-root", "aria-live": "polite" }); document.body.appendChild(root); }
    if (toastNow) toastNow.close(true);
    let timer = 0, gone = false;
    const node = el("div", { class: "wb-toast", role: "status" }, el("span", { class: "wb-toast__text", text: String(text == null ? "" : text) }));
    const api = {
      el: node,
      close(instant) {
        if (gone) return;
        gone = true;
        clearTimeout(timer);
        if (toastNow === api) toastNow = null;
        if (instant || reducedMotion()) node.remove();
        else { node.classList.remove("is-in"); setTimeout(() => node.remove(), 220); }
      },
    };
    if (o.action && o.action.label) {
      node.appendChild(el("button", { type: "button", class: "wb-toast__act", text: o.action.label, on: { click: () => {
        api.close();
        if (typeof o.action.onTap === "function") { try { o.action.onTap(); } catch (err) { console.error(err); } }
      } } }));
    }
    root.appendChild(node);
    toastNow = api;
    requestAnimationFrame(() => node.classList.add("is-in"));
    const ms = o.ms == null ? (o.action ? 5200 : 3200) : o.ms;
    if (ms > 0) {
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => api.close(), ms); };
      node.addEventListener("pointerenter", () => clearTimeout(timer));
      node.addEventListener("pointerleave", arm);
      node.addEventListener("focusin", () => clearTimeout(timer));
      arm();
    }
    return api;
  }

  /* ================================================================ pickPhoto */
  function pickPhoto(opts) {
    const source = opts && opts.source === "camera" ? "camera" : "library";
    let input = document.getElementById(source === "camera" ? "wb-file-camera" : "wb-file-library");
    let temp = false;
    if (!input) {
      input = el("input", { type: "file", accept: "image/*", hidden: true });
      if (source === "camera") input.setAttribute("capture", "environment");
      document.body.appendChild(input);
      temp = true;
    }
    return new Promise((resolve) => {
      let settled = false, focusTimer = 0;
      const settle = (file) => {
        if (settled) return;
        settled = true;
        clearTimeout(focusTimer);
        input.removeEventListener("change", onChange);
        input.removeEventListener("cancel", onCancel);
        window.removeEventListener("focus", onFocus);
        if (temp) input.remove();
        resolve(file || null);
      };
      const onChange = () => settle(input.files && input.files[0] ? input.files[0] : null);
      const onCancel = () => settle(null);
      // fallback for browsers without the input "cancel" event: focus comes back with no change
      const onFocus = () => { clearTimeout(focusTimer); focusTimer = setTimeout(() => { if (!input.files || !input.files.length) settle(null); }, 1500); };
      input.addEventListener("change", onChange);
      input.addEventListener("cancel", onCancel);
      setTimeout(() => window.addEventListener("focus", onFocus), 300);
      try { input.value = ""; } catch (e) { /* ignore */ }
      try { input.click(); } catch (e) { settle(null); }
    });
  }

  /* ================================================================ coach */
  function coach(target, text, opts) {
    const o = opts || {};
    const key = o.key || String(text).slice(0, 24);
    const prefs = uiPrefs();
    const seen = (prefs.coach && typeof prefs.coach === "object") ? prefs.coach : {};
    if (!target || seen[key]) return function () {};
    seen[key] = true;
    saveUiPrefs({ coach: seen });

    let root = document.getElementById("wb-coach-root");
    if (!root) { root = el("div", { id: "wb-coach-root" }); document.body.appendChild(root); }
    const placement = o.placement === "below" ? "below" : "above";
    const tag = el("div", { class: "wb-coach wb-coach--" + placement, role: "note" },
      el("span", { class: "wb-coach__text", text: String(text) }));
    let raf = 0, gone = false;
    const rectsOf = (list) => (list || []).map((n) => (n && n.getBoundingClientRect ? n.getBoundingClientRect() : n)).filter((r) => r && r.width);
    const hits = (a, rs) => rs.some((b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1);
    /* Candidates, in order: beside the target (placement side first), then the open edges of any "zones" (e.g. the gap
       above or below the sentence). The first one that covers nothing in opts.avoid and fits the visible band wins,
       so the tag never sits on the very numbers it is pointing at. */
    const place = () => {
      if (gone) return;
      if (!target.isConnected) { dispose(); return; }
      const r = target.getBoundingClientRect();
      const tw = tag.offsetWidth, th = tag.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const band = typeof o.bounds === "function" ? (o.bounds() || {}) : {};
      const bTop = isFinite(band.top) ? band.top : 0, bBot = isFinite(band.bottom) ? band.bottom : window.innerHeight;
      const cx = r.left + r.width / 2;
      const left = clamp(cx - tw / 2, 12, Math.max(12, vw - tw - 12));
      const avoid = rectsOf(typeof o.avoid === "function" ? o.avoid() : o.avoid);
      const cands = [];
      const above = { top: r.top - th - 10, side: "above" }, below = { top: r.bottom + 10, side: "below" };
      if (placement === "above") cands.push(above, below); else cands.push(below, above);
      rectsOf(typeof o.zones === "function" ? o.zones() : o.zones).forEach((z) => {
        cands.push({ top: z.top - th - 8, side: z.top - th - 8 < r.top ? "above" : "below" });
        cands.push({ top: z.bottom + 8, side: z.bottom + 8 < r.top ? "above" : "below" });
      });
      let pick = null;
      for (const c of cands) {
        const box = { left, right: left + tw, top: c.top, bottom: c.top + th };
        if (box.top < bTop + 4 || box.bottom > bBot - 4) continue;
        if (avoid.length && hits(box, avoid)) continue;
        pick = c; break;
      }
      const vis = !!pick && !(r.bottom < bTop || r.top > bBot);
      const c = pick || cands[0];
      tag.className = "wb-coach wb-coach--" + c.side + (tag.classList.contains("is-in") ? " is-in" : "");
      tag.style.transform = "translate(" + Math.round(left) + "px," + Math.round(c.top) + "px)";
      tag.style.setProperty("--nub", Math.round(clamp(cx - left, 14, tw - 14)) + "px");
      tag.hidden = !vis;
      raf = requestAnimationFrame(place);
    };
    const dispose = () => {
      if (gone) return;
      gone = true;
      cancelAnimationFrame(raf);
      tag.classList.remove("is-in");
      setTimeout(() => tag.remove(), reducedMotion() ? 0 : 200);
    };
    tag.addEventListener("click", dispose);
    root.appendChild(tag);
    place();
    requestAnimationFrame(() => tag.classList.add("is-in"));
    return dispose;
  }

  /* ================================================================ theme */
  function setTheme(t) {
    const theme = t === "light" || t === "dark" ? t : "auto";
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme; else root.dataset.theme = theme;
    saveUiPrefs({ theme });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      try {
        const bg = getComputedStyle(document.body || root).getPropertyValue("--paper").trim();
        if (bg) meta.setAttribute("content", bg);
      } catch (e) { /* ignore */ }
    }
    bus.emit("theme:changed", { theme });
    return theme;
  }

  WB.bus = bus;
  WB.ui = { sheet, toast, hold, pickPhoto, icon, coach, setTheme };
})();
