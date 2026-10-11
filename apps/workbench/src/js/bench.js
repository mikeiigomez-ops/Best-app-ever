/* ---- Workbench bench (Zhuo) ----
   The bench view (a cabinet of living systems, not a feed) and the end view ("Bench is set.").
   Session shape: tune one, commit one, then the app says so and stops offering anything new.
   Registers functions only; init() is called by WB.app.boot(). */
(function () {
  "use strict";
  const WB = window.WB;

  const DAY = 86400000;
  const SYSTEMS = ["Food", "Money", "Energy", "Things", "Space", "Health"];
  const MAIL_MOLDS = { leak: 1, perUse: 1, countdown: 1 };

  /* ------------------------------------------------------------ helpers */
  const has = (mod, fn) => !!(WB[mod] && typeof WB[mod][fn] === "function");
  function safe(label, fn, d) { try { const r = fn(); return r === undefined ? d : r; } catch (err) { console.error("[WB.bench] " + label, err); return d; } }
  const isNum = (v) => typeof v === "number" && isFinite(v);
  function h() { return WB.util.el.apply(null, arguments); }
  function svgIcon(name) { return has("ui", "icon") ? WB.ui.icon(name) : ""; }
  function iconEl(name, cls) { return h("span", { class: cls || "bn-ico", "aria-hidden": "true", html: svgIcon(name) }); }
  const now = () => Date.now();
  const reduced = () => (WB.util && typeof WB.util.reducedMotion === "function" ? WB.util.reducedMotion() : false);
  const fmtDay = (ms) => (WB.util && WB.util.fmtDay ? WB.util.fmtDay(ms) : new Date(ms).toDateString());
  const haptic = (ms) => { if (WB.util && WB.util.haptic) WB.util.haptic(ms); };
  const toast = (t, o) => { if (has("ui", "toast")) WB.ui.toast(t, o); };
  function go(name, params, opts) { if (has("router", "go")) WB.router.go(name, params || {}, opts || {}); }
  function curView() { return has("router", "current") ? WB.router.current().name : null; }
  function caps() {
    const c = WB.app && WB.app.caps;
    if (typeof c === "function") { const r = safe("caps", () => c(), null); if (r) return r; }
    return c && typeof c === "object" ? c : {};
  }
  const mailUsable = (c) => !!(c.sample && c.gmail && c.gmail !== "unavailable" && c.gmail !== "denied");
  const photoUsable = (c) => !!(c.sample && c.images);

  const store = () => WB.store || null;
  function list() { return has("store", "all") ? safe("store.all", () => WB.store.all(), []) || [] : []; }
  function getInst(id) { return has("store", "get") ? safe("store.get", () => WB.store.get(id), null) : null; }
  function mode() { return has("store", "mode") ? safe("store.mode", () => WB.store.mode(), "local") : "local"; }
  function profile() {
    if (has("store", "profile")) return safe("store.profile", () => WB.store.profile(), null);
    const st = store() && WB.store.state;
    return (st && st.bench && st.bench.profile) || null;
  }
  function session() { return has("store", "session") ? safe("store.session", () => WB.store.session(), null) || {} : {}; }
  function ledger() { return has("store", "ledger") ? safe("store.ledger", () => WB.store.ledger(), null) : null; }

  /* molds wrappers, all guarded */
  const Mo = (fn) => has("molds", fn);
  function moldOf(inst) { return Mo("get") ? safe("molds.get", () => WB.molds.get(inst.mold), null) : null; }
  function fmt(v, f, inst) {
    if (Mo("format")) return safe("molds.format", () => WB.molds.format(v, f, inst), String(v));
    if (f === "usd" && WB.util) return WB.util.fmtUSD(v);
    return WB.util ? WB.util.fmtNum(v) : String(v);
  }
  const usd = (v) => fmt(v, "usd", null);
  function primaryOf(inst) { return Mo("primaryOf") ? safe("molds.primaryOf", () => WB.molds.primaryOf(inst), null) || { formatted: "—", label: "" } : { formatted: "—", label: "" }; }
  function ghostOf(inst) { return Mo("ghost") ? safe("molds.ghost", () => WB.molds.ghost(inst), null) || { status: "none", due: false, points: [] } : { status: "none", due: false, points: [] }; }
  function computeOf(inst) { return Mo("compute") ? safe("molds.compute", () => WB.molds.compute(inst), null) : null; }
  function primaryFmt(inst) { const m = moldOf(inst); return m && m.outputs && m.outputs[m.primary] ? m.outputs[m.primary].format : "num"; }
  function primaryLabel(inst) { const m = moldOf(inst); return m && m.outputs && m.outputs[m.primary] ? m.outputs[m.primary].label : ""; }
  function confOf(inst) { return Mo("confidence") ? safe("molds.confidence", () => WB.molds.confidence(inst), null) : null; }

  /* ------------------------------------------------------------ glyphs */
  const SYS_GLYPH = {
    Food: '<path d="M8 13.5c-3 0-4.5-2.4-4.5-5S5.4 4.2 8 5.6c2.6-1.4 4.5.3 4.5 2.9s-1.5 5-4.5 5z"/><path d="M8 5.6c0-1.6.6-2.7 1.8-3.3"/>',
    Money: '<circle cx="8" cy="8" r="5.5"/><path d="M9.8 6.1c-.4-.6-1-.9-1.8-.9-1 0-1.7.5-1.7 1.3 0 1.8 3.6.9 3.6 2.8 0 .8-.8 1.4-1.9 1.4-.8 0-1.5-.3-1.9-.9M8 4.2v7.6"/>',
    Energy: '<path d="M9 2.5L4.5 9H8l-1 4.5L11.5 7H8z"/>',
    Things: '<path d="M2.8 8.6V3h5.6l5 5-5.6 5.6z"/><circle cx="5.6" cy="5.8" r="1"/>',
    Space: '<path d="M2.5 13.5v-11M2.5 13.5h11"/><path d="M5.5 10.5v-5h5"/>',
    Health: '<path d="M1.8 8.4h3l1.4-3.3 2.5 6.3 1.6-3h3.9"/>',
  };
  function sysGlyph(sys) {
    return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (SYS_GLYPH[sys] || SYS_GLYPH.Things) + "</svg>";
  }
  const DRAW = {
    receipt: '<path d="M16 6h20v38l-2.5-1.8-2.5 1.8-2.5-1.8-2.5 1.8-2.5-1.8-2.5 1.8-2.5-1.8L16 44z"/><path d="M20 12h8M20 17h12M20 21h9M20 25h12"/><path d="M20 30h12" stroke-dasharray="1 2.2"/><path d="M20 35h5M28 35h4" stroke-width="2"/>',
    fridge: '<rect x="7" y="7" width="38" height="38" rx="2"/><path d="M7 27h38"/><path d="M13 27v-8l2-3v-3h2v3l2 3v8"/><path d="M23 27V17l3-3 3 3v10zM23 17h6"/><circle cx="37" cy="23.4" r="3.4"/><path d="M11 34h13c0 4-2.9 6.2-6.5 6.2S11 38 11 34z"/><rect x="29" y="31" width="9" height="10" rx="1.4"/>',
    bill: '<path d="M12 6h19l8 8v32H12z"/><path d="M31 6v8h8"/><path d="M17 13h9M17 17h6"/><path d="M16 36.5h19"/><path d="M18.5 36v-4M22.5 36v-7M26.5 36v-5M30.5 36v-9"/><path d="M24 41.5h10" stroke-width="2"/>',
  };
  function drawing(key) {
    return '<svg viewBox="0 0 52 52" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + DRAW[key] + "</svg>";
  }

  /* ------------------------------------------------------------ view state */
  const V = {
    el: null, raf: 0, peers: [], enrich: {}, mailNote: {}, mailHidden: false, chips: {},
    lastMission: null, routedEnd: false, firstOpen: null,
  };
  let inited = false;

  /* ------------------------------------------------------------ since last time */
  const DUE_COPY = {
    leak: "check-in due. Tell me how the week went.",
    spoil: "check-in due. Tell me what you cooked, or photograph the shelf.",
    perUse: "check-in due. Tell me how often you went.",
    dial: "check-in due. Tell me, or photograph the next bill.",
    countdown: "today is act-by day.",
    reset: "check-in due. Photograph the corner from the same spot.",
  };
  function sinceLines(items) {
    const prof = profile() || {};
    const demoMode = mode() === "demo";
    const since = prof.prevOpenAt || 0;
    const fresh = (t) => isNum(t) && (since ? t > since : demoMode);
    const out = [];
    const add = (pri, inst, text) => out.push({ pri, inst, text });
    items.forEach((inst) => {
      const g = ghostOf(inst);
      const title = inst.title || "Instrument";
      const it = inst.intention;
      const pf = primaryFmt(inst);
      if (g.due) { add(0, inst, title + ": " + (DUE_COPY[inst.mold] || "check-in due.")); return; }
      if (it && g.status === "closer") {
        add(1, inst, title + ": " + closerLine(inst, g));
        return;
      }
      if (it && (g.status === "held" || g.status === "missed")) {
        const pts = (g.points || []).filter((p) => p.t > g.start);
        const last = pts.length ? pts[pts.length - 1] : null;
        const at = Math.max(it.checkAt || 0, last ? last.t : 0, inst.mission && inst.mission.endsAt ? inst.mission.endsAt : 0);
        if (fresh(at)) {
          if (g.status === "held") {
            if (inst.mold === "spoil" && last && isNum(g.baseline) && g.baseline > last.v) add(1, inst, title + ": you kept " + usd(g.baseline - last.v) + " from spoiling.");
            else if (inst.mold === "reset") add(1, inst, title + ": the corner held.");
            else add(1, inst, title + ": it held. " + (last ? fmt(last.v, pf, inst) + " against a line of " + fmt(g.target, pf, inst) + "." : ""));
          } else {
            add(1, inst, title + ": reality ran past the line" + (last ? ", " + fmt(last.v, pf, inst) + " against " + fmt(g.target, pf, inst) : "") + ".");
          }
          return;
        }
      }
      if (inst.mold === "countdown" && inst.vars && inst.vars.lead) {
        const c = computeOf(inst);
        const left = c && c.outputs ? c.outputs.daysLeft : null;
        if (isNum(left) && left >= 0 && left <= Math.max(1, inst.vars.lead.value)) {
          add(1, inst, title + ": act by " + fmt(c.outputs.actBy, "day", inst) + ", " + fmt(left, "days", inst) + " left.");
          return;
        }
      }
      if (inst.enriched && inst.enriched.summary && fresh(inst.enriched.at)) { add(2, inst, title + ": " + inst.enriched.summary); return; }
      if (inst.mold === "spoil") {
        const born = (inst.photo && inst.photo.at) || inst.createdAt || now();
        const elapsed = Math.floor((now() - born) / DAY);
        if (elapsed <= 7) {
          const soon = (inst.items || []).filter((x) => !x.cooked && isNum(x.days) && x.days - elapsed <= 1 && x.days - elapsed >= 0)
            .sort((a, b) => a.days - b.days);
          if (soon.length) {
            const names = soon.slice(0, 2).map((x) => x.name);
            const when = soon[0].days - elapsed <= 0 ? "today" : "by tomorrow";
            add(2, inst, title + ": the " + names.join(" and ") + (names.length > 1 ? " turn " : " turns ") + when + ".");
            return;
          }
        }
      }
      const obs = (inst.observations || []).filter((o) => (o.source === "photo" || o.source === "email") && o.t > (inst.createdAt || 0) + 60000 && fresh(o.t));
      if (obs.length) { const o = obs[obs.length - 1]; add(3, inst, title + ": a new reading, " + fmt(o.value, pf, inst) + (primaryLabel(inst) ? " " + primaryLabel(inst) : "") + "."); }
    });
    return out.sort((a, b) => a.pri - b.pri).slice(0, 3);
  }

  /* partial progress gets credit, in the lever's own words when the reading has them: "2 a week, down from 3." */
  const CLOSER_FACT = { leak: "rate", perUse: "uses" };
  function closerLine(inst, g) {
    const pf = primaryFmt(inst);
    const p = isNum(g.progress) ? g.progress : 0;
    const how = p >= 0.75 ? "Most of the way to your line." : p >= 0.4 ? "About halfway to your line." : "Part of the way to your line.";
    const fid = CLOSER_FACT[inst.mold];
    const obs = (inst.observations || []).filter((o) => !o.hollow && inst.intention && o.t > inst.intention.committedAt);
    const last = obs.length ? obs[obs.length - 1] : null;
    const was = fid && inst.vars && inst.vars[fid] ? inst.vars[fid].value : null;
    if (last && fid && isNum(last.facts && last.facts[fid]) && isNum(was)) {
      const per = inst.mold === "leak" ? " a " + ((inst.words && inst.words.period) === "month" ? "month" : "week") : " a month";
      const n = (v) => fmt(v, "num", inst);
      const dir = inst.mold === "leak" ? (last.facts[fid] < was ? "down from " : "against ") : (last.facts[fid] > was ? "up from " : "against ");
      return n(last.facts[fid]) + (inst.mold === "perUse" ? " uses" : "") + per + ", " + dir + n(was) + ". " + how;
    }
    const lv = g.points && g.points.length ? g.points.filter((x) => !x.hollow).slice(-1)[0] : null;
    return (lv ? fmt(lv.v, pf, inst) + ", from " + fmt(g.baseline, pf, inst) + ". " : "") + how;
  }

  /* ------------------------------------------------------------ ledger line */
  function ledgerLine() {
    const l = ledger();
    if (!l || !l.total) return null;
    const p = h("p", { class: "bn-ledger wb-mono" });
    p.appendChild(h("span", { class: "bn-ledger__k", text: "STEERED" }));
    const parts = [];
    if (l.inPlayUSD > 0) parts.push([usd(l.inPlayUSD), "/yr in play"]);
    if (l.keptUSD > 0) parts.push([usd(l.keptUSD), " kept"]);
    const resolved = (l.held || 0) + (l.missed || 0) + (l.closer || 0);
    if (resolved) parts.push([l.held + " of " + l.total, " promises held" + (l.closer ? ", " + l.closer + " closer" : "")]);
    else parts.push([String(l.total), l.total === 1 ? " promise open" : " promises open"]);
    parts.forEach((pt, i) => {
      if (i) p.appendChild(h("span", { class: "bn-ledger__sep", "aria-hidden": "true", text: " · " }));
      p.appendChild(h("span", { class: "bn-ledger__part" }, h("b", { text: pt[0] }), pt[1]));
    });
    return p;
  }

  /* ------------------------------------------------------------ tiles */
  function sortTiles(items) {
    return items.slice().sort((a, b) => {
      const sa = SYSTEMS.indexOf(a.system), sb = SYSTEMS.indexOf(b.system);
      const da = sa < 0 ? 99 : sa, db = sb < 0 ? 99 : sb;
      if (da !== db) return da - db;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }
  function fallbackMini(inst) {
    const p = primaryOf(inst);
    const photo = inst.photo || (inst.photos || [])[inst.photos ? inst.photos.length - 1 : 0];
    const src = photo && (photo.thumb || photo.src);
    return h("div", { class: "bn-mini" },
      h("div", { class: "bn-mini__thumb" }, src ? h("img", { src, alt: "", decoding: "async", loading: "lazy", draggable: "false" }) : null),
      h("div", { class: "bn-mini__num wb-mono", text: p.formatted }),
      h("div", { class: "bn-mini__title", text: inst.title || "Instrument" }),
      h("div", { class: "wb-micro bn-mini__sys", text: String(inst.system || "").toUpperCase() }));
  }
  function miniFor(inst) {
    if (has("instrument", "renderMini")) {
      const n = safe("instrument.renderMini", () => WB.instrument.renderMini(inst), null);
      if (n && n instanceof Node) return n;
    }
    return fallbackMini(inst);
  }
  function peersOn(id) { return (V.peers || []).filter((p) => !p.self && p.instrumentId === id); }

  function mailChipTarget(items) {
    if (V.mailHidden || session().ended) return null;
    if (mode() === "demo") {
      const gym = items.find((i) => i.demo && i.mold === "perUse" && !i.enriched);
      return gym ? gym.id : null;
    }
    const c = caps();
    const prof = profile();
    if (!mailUsable(c) || !prof || prof.gmailAsked || !(prof.prevOpenAt > 0)) return null;
    const real = items.filter((i) => !i.demo).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const first = real[0];
    return first && MAIL_MOLDS[first.mold] && !first.enriched ? first.id : null;
  }

  function tileLabel(inst) {
    const p = primaryOf(inst);
    const g = ghostOf(inst);
    const bits = [inst.title || "Instrument", p.formatted + (p.label ? " " + p.label : "")];
    bits.push(String(inst.system || "") + (inst.demo ? ", example" : ""));
    if (g.due) bits.push("check-in due");
    const pe = peersOn(inst.id);
    if (pe.length) bits.push(pe.length === 1 ? "someone here is looking at it" : pe.length + " people here are looking at it");
    return bits.join(". ") + ".";
  }

  function tile(inst, mailId) {
    const id = inst.id;
    const a = h("a", { class: "bn-tile__open", href: "#/instrument/" + encodeURIComponent(id), "aria-label": tileLabel(inst),
      "aria-description": "Press and hold for options", dataset: { key: "tile:" + id }, draggable: "false" }, miniFor(inst));
    bindTile(a, id);
    const wrap = h("li", { class: "bn-tile" + (ghostOf(inst).due ? " is-due" : ""), dataset: { id } }, a);
    const pe = peersOn(id);
    if (pe.length) {
      wrap.appendChild(h("span", { class: "bn-tile__peers", "aria-hidden": "true" },
        pe.slice(0, 3).map((p) => h("span", { class: "bn-tile__peer", text: String(p.initials || "?").slice(0, 2) }))));
    }
    if (id === mailId || V.enrich[id] || V.mailNote[id]) wrap.appendChild(mailChip(inst));
    return wrap;
  }

  function bindTile(a, id) {
    let timer = 0, sx = 0, sy = 0, fired = false;
    const clear = () => { clearTimeout(timer); timer = 0; a.classList.remove("is-pressing"); };
    let firedAt = 0;
    const fire = () => {
      if (fired) return;
      fired = true; firedAt = Date.now(); clear(); haptic(10);
      // the finger is still on the tile: its lift must not open the instrument or dismiss the sheet
      if (WB.util && typeof WB.util.swallowClick === "function") WB.util.swallowClick(700);
      tileSheet(id);
    };
    a.addEventListener("touchend", (e) => { if (fired && Date.now() - firedAt < 1500 && e.cancelable) e.preventDefault(); }, { passive: false });
    a.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      fired = false; sx = e.clientX; sy = e.clientY;
      clearTimeout(timer);
      a.classList.add("is-pressing");
      timer = setTimeout(fire, 520);
    });
    a.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear(); });
    ["pointerup", "pointercancel", "pointerleave"].forEach((t) => a.addEventListener(t, clear));
    a.addEventListener("contextmenu", (e) => { e.preventDefault(); fire(); });
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (fired) { fired = false; return; }
      go("instrument", { id });
    });
    a.addEventListener("keydown", (e) => {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); fired = false; fire(); fired = false; }
    });
  }

  function tileSheet(id) {
    const inst = getInst(id);
    if (!inst || !has("ui", "sheet")) return;
    const p = primaryOf(inst);
    const body = h("div", { class: "bn-tsheet" },
      h("p", { class: "bn-tsheet__line" }, h("span", { class: "wb-mono bn-tsheet__num", text: p.formatted }), p.label ? " " + p.label : ""),
      h("p", { class: "bn-tsheet__note", text: "Melting takes it off the bench and tells Claude you don’t want ones like it." }));
    WB.ui.sheet({
      title: inst.title || "Instrument",
      body,
      actions: [
        { label: "Open", kind: "primary", onTap: (close) => { close(); go("instrument", { id }); } },
        { label: "Re-photograph", kind: "quiet", onTap: (close) => { close(); capture({ intent: "snap", instrumentId: id }); } },
        { label: "Melt", kind: "danger", hold: true, onTap: (close) => { close(); meltNow(id); } },
      ],
    });
  }
  function meltNow(id) {
    const inst = getInst(id);
    if (!inst || !has("store", "melt")) return;
    const title = inst.title || "It";
    const r = safe("store.melt", () => WB.store.melt(id), null);
    const after = () => {
      toast(title + " melted. Claude won’t suggest ones like it.", has("store", "unmelt") ? { action: { label: "Undo", onTap: () => { const u = WB.store.unmelt(id); if (u && u.then) u.then(() => schedule()); } } } : undefined);
    };
    if (r && typeof r.then === "function") r.then(after, after); else after();
  }
  function capture(o) {
    if (has("app", "capture")) {
      const r = safe("app.capture", () => WB.app.capture(o), null);
      if (r && typeof r.catch === "function") r.catch((err) => console.error("[WB.bench] capture", err));
    } else toast("Photos need the full app.");
  }

  /* ------------------------------------------------------------ mail chip (the second act) */
  function mailChip(inst) {
    const id = inst.id;
    const box = h("div", { class: "bn-mail", dataset: { id } });
    V.chips[id] = box;
    paintChip(id);
    return box;
  }
  function paintChip(id) {
    const box = V.chips[id];
    if (!box) return;
    box.textContent = "";
    const job = V.enrich[id];
    if (job) {
      box.classList.add("is-running");
      box.appendChild(h("span", { class: "bn-mail__tick wb-mono", role: "status", "aria-live": "polite" },
        h("span", { class: "bn-mail__caret", "aria-hidden": "true" }), job.label));
      box.appendChild(h("button", { type: "button", class: "bn-mail__stop", text: "Stop", "aria-label": "Stop looking in my mail",
        on: { click: () => stopEnrich(id) } }));
      return;
    }
    box.classList.remove("is-running");
    const note = V.mailNote[id];
    if (note) {
      box.appendChild(h("p", { class: "bn-mail__note" + (note.err ? " is-err" : ""), role: note.err ? "alert" : "status", text: note.text }));
      if (note.retry) box.appendChild(h("button", { type: "button", class: "bn-mail__stop", text: "Try again", on: { click: () => runEnrich(id) } }));
      return;
    }
    box.appendChild(h("button", { type: "button", class: "bn-mail__btn", dataset: { key: "mail:" + id }, on: { click: () => runEnrich(id) } },
      iconEl("mail", "bn-mail__ico"), h("span", { text: "Check my mail for more of these" })));
  }
  const ENRICH_ERR = {
    not_granted: "Mail stays closed.",
    needs_reauth: "Connect Gmail in claude.ai Settings → Connectors.",
    server_not_connected: "Connect Gmail in claude.ai Settings → Connectors.",
    unavailable: "Connect Gmail in claude.ai Settings → Connectors.",
    rate_limited: "Claude needs a breather. Try again in a minute.",
    timeout: "That took too long. Nothing changed.",
  };
  async function runEnrich(id) {
    if (V.enrich[id]) return;
    if (!has("forge", "enrich")) { toast("Reading mail isn’t part of this build."); return; }
    const inst = getInst(id);
    if (!inst) return;
    if (!inst.demo) {
      const prof = profile();
      if (prof && !prof.gmailAsked) { prof.gmailAsked = true; if (has("store", "saveBench")) safe("store.saveBench", () => WB.store.saveBench()); }
    }
    delete V.mailNote[id];
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const job = { ctrl, jobId: null, label: "OPENING YOUR MAIL…" };
    V.enrich[id] = job;
    const offs = [];
    if (WB.bus) {
      offs.push(WB.bus.on("forge:start", (p) => { if (p.kind === "enrich" && p.instrumentId === id && !job.jobId) job.jobId = p.jobId; }));
      offs.push(WB.bus.on("forge:progress", (p) => {
        if (p.kind !== "enrich" || (job.jobId && p.jobId !== job.jobId)) return;
        job.label = p.detail ? "“" + p.detail + "”" : String(p.label || "READING…");
        paintChip(id);
      }));
    }
    paintChip(id);
    let res = null, err = null;
    try { res = await WB.forge.enrich(id, { signal: ctrl ? ctrl.signal : undefined }); }
    catch (e) { err = e || { code: "unknown" }; }
    offs.forEach((off) => { try { off(); } catch (e) { /* gone */ } });
    delete V.enrich[id];
    if (err) {
      const code = err.code || "unknown";
      if (code === "cancelled") { delete V.mailNote[id]; }
      else if (code === "not_granted") { V.mailHidden = true; V.mailNote[id] = { text: ENRICH_ERR.not_granted, err: false }; }
      else V.mailNote[id] = { text: ENRICH_ERR[code] || (typeof err.message === "string" && err.message) || "Mail didn’t answer. Try again.", err: true, retry: code === "rate_limited" || code === "tool_error" || code === "timeout" || code === "unknown" };
    } else {
      V.mailNote[id] = { text: (res && res.summary) || "I looked, and nothing in your mail changes these numbers.", err: false };
    }
    paintChip(id);
    schedule();
  }
  function stopEnrich(id) {
    const job = V.enrich[id];
    if (!job) return;
    try { if (job.ctrl) job.ctrl.abort(); } catch (e) { /* ignore */ }
    if (job.jobId && has("forge", "cancel")) safe("forge.cancel", () => WB.forge.cancel(job.jobId));
  }

  /* ------------------------------------------------------------ header menu */
  function plainSentence(inst) {
    if (!Mo("sentence")) return "";
    const toks = safe("molds.sentence", () => WB.molds.sentence(inst), []) || [];
    const c = computeOf(inst);
    const m = moldOf(inst);
    const un = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    return toks.map((t) => {
      if (t.t === "text") return un(t.text);
      if (t.t === "var") { const v = inst.vars && inst.vars[t.id]; return v ? fmt(v.value, v.format, inst) : "—"; }
      if (t.t === "out") { const o = m && m.outputs[t.id]; return c && o ? fmt(c.outputs[t.id], o.format, inst) : "—"; }
      return "";
    }).join("");
  }
  function exportText() {
    const items = sortTiles(list());
    const L = [];
    L.push("Workbench — " + fmtDay(now()));
    if (mode() === "demo") L.push("EXAMPLE BENCH: built from drawn example photos, not real data.");
    const l = ledger();
    if (l && l.total) L.push("Steered: " + usd(l.inPlayUSD) + "/yr in play · " + usd(l.keptUSD) + " kept · " + l.held + " of " + l.total + " promises held");
    L.push("");
    items.forEach((inst) => {
      L.push("## " + (inst.title || "Instrument") + " · " + String(inst.system || "").toUpperCase() + (inst.demo ? " · EXAMPLE" : ""));
      L.push(plainSentence(inst));
      const c = confOf(inst);
      if (c && c.total) L.push("Measured " + c.measured + " of " + c.total + ".");
      if (inst.intention) {
        const g = ghostOf(inst);
        const pf = primaryFmt(inst);
        L.push("Promise: " + fmt(g.baseline, pf, inst) + " → " + fmt(g.target, pf, inst) + " " + primaryLabel(inst) + ", check " + fmtDay(inst.intention.checkAt) + " (" + g.status + ").");
      }
      (inst.evidence || []).forEach((e) => {
        if (e.type === "photo" && e.text) L.push("- Read from the photo: " + e.text);
        else if (e.type === "email") L.push("- From mail" + (e.date ? " (" + e.date + ")" : "") + ": “" + (e.quote || e.subject || "") + "”");
      });
      if (inst.fieldNote) L.push("Field note: " + inst.fieldNote);
      L.push("");
    });
    if (!items.length) L.push("The bench is empty.");
    return L.join("\n");
  }
  function exportSheet() {
    const c = caps();
    const text = exportText();
    const name = "workbench-" + new Date().toISOString().slice(0, 10) + ".md";
    const driveOK = !!(c.drive && (c.drive === "granted" || c.drive === "prompt") && mode() !== "demo" && WB.ai && WB.ai.drive && typeof WB.ai.drive.create === "function");
    const status = h("p", { class: "bn-export__status wb-mono", role: "status", "aria-live": "polite" });
    const preview = h("pre", { class: "bn-export__pre", tabindex: "0", "aria-label": "What will be exported", text: text.length > 1400 ? text.slice(0, 1400) + "\n…" : text });
    const actions = [];
    let busy = false;
    if (driveOK) {
      actions.push({ label: "Save to Google Drive", kind: "primary", hold: true, onTap: async (close) => {
        if (busy) return;
        busy = true;
        status.textContent = "SAVING TO DRIVE…";
        try {
          await WB.ai.drive.create({ title: "Workbench — " + fmtDay(now()), text });
          close();
          toast("Saved to Google Drive.");
        } catch (e) {
          const code = (e && e.code) || "unknown";
          status.textContent = code === "not_granted" ? "Drive stayed closed. Nothing was saved."
            : code === "needs_reauth" || code === "server_not_connected" || code === "unavailable" ? "Connect Google Drive in claude.ai Settings → Connectors."
            : "Drive returned an error. Nothing was saved. Hold again to retry.";
        } finally { busy = false; }
      } });
    }
    actions.push({ label: "Download .md", kind: driveOK ? "quiet" : "primary", onTap: async (close) => {
      let r = "fallback";
      if (WB.ai && typeof WB.ai.download === "function") { try { r = await WB.ai.download(name, text, "text/markdown"); } catch (e) { r = "declined"; } }
      else {
        try {
          const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
          const a = h("a", { href: url, download: name, hidden: true }); document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
        } catch (e) { r = "declined"; }
      }
      if (r === "declined") { status.textContent = "NOTHING WAS SAVED."; return; }
      close();
      toast("Bench exported as " + name + ".");
    } });
    WB.ui.sheet({ title: "Export the bench", body: h("div", { class: "bn-export" },
      h("p", { class: "wb-sheet__text", text: driveOK ? "A plain-text summary of every instrument, its numbers and where they came from. Drive needs a hold; nothing else leaves this page." : "A plain-text summary of every instrument, its numbers and where they came from." }),
      preview, status), actions });
  }
  function themeRow() {
    const prefs = WB.util && WB.util.uiPrefs ? WB.util.uiPrefs() : {};
    let cur = prefs.theme || (document.documentElement.dataset.theme || "auto");
    const row = h("div", { class: "bn-seg", role: "group", "aria-label": "Theme" });
    const paint = () => Array.from(row.children).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === cur)));
    [["auto", "Auto"], ["light", "Vellum"], ["dark", "Darkroom"]].forEach(([v, label]) => {
      row.appendChild(h("button", { type: "button", class: "bn-seg__btn", dataset: { v }, text: label, on: { click: () => {
        cur = v;
        if (has("ui", "setTheme")) WB.ui.setTheme(v);
        const p = profile();
        if (p) { p.theme = v; if (has("store", "saveBench")) safe("store.saveBench", () => WB.store.saveBench()); }
        paint();
      } } }));
    });
    paint();
    return row;
  }
  function chipSample(cls, text, q) {
    return h("span", { class: "ins-chip ins-chip--" + cls + " bn-about__chip" }, h("span", { class: "ins-chip__v", text }),
      q ? h("sup", { class: "ins-chip__q", "aria-hidden": "true", text: "?" }) : null);
  }
  function aboutSheet() {
    const row = (chip, title, line) => h("li", { class: "bn-about__row" }, h("span", { class: "bn-about__sample" }, chip),
      h("span", { class: "bn-about__text" }, h("b", { text: title }), " ", line));
    const local = mode() === "local";
    WB.ui.sheet({ title: "Where numbers come from", body: h("div", { class: "bn-about" },
      h("ul", { class: "bn-about__list" },
        row(chipSample("seen", "$31.40"), "Solid.", "Read from your photo or mail. Tap it to see the exact spot or quote."),
        row(chipSample("inferred", "3"), "Dotted.", "Inferred from what is visible, with a one-line reason."),
        row(chipSample("assumed", "2", true), "Hollow.", "A guess waiting for you. Drag it and it becomes yours."),
        row(chipSample("set", "4"), "Cobalt.", "Set by you, so it is true."),
        row(chipSample("lever", "1"), "Plate.", "A lever: your choice. Hold it to commit."),
        row(chipSample("derived", "$4,898"), "Plain.", "Worked out from the others. Tap for the formula.")),
      h("p", { class: "bn-about__foot", text: "Claude fills the numbers; the math is fixed and runs on this page. The glowing one is the hinge: the single number that decides the outcome." }),
      local ? h("p", { class: "wb-micro bn-about__device", text: "SAVED ON THIS DEVICE ONLY" }) : null),
    actions: [{ label: "Close", kind: "quiet", onTap: (close) => close() }] });
  }
  function menuSheet() {
    if (!has("ui", "sheet")) return;
    const demoMode = mode() === "demo";
    const m = mode();
    const where = m === "cloud" ? "KEPT IN YOUR CLAUDE ACCOUNT" : m === "demo" ? "EXAMPLE BENCH · KEPT IN MEMORY ONLY" : "SAVED ON THIS DEVICE ONLY";
    let sh = null;
    const item = (icon, label, sub, fn) => h("li", null, h("button", { type: "button", class: "wb-choice", on: { click: fn } },
      h("span", { class: "wb-choice__glyph", html: svgIcon(icon) }),
      h("span", { class: "wb-choice__text" }, h("span", { class: "wb-choice__label", text: label }), sub ? h("span", { class: "wb-choice__sub", text: sub }) : null)));
    const body = h("div", { class: "bn-menu" },
      h("ul", { class: "wb-choices" },
        item("export", "Export bench", "To Google Drive, or as a .md file.", () => { sh.close({ instant: true }); exportSheet(); }),
        item("spark", "About provenance", "Solid, dotted, hollow and cobalt numbers.", () => { sh.close({ instant: true }); aboutSheet(); }),
        demoMode ? item("close", "Exit example bench", "Put the example away. Your own instruments stay.", () => { sh.close(); exitDemo(); }) : null),
      h("div", { class: "bn-menu__theme" }, h("span", { class: "wb-micro", text: "THEME" }), themeRow()),
      h("p", { class: "wb-micro bn-menu__where", text: where }));
    sh = WB.ui.sheet({ title: "Bench", body, actions: [] });
  }
  function exitDemo() {
    if (!has("store", "exitDemo")) return;
    safe("store.exitDemo", () => WB.store.exitDemo());
    const prof = profile();
    toast("Example bench put away.");
    if (!list().length && !(prof && prof.firstRunDone) && has("router", "has") && WB.router.has("front")) go("front", {}, { replace: true });
    else schedule();
  }
  function openDemo() {
    if (WB.app && typeof WB.app.openDemo === "function") { WB.app.openDemo(); return; }
    if (has("store", "enterDemo")) { safe("store.enterDemo", () => WB.store.enterDemo()); schedule(); }
  }
  function fromMail() {
    if (WB.app && typeof WB.app.fromMail === "function") { const r = WB.app.fromMail(); if (r && r.catch) r.catch((e) => console.error(e)); return; }
    capture({ intent: "new", source: "mail" });
  }

  /* ------------------------------------------------------------ bench render */
  function renderBench(el) {
    const items = list();
    const sorted = sortTiles(items);
    const demoMode = mode() === "demo";
    const ses = session();
    const c = caps();
    V.chips = {};
    const root = h("div", { class: "bn" + (demoMode ? " is-demo" : "") });

    root.appendChild(h("header", { class: "bn-head" },
      h("h1", { class: "bn-mark" }, "Workbench"),
      h("span", { class: "wb-micro bn-date", text: fmtDay(now()).toUpperCase() }),
      h("button", { type: "button", class: "wb-iconbtn bn-more", "aria-label": "Bench options", html: svgIcon("more"), dataset: { key: "more" },
        on: { click: menuSheet } })));
    root.appendChild(h("div", { class: "bn-rule", "aria-hidden": "true" }));

    if (demoMode) {
      root.appendChild(h("div", { class: "bn-demo" },
        h("span", { class: "wb-micro bn-demo__tag" }, "EXAMPLE BENCH", h("span", { class: "bn-demo__text", text: " · DRAWN, REAL MATH" })),
        h("button", { type: "button", class: "bn-demo__exit", text: "Exit", "aria-label": "Exit the example bench", dataset: { key: "exitdemo" }, on: { click: exitDemo } })));
    }

    // "Bench is set" is only true when nothing is waiting: a due check-in is named instead
    const dueN = sorted.filter((i) => ghostOf(i).due).length;
    if (ses.ended && dueN) {
      root.appendChild(h("div", { class: "bn-set" },
        h("p", { class: "bn-set__title", text: dueN === 1 ? "1 check-in waiting." : dueN + " check-ins waiting." }),
        h("p", { class: "wb-micro bn-set__sub", text: "EVERYTHING ELSE IS SET" })));
    } else if (ses.ended) {
      root.appendChild(h("div", { class: "bn-set" },
        h("p", { class: "bn-set__title", text: "Bench is set." }),
        h("p", { class: "wb-micro bn-set__sub", text: "NOTHING ELSE NEEDS YOU TODAY" })));
    }

    const lines = sinceLines(sorted);
    if (lines.length) {
      const strip = h("section", { class: "bn-since", "aria-label": "Since last time" },
        h("h2", { class: "wb-micro bn-since__h", text: demoMode && !(profile() || {}).prevOpenAt ? "ON THE BENCH" : "SINCE LAST TIME" }));
      const ul = h("ul", { class: "bn-since__list" });
      lines.forEach((ln) => ul.appendChild(h("li", null, h("button", { type: "button", class: "bn-since__line", dataset: { key: "since:" + ln.inst.id },
        on: { click: () => go("instrument", { id: ln.inst.id }) } },
        h("span", { class: "bn-since__glyph", html: sysGlyph(ln.inst.system) }),
        h("span", { class: "bn-since__text", text: ln.text })))));
      strip.appendChild(ul);
      root.appendChild(strip);
    }

    const led = ledgerLine();
    if (led) root.appendChild(led);

    if (!sorted.length) root.appendChild(emptyState());
    else {
      const mailId = mailChipTarget(sorted);
      const wall = h("div", { class: "bn-wall" });
      if (sorted.length > 6) {
        SYSTEMS.concat(["Other"]).forEach((sys) => {
          const group = sorted.filter((i) => (SYSTEMS.indexOf(i.system) >= 0 ? i.system : "Other") === sys);
          if (!group.length) return;
          const gid = "bn-g-" + sys.toLowerCase();
          wall.appendChild(h("h2", { class: "wb-micro bn-group", id: gid },
            h("span", { class: "bn-group__glyph", html: sysGlyph(sys) }), sys.toUpperCase() + " · " + group.length));
          const ul = h("ul", { class: "bn-grid", "aria-labelledby": gid });
          group.forEach((inst) => ul.appendChild(tile(inst, mailId)));
          wall.appendChild(ul);
        });
      } else {
        const ul = h("ul", { class: "bn-grid", "aria-label": "Instruments" });
        sorted.forEach((inst) => ul.appendChild(tile(inst, mailId)));
        wall.appendChild(ul);
      }
      root.appendChild(wall);
      root.appendChild(h("p", { class: "wb-micro bn-foot", text: "HOLD A TILE FOR OPTIONS" }));
    }

    // bottom bar: mail · camera · peers
    const mailOK = mailUsable(c) && !demoMode;
    const bar = h("nav", { class: "wb-bar bn-bar", "aria-label": "Bench actions" },
      h("div", { class: "bn-bar__side" },
        mailOK ? h("button", { type: "button", class: "wb-iconbtn bn-bar__mail", "aria-label": "Build instruments from my mail", html: svgIcon("mail"), dataset: { key: "barmail" }, on: { click: fromMail } }) : null),
      h("button", { type: "button", class: "bn-cam", "aria-label": photoUsable(c) ? "Photograph something" : "Add something to the bench", dataset: { key: "cam" },
        on: { click: () => capture({ intent: "new" }) } },
        h("span", { class: "bn-cam__ico", html: svgIcon("camera") }), h("span", { class: "bn-cam__dot", "aria-hidden": "true" })),
      h("div", { class: "bn-bar__side bn-bar__side--r" }, h("div", { class: "bn-bar__peers", dataset: { slot: "peers" } })));

    el.textContent = "";
    el.appendChild(root);
    el.appendChild(bar);
  }

  function emptyState() {
    const card = (key, label, sub) => h("li", null, h("button", { type: "button", class: "bn-suggest", dataset: { key: "sug:" + key },
      on: { click: () => capture({ intent: "new", source: photoUsable(caps()) ? "camera" : "ask" }) } },
      h("span", { class: "bn-suggest__draw", html: drawing(key) }),
      h("span", { class: "bn-suggest__text" }, h("span", { class: "bn-suggest__label", text: label }), h("span", { class: "bn-suggest__sub", text: sub }))));
    return h("section", { class: "bn-empty", "aria-label": "Start the bench" },
      h("p", { class: "bn-empty__hero", text: "Nothing on the bench yet." }),
      h("p", { class: "bn-empty__sub", text: "Photograph one ordinary thing and it becomes an instrument you can steer." }),
      h("ul", { class: "bn-suggests" },
        card("receipt", "Your last receipt", "Takeout, coffee, a delivery."),
        card("fridge", "Inside your fridge", "One full shelf is plenty."),
        card("bill", "A bill", "The page with the total.")),
      mode() === "demo" ? null : h("button", { type: "button", class: "wb-link bn-empty__demo", text: "See the example bench", on: { click: openDemo } }));
  }

  /* re-render, keeping focus on the same control */
  function render() {
    V.raf = 0;
    const el = V.el;
    if (!el || curView() !== "bench") return;
    const a = document.activeElement;
    const key = a && el.contains(a) && a.dataset ? a.dataset.key : null;
    const y = window.scrollY;
    renderBench(el);
    if (key) {
      const n = el.querySelector('[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
      if (n) { try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
  }
  function schedule() {
    if (V.raf || curView() !== "bench") return;
    V.raf = requestAnimationFrame(render);
  }
  function updatePeers() {
    if (curView() !== "bench" || !V.el) return;
    schedule();
  }

  /* ------------------------------------------------------------ end view */
  const COME_BACK = {
    leak: "Come back with the next receipt.",
    spoil: "Come back when the shelf changes.",
    perUse: "Come back after your next visit.",
    dial: "Come back with the next bill.",
    countdown: "Come back before the act-by day.",
    reset: "Come back when the corner drifts.",
  };
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  function renderEnd(el) {
    if (has("store", "markEnded")) safe("store.markEnded", () => WB.store.markEnded());
    const ses = session();
    const steered = has("store", "steered") ? safe("store.steered", () => WB.store.steered(), 0) : 0;
    const counts = [];
    if (ses.forged) counts.push(plural(ses.forged, "INSTRUMENT BUILT", "INSTRUMENTS BUILT"));
    if (ses.committed) counts.push(plural(ses.committed, "FUTURE COMMITTED", "FUTURES COMMITTED"));
    if (ses.closed) counts.push(plural(ses.closed, "LOOP CLOSED", "LOOPS CLOSED"));
    if (steered > 0) counts.push(usd(steered) + "/YR IN PLAY");
    if (!counts.length) counts.push("THE BENCH IS QUIET");

    const lastId = has("store", "lastCommit") ? safe("store.lastCommit", () => { const x = WB.store.lastCommit(); return x && x.id; }, null) : null;
    const inst = (lastId && getInst(lastId)) || (V.lastMission && getInst(V.lastMission.id)) || null;
    let plate = null;
    if (inst) {
      const it = inst.intention;
      const m = inst.mission;
      const pf = primaryFmt(inst);
      let line = null, when = null;
      if (it && inst.mold === "countdown") {
        const c = computeOf(inst);
        line = h("span", { class: "bn-plate__move wb-mono" }, "act by ", h("b", { text: c && c.outputs ? fmt(c.outputs.actBy, "day", inst) : "—" }),
          h("span", { class: "bn-plate__lbl", text: " · " + fmt(it.value, "days", inst) + " early" }));
        when = "REMINDER " + fmtDay(it.checkAt).toUpperCase();
      } else if (it) {
        const g = ghostOf(inst);
        line = h("span", { class: "bn-plate__move wb-mono" }, h("span", { text: fmt(g.baseline, pf, inst) }),
          h("span", { class: "bn-plate__arrow", "aria-hidden": "true", text: " → " }), h("span", { class: "wb-sr", text: " to " }),
          h("b", { text: fmt(g.target, pf, inst) }), primaryLabel(inst) ? h("span", { class: "bn-plate__lbl", text: " " + primaryLabel(inst) }) : null);
        when = "CHECK " + fmtDay(it.checkAt).toUpperCase();
      }
      if (m && m.verified && (!it || (V.lastMission && V.lastMission.id === inst.id))) {
        line = h("span", { class: "bn-plate__move wb-mono" }, h("b", { text: Math.round(m.verified.reclaimed || 0) + "%" }), " reclaimed");
        when = m.verified.by === "claude" ? "CHECKED BY CLAUDE" : "CHECKED BY YOU";
      }
      plate = h("div", { class: "bn-plate" + (inst.demo ? " is-demo" : "") },
        h("span", { class: "bn-plate__sys", html: sysGlyph(inst.system) }),
        h("span", { class: "bn-plate__body" },
          h("span", { class: "bn-plate__title" }, inst.title || "Instrument", inst.demo ? h("span", { class: "wb-micro bn-plate__ex", text: " · EXAMPLE" }) : null),
          line,
          when ? h("span", { class: "wb-micro bn-plate__when", text: when }) : null));
    }
    const back = (inst && COME_BACK[inst.mold]) || "Come back with the next one.";
    const root = h("div", { class: "bn-end" + (reduced() ? "" : " is-animated") },
      h("span", { class: "wb-micro bn-end__kicker", text: "WORKBENCH · " + fmtDay(now()).toUpperCase() }),
      h("div", { class: "bn-end__center" },
        h("span", { class: "bn-end__line", "aria-hidden": "true" }),
        h("h1", { class: "bn-end__title", tabindex: "-1", text: "Bench is set." }),
        h("p", { class: "wb-micro bn-end__counts", text: counts.join(" · ") }),
        plate,
        h("p", { class: "bn-end__back", text: back })),
      h("div", { class: "bn-end__acts" },
        h("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block", text: "Show me the bench", on: { click: () => go("bench", {}, { replace: true }) } }),
        h("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block", text: "One more photo", on: { click: () => capture({ intent: "new" }) } })));
    el.textContent = "";
    el.appendChild(root);
    if (WB.bus) WB.bus.emit("session:set", { forged: ses.forged || 0, committed: ses.committed || 0, closed: ses.closed || 0, steeredUSD: steered || 0 });
    requestAnimationFrame(() => {
      const t = root.querySelector(".bn-end__title");
      if (t && el.contains(document.activeElement) === false) { try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    });
  }

  /* ------------------------------------------------------------ routing to the end */
  function maybeEnd(kind, p) {
    if (kind === "mission" && p && p.id) V.lastMission = { id: p.id, at: now() };
    const s = session();
    if (V.routedEnd || s.ended) return;
    V.routedEnd = true;
    go("end", {});
  }

  /* ------------------------------------------------------------ init */
  function init() {
    if (inited) return;
    inited = true;
    if (has("router", "register")) {
      WB.router.register("bench", {
        enter(el) { V.el = el; if (V.raf) { cancelAnimationFrame(V.raf); V.raf = 0; } renderBench(el); },
        leave() { if (V.raf) { cancelAnimationFrame(V.raf); V.raf = 0; } },
      });
      WB.router.register("end", { enter(el) { renderEnd(el); } });
    }
    const bus = WB.bus;
    if (!bus) return;
    ["store:loaded", "instrument:saved", "instrument:updated", "instrument:melted", "caps:changed", "app:ready", "session:set", "theme:changed"]
      .forEach((ev) => bus.on(ev, (p) => {
        if (ev === "instrument:updated" && p && p.source === "scrub") return;
        if (ev === "instrument:melted" && p && p.id) { delete V.mailNote[p.id]; delete V.enrich[p.id]; }
        schedule();
      }));
    bus.on("room:peers", (p) => { V.peers = (p && Array.isArray(p.peers)) ? p.peers : []; updatePeers(); });
    bus.on("action:done", (p) => maybeEnd("action", p));
    bus.on("mission:done", (p) => maybeEnd("mission", p));
    try {
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(); });
    } catch (e) { /* no document */ }
  }

  WB.bench = {
    init,
    /* extras beyond the contract */
    render: schedule, exportText, sinceLines: (items) => sinceLines(items || sortTiles(list())),
  };
})();
