/* ---- Workbench instrument (Victor) ----
   The instrument view and the tactile core: the specimen photo with brackets and pins, the live serif
   sentence whose chips you drag, the hairlines from what Claude read to the numbers it became, the hinge,
   the chart, the commit hold, evidence reveals, and the bench's mini tiles.
   Live values stay in a view-local override map during a drag; the store is written once, on drag end.
   Registers functions only: no DOM work and no calls into other modules at load. */
(function () {
  "use strict";
  const WB = window.WB;

  const DAY = 86400000;
  const STEP_PX = 8;           // 1 step per 8 px
  const CAPTURE_PX = 6;        // horizontal travel before the chip takes the pointer
  const FAST = 1.2;            // px/ms: above this, steps count triple
  const SCRUB_MS = 33;         // instrument:scrub ≤ 30/s
  const BUZZ_MS = 40;          // step haptics at most every 40 ms
  const MAIL_MOLDS = ["leak", "perUse", "countdown"];

  /* ================================================================ guarded access */
  const U = () => (WB && WB.util) || {};
  const has = (mod, fn) => !!(WB && WB[mod] && typeof WB[mod][fn] === "function");
  function call(mod, fn) {
    if (!has(mod, fn)) return undefined;
    const args = Array.prototype.slice.call(arguments, 2);
    try { return WB[mod][fn].apply(WB[mod], args); }
    catch (err) { console.error("[WB.instrument] " + mod + "." + fn, err); return undefined; }
  }
  function emit(name, payload) { if (has("bus", "emit")) WB.bus.emit(name, payload); }
  function on(name, fn) { return has("bus", "on") ? WB.bus.on(name, fn) : () => {}; }
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = () => (typeof U().reducedMotion === "function" ? U().reducedMotion() : false);
  const raf = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 16));
  const caf = (id) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  function h(tag, attrs) {
    const kids = Array.prototype.slice.call(arguments, 2);
    if (typeof U().el === "function") return U().el.apply(null, [tag, attrs].concat(kids));
    const n = document.createElement(tag);
    if (attrs && attrs.class) n.className = attrs.class;
    if (attrs && attrs.text != null) n.textContent = attrs.text;
    kids.forEach((k) => { if (k != null && k !== false) n.appendChild(k instanceof Node ? k : document.createTextNode(String(k))); });
    return n;
  }
  function svgEl(tag, attrs) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs || {}) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    return n;
  }
  function icon(name) { return has("ui", "icon") ? WB.ui.icon(name) : ""; }
  function haptic(ms) { if (typeof U().haptic === "function") U().haptic(ms); else { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* no */ } } }
  function fmtDay(ms) {
    if (typeof U().fmtDay === "function") return U().fmtDay(ms);
    return new Date(ms).toDateString().slice(0, 10);
  }
  // molds.sentence returns HTML-escaped text; we insert with textContent, so undo the escaping first
  const UNESC = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'" };
  const unescape = (s) => String(s == null ? "" : s).replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => UNESC[m] || m);

  /* ================================================================ mold helpers */
  const M = () => (WB && WB.molds) || null;
  function moldDef(inst) { return inst && has("molds", "get") ? WB.molds.get(inst.mold) : null; }
  function compute(inst, ov) {
    const r = inst && has("molds", "compute") ? call("molds", "compute", inst, ov) : null;
    return r || { outputs: {}, primary: NaN, series: null };
  }
  function fmt(v, f, inst, o) {
    if (has("molds", "format")) {
      try { return WB.molds.format(v, f, inst, o); } catch (e) { /* fall through */ }
    }
    if (!isNum(v)) return "—";
    if (f === "usd") return typeof U().fmtUSD === "function" ? U().fmtUSD(v) : "$" + Math.round(v);
    return String(Math.round(v * 10) / 10);
  }
  function tokens(inst, ov) {
    if (!inst || !has("molds", "sentence")) return [];
    const t = call("molds", "sentence", inst, ov);
    return Array.isArray(t) ? t : [];
  }
  function hingeOf(inst) {
    const r = inst && has("molds", "hinge") ? call("molds", "hinge", inst) : null;
    return r || { varId: null, impact: 0, isLever: false, note: "" };
  }
  function confOf(inst) {
    const r = inst && has("molds", "confidence") ? call("molds", "confidence", inst) : null;
    return r || { measured: 0, total: 0, ratio: 0 };
  }
  function ghostOf(inst) {
    const r = inst && has("molds", "ghost") ? call("molds", "ghost", inst) : null;
    return r || { status: "none", points: [], due: false };
  }
  function outcomeAt(inst, ov) {
    if (has("molds", "outcome")) {
      const r = call("molds", "outcome", inst, ov);
      if (r && isNum(r.value)) return r.value;
    }
    return compute(inst, ov).primary;
  }
  /* the draggable range; levers come back narrowed to their honest bounds (never past "as it is") */
  function rangeOf(inst, id, ov) {
    const v = inst && inst.vars && inst.vars[id];
    const r = has("molds", "range") ? call("molds", "range", inst, id, ov) : null;
    if (r && isNum(r.min) && isNum(r.max)) return { min: r.min, max: r.max, step: r.step > 0 ? r.step : 1 };
    if (v && isNum(v.min) && isNum(v.max) && v.max > v.min) return { min: v.min, max: v.max, step: v.step > 0 ? v.step : 1 };
    const val = v && isNum(v.value) ? v.value : 0;
    return { min: Math.min(0, val), max: Math.max(10, val * 3), step: 1 };
  }
  function decimals(step) {
    const s = String(step);
    const i = s.indexOf(".");
    return i < 0 ? 0 : Math.min(6, s.length - i - 1);
  }
  function quantize(v, r) {
    const q = Math.round((v - r.min) / r.step) * r.step + r.min;
    return +clamp(q, r.min, r.max).toFixed(decimals(r.step));
  }
  function valueOf(S, id) {
    if (S.ov && isNum(S.ov[id])) return S.ov[id];
    const v = S.inst && S.inst.vars && S.inst.vars[id];
    if (!v || !isNum(v.value)) return NaN;
    if (v.kind === "lever") { const r = rangeOf(S.inst, id, S.ov); return clamp(v.value, r.min, r.max); }
    return v.value;
  }
  function verdictOf(S, id, value) {
    if (!has("molds", "verdict")) return "na";
    return call("molds", "verdict", S.inst, id, value, S.ov) || "na";
  }
  /* "1 a week", "6 uses a month", "3 tonight": the lever said the way the sentence says it */
  function leverPhrase(inst, id, value) {
    const v = inst.vars[id];
    const n = fmt(value, v ? v.format : "num", inst);
    const w = inst.words || {};
    if (inst.mold === "leak") return n + " a " + (w.period === "month" ? "month" : "week");
    if (inst.mold === "perUse") return n + (Math.abs(value - 1) < 1e-9 ? " use" : " uses") + " a month";
    if (inst.mold === "spoil") return n + " tonight";
    if (inst.mold === "dial") return n + " " + (w.stepUnit || "steps");
    if (inst.mold === "countdown") return n + " early";
    if (inst.mold === "reset") return n + (Math.abs(value - 1) < 1e-9 ? " move" : " moves");
    if (inst.mold === "project" || inst.mold === "zones") return n + " a week";
    if (inst.mold === "week") return n + (Math.abs(value - 1) < 1e-9 ? " family evening" : " family evenings");
    return n;
  }
  function draggable(S, v) { return !S.readOnly && !!v && (v.kind === "lever" || v.origin !== "seen"); }
  function originClass(v) { return v.kind === "lever" ? "lever" : (v.origin === "seen" || v.origin === "inferred" || v.origin === "assumed" || v.origin === "set") ? v.origin : "inferred"; }
  const ORIGIN_WORD = { seen: "read from the source", inferred: "inferred", assumed: "a guess", set: "set by you", lever: "your call" };
  function evidenceById(inst, id) { return id && inst && Array.isArray(inst.evidence) ? inst.evidence.find((e) => e.id === id) || null : null; }
  function leverIds(S) {
    const out = [];
    tokens(S.inst, S.ov).forEach((t) => { if (t.t === "var" && S.inst.vars[t.id] && S.inst.vars[t.id].kind === "lever") out.push(t.id); });
    return out;
  }
  function isLocked(inst) { return !!(inst && has("store", "isHidden") && call("store", "isHidden", inst)); }
  function isTyped(inst) { return !!inst && (inst.mold === "project" || inst.mold === "week"); }
  function tracksDone(inst) { const d = moldDef(inst); return !!(d && d.tracks === "done"); }
  function zonesOf(inst) { return inst && Array.isArray(inst.zones) ? inst.zones.slice().sort((a, b) => (a.n || 0) - (b.n || 0)) : []; }
  function nextZoneOf(inst) {
    const z = has("molds", "nextZone") ? call("molds", "nextZone", inst) : null;
    if (z !== undefined && z !== null) return z;
    return zonesOf(inst).find((x) => x.state !== "done") || null;
  }
  function singular(u) {
    const w = String(u || "piece");
    if (/ies$/i.test(w)) return w.replace(/ies$/i, "y");
    if (/(ses|xes|ches|shes)$/i.test(w)) return w.replace(/es$/i, "");
    if (/s$/i.test(w) && !/ss$/i.test(w)) return w.slice(0, -1);
    return w;
  }
  function caps() { return has("app", "caps") ? call("app", "caps") || null : null; }
  function storeGet(id) { return id && has("store", "get") ? call("store", "get", id) || null : null; }

  /* ================================================================ mount registry */
  const mounts = new Set();
  let viewS = null;          // the mount inside #view-instrument
  let inited = false;
  let sessionLeverMoved = false;
  let hiddenMail = false;    // 'not_granted' hides the mail chip for this load

  /* ================================================================ building the view */
  function mount(el, id, opts) {
    if (!el || typeof document === "undefined") return null;
    const o = opts || {};
    const prev = Array.from(mounts).find((m) => m.root === el);
    if (prev) destroy(prev);
    const snapshot = o.snapshot ? clone(o.snapshot) : null;
    const inst = snapshot || (id ? clone(storeGet(id)) : null);
    const S = {
      root: el, id: (inst && inst.id) || id || null, inst, ov: {}, readOnly: !!(o.readOnly || snapshot),
      develop: !!o.develop && !reduced(), refs: {}, chips: {}, textNodes: [], sentSig: "", chart: null,
      holds: [], offs: [], timers: [], live: null, rafId: 0, hairRaf: 0, tweens: new Map(), strip: null,
      mail: { state: "idle", jobId: null, queries: [], summary: null, error: null }, coachOff: null,
      hinge: null, peerTimers: {}, missionTimer: 0, zoomed: false, leverMoved: false, inkNext: false,
      lastIntentionAt: inst && inst.intention ? inst.intention.committedAt : null, destroyed: false, chrome: o.chrome !== false,
    };
    mounts.add(S);
    el.textContent = "";
    if (!inst) { renderMissing(S); return handleFor(S); }
    if (!S.readOnly && isLocked(inst)) { buildLocked(S); return handleFor(S); }
    build(S);
    if (!S.readOnly) emit("instrument:open", { id: S.id });
    return handleFor(S);
  }

  function handleFor(S) {
    return {
      el: S.root,
      get id() { return S.id; },
      update(next) { if (next && next.mold) refresh(S, clone(next), "system"); else refresh(S, null, "system"); },
      applyScrub(varId, value, peer) { peerScrub(S, varId, value, peer); },
      flash(key) { flashKey(S, key); },
      destroy() { destroy(S); },
    };
  }

  function renderMissing(S) {
    const box = h("div", { class: "ins ins--missing" },
      h("p", { class: "ins-missing__t wb-serif", text: "This one isn’t on the bench any more." }),
      h("p", { class: "ins-missing__s", text: "It may have been melted, or it lives on another device that hasn’t synced yet." }));
    if (!S.readOnly) {
      box.appendChild(h("button", { class: "wb-btn wb-btn--quiet", type: "button", text: "Back to the bench",
        on: { click: () => { if (has("router", "go")) WB.router.go("bench", {}, { replace: true }); } } }));
    }
    S.root.appendChild(box);
  }

  /* "Home never shows work": a clocked-out work instrument renders only this card. No title, numbers, photo or steps. */
  function buildLocked(S) {
    S.locked = true;
    const root = h("div", { class: "ins ins--locked", dataset: { mold: S.inst.mold } });
    S.refs.wrap = root;
    const top = h("header", { class: "ins-top" },
      h("button", { class: "wb-iconbtn ins-top__back", type: "button", "aria-label": "Back", html: icon("back"),
        on: { click: () => { if (has("router", "back")) WB.router.back(); } } }));
    root.appendChild(top);
    const card = h("div", { class: "ins-lock", role: "group", "aria-label": "Clocked out" },
      h("span", { class: "wb-micro ins-lock__tag", text: "WORK · CLOCKED OUT" }),
      h("p", { class: "ins-lock__line wb-serif", text: "Clocked out. This one waits for Clock in." }),
      h("button", { class: "wb-btn wb-btn--primary ins-lock__btn", type: "button",
        on: { click: () => {
          if (has("bench", "clockIn")) call("bench", "clockIn");
          else if (has("store", "setSide")) call("store", "setSide", "work");
        } } }, h("span", { class: "wb-btn__label", text: "Clock in" })));
    root.appendChild(card);
    S.root.appendChild(root);
  }

  function build(S) {
    const inst = S.inst;
    const root = h("div", { class: "ins" + (S.readOnly ? " ins--readonly" : "") + (S.develop ? " is-developing" : "") + (inst.demo ? " ins--demo" : ""), dataset: { mold: inst.mold } });
    S.refs.wrap = root;
    if (S.chrome) root.appendChild(buildTop(S));
    const body = h("div", { class: "ins-body" });
    S.refs.body = body;
    S.refs.mission = h("button", { class: "ins-mission", type: "button", hidden: true, on: { click: () => { if (has("router", "go")) WB.router.go("mission", { id: S.id }); } } });
    body.appendChild(S.refs.mission);
    body.appendChild(buildSpecimen(S));
    S.refs.sentence = h("p", { class: "ins-sentence wb-serif" });
    body.appendChild(S.refs.sentence);
    S.refs.nextcard = h("div", { class: "ins-next", hidden: true });
    body.appendChild(S.refs.nextcard);
    S.refs.strip = h("div", { class: "ins-strip", "aria-live": "polite", hidden: true });
    body.appendChild(S.refs.strip);
    S.refs.hinge = h("p", { class: "ins-hinge", hidden: true });
    body.appendChild(S.refs.hinge);
    S.refs.chart = h("div", { class: "ins-chart" });
    body.appendChild(S.refs.chart);
    S.refs.coach2 = h("p", { class: "ins-coach2", role: "note", hidden: true, on: { click: () => { S.refs.coach2.hidden = true; scheduleHair(S); } } });
    body.appendChild(S.refs.coach2);
    S.refs.list = h("ol", { class: "ins-list", hidden: true });
    body.appendChild(S.refs.list);
    S.refs.conf = h("div", { class: "ins-conf" });
    body.appendChild(S.refs.conf);
    S.refs.note = h("p", { class: "ins-note wb-serif", hidden: true });
    body.appendChild(S.refs.note);
    S.refs.next = h("p", { class: "ins-keep", hidden: true });
    body.appendChild(S.refs.next);
    const hair = svgEl("svg", { class: "ins-hair", "aria-hidden": "true", focusable: "false" });
    S.refs.hair = hair;
    body.appendChild(hair);
    root.appendChild(body);
    if (!S.readOnly) {
      S.refs.bar = h("div", { class: "wb-bar ins-bar" });
      S.refs.ruler = h("div", { class: "ins-ruler", "aria-hidden": "true", hidden: true });
      S.refs.peek = h("div", { class: "ins-peek", "aria-hidden": "true", hidden: true });
      root.appendChild(S.refs.peek);
      root.appendChild(S.refs.bar);
      root.appendChild(S.refs.ruler);
    }
    S.root.appendChild(root);

    wireSentence(S);
    renderAll(S, S.develop ? { first: true, countUp: true, delay: 560 } : { first: true });

    // layout-dependent passes
    const relayout = () => { if (S.destroyed) return; drawOverlay(S); renderChart(S); scheduleHair(S); };
    const onResize = () => { caf(S.resizeRaf); S.resizeRaf = raf(relayout); };
    window.addEventListener("resize", onResize);
    S.offs.push(() => window.removeEventListener("resize", onResize));
    if (typeof ResizeObserver === "function") {
      let lastW = 0;
      const ro = new ResizeObserver((entries) => {
        const w = entries[0] && entries[0].contentRect ? Math.round(entries[0].contentRect.width) : 0;
        if (w && w !== lastW) { lastW = w; onResize(); } else scheduleHair(S);
      });
      ro.observe(body);
      S.offs.push(() => ro.disconnect());
    }
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!S.destroyed) scheduleHair(S); }); } catch (e) { /* ignore */ }
    const pd = (e) => { if (S.coachOff && !e.target.closest(".wb-coach")) dismissCoach(S); };
    root.addEventListener("pointerdown", pd, true);

    if (S.develop) runDevelop(S);
    else later(S, () => coachDrag(S), 700);
  }

  /* ---------------------------------------------------------------- top bar */
  function buildTop(S) {
    const inst = S.inst;
    const top = h("header", { class: "ins-top" });
    if (!S.readOnly) {
      top.appendChild(h("button", { class: "wb-iconbtn ins-top__back", type: "button", "aria-label": "Back", html: icon("back"),
        on: { click: () => { if (has("router", "back")) WB.router.back(); } } }));
    }
    const head = h("div", { class: "ins-top__head" });
    S.refs.title = h("h1", { class: "ins-top__title", text: inst.title || "Instrument" });
    S.refs.sys = h("span", { class: "wb-micro ins-top__sys" });
    head.appendChild(S.refs.title);
    head.appendChild(S.refs.sys);
    top.appendChild(head);
    if (!S.readOnly) {
      top.appendChild(h("button", { class: "wb-iconbtn ins-top__more", type: "button", "aria-label": "More for this instrument", "aria-haspopup": "dialog", html: icon("more"),
        on: { click: () => openMenu(S) } }));
    }
    return top;
  }
  function renderTop(S) {
    if (!S.refs.title) return;
    const inst = S.inst;
    S.refs.title.textContent = inst.title || "Instrument";
    const bits = [String(inst.system || (moldDef(inst) && moldDef(inst).system) || "").toUpperCase()];
    if (inst.demo) bits.push("EXAMPLE");
    S.refs.sys.textContent = bits.filter(Boolean).join(" · ");
  }

  function openMenu(S) {
    if (!has("ui", "sheet")) return;
    const inst = S.inst;
    const c = caps() || {};
    const actions = [];
    actions.push({ label: "Re-photograph to update", kind: "quiet", onTap: (close) => { close(); rephotograph(S); } });
    const g = inst.intention ? ghostOf(inst) : null;
    if (g && (g.status === "open" || g.due)) {
      // a promise you can always take back, without it counting as missed
      actions.push({ label: "Let this promise go", kind: "quiet", onTap: (close) => {
        close();
        if (has("store", "setIntention")) call("store", "setIntention", S.id, null);
        toast("Let go. It doesn’t count as missed.");
      } });
    }
    if (mailAllowed(S)) actions.push({ label: "Check my mail for more", kind: "quiet", onTap: (close) => { close(); startEnrich(S); } });
    if (has("room", "shareInstrument") && c.room) {
      actions.push({ label: "Show to someone here", kind: "quiet", onTap: (close) => { close(); call("room", "shareInstrument", S.id); } });
    }
    actions.push({ label: "Hold to melt this instrument", kind: "danger", hold: true, onTap: (close) => { close(); melt(S); } });
    const body = h("div", { class: "ins-menu" },
      h("p", { class: "ins-menu__line", text: describeOrigins(inst) }),
      h("p", { class: "ins-menu__melt", text: "Melting takes it off the bench and tells Claude you don’t want ones like it." }));
    WB.ui.sheet({ title: inst.title || "Instrument", body, actions });
  }
  function describeOrigins(inst) {
    const c = confOf(inst);
    const src = inst.photo ? "a photo" : isTyped(inst) ? "what you typed" : "your mail";
    const when = inst.createdAt ? " on " + fmtDay(inst.createdAt) : "";
    return "Built from " + src + when + ". Measured " + c.measured + " of " + c.total + ".";
  }
  function rephotograph(S) {
    if (has("app", "capture")) {
      const r = call("app", "capture", { intent: "snap", instrumentId: S.id });
      if (r && typeof r.catch === "function") r.catch((err) => console.error("[WB.instrument] capture", err));
    } else toast("Photos need the full app.");
  }
  function melt(S) {
    if (!has("store", "melt")) { toast("Can’t melt right now."); return; }
    const r = call("store", "melt", S.id);
    const after = () => {
      if (viewS === S && has("router", "current") && WB.router.current().name === "instrument") WB.router.go("bench", {}, { replace: true });
    };
    if (r && typeof r.then === "function") r.then(after, after); else after();
  }
  function toast(t, o) { if (has("ui", "toast")) WB.ui.toast(t, o); }

  /* ---------------------------------------------------------------- specimen */
  function buildSpecimen(S) {
    const inst = S.inst;
    const fig = h("figure", { class: "ins-spec" });
    S.refs.spec = fig;
    S.refs.img = S.refs.ov = S.refs.frame = S.refs.inner = S.refs.press = S.refs.plate = null;
    S.brackets = null; S.pins = null; S.plateChart = null; S.plateNum = null;
    const photo = inst.photo || (Array.isArray(inst.photos) && inst.photos.length ? inst.photos[inst.photos.length - 1] : null);
    if (photo && (photo.src || photo.thumb)) {
      const mat = h("div", { class: "ins-spec__mat" });
      const frame = h("div", { class: "ins-spec__frame" });
      const inner = h("div", { class: "ins-spec__inner" });
      const img = h("img", { class: "ins-spec__img", alt: photoAlt(inst), decoding: "async", draggable: "false" });
      if (isNum(photo.w) && isNum(photo.h) && photo.w > 0 && photo.h > 0) {
        img.setAttribute("width", photo.w);
        img.setAttribute("height", photo.h);
        frame.style.setProperty("--ar", photo.w + " / " + photo.h);
      }
      let triedThumb = false;
      img.addEventListener("load", () => { if (!S.destroyed) { drawOverlay(S); scheduleHair(S); if (S.develop) fig.classList.add("is-loaded"); } });
      img.addEventListener("error", () => {
        if (!triedThumb && photo.thumb && img.src !== photo.thumb) { triedThumb = true; img.src = photo.thumb; return; }
        fig.classList.add("is-broken");
        frame.setAttribute("data-msg", "PHOTO UNAVAILABLE");
      });
      img.src = photo.src || photo.thumb;
      const overlay = svgEl("svg", { class: "ins-spec__ov", focusable: "false" });
      inner.appendChild(img);
      inner.appendChild(overlay);
      frame.appendChild(inner);
      frame.addEventListener("click", (e) => {
        if (S.zoomed) { e.preventDefault(); unzoom(S); }
      });
      mat.appendChild(frame);
      fig.appendChild(mat);
      S.refs.img = img; S.refs.frame = frame; S.refs.inner = inner; S.refs.ov = overlay;
      overlay.addEventListener("click", (e) => onOverlayTap(S, e));
      overlay.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOverlayTap(S, e); } });
    } else if (isTyped(inst) && !(inst.evidence || []).some((e) => e.type === "email")) {
      fig.classList.add("ins-spec--plate");
      fig.appendChild(buildPlate(S));
    } else {
      fig.classList.add("ins-spec--press");
      fig.appendChild(buildPress(S));
    }
    S.refs.cap = h("figcaption", { class: "ins-spec__cap wb-micro", "aria-live": "polite" });
    fig.appendChild(S.refs.cap);
    return fig;
  }
  function photoAlt(inst) {
    const t = inst.title || "this";
    return inst.demo ? "Example drawing: " + t : "Your photo: " + t;
  }

  /* a typed instrument has no photo: the week is its own chart, a project is a serif title and a big count */
  function buildPlate(S) {
    const inst = S.inst;
    const plate = h("div", { class: "ins-plate ins-plate--" + inst.mold });
    S.refs.plate = plate;
    if (inst.mold === "week") {
      S.plateChart = h("div", { class: "ins-plate__chart" });
      plate.appendChild(S.plateChart);
      return plate;
    }
    plate.appendChild(h("p", { class: "ins-plate__title wb-serif", text: inst.title || "Project" }));
    S.plateNum = h("p", { class: "ins-plate__num wb-mono" });
    plate.appendChild(S.plateNum);
    if (!S.readOnly) {
      plate.appendChild(h("button", { class: "wb-btn wb-btn--quiet ins-plate__add", type: "button", text: "Add a photo",
        on: { click: () => { if (has("app", "capture")) { const r = call("app", "capture", { intent: "snap", instrumentId: S.id, source: "ask" }); if (r && typeof r.catch === "function") r.catch((err) => console.error("[WB.instrument] capture", err)); } else toast("Photos need the full app."); } } }));
    }
    return plate;
  }
  function renderPlate(S) {
    const n = S.plateNum;
    if (!n || !S.inst) return;
    const done = valueOf(S, "done"), total = valueOf(S, "total");
    const unit = (S.inst.words && S.inst.words.unit) || "pieces";
    n.textContent = "";
    n.appendChild(h("span", { class: "ins-plate__big", text: (isNum(done) ? Math.round(done) : "—") + "/" + (isNum(total) ? Math.round(total) : "—") }));
    n.appendChild(h("span", { class: "ins-plate__unit", text: " " + unit }));
  }
  function chartBox(S) { return S.plateChart || S.refs.chart; }

  /* letterpress specimen for instruments forged from mail: subject, sender, the quoted line, in mono on paper-3 */
  function buildPress(S) {
    const inst = S.inst;
    const press = h("div", { class: "ins-press" });
    const evs = (inst.evidence || []).filter((e) => e.type === "email").slice(0, 3);
    if (!evs.length) {
      press.appendChild(h("p", { class: "ins-press__subj", text: inst.title || "From your mail" }));
      press.appendChild(h("p", { class: "ins-press__meta", text: "NO PHOTO · BUILT FROM YOUR MAIL" }));
    }
    let prevKey = null, block = null;
    evs.forEach((e, i) => {
      // quotes from the same email share one header
      const key = (e.threadId || "") + "|" + (e.subject || "") + "|" + (e.sender || "");
      if (!block || key !== prevKey) {
        block = h("div", { class: "ins-press__block", dataset: { ev: e.id } });
        if (i === 0 || e.subject) block.appendChild(h("p", { class: "ins-press__subj", text: e.subject || inst.title || "Email" }));
        const meta = [e.sender, e.date].filter(Boolean).join(" · ");
        if (meta) block.appendChild(h("p", { class: "ins-press__meta", text: meta }));
        press.appendChild(block);
      }
      prevKey = key;
      if (e.quote) {
        const q = h("button", { class: "ins-press__quote", type: "button", dataset: { ev: e.id }, text: "“" + e.quote + "”",
          on: { click: () => flashKey(S, e.id) } });
        block.appendChild(q);
      }
    });
    press.appendChild(h("span", { class: "ins-press__stamp wb-micro", text: inst.demo ? "EXAMPLE · MAIL" : "FROM YOUR MAIL" }));
    S.refs.press = press;
    return press;
  }

  /* overlay: corner brackets at evidence boxes, numbered pins for items/steps. Pixel-true, redrawn on resize. */
  function frameSize(S) {
    const img = S.refs.img;
    if (!img) return null;
    const w = img.clientWidth, hh = img.clientHeight;
    if (!w || !hh) return null;
    return { w, h: hh };
  }
  function pinStates(S) {
    const inst = S.inst, out = {};
    if (inst.mold === "spoil") {
      const c = compute(inst, S.ov);
      const marks = c.series && Array.isArray(c.series.marks) ? c.series.marks : [];
      marks.forEach((m) => { out[m.id] = m.state; });
      (inst.items || []).forEach((it) => { if (it.cooked) out[it.id] = "cooked"; });
    } else if (inst.mold === "reset") {
      const take = valueOf(S, "take");
      const steps = (inst.steps || []).slice().sort((a, b) => a.n - b.n);
      steps.forEach((s, i) => { out[s.id] = s.done ? "done" : i < (isNum(take) ? take : steps.length) ? "on" : "off"; });
    }
    return out;
  }
  function pinList(S) {
    const inst = S.inst;
    if (inst.mold === "reset" || (inst.steps && inst.steps.length && !(inst.items && inst.items.length))) {
      return (inst.steps || []).slice().sort((a, b) => a.n - b.n).map((s, i) => ({ id: s.id, n: s.n || i + 1, pin: s.pin, label: s.text }));
    }
    return (inst.items || []).map((it, i) => ({ id: it.id, n: i + 1, pin: it.pin, label: it.name }));
  }
  function drawOverlay(S) {
    const ov = S.refs.ov;
    if (!ov) return;
    const sz = frameSize(S);
    if (!sz) return;
    const inst = S.inst;
    ov.setAttribute("width", sz.w);
    ov.setAttribute("height", sz.h);
    ov.setAttribute("viewBox", "0 0 " + sz.w + " " + sz.h);
    ov.textContent = "";
    S.brackets = {};
    const evs = (inst.evidence || []).filter((e) => e.type === "photo" && Array.isArray(e.bbox) && e.bbox.length === 4 && (e.photoIndex == null || e.photoIndex === 0));
    const varFor = {};
    for (const k in inst.vars || {}) if (inst.vars[k] && inst.vars[k].evidenceId) varFor[inst.vars[k].evidenceId] = k;
    evs.forEach((e, i) => {
      const [bx, by, bw, bh] = e.bbox.map(Number);
      const x = bx * sz.w, y = by * sz.h, w = Math.max(6, bw * sz.w), hh = Math.max(6, bh * sz.h);
      const L = Math.min(12, w / 2, hh / 2);
      const d = "M" + x + " " + (y + L) + "V" + y + "H" + (x + L) +
        "M" + (x + w - L) + " " + y + "H" + (x + w) + "V" + (y + L) +
        "M" + (x + w) + " " + (y + hh - L) + "V" + (y + hh) + "H" + (x + w - L) +
        "M" + (x + L) + " " + (y + hh) + "H" + x + "V" + (y + hh - L);
      const label = varFor[e.id] && inst.vars[varFor[e.id]] ? inst.vars[varFor[e.id]].label : "evidence";
      const g = svgEl("g", { class: "ins-br", "data-ev": e.id, style: "--i:" + i, role: "button", tabindex: S.readOnly ? null : "0",
        "aria-label": "Where I read " + (e.text ? "“" + e.text + "”" : label) });
      const hitW = Math.max(44, w), hitH = Math.max(44, hh);
      g.appendChild(svgEl("rect", { class: "ins-br__hit", x: x + w / 2 - hitW / 2, y: y + hh / 2 - hitH / 2, width: hitW, height: hitH }));
      g.appendChild(svgEl("path", { class: "ins-br__halo", d }));
      g.appendChild(svgEl("path", { class: "ins-br__line", d }));
      ov.appendChild(g);
      S.brackets[e.id] = { g, cx: x + w / 2, cy: y + hh / 2, varId: varFor[e.id] || null };
    });
    if (inst.mold === "zones") drawZones(S, ov, sz);
    const states = pinStates(S);
    S.pins = {};
    pinList(S).forEach((p) => {
      if (!Array.isArray(p.pin)) return;
      const cx = clamp(p.pin[0], 0, 1) * sz.w, cy = clamp(p.pin[1], 0, 1) * sz.h;
      const st = states[p.id] || "safe";
      const g = svgEl("g", { class: "ins-pin ins-pin--" + st, "data-pin": p.id, role: "button", tabindex: S.readOnly ? null : "0", "aria-label": p.n + ": " + p.label });
      g.appendChild(svgEl("circle", { class: "ins-pin__hit", cx, cy, r: 22 }));
      g.appendChild(svgEl("circle", { class: "ins-pin__dot", cx, cy, r: 11 }));
      const t = svgEl("text", { class: "ins-pin__n", x: cx, y: cy + 4, "text-anchor": "middle" });
      t.textContent = String(p.n);
      g.appendChild(t);
      ov.appendChild(g);
      S.pins[p.id] = g;
    });
  }
  /* zone map: clear zones are filled, the next one pulses, the rest are dashed outlines.
     Labels are drawn last, in their own layer, and nudged so no two collide: every name stays readable and tappable. */
  function drawZones(S, ov, sz) {
    const next = nextZoneOf(S.inst);
    const LH = 18, GAP = 2;
    const placed = [];
    const hits = (a) => placed.some((b) => a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y);
    const labels = [];
    zonesOf(S.inst).forEach((z) => {
      if (!Array.isArray(z.bbox) || z.bbox.length !== 4) return;
      const [bx, by, bw, bh] = z.bbox.map(Number);
      const x = bx * sz.w, y = by * sz.h, w = Math.max(14, bw * sz.w), hh = Math.max(14, bh * sz.h);
      const st = z.state === "done" ? "done" : next && next.id === z.id ? "next" : "todo";
      const g = svgEl("g", { class: "ins-zone ins-zone--" + st, "data-zone": z.id, role: "button", tabindex: S.readOnly ? null : "0",
        "aria-label": z.name + ", " + (st === "done" ? "clear" : st === "next" ? "next" : "later") });
      const hitW = Math.max(44, w), hitH = Math.max(44, hh);
      g.appendChild(svgEl("rect", { class: "ins-zone__hit", x: x + w / 2 - hitW / 2, y: y + hh / 2 - hitH / 2, width: hitW, height: hitH }));
      g.appendChild(svgEl("rect", { class: "ins-zone__r", x, y, width: w, height: hh, rx: 3 }));
      ov.appendChild(g);
      labels.push({ z, st, x, y, w, hh });
    });
    // the next zone places first so it keeps its natural spot; then the rest in reading order
    labels.sort((a, b) => (a.st === "next" ? -1 : b.st === "next" ? 1 : a.y - b.y || a.x - b.x));
    labels.forEach((L) => {
      const { z, st, x, y, w, hh } = L;
      let name = String(z.name || "").slice(0, 28);
      const widthFor = (n) => Math.min(Math.max(30, w + 40), n.length * 6.2 + (st === "done" ? 26 : 12), sz.w);
      const at = (cx, cy, lw) => ({ x: clamp(cx, 0, Math.max(0, sz.w - lw)), y: clamp(cy, 0, Math.max(0, sz.h - LH)), w: lw, h: LH });
      let lw = widthFor(name);
      const tries = () => {
        const c = [at(x, y, lw), at(x, y + hh - LH, lw), at(x, y - LH - GAP, lw), at(x, y + hh + GAP, lw), at(x + w - lw, y, lw), at(x + w - lw, y + hh - LH, lw)];
        for (let k = 1; k <= 8; k++) c.push(at(x, y + k * (LH + GAP), lw), at(x, y - k * (LH + GAP), lw));
        return c.find((r) => !hits(r)) || null;
      };
      let r = tries();
      if (!r && name.length > 10) { name = name.slice(0, 9) + "…"; lw = widthFor(name); r = tries(); }
      if (!r) r = at(x, y, lw);
      placed.push(r);
      const g = svgEl("g", { class: "ins-zone ins-zone--" + st + " ins-zone--lbl", "data-zone": z.id, "aria-hidden": "true" });
      g.appendChild(svgEl("rect", { class: "ins-zone__chip", x: r.x, y: r.y, width: r.w, height: LH, rx: 3 }));
      // a taller transparent hit around the 18px chip; the zone outline underneath keeps its own 44px target
      g.appendChild(svgEl("rect", { class: "ins-zone__hit", x: r.x, y: r.y + LH / 2 - 13, width: r.w, height: 26 }));
      let tx = r.x + 6;
      if (st === "done") {
        g.appendChild(svgEl("path", { class: "ins-zone__check", d: "M" + (r.x + 5) + " " + (r.y + 9.5) + "l3 3 5-6.5" }));
        tx = r.x + 18;
      }
      const t = svgEl("text", { class: "ins-zone__t", x: tx, y: r.y + 12.5 });
      t.textContent = name;
      g.appendChild(t);
      ov.appendChild(g);
    });
  }
  function updatePins(S) {
    if (!S.pins) return;
    const states = pinStates(S);
    for (const id in S.pins) {
      const g = S.pins[id];
      const st = states[id] || "safe";
      g.setAttribute("class", "ins-pin ins-pin--" + st);
    }
  }
  function onOverlayTap(S, e) {
    const t = e.target && e.target.closest ? e.target.closest("[data-ev],[data-pin],[data-zone]") : null;
    if (!t) { if (S.zoomed) unzoom(S); return; }
    e.stopPropagation();
    if (t.getAttribute("data-zone")) { openZone(S, t.getAttribute("data-zone")); return; }
    const ev = t.getAttribute("data-ev");
    const pin = t.getAttribute("data-pin");
    if (ev) {
      const b = S.brackets && S.brackets[ev];
      flashBracket(S, ev);
      const e2 = evidenceById(S.inst, ev);
      if (e2 && e2.text) caption(S, "READ HERE · “" + e2.text + "”");
      if (b && b.varId) flashChip(S, b.varId, true);
    } else if (pin) {
      flashRow(S, pin);
    }
  }
  function caption(S, text) {
    const cap = S.refs.cap;
    if (!cap) return;
    cap.textContent = text || "";
    cap.classList.toggle("is-on", !!text);
    clearTimeout(S.capTimer);
    if (text) S.capTimer = setTimeout(() => { cap.classList.remove("is-on"); }, 3200);
  }

  /* zoom to an evidence box, flash the bracket, then come back */
  function zoomTo(S, ev) {
    const sz = frameSize(S);
    const inner = S.refs.inner;
    if (!sz || !inner || !Array.isArray(ev.bbox)) { flashBracket(S, ev.id); return; }
    const [bx, by, bw, bh] = ev.bbox.map(Number);
    if (ev.text) caption(S, "READ HERE · “" + ev.text + "”");
    if (reduced()) { flashBracket(S, ev.id); return; }
    const s = clamp(Math.min(0.72 / Math.max(bw, 0.02), 0.72 / Math.max(bh, 0.02)), 1, 4);
    const cx = (bx + bw / 2) * sz.w, cy = (by + bh / 2) * sz.h;
    const tx = clamp(sz.w / 2 - cx * s, sz.w - sz.w * s, 0);
    const ty = clamp(sz.h / 2 - cy * s, sz.h - sz.h * s, 0);
    S.zoomed = true;
    S.refs.wrap.classList.add("is-zoomed");
    inner.style.transform = "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) scale(" + s.toFixed(3) + ")";
    flashBracket(S, ev.id, 380);
    clearTimeout(S.zoomTimer);
    S.zoomTimer = setTimeout(() => unzoom(S), 2200);
    // bring the photo into view if the user tapped a chip far below it
    try {
      const r = S.refs.frame.getBoundingClientRect();
      if (r.bottom < 60 || r.top > window.innerHeight - 80) S.refs.frame.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) { /* ignore */ }
  }
  function unzoom(S) {
    clearTimeout(S.zoomTimer);
    if (!S.zoomed) return;
    S.zoomed = false;
    if (S.refs.inner) S.refs.inner.style.transform = "";
    setTimeout(() => { if (!S.destroyed && !S.zoomed) { S.refs.wrap.classList.remove("is-zoomed"); scheduleHair(S); } }, reduced() ? 0 : 440);
  }
  function flashBracket(S, evId, delay) {
    const b = S.brackets && S.brackets[evId];
    const fire = (node) => {
      if (!node) return;
      node.classList.remove("is-flash");
      void node.getBoundingClientRect();
      node.classList.add("is-flash");
      setTimeout(() => node.classList.remove("is-flash"), 1100);
    };
    const press = S.refs.press ? S.refs.press.querySelector('[data-ev="' + cssEsc(evId) + '"]') : null;
    const go = () => { fire(b && b.g); fire(press); };
    if (delay) setTimeout(go, delay); else go();
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  /* ---------------------------------------------------------------- zones */
  function zoneById(S, id) { return zonesOf(S.inst).find((z) => z.id === id) || null; }
  function openZone(S, id) {
    const z = zoneById(S, id);
    if (!z || !has("ui", "sheet")) return;
    const steps = Array.isArray(z.steps) ? z.steps : [];
    const body = h("div", { class: "ins-zsheet" },
      h("p", { class: "ins-zsheet__meta wb-mono", text: fmt(z.minutes, "min", S.inst) + " · " + steps.length + (steps.length === 1 ? " step" : " steps") }));
    if (z.state === "done") {
      if (z.afterThumb) body.appendChild(h("img", { class: "ins-zsheet__after", src: z.afterThumb, alt: "After: " + z.name, decoding: "async" }));
      body.appendChild(h("p", { class: "ins-zsheet__done wb-micro", text: "clear · " + fmtDay(z.doneAt || Date.now()) + " · checked " + (z.by === "claude" ? "by photo" : "by you") }));
    }
    if (steps.length) {
      const ol = h("ol", { class: "ins-zsheet__steps" });
      steps.forEach((st) => ol.appendChild(h("li", { class: "ins-zsheet__step", text: st.text })));
      body.appendChild(ol);
    }
    const actions = [{ label: "Start this zone", kind: "primary", onTap: (close) => { close(); if (has("router", "go")) WB.router.go("mission", { id: S.id, zoneId: z.id }); } }];
    if (z.state !== "done") actions.push({ label: "Mark it clear without a photo", kind: "quiet", onTap: (close) => { close(); markZoneClear(S, z.id); } });
    WB.ui.sheet({ title: z.name, body, actions });
  }
  function markZoneClear(S, zoneId) {
    if (!has("store", "update")) return;
    const r = call("store", "update", S.id, (inst) => {
      const z = (inst.zones || []).find((x) => x.id === zoneId);
      if (z) { z.state = "done"; z.doneAt = Date.now(); z.by = "self"; }
    }, "set");
    if (r && has("store", "addObservation")) {
      S.flashChart = true;
      WB.store.addObservation(S.id, { t: Date.now(), value: compute(r).primary, facts: {}, source: "manual", note: null });
    }
    toast("Zone clear.");
  }

  /* ---------------------------------------------------------------- project: the next step, one more done */
  function nextStepOf(inst) { return (inst.steps || []).find((s) => !s.done) || null; }
  function renderNextCard(S) {
    const box = S.refs.nextcard;
    if (!box) return;
    const inst = S.inst;
    if (inst.mold !== "project" || S.readOnly) { box.hidden = true; box.textContent = ""; return; }
    const step = nextStepOf(inst);
    const done = valueOf(S, "done"), total = valueOf(S, "total");
    const unit = (inst.words && inst.words.unit) || "pieces";
    const canMore = isNum(done) && isNum(total) && done < total;
    const sig = [step ? step.id + ":" + step.text + ":" + step.minutes : "-", canMore ? unit : "x", S.live ? "live" : ""].join("|");
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.textContent = "";
    const main = h("div", { class: "ins-next__main" });
    main.appendChild(h("span", { class: "wb-micro ins-next__tag", text: step ? "NEXT STEP · " + Math.round(step.minutes || 25) + " MIN" : "NEXT STEP" }));
    main.appendChild(h("p", { class: "ins-next__text", text: step ? step.text : "No next step yet." }));
    const row = h("div", { class: "ins-next__row" });
    if (step) {
      row.appendChild(h("button", { class: "ins-next__check", type: "button", role: "checkbox", "aria-checked": "false", on: { click: () => completeStep(S, step.id) } },
        h("span", { class: "ins-next__box", "aria-hidden": "true" }), h("span", { class: "ins-next__lbl", text: "Done" })));
    }
    row.appendChild(h("button", { class: "ins-next__edit", type: "button", text: step ? "Edit" : "Add a step", on: { click: () => editStep(S, step ? step.id : null) } }));
    main.appendChild(row);
    box.appendChild(main);
    if (canMore) {
      box.appendChild(h("button", { class: "wb-btn wb-btn--quiet ins-next__more", type: "button", text: "One more " + singular(unit) + " done", on: { click: () => oneMore(S) } }));
    }
    box.hidden = false;
  }
  function completeStep(S, stepId) {
    if (!has("store", "update")) return;
    call("store", "update", S.id, (inst) => { const st = (inst.steps || []).find((x) => x.id === stepId); if (st) st.done = true; }, "set");
    haptic(6);
    toast("Step done.");
  }
  function editStep(S, stepId) {
    if (!has("ui", "sheet") || !has("ui", "field")) return;
    const cur = stepId ? (S.inst.steps || []).find((x) => x.id === stepId) : null;
    const f = WB.ui.field({ label: cur ? "Next step" : "Add a step", value: cur ? cur.text : "", placeholder: "What is the next concrete step?", maxLength: 72 });
    const save = (close) => {
      const text = String(f.input.value || "").trim().slice(0, 72);
      if (!text) { try { f.input.focus(); } catch (e) { /* ignore */ } return; }
      close();
      call("store", "update", S.id, (inst) => {
        inst.steps = Array.isArray(inst.steps) ? inst.steps : [];
        const st = stepId ? inst.steps.find((x) => x.id === stepId) : null;
        if (st) { st.text = text; return; }
        // up to three steps: a new one makes room by dropping the oldest finished one
        while (inst.steps.length >= 3) { const i = inst.steps.findIndex((x) => x.done); inst.steps.splice(i < 0 ? 0 : i, 1); }
        inst.steps.push({ id: "st" + Date.now().toString(36), n: inst.steps.length + 1, text, minutes: 25, pin: null, done: false });
        inst.steps.forEach((x, i) => { x.n = i + 1; });
      }, "set");
    };
    f.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const b = document.querySelector(".wb-sheet__actions .wb-btn--primary"); if (b) b.click(); } });
    WB.ui.sheet({ title: cur ? "Edit the next step" : "Next step", body: f.el, actions: [{ label: "Save", kind: "primary", onTap: save }, { label: "Cancel", kind: "quiet", onTap: (close) => close() }] });
    setTimeout(() => { try { f.input.focus(); } catch (e) { /* ignore */ } }, 120);
  }
  function oneMore(S) {
    if (!has("store", "update")) return;
    const r = call("store", "update", S.id, (inst) => {
      const d = inst.vars && inst.vars.done, t = inst.vars && inst.vars.total;
      if (!d) return;
      const cap = t && isNum(t.value) ? t.value : Infinity;
      d.value = Math.min(cap, (isNum(d.value) ? d.value : 0) + 1);
      d.origin = "set"; d.reason = null;
    }, "set");
    haptic(6);
    if (r && has("store", "addObservation")) {
      S.flashChart = true;
      WB.store.addObservation(S.id, { t: Date.now(), value: compute(r).primary, facts: { done: r.vars.done.value }, source: "manual", note: null });
    }
    const box = chartBox(S);
    if (box) { box.classList.remove("is-flash"); void box.offsetWidth; box.classList.add("is-flash"); setTimeout(() => box.classList.remove("is-flash"), 1400); }
  }

  /* ---------------------------------------------------------------- the sentence */
  function sentenceSig(S, toks) {
    return toks.map((t) => {
      if (t.t === "text") return "x";
      if (t.t === "var") {
        const v = S.inst.vars[t.id];
        return "v:" + t.id + ":" + (draggable(S, v) ? "d" : "s");
      }
      return "o:" + t.id;
    }).join("|");
  }
  function renderSentence(S, opt) {
    const o = opt || {};
    const p = S.refs.sentence;
    const toks = tokens(S.inst, S.ov);
    const sig = sentenceSig(S, toks);
    const out = compute(S.inst, S.ov).outputs || {};
    if (sig !== S.sentSig) {
      const focused = document.activeElement && p.contains(document.activeElement) ? document.activeElement.getAttribute("data-key") : null;
      disposeHolds(S);
      p.textContent = "";
      S.chips = {};
      S.textNodes = [];
      toks.forEach((t) => {
        if (t.t === "text") {
          const n = document.createTextNode(unescape(t.text));
          S.textNodes.push(n);
          p.appendChild(n);
        } else if (t.t === "var") {
          const c = makeVarChip(S, t.id);
          if (c) p.appendChild(c);
        } else if (t.t === "out") {
          p.appendChild(makeOutChip(S, t.id));
        }
      });
      S.sentSig = sig;
      if (focused) {
        const again = p.querySelector('[data-key="' + cssEsc(focused) + '"]');
        if (again) { try { again.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      }
    } else {
      let ti = 0;
      toks.forEach((t) => { if (t.t === "text") { const n = S.textNodes[ti++]; const v = unescape(t.text); if (n && n.nodeValue !== v) n.nodeValue = v; } });
    }
    const hingeId = S.hinge && S.hinge.varId;
    for (const key in S.chips) {
      const c = S.chips[key];
      if (c.kind === "var") updateVarChip(S, c, hingeId, o);
      else updateOutChip(S, c, out, o);
    }
  }

  function makeVarChip(S, id) {
    const v = S.inst.vars[id];
    if (!v) return null;
    const drag = draggable(S, v);
    const node = h(drag ? "span" : "button", { class: "ins-chip", dataset: { key: "v:" + id, var: id } });
    if (!drag) node.setAttribute("type", "button");
    else {
      node.setAttribute("role", "slider");
      node.setAttribute("tabindex", "0");
    }
    const val = h("span", { class: "ins-chip__v" });
    node.appendChild(val);
    let q = null, mail = null, ring = null;
    const peer = h("span", { class: "ins-chip__peer", "aria-hidden": "true", hidden: true });
    if (v.kind === "lever" && !S.readOnly) {
      // the consent ring: a conic sweep of vermilion that fills clockwise with --hold (0..1) over 700 ms
      ring = h("span", { class: "ins-chip__ring", "aria-hidden": "true" });
      node.appendChild(ring);
      if (has("ui", "hold")) {
        const dispose = WB.ui.hold(node, {
          ms: 700,
          enabled: () => { if (S.live) return true; const vd = verdictOf(S, id, valueOf(S, id)); return vd !== "worse" && vd !== "same"; },
          onRefuse: () => { S.refusal = verdictOf(S, id, valueOf(S, id)); renderBar(S); },
          onProgress: (pr) => { ring.style.setProperty("--p", pr.toFixed(3)); node.classList.toggle("is-holding", pr > 0 && pr < 1); },
          onDone: () => { ring.style.setProperty("--p", "0"); node.classList.remove("is-holding"); commit(S, id, node); },
          onCancel: () => { ring.style.setProperty("--p", "0"); node.classList.remove("is-holding"); },
        });
        S.holds.push(dispose);
      }
    }
    node.appendChild(peer);
    const c = { kind: "var", id, node, val, q, mail, ring, peer, shown: null };
    S.chips["v:" + id] = c;
    return node;
  }
  function updateVarChip(S, c, hingeId, o) {
    const v = S.inst.vars[c.id];
    if (!v) return;
    const value = valueOf(S, c.id);
    const text = fmt(value, v.format, S.inst);
    const oc = originClass(v);
    const ev = evidenceById(S.inst, v.evidenceId);
    const cls = "ins-chip ins-chip--" + oc + (draggable(S, v) ? " ins-chip--drag" : "") + (c.id === hingeId ? " is-hinge" : "") +
      (ev && ev.type === "email" ? " ins-chip--mail" : "") + (S.live && S.live.varId === c.id ? " is-scrubbing" : "") +
      (c.node.classList.contains("is-flash") ? " is-flash" : "") + (c.node.classList.contains("is-stamp") ? " is-stamp" : "") +
      (c.node.classList.contains("is-holding") ? " is-holding" : "") + (c.node.classList.contains("wb-holding") ? " wb-holding" : "") +
      (c.node.classList.contains("is-pulse") ? " is-pulse" : "");
    if (c.node.className !== cls) c.node.className = cls;
    // assumed: superscript ?; email-proven: a tiny mail glyph
    if (oc === "assumed" && !c.q) { c.q = h("sup", { class: "ins-chip__q", "aria-hidden": "true", text: "?" }); c.node.insertBefore(c.q, c.val.nextSibling); }
    if (oc !== "assumed" && c.q) { c.q.remove(); c.q = null; }
    const wantMail = oc === "seen" && ev && ev.type === "email";
    if (wantMail && !c.mail) { c.mail = h("span", { class: "ins-chip__mail", "aria-hidden": "true", html: icon("mail") }); c.node.insertBefore(c.mail, c.val.nextSibling); }
    if (!wantMail && c.mail) { c.mail.remove(); c.mail = null; }
    setChipText(S, c, value, v.format, text, o);
    const label = v.label || c.id;
    if (draggable(S, v)) {
      const r = rangeOf(S.inst, c.id);
      c.node.setAttribute("aria-label", label);
      c.node.setAttribute("aria-valuemin", String(r.min));
      c.node.setAttribute("aria-valuemax", String(r.max));
      c.node.setAttribute("aria-valuenow", String(isNum(value) ? value : r.min));
      c.node.setAttribute("aria-valuetext", text + ", " + ORIGIN_WORD[oc]);
      c.node.setAttribute("aria-description", v.kind === "lever"
        ? "Drag sideways or use the arrow keys to change it. Press and hold to commit."
        : "Drag sideways or use the arrow keys to set it yourself. Tap to see why.");
    } else {
      c.node.setAttribute("aria-label", text + ", " + label + ", " + ORIGIN_WORD[oc] + (ev ? ". Show where." : "."));
    }
  }
  function makeOutChip(S, id) {
    const node = h("button", { class: "ins-chip ins-chip--derived", type: "button", dataset: { key: "o:" + id, out: id } });
    const val = h("span", { class: "ins-chip__v" });
    node.appendChild(val);
    const c = { kind: "out", id, node, val, shown: null };
    S.chips["o:" + id] = c;
    return node;
  }
  function updateOutChip(S, c, outputs, o) {
    const def = moldDef(S.inst);
    const od = def && def.outputs && def.outputs[c.id];
    const f = (od && od.format) || "num";
    const value = outputs[c.id];
    // once the totals run past $100, derived money is whole dollars: "$1,591 … $88 back", not "$88.02 back"
    let whole = false;
    if (f === "usd" && def && def.outputs) for (const k in def.outputs) if (def.outputs[k].format === "usd" && isNum(outputs[k]) && Math.abs(outputs[k]) >= 100) whole = true;
    c.fmtOpts = whole ? { whole: true } : null;
    const text = fmt(value, f, S.inst, c.fmtOpts);
    setChipText(S, c, value, f, text, o);
    c.node.classList.toggle("is-open", !!(S.strip && S.strip.key === "o:" + c.id));
    c.node.classList.toggle("ins-chip--short", S.inst.mold === "week" && c.id === "slack" && isNum(value) && value < 0);
    c.node.setAttribute("aria-label", text + ", " + ((od && od.label) || c.id) + ". Show the math.");
    c.node.setAttribute("aria-expanded", S.strip && S.strip.key === "o:" + c.id ? "true" : "false");
  }
  /* numbers tween 420 ms on non-scrub changes, snap during scrub and under reduced motion */
  function setChipText(S, c, value, format, text, o) {
    const prev = c.shown;
    c.shown = { value, text };
    const running = S.tweens.get(c);
    if (running) { caf(running); S.tweens.delete(c); }
    const canTween = o && (o.tween || o.countUp) && !reduced() && isNum(value) && format !== "day" &&
      (o.countUp || (prev && isNum(prev.value) && prev.value !== value));
    if (!canTween) { if (c.val.textContent !== text) c.val.textContent = text; return; }
    const from = o.countUp ? 0 : prev.value;
    const t0 = performance.now() + (o.delay || 0);
    const ms = 420;
    const step = () => {
      const k = clamp((performance.now() - t0) / ms, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = from + (value - from) * e;
      c.val.textContent = k >= 1 ? text : fmt(format === "int" || format === "days" ? Math.round(cur) : cur, format, S.inst, c.fmtOpts);
      if (k < 1) S.tweens.set(c, raf(step)); else { S.tweens.delete(c); scheduleHair(S); }
    };
    c.val.textContent = fmt(from, format, S.inst, c.fmtOpts);
    S.tweens.set(c, raf(step));
  }
  function disposeHolds(S) { S.holds.forEach((d) => { try { d(); } catch (e) { /* ignore */ } }); S.holds = []; }

  /* ---------------------------------------------------------------- chip gestures */
  function wireSentence(S) {
    const p = S.refs.sentence;
    p.addEventListener("pointerdown", (e) => {
      const node = e.target.closest ? e.target.closest(".ins-chip--drag") : null;
      if (!node || (e.button != null && e.button !== 0)) return;
      beginPointer(S, node, e);
    });
    p.addEventListener("click", (e) => {
      const node = e.target.closest ? e.target.closest(".ins-chip") : null;
      if (!node) return;
      if (S.suppressClick) { S.suppressClick = false; e.preventDefault(); return; }
      tapChip(S, node);
    });
    p.addEventListener("keydown", (e) => {
      const node = e.target.closest ? e.target.closest(".ins-chip--drag") : null;
      if (!node) return;
      keyChip(S, node, e);
    });
  }

  function beginPointer(S, node, e) {
    const id = node.getAttribute("data-var");
    const v = S.inst.vars[id];
    if (!v) return;
    const r = rangeOf(S.inst, id);
    const start = isNum(valueOf(S, id)) ? valueOf(S, id) : r.min;
    const g = { id, node, r, start, value: start, pid: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, lt: performance.now(),
      vpx: 0, captured: false, abandoned: false, lastBuzz: 0, lastEmit: 0, lastStep: 0, kind: v.kind };
    const minPx = ((r.min - start) / r.step) * STEP_PX, maxPx = ((r.max - start) / r.step) * STEP_PX;
    const move = (ev) => {
      if (ev.pointerId !== g.pid || g.abandoned) return;
      const dx = ev.clientX - g.sx, dy = ev.clientY - g.sy;
      if (!g.captured) {
        if (Math.abs(dy) > CAPTURE_PX && Math.abs(dy) > Math.abs(dx)) { g.abandoned = true; cleanup(); return; }
        if (Math.abs(dx) < CAPTURE_PX) return;
        g.captured = true;
        try { node.setPointerCapture(g.pid); } catch (err) { /* ignore */ }
        g.lx = ev.clientX; g.lt = performance.now();
        startLive(S, id, "chip");
        dismissCoach(S);
        showRuler(S, ev.clientX, ev.clientY, g);
      }
      if (ev.cancelable) ev.preventDefault();
      const t = performance.now();
      const ddx = ev.clientX - g.lx;
      const dt = Math.max(1, t - g.lt);
      const fast = Math.abs(ddx) / dt > FAST;
      g.lx = ev.clientX; g.lt = t;
      const raw = g.vpx + ddx * (fast ? 3 : 1);
      g.vpx = clamp(raw, minPx, maxPx);
      const over = raw - g.vpx;  // rubber band beyond the range
      const steps = Math.trunc(g.vpx / STEP_PX);
      const value = quantize(start + steps * r.step, r);
      node.style.transform = over ? "translateX(" + clamp(over * 0.25, -8, 8).toFixed(1) + "px)" : "";
      node.classList.toggle("is-edge", !!over);
      if (value !== g.value) {
        g.value = value;
        if (t - g.lastBuzz >= BUZZ_MS) { g.lastBuzz = t; haptic(4); }
        liveSet(S, id, value);
        if (t - g.lastEmit >= SCRUB_MS) { g.lastEmit = t; emit("instrument:scrub", { id: S.id, varId: id, value }); }
        else { clearTimeout(g.emitT); g.emitT = setTimeout(() => { if (S.live) emit("instrument:scrub", { id: S.id, varId: id, value: g.value }); }, SCRUB_MS); }
      }
      moveRuler(S, ev.clientX, ev.clientY, g);
    };
    const up = (ev) => {
      if (ev.pointerId !== g.pid) return;
      cleanup();
      if (!g.captured) return;
      S.suppressClick = true;
      setTimeout(() => { S.suppressClick = false; }, 0);
      clearTimeout(g.emitT);
      node.classList.remove("is-edge");
      node.style.transition = "transform 40ms ease-out";
      node.style.transform = "";
      setTimeout(() => { node.style.transition = ""; }, 60);
      hideRuler(S);
      endLive(S, id, g.value, g.start);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function keyChip(S, node, e) {
    const id = node.getAttribute("data-var");
    const v = S.inst.vars[id];
    if (!v) return;
    const r = rangeOf(S.inst, id);
    const cur = isNum(valueOf(S, id)) ? valueOf(S, id) : r.min;
    let next = null;
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = cur + r.step * big;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = cur - r.step * big;
    else if (e.key === "PageUp") next = cur + r.step * 10;
    else if (e.key === "PageDown") next = cur - r.step * 10;
    else if (e.key === "Home") next = r.min;
    else if (e.key === "End") next = r.max;
    else return;
    e.preventDefault();
    next = quantize(next, r);
    if (!S.live) { startLive(S, id, "key"); S.live.start = cur; }
    liveSet(S, id, next);
    emit("instrument:scrub", { id: S.id, varId: id, value: next });
    clearTimeout(S.keyTimer);
    const start = S.live.start;
    S.keyTimer = setTimeout(() => { if (S.live && S.live.varId === id) endLive(S, id, valueOf(S, id), start); }, 650);
  }

  /* the floating ruler: 140 px of ticks, 44 px above the finger */
  function showRuler(S, x, y, g) {
    const ru = S.refs.ruler;
    if (!ru) return;
    if (!ru.firstChild) {
      const ticks = svgEl("svg", { class: "ins-ruler__ticks", width: 140, height: 14, viewBox: "0 0 140 14" });
      const path = [];
      for (let i = -24; i <= 24; i++) {
        const px = 70 + i * STEP_PX;
        path.push("M" + px + " " + (i % 5 === 0 ? 2 : 6) + "V14");
      }
      ticks.appendChild(svgEl("path", { class: "ins-ruler__path", d: path.join("") }));
      ru.appendChild(h("span", { class: "ins-ruler__val wb-mono" }));
      const track = h("span", { class: "ins-ruler__track" });
      track.appendChild(ticks);
      ru.appendChild(track);
      ru.appendChild(h("span", { class: "ins-ruler__mid" }));
    }
    ru.hidden = false;
    moveRuler(S, x, y, g);
  }
  function moveRuler(S, x, y, g) {
    const ru = S.refs.ruler;
    if (!ru || ru.hidden) return;
    const v = S.inst.vars[g.id];
    ru.querySelector(".ins-ruler__val").textContent = fmt(g.value, v && v.format, S.inst);
    const off = ((g.vpx % (STEP_PX * 5)) + STEP_PX * 5) % (STEP_PX * 5);
    const ticks = ru.querySelector(".ins-ruler__ticks");
    if (ticks) ticks.style.transform = "translateX(" + (-off).toFixed(1) + "px)";
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const left = clamp(x - 70, 8, vw - 148);
    const top = Math.max(8, y - 44 - 48);
    ru.style.transform = "translate(" + Math.round(left) + "px," + Math.round(top) + "px)";
    ru.classList.toggle("is-edge", g.value === g.r.min || g.value === g.r.max);
  }
  function hideRuler(S) { if (S.refs.ruler) S.refs.ruler.hidden = true; }

  /* ---------------------------------------------------------------- live state */
  function startLive(S, varId, via) {
    S.live = { varId, via, start: valueOf(S, varId) };
    const c = S.chips["v:" + varId];
    if (c) c.node.classList.add("is-scrubbing");
    S.refs.wrap.classList.add("is-live");
    S.tweens.forEach((id) => caf(id));
    S.tweens.clear();
  }
  function liveSet(S, varId, value) {
    S.ov[varId] = value;
    S.refusal = null;
    scheduleLive(S);
  }
  function scheduleLive(S) {
    if (S.rafId) return;
    S.rafId = raf(() => {
      S.rafId = 0;
      if (S.destroyed) return;
      renderSentence(S);
      renderPlate(S);
      renderStrip(S);
      renderChart(S, { live: true });
      renderPeek(S);
      updatePins(S);
      renderList(S);
      renderBar(S);
      drawHair(S);
    });
  }
  function endLive(S, varId, value, start) {
    const live = S.live;
    S.live = null;
    S.refs.wrap.classList.remove("is-live");
    hidePeek(S);
    const c = S.chips["v:" + varId];
    if (c) c.node.classList.remove("is-scrubbing");
    const v = S.inst.vars[varId];
    if (!v) return;
    const isLever = v.kind === "lever";
    const changed = !isNum(start) || value !== start;
    if (isLever && changed) { S.leverMoved = true; sessionLeverMoved = true; }
    // the week has no "as it is": remember the week as it stood before the lever first moved
    if (isLever && changed && S.inst.mold === "week" && !isNum(S.preLever)) S.preLever = compute(S.inst).primary;
    persist(S, varId, value, isLever);
    // coach 2 after the first drag, coach 3 after a lever moved
    // coach 3 is the bar's own hint ("Hold 1 a week to commit."), so no floating tag repeats it
    later(S, () => { if (!seenCoach("origins") && hasOriginVariety(S)) coachOrigins(S); }, 260);
    if (live && S.pendingRefresh) { const pr = S.pendingRefresh; S.pendingRefresh = null; refresh(S, pr.inst, pr.source); }
  }
  function persist(S, varId, value, isLever) {
    if (S.readOnly) return;
    const source = isLever ? "scrub" : "set";
    const apply = (inst) => {
      const v = inst && inst.vars && inst.vars[varId];
      if (!v) return;
      v.value = value;
      if (v.kind === "fact") {
        v.origin = "set"; v.reason = null;
        // a fact that moved can pull a lever's honest bound in (rate 3 -> 2 brings a target of 3 down to 2)
        for (const k in inst.vars) {
          const lv = inst.vars[k];
          if (!lv || lv.kind !== "lever" || !isNum(lv.value) || !has("molds", "range")) continue;
          const r = WB.molds.range(inst, k);
          if (r && isNum(r.min) && isNum(r.max)) lv.value = clamp(lv.value, r.min, r.max);
        }
      }
    };
    // update the local copy first so the in-place refresh sees the new origin, then clear the override
    apply(S.inst);
    delete S.ov[varId];
    let stored = null;
    if (has("store", "update")) stored = call("store", "update", S.id, apply, source);
    emit("instrument:set", { id: S.id, varId, value, origin: isLever ? "lever" : "set" });
    if (!stored || !stored.vars) refresh(S, null, source);
  }

  /* ---------------------------------------------------------------- commit */
  function commit(S, varId, node) {
    if (S.readOnly || S.destroyed) return;
    const value = valueOf(S, varId);
    if (!isNum(value)) return;
    // a hold that completes while the finger is mid-drag is not a commit
    if (S.live && S.live.via !== "key") return;
    // never stamp a step the wrong way, or a "promise" to stay exactly where you are
    const vd = verdictOf(S, varId, value);
    if (vd === "worse" || vd === "same") {
      S.refusal = vd;
      renderBar(S);
      haptic(4);
      return;
    }
    const stored = S.inst.vars[varId] && S.inst.vars[varId].value;
    const preBase = S.inst.mold === "week" ? (isNum(S.preLever) ? S.preLever : compute(S.inst).primary) : null;
    S.preLever = null;
    if (S.live) { clearTimeout(S.keyTimer); S.live = null; S.refs.wrap.classList.remove("is-live"); hidePeek(S); }
    if (stored !== value || isNum(S.ov[varId])) persist(S, varId, value, true);
    const inst = S.inst;
    const baseline = isNum(preBase) ? preBase : has("molds", "baseline") ? WB.molds.baseline(inst) : compute(inst).primary;
    const primary = outcomeAt(inst, { [varId]: value });
    stamp(S, node);
    S.inkNext = true;
    S.leverMoved = false;
    emit("instrument:commit", { id: S.id, varId, value, primary, baseline });
    // without the actions module nobody would pin the intention: keep the promise locally so the ghost still inks in
    if (!WB.actions && has("store", "setIntention") && has("molds", "intentionFor")) {
      const it = call("molds", "intentionFor", inst, varId, value);
      if (it) call("store", "setIntention", S.id, it);
    }
  }
  function stamp(S, node) {
    if (!node) return;
    if (reduced()) return;
    node.classList.remove("is-stamp");
    void node.offsetWidth;
    node.classList.add("is-stamp");
    setTimeout(() => node.classList.remove("is-stamp"), 360);
  }

  /* ---------------------------------------------------------------- taps: provenance, reasons, formulas */
  function tapChip(S, node) {
    const vid = node.getAttribute("data-var");
    const oid = node.getAttribute("data-out");
    dismissCoach(S);
    if (oid) { toggleStrip(S, { key: "o:" + oid, type: "formula", id: oid }); return; }
    const v = vid && S.inst.vars[vid];
    if (!v) return;
    if (v.kind === "lever") { toggleStrip(S, { key: "v:" + vid, type: "lever", id: vid }); return; }
    if (v.origin === "seen") {
      const ev = evidenceById(S.inst, v.evidenceId);
      if (ev && ev.type === "photo") { zoomTo(S, ev); flashChip(S, vid); return; }
      if (ev && ev.type === "email") { quoteCard(S, ev, v); return; }
      toggleStrip(S, { key: "v:" + vid, type: "seen", id: vid });
      return;
    }
    toggleStrip(S, { key: "v:" + vid, type: v.origin, id: vid });
  }
  function toggleStrip(S, s) {
    S.strip = S.strip && S.strip.key === s.key ? null : s;
    renderStrip(S);
    // a reason that opens behind the bottom bar is a reason nobody reads: bring it up into the clear
    if (S.strip && S.refs.strip && !S.refs.strip.hidden) {
      raf(() => {
        try {
          const r = S.refs.strip.getBoundingClientRect(), band = visibleBand(S);
          if (r.bottom > band.bottom - 8) window.scrollBy({ top: r.bottom - band.bottom + 24, behavior: reduced() ? "auto" : "smooth" });
        } catch (e) { /* ignore */ }
      });
    }
    for (const k in S.chips) if (S.chips[k].kind === "out") S.chips[k].node.classList.toggle("is-open", !!(S.strip && S.strip.key === k));
  }
  function renderStrip(S) {
    const box = S.refs.strip;
    if (!box) return;
    const s = S.strip;
    if (!s) { if (!box.hidden) { box.hidden = true; box.textContent = ""; scheduleHair(S); } return; }
    let tag = "", line = "", tail = "";
    const inst = S.inst;
    if (s.type === "formula") {
      const def = moldDef(inst);
      const od = def && def.outputs ? def.outputs[s.id] : null;
      const out = compute(inst, S.ov).outputs || {};
      const f = has("molds", "formula") ? call("molds", "formula", inst, s.id, S.ov) : "";
      tag = "THE MATH";
      line = (f ? f + " = " : "") + fmt(out[s.id], od ? od.format : "num", inst);
      tail = od && od.label ? od.label : "";
    } else {
      const v = inst.vars[s.id];
      if (!v) { S.strip = null; renderStrip(S); return; }
      const val = fmt(valueOf(S, s.id), v.format, inst);
      if (s.type === "lever") { tag = "YOUR CALL"; line = val + " " + (v.label || ""); tail = "Drag it sideways to change it. Hold it to commit."; }
      else if (s.type === "inferred") { tag = "INFERRED"; line = v.reason || "Implied by what’s in the photo."; tail = "Drag it to set it yourself."; }
      else if (s.type === "assumed") { tag = "A GUESS"; line = v.reason || "A starting guess."; tail = "Drag it to make it yours, and true."; }
      else if (s.type === "set") { tag = "YOURS"; line = "You set " + (v.label || "this") + " to " + val + "."; tail = "It counts as measured."; }
      else { tag = "READ"; line = v.reason || "Read from the source."; tail = ""; }
    }
    const sig = tag + "|" + line + "|" + tail;
    if (box.dataset.sig === sig && !box.hidden) return;
    box.dataset.sig = sig;
    box.textContent = "";
    box.className = "ins-strip ins-strip--" + s.type;
    box.appendChild(h("span", { class: "wb-micro ins-strip__tag", text: tag + " —" }));
    box.appendChild(h("span", { class: s.type === "formula" ? "ins-strip__math wb-mono" : "ins-strip__line", text: line }));
    if (tail) box.appendChild(h("span", { class: "ins-strip__tail", text: tail }));
    const wasHidden = box.hidden;
    box.hidden = false;
    if (wasHidden) scheduleHair(S);
  }

  function quoteCard(S, ev, v) {
    flashBracket(S, ev.id);
    if (!has("ui", "sheet")) { toggleStrip(S, { key: "v:" + v.id, type: "seen", id: v.id }); return; }
    const quote = String(ev.quote || "");
    const body = h("div", { class: "ins-quote" },
      h("p", { class: "ins-quote__subj", text: ev.subject || "An email" }),
      h("p", { class: "ins-quote__meta wb-micro", text: [ev.sender, ev.date].filter(Boolean).join(" · ") || "FROM YOUR MAIL" }),
      h("blockquote", { class: "ins-quote__q wb-serif" }, h("mark", { class: "ins-quote__mark", text: quote || "(no quote kept)" })),
      h("p", { class: "ins-quote__why" }, "This is why ", h("b", { text: fmt(v.value, v.format, S.inst) }), " is solid: it’s in your mail."));
    WB.ui.sheet({ title: "From your mail", body, actions: [{ label: "Close", kind: "quiet", onTap: (close) => close() }] });
  }

  function flashChip(S, varId, scroll) {
    const c = S.chips["v:" + varId];
    if (!c) return;
    c.node.classList.remove("is-flash");
    void c.node.offsetWidth;
    c.node.classList.add("is-flash");
    setTimeout(() => c.node.classList.remove("is-flash"), 1000);
    if (scroll) {
      try {
        const r = c.node.getBoundingClientRect();
        if (r.top < 60 || r.bottom > window.innerHeight - 100) c.node.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
      } catch (e) { /* ignore */ }
    }
  }
  function flashRow(S, id) {
    const row = S.refs.list && S.refs.list.querySelector('[data-row="' + cssEsc(id) + '"]');
    if (row) {
      row.classList.remove("is-flash"); void row.offsetWidth; row.classList.add("is-flash");
      setTimeout(() => row.classList.remove("is-flash"), 1000);
    }
    const pin = S.pins && S.pins[id];
    if (pin) {
      pin.classList.add("is-flash");
      setTimeout(() => pin.classList.remove("is-flash"), 1000);
    }
  }
  function flashKey(S, key) {
    if (!key) return;
    if (S.inst.vars && S.inst.vars[key]) {
      flashChip(S, key, true);
      const v = S.inst.vars[key];
      if (v.evidenceId) flashBracket(S, v.evidenceId);
      return;
    }
    const ev = evidenceById(S.inst, key);
    if (ev) {
      flashBracket(S, ev.id);
      for (const k in S.inst.vars) if (S.inst.vars[k].evidenceId === ev.id) flashChip(S, k, true);
      return;
    }
    flashRow(S, key);
  }

  /* ---------------------------------------------------------------- hinge, chart, list, confidence, note */
  function renderHinge(S) {
    const p = S.refs.hinge;
    const hg = S.hinge;
    if (!hg || !hg.varId || !S.inst.vars[hg.varId]) { p.hidden = true; return; }
    const v = S.inst.vars[hg.varId];
    p.textContent = "";
    p.appendChild(h("span", { class: "wb-micro ins-hinge__tag", text: "THE HINGE —" }));
    p.appendChild(h("span", { class: "ins-hinge__note", text: " " + (hg.note || "This is the one that decides it.") + " " }));
    const lbl = String(v.label || hg.varId);
    p.appendChild(h("button", { class: "ins-hinge__var", type: "button", text: lbl.charAt(0).toUpperCase() + lbl.slice(1) + ".", on: { click: () => flashChip(S, hg.varId, true) } }));
    p.hidden = false;
  }

  function renderChart(S, o) {
    const box = chartBox(S);
    if (S.plateChart && S.refs.chart) S.refs.chart.hidden = true;
    if (!box || !has("charts", "render")) { if (box) box.hidden = true; return; }
    const opt = o || {};
    const inst = S.inst;
    const c = compute(inst, S.ov);
    const series = c.series;
    if (!series) { box.hidden = true; return; }
    box.hidden = false;
    let cursorRange = null, onCursor = null;
    if (series.type === "timeline" && series.cursor && inst.vars[series.cursor.varId] && draggable(S, inst.vars[series.cursor.varId])) {
      cursorRange = rangeOf(inst, series.cursor.varId);
      onCursor = (varId, value, phase) => chartCursor(S, varId, value, phase);
    }
    let secondary = null;
    if (series.type === "gauge" && inst.mold === "perUse" && c.outputs && isNum(c.outputs.cpuAtTarget)) {
      secondary = { value: c.outputs.cpuAtTarget, label: "at your number" };
    }
    const ink = S.inkNext && !opt.live;
    S.chart = WB.charts.render(box, series, { inst, live: !!opt.live, ink, onCursor, cursorRange, secondary, readOnly: S.readOnly, ghost: opt.live ? S.lastGhost : undefined });
    if (!opt.live) S.lastGhost = ghostOf(inst);
    if (ink) S.inkNext = false;
  }
  /* While a finger scrubs and the chart is below the fold (short phones), a compact copy of the live chart floats just
     above the bottom bar, so the curve visibly bends under the drag. */
  function renderPeek(S) {
    const pk = S.refs.peek;
    if (!pk || !S.live || S.live.via === "chart" || !has("charts", "render") || !chartBox(S)) return;
    const band = visibleBand(S);
    const cr = chartBox(S).getBoundingClientRect();
    const visible = Math.min(cr.bottom, band.bottom) - Math.max(cr.top, band.top);
    if (!S.peekOn && visible > Math.min(110, cr.height * 0.7)) return;
    const c = compute(S.inst, S.ov);
    if (!c.series) return;
    let secondary = null;
    if (c.series.type === "gauge" && S.inst.mold === "perUse" && c.outputs && isNum(c.outputs.cpuAtTarget)) secondary = { value: c.outputs.cpuAtTarget, label: "at your number" };
    if (!S.peekOn) { S.peekOn = true; pk.hidden = false; S.refs.wrap.classList.add("is-peek"); }
    S.peekChart = WB.charts.render(pk.firstChild || pk.appendChild(h("div", { class: "ins-peek__chart" })), c.series, { inst: S.inst, live: true, compact: true, readOnly: true, height: 96, secondary });
  }
  function hidePeek(S) {
    if (!S.peekOn || !S.refs.peek) return;
    S.peekOn = false;
    S.refs.peek.hidden = true;
    S.refs.wrap.classList.remove("is-peek");
  }
  function chartCursor(S, varId, value, phase) {
    if (S.readOnly) return;
    if (phase === "start") { if (!S.live) startLive(S, varId, "chart"); dismissCoach(S); return; }
    if (!isNum(value)) { if (phase === "end" && S.live) endLive(S, varId, valueOf(S, varId), S.live.start); return; }
    const prev = valueOf(S, varId);
    if (value !== prev) {
      haptic(4);
      liveSet(S, varId, value);
      emit("instrument:scrub", { id: S.id, varId, value });
    }
    if (phase === "end") {
      const start = S.live ? S.live.start : prev;
      endLive(S, varId, value, start);
    }
  }

  function renderList(S) {
    const ol = S.refs.list;
    const inst = S.inst;
    const isSpoil = inst.mold === "spoil" && Array.isArray(inst.items) && inst.items.length;
    const isReset = inst.mold === "reset" && Array.isArray(inst.steps) && inst.steps.length;
    const zs = inst.mold === "zones" ? zonesOf(inst) : [];
    const isZones = zs.length > 0;
    if (!isSpoil && !isReset && !isZones) { ol.hidden = true; return; }
    const states = pinStates(S);
    const nz = isZones ? nextZoneOf(inst) : null;
    const rows = isZones
      ? zs.map((z, i) => ({ id: z.id, n: z.n || i + 1, a: z.name, b: "", c: fmt(z.minutes, "min", inst), origin: z.origin === "set" ? "set" : "inferred",
          st: z.state === "done" ? "done" : nz && nz.id === z.id ? "next" : "later" }))
      : isSpoil
      ? inst.items.map((it, i) => ({ id: it.id, n: i + 1, a: it.name, b: fmt(it.days, "days", inst), c: fmt(it.value, "usd", inst), origin: it.origin, st: states[it.id] || "safe" }))
      : inst.steps.slice().sort((x, y) => x.n - y.n).map((s, i) => ({ id: s.id, n: s.n || i + 1, a: s.text, b: "", c: fmt(s.minutes, "min", inst), origin: null, st: states[s.id] || "on" }));
    const sig = rows.map((r) => r.id + ":" + r.a + ":" + r.c + ":" + r.b + ":" + r.origin + (isZones ? ":" + r.st : "")).join("|");
    const ZWORD = { done: "clear", next: "next", later: "later" };
    if (ol.dataset.sig !== sig) {
      ol.dataset.sig = sig;
      ol.textContent = "";
      ol.className = "ins-list ins-list--" + (isZones ? "zones" : isSpoil ? "items" : "steps");
      rows.forEach((r) => {
        const btn = h("button", { class: "ins-row", type: "button", dataset: { row: r.id }, on: { click: () => { if (isZones) openZone(S, r.id); else flashRow(S, r.id); } } },
          h("span", { class: "ins-row__n wb-mono", "aria-hidden": "true", text: String(r.n) }),
          h("span", { class: "ins-row__a", text: r.a }),
          r.b ? h("span", { class: "ins-row__b wb-mono", text: r.b }) : null,
          h("span", { class: "ins-row__c wb-mono" + (r.origin ? " ins-row__c--" + r.origin : ""), text: r.c }),
          isZones ? h("span", { class: "ins-row__w wb-micro", text: ZWORD[r.st] }) : null,
          h("span", { class: "ins-row__st wb-sr" }));
        ol.appendChild(h("li", { class: "ins-li" }, btn));
      });
    }
    const STATE_WORD = { risk: "turns inside the horizon", saved: "cooked tonight", cooked: "cooked", safe: "keeps for now", today: "", on: "in this round", off: "later", done: "done" };
    rows.forEach((r) => {
      const btn = ol.querySelector('[data-row="' + cssEsc(r.id) + '"]');
      if (!btn) return;
      const cls = "ins-row is-" + (isZones && r.st === "later" ? "off" : r.st);
      if (btn.className.replace(" is-flash", "") !== cls) btn.className = cls + (btn.classList.contains("is-flash") ? " is-flash" : "");
      const sr = btn.querySelector(".ins-row__st");
      if (sr) sr.textContent = ", " + (isZones ? ZWORD[r.st] : (STATE_WORD[r.st] || r.st)) + (r.origin ? ", " + ORIGIN_WORD[r.origin] : "");
    });
    ol.hidden = false;
  }

  function mailAllowed(S) {
    if (S.readOnly || hiddenMail) return false;
    const inst = S.inst;
    if (!inst.mailQuery && !(inst.demo && MAIL_MOLDS.indexOf(inst.mold) >= 0)) return false;
    if (!has("forge", "enrich")) return false;
    if (inst.demo) return true;
    const c = caps();
    if (!c || !c.sample) return false;
    return c.gmail === "granted" || c.gmail === "prompt";
  }
  function renderConf(S) {
    const box = S.refs.conf;
    const inst = S.inst;
    const cf = confOf(inst);
    box.textContent = "";
    if (cf.total > 0) {
      const row = h("div", { class: "ins-conf__row" });
      row.appendChild(h("span", { class: "wb-micro ins-conf__lbl", text: "MEASURED " + cf.measured + " OF " + cf.total }));
      const sq = h("span", { class: "ins-conf__sq", "aria-hidden": "true" });
      // one square per fact, in the mold's order, so a bracket on the photo can draw its hairline to its own square
      const ids = Array.isArray(cf.ids) && cf.ids.length === cf.total ? cf.ids : null;
      for (let i = 0; i < cf.total; i++) {
        const vid = ids ? ids[i] : null;
        const zn = vid && inst.mold === "zones" ? zonesOf(inst).find((z) => z.id === vid) : null;
        const vv = vid && inst.vars[vid];
        const on = zn ? (zn.state === "done" || zn.origin === "set") : vv ? (vv.origin === "seen" || vv.origin === "set") : i < cf.measured;
        sq.appendChild(h("i", { class: on ? "is-on" : "", dataset: vv ? { var: vid } : {} }));
      }
      row.appendChild(sq);
      const anyGuess = Object.keys(S.chips).some((k) => S.chips[k].kind === "var" && inst.vars[S.chips[k].id] && inst.vars[S.chips[k].id].origin === "assumed");
      if (anyGuess && !S.readOnly) row.appendChild(h("span", { class: "ins-conf__hint", text: "tap ? to set" }));
      box.appendChild(row);
    }
    renderMail(S, box);
  }
  function renderMail(S, box) {
    const m = S.mail;
    const host = h("div", { class: "ins-mail", "aria-live": "polite" });
    if (m.state === "running") {
      const tick = h("div", { class: "ins-mail__tick" },
        h("span", { class: "wb-micro ins-mail__lbl", text: m.label || "LOOKING IN YOUR MAIL…" }),
        h("span", { class: "ins-mail__q wb-mono", text: m.queries.length ? m.queries[m.queries.length - 1] : "" }));
      host.appendChild(tick);
      host.appendChild(h("button", { class: "ins-mail__stop", type: "button", text: "Stop", on: { click: () => stopEnrich(S) } }));
      box.appendChild(host);
      return;
    }
    if (m.state === "error" && m.error) {
      host.appendChild(h("p", { class: "ins-mail__err", text: m.error }));
      if (m.retry && mailAllowed(S)) host.appendChild(h("button", { class: "ins-mail__chip", type: "button", text: "Try again", on: { click: () => startEnrich(S) } }));
      box.appendChild(host);
      return;
    }
    const summary = m.summary || (S.inst.enriched && S.inst.enriched.summary) || null;
    if (summary) host.appendChild(h("p", { class: "ins-mail__sum wb-serif", text: summary }));
    if (mailAllowed(S)) {
      host.appendChild(h("button", { class: "ins-mail__chip", type: "button", on: { click: () => startEnrich(S) } },
        h("span", { class: "ins-mail__icon", "aria-hidden": "true", html: icon("mail") }),
        h("span", { text: S.inst.enriched ? "Look again in my mail" : "Check my mail for more of these" })));
    }
    if (host.childNodes.length) box.appendChild(host);
  }
  function startEnrich(S) {
    if (!has("forge", "enrich") || S.mail.state === "running") return;
    S.mail = { state: "running", jobId: null, queries: [], summary: null, error: null, label: "LOOKING IN YOUR MAIL…", wanted: true };
    renderConf(S);
    const p = call("forge", "enrich", S.id, {});
    if (p && typeof p.then === "function") {
      p.then((res) => {
        if (S.destroyed) return;
        if (S.mail.state === "running") { S.mail = { state: "done", jobId: null, queries: [], summary: (res && res.summary) || null, error: null }; renderConf(S); }
      }, (err) => {
        if (S.destroyed) return;
        if (S.mail.state === "running") mailError(S, err || {});
      });
    }
  }
  function stopEnrich(S) {
    if (S.mail.jobId && has("forge", "cancel")) call("forge", "cancel", S.mail.jobId);
    S.mail = { state: "idle", jobId: null, queries: [], summary: null, error: null };
    renderConf(S);
  }
  function mailError(S, err) {
    const code = err.code || "unknown";
    if (code === "cancelled") { S.mail = { state: "idle", jobId: null, queries: [], summary: null, error: null }; renderConf(S); return; }
    let msg = err.message || "Something went wrong in the mail search.";
    let retry = false;
    if (code === "server_not_connected" || code === "needs_reauth" || code === "unavailable") msg = "Connect Gmail in claude.ai Settings → Connectors.";
    else if (code === "not_granted") { msg = "Mail stays closed."; hiddenMail = true; }
    else if (code === "rate_limited") { msg = "Claude needs a breather. Try again in a minute."; retry = true; }
    else if (code === "timeout") { msg = "The mail search ran long, so I stopped it."; retry = true; }
    else if (code === "invalid_json") { msg = "I couldn’t make sense of what I found. Try again."; retry = true; }
    else if (code === "tool_error") { msg = err.message || "Gmail had a problem with that search."; retry = true; }
    else retry = true;
    S.mail = { state: "error", jobId: null, queries: [], summary: null, error: msg, retry };
    renderConf(S);
  }

  function renderNote(S) {
    const p = S.refs.note;
    const note = S.inst.fieldNote;
    if (note) { p.textContent = note; p.hidden = false; } else p.hidden = true;
    const nx = S.refs.next;
    const np = Array.isArray(S.inst.nextPhotos) ? S.inst.nextPhotos.filter(Boolean) : [];
    if (np.length && !S.readOnly) {
      nx.textContent = "";
      nx.appendChild(h("span", { class: "wb-micro", text: "TO KEEP IT TRUE — " }));
      nx.appendChild(h("span", { text: "photograph " + np[0].replace(/^photograph\s+/i, "").replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()) }));
      nx.hidden = false;
    } else nx.hidden = true;
  }

  function renderMission(S) {
    const b = S.refs.mission;
    const ms = S.inst.mission;
    clearInterval(S.missionTimer);
    if (S.readOnly || !ms || !isNum(ms.endsAt) || !isNum(ms.startedAt) || ms.verified) { b.hidden = true; return; }
    const paint = () => {
      const left = ms.endsAt - Date.now();
      if (left <= 0) b.textContent = "TIME · SHOW ME THE AFTER";
      else {
        const s = Math.ceil(left / 1000);
        b.textContent = "ON A MISSION · " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + " LEFT";
      }
    };
    paint();
    b.hidden = false;
    S.missionTimer = setInterval(() => { if (S.destroyed) clearInterval(S.missionTimer); else paint(); }, 1000);
  }

  /* ---------------------------------------------------------------- the bottom bar */
  const REFUSE = {
    worse: "That’s further from where you want to be. Drag the other way to commit.",
    same: "That’s where it is now. Drag it to pick a different number.",
  };
  function renderBar(S) {
    const bar = S.refs.bar;
    if (!bar) return;
    const inst = S.inst;
    const it = inst.intention;
    const g = S.lastGhost || ghostOf(inst);
    const levers = leverIds(S);
    const lever = levers[0] || null;
    const lv = lever ? inst.vars[lever] : null;
    const liveVal = lever ? valueOf(S, lever) : NaN;
    const differs = it && lever === it.varId && isNum(it.value) && liveVal !== it.value;
    const vd = lever && isNum(liveVal) ? verdictOf(S, lever, liveVal) : "na";
    const moved = lever && (S.leverMoved || differs || (S.hinge && S.hinge.varId === lever && sessionLeverMoved));
    let mono = null, text = null, btn = null, zNext = null;
    const isZones = inst.mold === "zones";
    const openMission = !!(inst.mission && !inst.mission.verified);
    if (isZones) zNext = nextZoneOf(inst);
    if (isZones && zNext && !differs && !S.leverMoved && !S.live && !S.refusal && (g.due || !openMission)) {
      const zs = zonesOf(inst);
      mono = zs.filter((z) => z.state === "done").length + " OF " + zs.length + " CLEAR";
      btn = "zone";
    } else if (isZones && g.due && !zNext && !differs) {
      mono = "ALL ZONES CLEAR";
    } else if (it && !differs && g.status !== "none") {
      if (g.due) { mono = "CHECK-IN DUE · HOW DID IT GO"; btn = "checkin"; }
      else if (g.status === "held") { mono = "HELD · " + leverPhrase(inst, it.varId, it.value).toUpperCase(); btn = "quiet"; }
      else if (g.status === "closer") {
        const pct = isNum(g.progress) ? Math.round(clamp(g.progress, 0, 1) * 100) : null;
        mono = "CLOSER" + (pct != null ? " · " + pct + "% OF THE WAY" : ""); btn = "quiet";
      }
      else if (g.status === "missed") { mono = "NOT THIS TIME · TRY A SMALLER STEP"; btn = "quiet"; }
      else { mono = "COMMITTED · CHECK " + fmtDay(it.checkAt || g.end || Date.now()).toUpperCase(); btn = "quiet"; }
    } else if (S.refusal && REFUSE[S.refusal]) {
      text = REFUSE[S.refusal];
    } else if (moved && (vd === "worse" || vd === "same")) {
      text = REFUSE[vd];
    } else if (moved) {
      text = "Hold " + leverPhrase(inst, lever, liveVal) + " to commit" + (differs ? " instead." : ".");
    } else if (S.hinge && S.hinge.varId && draggable(S, inst.vars[S.hinge.varId])) {
      text = "Drag the glowing number.";
    } else if (lever) {
      text = "Drag the " + fmt(liveVal, lv.format, inst) + ", then hold it to commit.";
    } else text = "Tap any number to see where it came from.";
    const sig = [mono, text, btn, zNext ? zNext.id + zNext.name : ""].join("|");
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    bar.textContent = "";
    bar.classList.toggle("ins-bar--two", btn === "checkin");
    bar.appendChild(h("p", { class: "ins-bar__hint" + (mono ? " wb-micro ins-bar__hint--mono" : "") + (text && (text === REFUSE.worse || text === REFUSE.same) ? " ins-bar__hint--refuse" : ""), "aria-live": "polite", text: mono || text }));
    if (btn === "checkin") {
      // a kept promise often leaves nothing to photograph (no receipt is the success): say how it went instead
      const row = h("div", { class: "ins-bar__btns" },
        h("button", { class: "wb-btn wb-btn--quiet ins-bar__btn ins-bar__btn--icon", type: "button", "aria-label": "Re-photograph", on: { click: () => rephotograph(S) } },
          h("span", { class: "ins-bar__icon", "aria-hidden": "true", html: icon("camera") })),
        h("button", { class: "wb-btn wb-btn--primary ins-bar__btn", type: "button", on: { click: () => checkIn(S) } },
          h("span", { class: "wb-btn__label", text: "How did it go?" })));
      bar.appendChild(row);
    } else if (btn === "zone" && zNext) {
      bar.appendChild(h("button", { class: "wb-btn wb-btn--primary ins-bar__btn ins-bar__btn--zone", type: "button",
        on: { click: () => { if (has("router", "go")) WB.router.go("mission", { id: S.id, zoneId: zNext.id }); } } },
        h("span", { class: "wb-btn__label ins-bar__zlbl", text: "Start the " + String(zNext.name || "next zone").replace(/^(the|a|an)\s+/i, "").replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()) })));
    } else if (btn) {
      bar.appendChild(h("button", { class: "wb-btn wb-btn--" + btn + " ins-bar__btn", type: "button", on: { click: () => rephotograph(S) } },
        h("span", { class: "ins-bar__icon", "aria-hidden": "true", html: icon("camera") }), h("span", { class: "wb-btn__label", text: "Re-photograph" })));
    }
  }

  /* ---------------------------------------------------------------- check-in: "How did it go?" */
  /* The lever, prefilled at the promised value; the user steps it to what actually happened. Saved as a manual
     observation of the outcome at that value, so the ghost line can resolve held, closer or missed right away. */
  const CHECKIN_Q = {
    leak: (w) => "How many times a " + (w.period === "month" ? "month" : "week") + " did it really happen?",
    perUse: () => "How many times a month did you really go?",
    spoil: () => "How many of them did you cook?",
    dial: (w) => "How far did the dial really move, in " + (w.stepUnit || "steps") + "?",
    countdown: () => "How many days early did you act?",
    reset: () => "How many of the moves did you do?",
  };
  CHECKIN_Q.project = (w) => "How many " + (w.unit || "pieces") + " are done now?";
  CHECKIN_Q.week = () => "How many family evenings did you really get?";
  const CHECKIN_FACT = { leak: "rate", perUse: "uses", project: "done" };
  function checkIn(S) {
    const inst = S.inst;
    const it = inst && inst.intention;
    if (!it || !has("ui", "sheet") || inst.mold === "zones") return;
    const v = inst.vars[it.varId];
    if (!v) return;
    const def = moldDef(inst);
    const counts = tracksDone(inst);
    // what really happened is a fact (orders a week, visits a month), so it can land past "as it is" too
    const mirror = CHECKIN_FACT[inst.mold] && inst.vars[CHECKIN_FACT[inst.mold]] ? CHECKIN_FACT[inst.mold] : null;
    const asIs = mirror ? inst.vars[mirror].value : null;
    const r0 = rangeOf(inst, it.varId);
    const rf = mirror ? rangeOf(inst, mirror) : r0;
    let r = { min: Math.min(r0.min, rf.min), max: Math.max(r0.max, rf.max, isNum(asIs) ? asIs : -Infinity), step: r0.step };
    // a count of finished pieces steps over 0..total, starting at where it stands now
    if (counts) { const tot = inst.vars.total && isNum(inst.vars.total.value) ? inst.vars.total.value : rf.max; r = { min: 0, max: Math.max(0, tot), step: 1 }; }
    const obsAt = (value) => {
      if (!has("molds", "compute")) return NaN;
      return mirror ? WB.molds.compute(inst, { [mirror]: value }).primary : WB.molds.compute(inst, { [it.varId]: value }).outcome;
    };
    let val = counts && isNum(asIs) ? clamp(asIs, r.min, r.max) : isNum(it.value) ? it.value : valueOf(S, it.varId);
    const gh = counts ? ghostOf(inst) : null;
    const cnt = (n) => fmt(n, "int", inst);
    const pf = (def && def.outputs && def.outputs[def.primary] && def.outputs[def.primary].format) || "num";
    const valEl = h("span", { class: "ins-ci__v wb-mono" });
    const outEl = h("p", { class: "ins-ci__out wb-mono" });
    const paint = () => {
      if (counts) {
        valEl.textContent = val + " of " + r.max;
        const b = gh && isNum(gh.baseline) ? gh.baseline : it.baseline, tg = gh && isNum(gh.target) ? gh.target : it.target;
        outEl.textContent = cnt(b) + " → " + cnt(val) + " · LINE " + cnt(tg);
        return;
      }
      valEl.textContent = leverPhrase(inst, it.varId, val);
      const y = obsAt(val);
      outEl.textContent = isNum(y) ? fmt(it.baseline, pf, inst) + " → " + fmt(y, pf, inst) + " · LINE " + fmt(it.target, pf, inst) : "";
    };
    const stepBy = (k) => { val = quantize(val + k * r.step, r); paint(); haptic(4); };
    const body = h("div", { class: "ins-ci" },
      h("p", { class: "ins-ci__q", text: (CHECKIN_Q[inst.mold] || (() => "What actually happened?"))(inst.words || {}) }),
      h("div", { class: "ins-ci__row" },
        h("button", { class: "wb-iconbtn ins-ci__step", type: "button", "aria-label": "Less", text: "−", on: { click: () => stepBy(-1) } }),
        valEl,
        h("button", { class: "wb-iconbtn ins-ci__step", type: "button", "aria-label": "More", text: "+", on: { click: () => stepBy(1) } })),
      outEl,
      h("p", { class: "wb-micro ins-ci__fine", text: "YOUR WORD COUNTS AS A READING. A PHOTO CAN STILL CORRECT IT." }));
    paint();
    const save = (value, note) => {
      const y = obsAt(value);
      if (!isNum(y) || !has("store", "addObservation")) return;
      S.flashChart = true;
      if (counts && has("store", "update")) call("store", "update", S.id, (i) => { const dv = i.vars && i.vars.done; if (dv) { dv.value = value; dv.origin = "set"; dv.reason = null; } }, "set");
      WB.store.addObservation(S.id, { t: Date.now(), value: y, facts: { [mirror || it.varId]: value }, source: "manual", note });
    };
    WB.ui.sheet({
      title: "How did it go?",
      body,
      actions: [
        { label: "Save", kind: "primary", onTap: (close) => { close(); save(val, "You told me."); } },
        { label: "Same as before", kind: "quiet", onTap: (close) => {
          close();
          save(mirror && isNum(asIs) ? asIs : 0, "Nothing changed, you said.");
        } },
      ],
    });
  }

  /* ---------------------------------------------------------------- hairlines */
  function scheduleHair(S) {
    if (S.hairRaf || S.destroyed) return;
    S.hairRaf = raf(() => { S.hairRaf = 0; drawHair(S); });
  }
  function drawHair(S, animate) {
    const svg = S.refs.hair, body = S.refs.body;
    if (!svg || !body || S.destroyed) return;
    if (!animate && S.hairAnimating) { S.hairDirty = true; return; }
    const br = body.getBoundingClientRect();
    if (!br.width) return;
    const W = Math.round(br.width), H = Math.round(body.scrollHeight || br.height);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    const lines = [];
    const inst = S.inst;
    // photo brackets
    if (S.brackets && S.refs.img && !S.zoomed) {
      const ir = S.refs.img.getBoundingClientRect();
      for (const evId in S.brackets) {
        const b = S.brackets[evId];
        if (!b.varId) continue;
        const c = S.chips["v:" + b.varId];
        // a fact read from the photo that the sentence doesn't name still gets its line: to its measured square
        const node = c ? c.node : S.refs.conf && S.refs.conf.querySelector('.ins-conf__sq i[data-var="' + cssEsc(b.varId) + '"]');
        if (!node) continue;
        lines.push({ key: evId, x1: ir.left - br.left + b.cx, y1: ir.top - br.top + b.cy, chip: node, far: !c });
      }
    }
    // letterpress quotes
    if (S.refs.press) {
      S.refs.press.querySelectorAll(".ins-press__quote[data-ev]").forEach((q) => {
        const evId = q.getAttribute("data-ev");
        for (const k in inst.vars) {
          if (inst.vars[k].evidenceId !== evId) continue;
          const c = S.chips["v:" + k];
          if (!c) continue;
          const qr = q.getBoundingClientRect();
          lines.push({ key: evId + ":" + k, x1: qr.left - br.left + Math.min(qr.width / 2, 40), y1: qr.bottom - br.top, chip: c.node });
        }
      });
    }
    const P = [];
    lines.forEach((l, i) => {
      const cr = l.chip.getBoundingClientRect();
      const x2 = cr.left - br.left + cr.width / 2, y2 = cr.top - br.top + 1;
      if (y2 <= l.y1 + 4) return;
      const dy = y2 - l.y1;
      const d = "M" + l.x1.toFixed(1) + " " + l.y1.toFixed(1) + "C" + l.x1.toFixed(1) + " " + (l.y1 + dy * 0.55).toFixed(1) + " " + x2.toFixed(1) + " " + (y2 - dy * 0.45).toFixed(1) + " " + x2.toFixed(1) + " " + y2.toFixed(1);
      const hot = (S.live && l.chip.classList.contains("is-scrubbing") ? " is-hot" : "") + (l.far ? " is-far" : "");
      P.push('<g class="ins-hair__g' + hot + '" style="--i:' + i + '"><path class="ins-hair__halo" d="' + d + '"/><path class="ins-hair__line" d="' + d + '"/>' +
        '<circle class="ins-hair__end" cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="1.75"/></g>');
    });
    svg.innerHTML = P.join("");
    if (animate && !reduced()) {
      svg.querySelectorAll("path").forEach((p) => {
        let len = 400;
        try { len = Math.ceil(p.getTotalLength()) + 2; } catch (e) { /* jsdom etc */ }
        p.style.strokeDasharray = len;
        p.style.strokeDashoffset = len;
      });
      svg.classList.add("is-drawing");
      S.hairAnimating = true;
      raf(() => raf(() => {
        svg.querySelectorAll("path").forEach((p) => { p.style.strokeDashoffset = "0"; });
        later(S, () => {
          S.hairAnimating = false;
          svg.classList.remove("is-drawing");
          svg.querySelectorAll("path").forEach((p) => { p.style.strokeDasharray = ""; p.style.strokeDashoffset = ""; });
          if (S.hairDirty) { S.hairDirty = false; drawHair(S); }
        }, 1400);
      }));
    }
  }

  /* ---------------------------------------------------------------- the develop */
  function runDevelop(S) {
    const fig = S.refs.spec;
    const wrap = S.refs.wrap;
    const start = () => {
      if (S.destroyed) return;
      raf(() => raf(() => {
        fig.classList.add("is-on");          // negative → colour (CSS 600 ms)
        later(S, () => { wrap.classList.add("is-brackets"); }, 360);
        later(S, () => { drawHair(S, true); }, 560);
        later(S, () => { wrap.classList.remove("is-developing", "is-brackets"); fig.classList.remove("is-on"); S.develop = false; }, 1500);
        later(S, () => coachDrag(S), 1650);
      }));
    };
    const img = S.refs.img;
    if (img && !img.complete) {
      let done = false;
      const go = () => { if (!done) { done = true; start(); } };
      img.addEventListener("load", go, { once: true });
      img.addEventListener("error", go, { once: true });
      later(S, go, 1200);
    } else start();
  }

  /* ---------------------------------------------------------------- coach marks */
  function seenCoach(key) {
    const p = typeof U().uiPrefs === "function" ? U().uiPrefs() : {};
    return !!(p && p.coach && p.coach[key]);
  }
  function dismissCoach(S) { if (S.coachOff) { try { S.coachOff(); } catch (e) { /* ignore */ } S.coachOff = null; } }
  function showCoach(S, target, text, key, placement, extra) {
    if (S.readOnly || S.destroyed || !target || !has("ui", "coach") || seenCoach(key)) return;
    if (has("router", "current") && viewS === S && WB.router.current().name !== "instrument") return;
    dismissCoach(S);
    S.coachOff = WB.ui.coach(target, text, Object.assign({ key, placement: placement || "above", bounds: () => visibleBand(S) }, extra || {}));
    try {
      const root = document.getElementById("wb-coach-root");
      const tag = root && root.lastElementChild;
      if (tag) tag.style.pointerEvents = "none";
    } catch (e) { /* ignore */ }
    later(S, () => dismissCoach(S), 7000);
  }
  /* the part of the screen between the instrument's top bar and its bottom bar */
  function visibleBand(S) {
    let top = 0, bottom = window.innerHeight;
    try {
      const t = S.refs.wrap && S.refs.wrap.querySelector(".ins-top");
      if (t) { const r = t.getBoundingClientRect(); if (r.bottom > 0) top = Math.max(top, r.bottom); }
      if (S.refs.bar) { const r = S.refs.bar.getBoundingClientRect(); if (r.height) bottom = Math.min(bottom, r.top); }
    } catch (e) { /* ignore */ }
    return { top, bottom };
  }
  function coachDrag(S) {
    // nothing to teach on an instrument that already holds a promise
    if (S.inst.intention) return;
    const id = S.hinge && S.hinge.varId && draggable(S, S.inst.vars[S.hinge.varId]) ? S.hinge.varId : leverIds(S)[0];
    const c = id && S.chips["v:" + id];
    // never over the sentence's numbers or text: beside the chip only when its line is the first, else the gap above
    // when the tag has to sit in the gap above the sentence, it names the number so it can't be read as the one under it
    let say = "Drag me.";
    try {
      const cr = c && c.node.getBoundingClientRect(), sr = S.refs.sentence.getBoundingClientRect();
      if (cr && cr.top - sr.top > 12) say = "Drag the " + fmt(valueOf(S, id), S.inst.vars[id].format, S.inst) + ".";
    } catch (e) { /* ignore */ }
    if (c) showCoach(S, c.node, say, "drag", "above", {
      avoid: () => [S.refs.sentence, S.refs.strip && !S.refs.strip.hidden ? S.refs.strip : null, S.refs.hinge && !S.refs.hinge.hidden ? S.refs.hinge : null].filter(Boolean),
      zones: () => [S.refs.sentence],
    });
  }
  function hasOriginVariety(S) {
    return Object.keys(S.chips).some((k) => S.chips[k].kind === "var" && S.inst.vars[S.chips[k].id] && S.inst.vars[S.chips[k].id].kind === "fact");
  }
  /* coach 2 sits in the page under the chart, never over the sentence or the hinge note, and names only the kinds of
     number this instrument actually has */
  function coachOrigins(S) {
    if (S.readOnly || S.destroyed || seenCoach("origins") || !S.refs.coach2) return;
    const kinds = {};
    Object.keys(S.chips).forEach((k) => { const c = S.chips[k]; const v = c.kind === "var" && S.inst.vars[c.id]; if (v && v.kind === "fact") kinds[v.origin] = 1; });
    const bits = [];
    if (kinds.seen) bits.push("Solid numbers I read.");
    if (kinds.inferred) bits.push("Dotted ones I inferred.");
    if (kinds.assumed) bits.push("Hollow ones are guesses: make them true.");
    if (kinds.set) bits.push("Blue ones are yours.");
    if (!bits.length) return;
    try { const pr = U().uiPrefs ? U().uiPrefs() : {}; const coach = Object.assign({}, pr.coach || {}, { origins: true }); if (U().saveUiPrefs) U().saveUiPrefs({ coach }); } catch (e) { /* ignore */ }
    const box = S.refs.coach2;
    box.textContent = "";
    box.appendChild(h("span", { class: "wb-micro ins-coach2__tag", text: "HOW TO READ IT — " }));
    box.appendChild(h("span", { text: bits.join(" ") }));
    box.hidden = false;
    const q = Object.keys(S.chips).map((k) => S.chips[k]).find((c) => c.kind === "var" && S.inst.vars[c.id] && S.inst.vars[c.id].origin === "assumed");
    if (q && !reduced()) {
      q.node.classList.add("is-pulse");
      later(S, () => q.node.classList.remove("is-pulse"), 1300);
    }
    later(S, () => { box.hidden = true; scheduleHair(S); }, 9000);
    scheduleHair(S);
  }

  /* ---------------------------------------------------------------- render orchestration */
  function renderAll(S, o) {
    const opt = o || {};
    S.hinge = hingeOf(S.inst);
    renderTop(S);
    renderMission(S);
    renderSentence(S, { tween: opt.tween, countUp: opt.countUp, delay: opt.delay });
    renderNextCard(S);
    renderPlate(S);
    renderStrip(S);
    renderHinge(S);
    renderChart(S);
    renderList(S);
    renderConf(S);
    renderNote(S);
    renderBar(S);
    if (!opt.first) drawOverlay(S);
    scheduleHair(S);
  }
  function refresh(S, next, source) {
    if (S.destroyed) return;
    const inst = next || (S.readOnly ? S.inst : clone(storeGet(S.id))) || S.inst;
    if (!inst) return;
    if (!S.readOnly && isLocked(inst) !== !!S.locked) { remount(S, inst); return; }
    if (S.locked) return;
    if (S.live) { S.pendingRefresh = { inst, source }; return; }
    if (!S.refs.wrap) { remount(S, inst); return; }
    const photoChanged = photoKey(inst) !== photoKey(S.inst);
    const it = inst.intention;
    if (it && it.committedAt !== S.lastIntentionAt) { S.inkNext = true; S.lastIntentionAt = it.committedAt; }
    if (!it) S.lastIntentionAt = null;
    S.inst = inst;
    if (photoChanged || (inst.mold !== S.refs.wrap.dataset.mold)) {
      // a new reading landed: rebuild the specimen and re-run a short develop
      const fig = S.refs.spec;
      const nf = buildSpecimen(S);
      fig.replaceWith(nf);
      S.refs.wrap.dataset.mold = inst.mold;
      S.sentSig = "";
    }
    renderAll(S, { tween: source !== "scrub" && source !== "set" });
    // a new reading is the payoff of coming back: bring the promise line into view and let it flash once
    if ((source === "snap" || S.flashChart) && S.refs.chart && inst.intention) {
      S.flashChart = false;
      later(S, () => {
        try {
          const r = S.refs.chart.getBoundingClientRect(), band = visibleBand(S);
          if (r.bottom > band.bottom || r.top < band.top) S.refs.chart.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
        } catch (e) { /* ignore */ }
        S.refs.chart.classList.remove("is-flash"); void S.refs.chart.offsetWidth; S.refs.chart.classList.add("is-flash");
        later(S, () => S.refs.chart.classList.remove("is-flash"), 1400);
      }, 120);
    }
  }
  function remount(S, inst) {
    const el = S.root, wasView = viewS === S;
    destroy(S);
    mount(el, inst.id, {});
    if (wasView) viewS = Array.from(mounts).find((m) => m.root === el) || null;
  }
  function photoKey(inst) {
    const p = inst && inst.photo;
    return p ? String(p.assetId || "") + "|" + String(p.at || "") + "|" + String((p.src || "").length) : "none";
  }

  function peerScrub(S, varId, value, peer) {
    if (S.destroyed || !S.inst || !S.inst.vars || !S.inst.vars[varId] || !isNum(value)) return;
    if (!S.readOnly) return; // peers steer mirrors, never your own instrument
    S.ov[varId] = value;
    scheduleLive(S);
    const c = S.chips["v:" + varId];
    if (!c || !c.peer) return;
    const initials = peerInitials(peer);
    if (initials) { c.peer.textContent = initials; c.peer.hidden = false; }
    c.node.classList.add("is-peer");
    clearTimeout(S.peerTimers[varId]);
    S.peerTimers[varId] = setTimeout(() => { c.peer.hidden = true; c.node.classList.remove("is-peer"); }, 1600);
  }
  function peerInitials(peer) {
    if (!peer) return "";
    if (typeof peer === "string") return peer.slice(0, 2).toUpperCase();
    if (peer.initials) return String(peer.initials).slice(0, 2).toUpperCase();
    const n = String(peer.name || "").trim();
    return n ? n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "";
  }

  function later(S, fn, ms) {
    const t = setTimeout(() => { if (!S.destroyed) { try { fn(); } catch (err) { console.error("[WB.instrument]", err); } } }, ms);
    S.timers.push(t);
    return t;
  }
  function destroy(S) {
    if (!S || S.destroyed) return;
    S.destroyed = true;
    if (S.live) { const l = S.live; S.live = null; if (!S.readOnly && isNum(S.ov[l.varId])) persist(S, l.varId, S.ov[l.varId], S.inst.vars[l.varId] && S.inst.vars[l.varId].kind === "lever"); }
    dismissCoach(S);
    disposeHolds(S);
    S.offs.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    S.timers.forEach((t) => clearTimeout(t));
    clearTimeout(S.keyTimer); clearTimeout(S.zoomTimer); clearTimeout(S.capTimer);
    clearInterval(S.missionTimer);
    for (const k in S.peerTimers) clearTimeout(S.peerTimers[k]);
    caf(S.rafId); caf(S.hairRaf); caf(S.resizeRaf);
    S.tweens.forEach((id) => caf(id));
    if (S.chart && typeof S.chart.destroy === "function") S.chart.destroy();
    mounts.delete(S);
    if (viewS === S) viewS = null;
    if (S.root) S.root.textContent = "";
  }

  /* ================================================================ public API */
  function unmount(target) {
    if (!target) { if (viewS) destroy(viewS); return; }
    if (typeof target.destroy === "function" && !(target instanceof Node)) { target.destroy(); return; }
    const S = Array.from(mounts).find((m) => m.root === target);
    if (S) destroy(S);
  }

  /* applyPeerScrub(id, varId, value, peer) or applyPeerScrub({id, varId, value, from|peer}) */
  function applyPeerScrub(a, b, c, d) {
    let id = a, varId = b, value = c, peer = d;
    if (a && typeof a === "object") { id = a.id; varId = a.varId; value = a.value; peer = a.peer || a.from || null; }
    if (typeof value === "string") value = parseFloat(value);
    mounts.forEach((S) => { if (S.id === id) peerScrub(S, varId, value, peer); });
  }

  /* flashEvidence(id, varId|evidenceId) or flashEvidence(varId|evidenceId) on the open instrument */
  function flashEvidence(a, b) {
    let S = null, key = b;
    if (b === undefined) { S = viewS; key = a; }
    else S = Array.from(mounts).find((m) => m.id === a) || null;
    if (S && key) flashKey(S, key);
  }

  /* renderMini(inst, {bare}) -> HTMLElement (stringifies to its markup). The bench's specimen tile. */
  function renderMini(inst, opts) {
    if (typeof document === "undefined") return null;
    if (inst instanceof Node && opts && opts.mold) { const t = inst; const el = renderMini(opts, arguments[2]); if (el) { t.textContent = ""; t.appendChild(el); } return t; }
    const o = opts || {};
    const tile = h("div", { class: "ins-mini" + (o.bare ? " ins-mini--bare" : ""), dataset: { id: inst && inst.id, mold: inst && inst.mold } });
    if (!inst || !inst.mold) { tile.appendChild(h("span", { class: "ins-mini__title", text: "Missing" })); return tile; }
    if (isLocked(inst)) {
      tile.classList.add("ins-mini--locked");
      tile.dataset.mold = "";
      tile.appendChild(h("div", { class: "ins-mini__lock" },
        h("span", { class: "wb-micro", text: "WORK · CLOCKED OUT" }),
        h("span", { class: "ins-mini__lock-t", text: "Waits for Clock in." })));
      tile.toString = function () { return this.outerHTML; };
      return tile;
    }
    const g = ghostOf(inst);
    if (g.due) tile.classList.add("is-due");
    if (inst.demo) tile.classList.add("is-demo");
    const fig = h("div", { class: "ins-mini__fig" });
    const thumb = h("div", { class: "ins-mini__thumb" });
    const photo = inst.photo || (Array.isArray(inst.photos) && inst.photos.length ? inst.photos[inst.photos.length - 1] : null);
    const src = photo && (photo.thumb || photo.src);
    let anchor = null;
    if (src) {
      const img = h("img", { class: "ins-mini__img", alt: "", src, decoding: "async", loading: "lazy", draggable: "false" });
      img.addEventListener("error", () => { if (photo.src && img.src !== photo.src && img.getAttribute("src") !== photo.src) img.src = photo.src; else thumb.classList.add("is-broken"); }, { once: false });
      thumb.appendChild(img);
      anchor = miniAnchor(inst, photo);
    } else {
      const ev = (inst.evidence || []).find((e) => e.type === "email");
      let pq = ev && ev.quote ? "“" + ev.quote + "”" : "FROM YOUR MAIL";
      if (!ev && inst.mold === "project") pq = Math.round((inst.vars.done && inst.vars.done.value) || 0) + "/" + Math.round((inst.vars.total && inst.vars.total.value) || 0) + " " + ((inst.words && inst.words.unit) || "pieces");
      else if (!ev && inst.mold === "week") pq = "A WEEK, PLANNED";
      const press = h("div", { class: "ins-mini__press" },
        h("span", { class: "ins-mini__press-s", text: (ev && ev.subject) || inst.title || "From your mail" }),
        h("span", { class: "ins-mini__press-q", text: pq }));
      thumb.appendChild(press);
    }
    if (anchor) {
      const svg = svgEl("svg", { class: "ins-mini__hair", viewBox: "0 0 100 75", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
      const ax = anchor.x * 100, ay = anchor.y * 75;
      const d = "M" + ax.toFixed(1) + " " + ay.toFixed(1) + "C" + ax.toFixed(1) + " " + (ay + (75 - ay) * 0.6).toFixed(1) + " 7 " + (75 - (75 - ay) * 0.4).toFixed(1) + " 7 75";
      svg.appendChild(svgEl("path", { class: "ins-mini__halo", d }));
      svg.appendChild(svgEl("path", { class: "ins-mini__line", d }));
      if (anchor.box) {
        const [bx, by, bw, bh] = anchor.box;
        const x = bx * 100, y = by * 75, w = Math.max(2, bw * 100), hh = Math.max(2, bh * 75), L = Math.min(5, w / 2, hh / 2);
        const bd = "M" + x + " " + (y + L) + "V" + y + "H" + (x + L) + "M" + (x + w - L) + " " + y + "H" + (x + w) + "V" + (y + L) +
          "M" + (x + w) + " " + (y + hh - L) + "V" + (y + hh) + "H" + (x + w - L) + "M" + (x + L) + " " + (y + hh) + "H" + x + "V" + (y + hh - L);
        svg.appendChild(svgEl("path", { class: "ins-mini__halo", d: bd }));
        svg.appendChild(svgEl("path", { class: "ins-mini__line", d: bd }));
      } else svg.appendChild(svgEl("circle", { class: "ins-mini__dot", cx: ax, cy: ay, r: 1.6 }));
      thumb.appendChild(svg);
      fig.classList.add("has-hair");
    }
    fig.appendChild(thumb);
    let pv = { formatted: "—", label: "" };
    if (has("molds", "primaryOf")) pv = call("molds", "primaryOf", inst) || pv;
    // a tile shows reality, never the promise: with an open promise and no reading since, the big number is the
    // as-is figure, and the promise rides under it as "→ $0 · CHECK THU"
    let promise = null;
    if (inst.intention && g.status !== "none" && isNum(g.baseline)) {
      const def = moldDef(inst);
      const pf = def && def.tracks === "done" ? "int" : def && def.outputs && def.outputs[def.primary] ? def.outputs[def.primary].format : "num";
      const real = (g.points || []).filter((p) => p.t > g.start && !p.hollow);
      const shown = real.length ? real[real.length - 1].v : g.baseline;
      pv = { formatted: fmt(shown, pf, inst), label: pv.label };
      if (isNum(g.target)) {
        const tail = g.status === "held" ? "HELD" : g.status === "missed" ? "NOT THIS TIME" : g.status === "closer" ? "CLOSER" : g.due ? "DUE" : "CHECK " + fmtDay(g.end || Date.now()).toUpperCase();
        promise = "→ " + fmt(g.target, pf, inst) + " · " + tail;
      }
    }
    fig.appendChild(h("div", { class: "ins-mini__num" },
      h("span", { class: "ins-mini__val wb-mono", text: pv.formatted }),
      pv.label ? h("span", { class: "ins-mini__unit", text: " " + pv.label }) : null,
      promise ? h("span", { class: "wb-micro ins-mini__promise", text: promise }) : null));
    tile.appendChild(fig);
    const meta = h("div", { class: "ins-mini__meta" },
      h("span", { class: "ins-mini__title", text: inst.title || "Instrument" }),
      h("span", { class: "wb-micro ins-mini__sys", text: String(inst.system || "").toUpperCase() }));
    const foot = h("div", { class: "ins-mini__foot" }, meta);
    if (has("charts", "renderSpark")) {
      const sp = call("charts", "renderSpark", inst, { w: 60, h: 18 });
      if (sp && sp instanceof Node) foot.appendChild(h("span", { class: "ins-mini__spark" }, sp));
    }
    tile.appendChild(foot);
    if (g.due && !promise) tile.appendChild(h("span", { class: "wb-micro ins-mini__due", text: "CHECK-IN DUE" }));
    tile.toString = function () { return this.outerHTML; };
    return tile;
  }
  /* where the tile's hairline starts: the main evidence box (or the first pin), mapped through object-fit: cover at 4:3 */
  function miniAnchor(inst, photo) {
    const ev = (inst.evidence || []).find((e) => e.type === "photo" && Array.isArray(e.bbox) && e.bbox.length === 4);
    let pt = null, box = null;
    if (ev) {
      const [x, y, w, hh] = ev.bbox.map(Number);
      pt = [x + w / 2, y + hh / 2];
      box = [x, y, w, hh];
    } else {
      const pins = (inst.items || []).concat(inst.steps || []).filter((p) => Array.isArray(p.pin));
      if (pins.length) pt = pins[0].pin.map(Number);
    }
    if (!pt) return null;
    const a = photo && photo.w > 0 && photo.h > 0 ? photo.w / photo.h : 4 / 3;
    const box43 = 4 / 3;
    const map = (x, y) => {
      if (a > box43) { const f = box43 / a; return [(x - (1 - f) / 2) / f, y]; }
      const f = a / box43; return [x, (y - (1 - f) / 2) / f];
    };
    const p = map(pt[0], pt[1]);
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return null;
    let b = null;
    if (box) {
      const p1 = map(box[0], box[1]), p2 = map(box[0] + box[2], box[1] + box[3]);
      b = [clamp(p1[0], 0, 1), clamp(p1[1], 0, 1), clamp(p2[0], 0, 1) - clamp(p1[0], 0, 1), clamp(p2[1], 0, 1) - clamp(p1[1], 0, 1)];
    }
    return { x: p[0], y: p[1], box: b };
  }

  /* ================================================================ init: the view + bus wiring */
  function init() {
    if (inited) return;
    inited = true;
    if (has("router", "register")) {
      WB.router.register("instrument", {
        enter(el, params) {
          const p = params || {};
          viewS = null;
          const handle = mount(el, p.id, { develop: !!p.develop });
          viewS = Array.from(mounts).find((m) => m.root === el) || null;
          return handle;
        },
        leave(el) { unmount(el); viewS = null; },
      });
    }
    const each = (id, fn) => mounts.forEach((S) => { if (S.id === id && !S.readOnly) fn(S); });
    on("instrument:updated", (p) => { if (p && p.id) each(p.id, (S) => refresh(S, p.instrument ? clone(p.instrument) : null, p.source)); });
    on("instrument:saved", (p) => { const inst = p && p.instrument; if (inst && inst.id) each(inst.id, (S) => refresh(S, clone(inst), "snap")); });
    on("intention:created", (p) => { if (p && p.id) each(p.id, (S) => { S.inkNext = true; refresh(S, null, "intention"); }); });
    on("mission:done", (p) => { if (p && p.id) each(p.id, (S) => refresh(S, null, "mission")); });
    on("mission:start", (p) => { if (p && p.id) each(p.id, (S) => refresh(S, null, "mission")); });
    // clocking in or out: a work instrument locks or opens in place
    on("side:changed", () => {
      Array.from(mounts).forEach((S) => { if (!S.readOnly && S.id && S.inst && isLocked(storeGet(S.id) || S.inst) !== !!S.locked) refresh(S, null, "system"); });
    });
    on("instrument:melted", (p) => {
      if (!p || !p.id) return;
      each(p.id, (S) => {
        if (S === viewS && has("router", "current") && WB.router.current().name === "instrument") WB.router.go("bench", {}, { replace: true });
      });
    });
    on("store:loaded", () => {
      Array.from(mounts).forEach((S) => {
        if (S.readOnly) return;
        const fresh = storeGet(S.id);
        if (!fresh) return;
        if (!S.inst || !S.refs.wrap) remount(S, fresh);
        else if (fresh.updatedAt !== S.inst.updatedAt) refresh(S, clone(fresh), "system");
      });
    });
    const capsRender = () => mounts.forEach((S) => { if (S.inst && S.refs.conf && S.mail.state !== "running") renderConf(S); });
    on("caps:changed", capsRender);
    on("app:ready", capsRender);
    // the enrichment ticker: search terms tick past while Claude reads your mail
    on("forge:start", (p) => {
      if (!p || p.kind !== "enrich" || !p.instrumentId) return;
      each(p.instrumentId, (S) => {
        if (S.mail.state !== "running") S.mail = { state: "running", jobId: p.jobId, queries: [], summary: null, error: null, label: "LOOKING IN YOUR MAIL…" };
        else S.mail.jobId = p.jobId;
        renderConf(S);
      });
    });
    on("forge:progress", (p) => {
      if (!p || p.kind !== "enrich") return;
      mounts.forEach((S) => {
        if (S.readOnly || S.mail.state !== "running" || (S.mail.jobId && S.mail.jobId !== p.jobId)) return;
        if (!S.mail.jobId) return;
        if (p.label) S.mail.label = String(p.label).toUpperCase();
        if (p.detail && (p.stage === "searching" || p.stage === "reading-mail")) S.mail.queries.push(String(p.detail));
        renderConf(S);
      });
    });
    on("forge:done", (p) => {
      if (!p || p.kind !== "enrich") return;
      mounts.forEach((S) => {
        if (S.readOnly || S.mail.jobId !== p.jobId) return;
        S.mail = { state: "done", jobId: null, queries: [], summary: p.summary || null, error: null };
        renderConf(S);
      });
    });
    on("forge:error", (p) => {
      if (!p || p.kind !== "enrich") return;
      mounts.forEach((S) => { if (!S.readOnly && S.mail.jobId === p.jobId) mailError(S, p); });
    });
  }

  WB.instrument = { init, mount, unmount, renderMini, applyPeerScrub, flashEvidence };
})();
