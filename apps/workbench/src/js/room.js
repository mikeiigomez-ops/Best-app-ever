/* Workbench room (Raskin): optional witnesses. Presence ("Alex · on a mission · 4:12"), an explicit
   "Show to someone here" that broadcasts a thumb-only snapshot, a live read-only mirror that follows
   the sharer's scrubs, and mission start/finish so a roommate sees the reveal.
   Without a room, everything stays hidden and nothing breaks. Everything heard is untrusted:
   it is sanitised and rendered with textContent only. View: "mirror", params {peerKey}. */
(function () {
  "use strict";
  const WB = window.WB;

  const has = (mod, fn) => !!(WB[mod] && typeof WB[mod][fn] === "function");
  const isNum = (n) => typeof n === "number" && isFinite(n);
  const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
  function safe(label, fn, fallback) {
    try { return fn(); } catch (err) { console.error("[WB.room] " + label, err); return fallback; }
  }
  const el = function () { return WB.util.el.apply(null, arguments); };
  const icon = (name) => (has("ui", "icon") ? WB.ui.icon(name) : "");
  const nowMs = () => Date.now();
  const sid = "s" + Math.random().toString(36).slice(2, 10);   // this tab, until the room tells us our key

  const R = {
    room: null, ready: false, starting: false, name: "", selfKey: null,
    peers: [], shared: {}, sharing: null, version: 0, offs: [], observer: null,
  };

  /* ------------------------------------------------------------ pure helpers */
  function clip(s, n) { s = s == null ? "" : String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function initials(name) {
    const w = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "·";
    const a = w[0].charAt(0), b = w.length > 1 ? w[w.length - 1].charAt(0) : "";
    return (a + b).toUpperCase();
  }
  function firstName(name) { const w = String(name || "").trim().split(/\s+/)[0]; return w ? clip(w, 24) : "Someone"; }
  /* normPeers(raw, selfKey) -> [{key, name, initials, view, instrumentId, mission, self}] */
  function normPeers(raw, selfKey) {
    let list = [];
    if (Array.isArray(raw)) list = raw;
    else if (isObj(raw) && Array.isArray(raw.peers)) list = raw.peers;
    else if (isObj(raw)) list = Object.keys(raw).map((k) => Object.assign({ key: k }, isObj(raw[k]) ? raw[k] : {}));
    const seen = {};
    const out = [];
    list.forEach((p, i) => {
      if (!isObj(p)) return;
      const key = String(p.key || p.id || p.peerId || p.clientId || p.connectionId || p.sessionId || ("peer" + i));
      if (seen[key]) return;
      seen[key] = 1;
      const pres = isObj(p.presence) ? p.presence : isObj(p.state) ? p.state : isObj(p.data) ? p.data : p;
      const name = clip(String(pres.name || p.name || (isObj(p.user) && p.user.name) || "").replace(/[\u0000-\u001f]/g, ""), 40);
      const ms = isObj(pres.mission) ? pres.mission : null;
      out.push({
        key, name, initials: initials(name),
        view: typeof pres.view === "string" ? clip(pres.view, 20) : null,
        instrumentId: typeof pres.instrumentId === "string" ? clip(pres.instrumentId, 40) : null,
        mission: ms && isNum(Number(ms.endsAt)) ? { title: clip(ms.title, 80), endsAt: Number(ms.endsAt) } : null,
        self: !!(p.self || p.isSelf || p.me || p.local || p.isMe || (selfKey && key === selfKey)),
      });
    });
    return out;
  }
  const VIEW_WORDS = {
    bench: "at the bench", instrument: "looking at an instrument", mission: "on a mission", mirror: "watching a shared instrument",
    front: "just arrived", forging: "reading a photo", end: "done for now",
  };
  function activity(p, t) {
    if (p.mission && p.mission.endsAt > (t || nowMs())) {
      const s = Math.ceil((p.mission.endsAt - (t || nowMs())) / 1000);
      return "on a mission · " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }
    return VIEW_WORDS[p.view] || "here";
  }
  function okSrc(s) {
    if (typeof s !== "string") return null;
    if (/^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(s) && s.length < 400000) return s;
    if (/^data:image\/svg\+xml[;,]/i.test(s) && s.length < 200000) return s;   // rendered via <img>: no script runs
    return null;
  }
  function photoOk(ref) {
    if (!isObj(ref)) return null;
    const src = okSrc(ref.thumb) || okSrc(ref.src);
    if (!src) return null;
    return { src, assetId: null, thumb: src, w: isNum(ref.w) ? ref.w : 4, h: isNum(ref.h) ? ref.h : 3, at: isNum(ref.at) ? ref.at : 0, role: "hero" };
  }
  /* snapshotOf(inst) -> a shareable copy: photos reduced to thumbs, observations ≤10, nothing from mail or drafts */
  /* the side an instrument lives on, and whether this tab is clocked out right now */
  function sideOfInst(x) {
    if (!x) return "home";
    if (has("molds", "sideOf")) return safe("molds.sideOf", () => WB.molds.sideOf(x), "home");
    return x.side === "work" || x.side === "both" ? x.side : "home";
  }
  const clockedOut = () => (has("store", "side") ? safe("store.side", () => WB.store.side(), "work") === "home" : false);
  const hiddenInst = (x) => !!x && has("store", "isHidden") && safe("store.isHidden", () => WB.store.isHidden(x), false);
  function snapshotOf(inst) {
    if (!isObj(inst)) return null;
    const s = JSON.parse(JSON.stringify(inst));
    const thumbOnly = (p) => (isObj(p) ? Object.assign({}, p, { src: p.thumb || null, assetId: null }) : null);
    s.photo = thumbOnly(s.photo);
    s.photos = s.photo ? [s.photo] : [];
    s.observations = (s.observations || []).slice(-10);
    s.evidence = (s.evidence || []).map((e) => (e && e.type === "email" ? { id: e.id, type: "email", date: e.date || null } : e));
    s.contact = null;
    s.actions = [];
    s.mailQuery = null;
    if (s.act) s.act = { type: s.act.type || null, to: null, why: null };
    if (s.mission) s.mission = Object.assign({}, s.mission, { beforePhoto: thumbOnly(s.mission.beforePhoto), afterPhoto: thumbOnly(s.mission.afterPhoto) });
    return s;
  }
  /* sanitize(snapshot) -> a safe read-only instrument, or null */
  function sanitize(x) {
    if (!isObj(x) || typeof x.mold !== "string" || !isObj(x.vars)) return null;
    if (has("molds", "get") && !WB.molds.get(x.mold)) return null;
    const s = { id: clip(String(x.id || "shared"), 40), v: 1, side: x.side === "work" || x.side === "both" || x.side === "home" ? x.side : "home", demo: !!x.demo, mold: x.mold, kind: clip(x.kind, 60), system: clip(x.system, 12),
      title: clip(x.title || "Shared instrument", 60), createdAt: Number(x.createdAt) || 0, updatedAt: Number(x.updatedAt) || 0,
      photo: photoOk(x.photo), photos: [], words: {}, vars: {}, items: [], steps: [], evidence: [], fieldNote: x.fieldNote ? clip(x.fieldNote, 200) : null,
      nextPhotos: [], mailQuery: null, act: null, contact: null, intention: null, observations: [], actions: [], mission: null, enriched: null };
    if (s.photo) s.photos = [s.photo];
    if (isObj(x.words)) Object.keys(x.words).slice(0, 8).forEach((k) => { if (typeof x.words[k] === "string") s.words[clip(k, 20)] = clip(x.words[k], 60); });
    if (!s.words.currency) s.words.currency = "$";
    Object.keys(x.vars).slice(0, 12).forEach((k) => {
      const v = x.vars[k];
      if (!isObj(v) || !isNum(Number(v.value))) return;
      s.vars[clip(k, 24)] = { id: clip(k, 24), kind: v.kind === "lever" ? "lever" : "fact", label: clip(v.label, 60), unit: clip(v.unit, 20),
        format: clip(v.format || "num", 8), value: Number(v.value), min: Number(v.min) || 0, max: isNum(Number(v.max)) ? Number(v.max) : 100,
        step: Number(v.step) || 1, origin: ["seen", "inferred", "assumed", "set", "lever"].indexOf(v.origin) >= 0 ? v.origin : "assumed",
        evidenceId: v.evidenceId ? clip(v.evidenceId, 40) : null, reason: v.reason ? clip(v.reason, 160) : null };
    });
    (Array.isArray(x.items) ? x.items : []).slice(0, 12).forEach((it) => {
      if (!isObj(it)) return;
      s.items.push({ id: clip(it.id, 20), name: clip(it.name, 40), value: Number(it.value) || 0, days: Number(it.days) || 0,
        origin: clip(it.origin, 10), pin: pinOk(it.pin), cooked: !!it.cooked });
    });
    (Array.isArray(x.steps) ? x.steps : []).slice(0, 7).forEach((st, i) => {
      if (!isObj(st)) return;
      s.steps.push({ id: clip(st.id || "s" + i, 20), n: Number(st.n) || i + 1, text: clip(st.text, 80), minutes: Number(st.minutes) || 1, pin: pinOk(st.pin), done: !!st.done });
    });
    (Array.isArray(x.evidence) ? x.evidence : []).slice(0, 12).forEach((e) => {
      if (!isObj(e)) return;
      const b = Array.isArray(e.bbox) && e.bbox.length === 4 && e.bbox.every((n) => isNum(Number(n))) ? e.bbox.map(Number) : undefined;
      s.evidence.push({ id: clip(e.id, 40), type: e.type === "email" ? "email" : "photo", bbox: b, text: e.text ? clip(e.text, 80) : undefined, date: e.date ? clip(e.date, 10) : undefined });
    });
    (Array.isArray(x.observations) ? x.observations : []).slice(-10).forEach((o) => {
      if (isObj(o) && isNum(Number(o.t)) && isNum(Number(o.value))) s.observations.push({ t: Number(o.t), value: Number(o.value), facts: {}, source: clip(o.source, 10), note: null });
    });
    if (isObj(x.intention) && isNum(Number(x.intention.value))) {
      const it = x.intention;
      s.intention = { varId: clip(it.varId, 24), value: Number(it.value), baseline: Number(it.baseline) || 0, target: Number(it.target) || 0, outputId: clip(it.outputId, 24),
        committedAt: Number(it.committedAt) || 0, checkAt: Number(it.checkAt) || 0, status: ["open", "held", "missed"].indexOf(it.status) >= 0 ? it.status : "open", actionId: null };
    }
    return s;
  }
  function pinOk(p) { return Array.isArray(p) && p.length >= 2 && isNum(Number(p[0])) && isNum(Number(p[1])) ? [Number(p[0]), Number(p[1])] : null; }

  /* ------------------------------------------------------------ room plumbing */
  function myKey() { return R.selfKey || sid; }
  function emit(topic, data) {
    if (!R.room || typeof R.room.emit !== "function") return false;
    try { R.room.emit(topic, Object.assign({ from: myKey() }, data)); return true; }
    catch (e) { return false; }   // messages can drop; nothing depends on them
  }
  function unwrap(args) {
    const a = args[0], meta = args[1];
    let msg = a, from = null;
    if (isObj(a) && isObj(a.data) && (a.topic || a.from || a.sender || a.peer)) { msg = a.data; from = a.from || a.sender || a.peer || null; }
    if (isObj(meta)) from = from || meta.from || meta.key || meta.peerId || meta.id || null;
    else if (typeof meta === "string") from = from || meta;
    if (isObj(from)) from = from.key || from.id || null;
    return { msg: isObj(msg) ? msg : null, from: from ? String(from) : (isObj(msg) && msg.from ? String(msg.from) : null) };
  }
  function fromSelf(m, from) {
    const f = from || (m && m.from);
    if (!f) return false;
    return f === sid || (R.selfKey && f === R.selfKey) || (m && (m.from === sid || (R.selfKey && m.from === R.selfKey)));
  }
  function peerFor(key, msg) {
    const k = key || (msg && msg.from);
    return R.peers.find((p) => p.key === k) || null;
  }
  function nameFor(key, msg) { const p = peerFor(key, msg); return p && p.name ? firstName(p.name) : "Someone here"; }

  /* ------------------------------------------------------------ presence */
  function myMission() {
    const list = has("store", "all") ? safe("store.all", () => WB.store.all(), []) || [] : [];
    const t = nowMs();
    let best = null;
    list.forEach((inst) => {
      const m = inst && inst.mission;
      if (m && isNum(m.startedAt) && isNum(m.endsAt) && !m.verified && m.endsAt > t - 15 * 60000) {
        if (!best || m.startedAt > best.startedAt) best = m;
      }
    });
    return best ? { title: clip(best.title, 80), endsAt: best.endsAt } : null;
  }
  let lastPresence = "";
  function sendPresence() {
    if (!R.room || typeof R.room.presence !== "function") return;
    const cur = WB.router && WB.router.current ? WB.router.current() : { name: null, params: {} };
    const view = cur.name || null;
    let instrumentId = (view === "instrument" || view === "mission") && cur.params && cur.params.id ? String(cur.params.id) : null;
    if (instrumentId && clockedOut()) {
      const shown = has("store", "get") ? safe("store.get", () => WB.store.get(instrumentId), null) : null;
      if (hiddenInst(shown)) instrumentId = null;
    }
    // a mission is shown to people here only when you said so on its brief
    const p = { v: 1, name: R.name || "", view, instrumentId, mission: R.missionVisible ? myMission() : null };
    const key = JSON.stringify(p);
    if (key === lastPresence) return;
    lastPresence = key;
    try { R.room.presence(p); } catch (e) { /* the room may be closing */ }
  }

  /* ------------------------------------------------------------ peers UI */
  let announced = {};
  function onPeers(raw) {
    const prev = R.peers;
    R.peers = normPeers(raw, R.selfKey);
    const me = R.peers.find((p) => p.self);
    if (me && me.key !== R.selfKey) R.selfKey = me.key;
    const others = R.peers.filter((p) => !p.self);
    // a quiet line for screen readers when someone arrives
    const live = document.getElementById("wb-peers");
    others.forEach((p) => {
      if (!announced[p.key] && !prev.some((q) => q.key === p.key)) {
        announced[p.key] = 1;
        if (live) { const n = live.querySelector(".rm-sr") || live.appendChild(el("span", { class: "rm-sr" })); n.textContent = firstName(p.name) + " is here."; }
      }
    });
    // a newcomer should see what we're showing
    if (R.sharing && others.some((p) => !prev.some((q) => q.key === p.key))) reshareSoon();
    WB.bus.emit("room:peers", { peers: R.peers.map((p) => Object.assign({}, p)) });
    R.version++;
    renderSlots();
    if (mirror.el) mirror.refreshStatus();
    if (peerSheet) peerSheet.refresh();
  }
  function renderSlots() {
    const others = R.peers.filter((p) => !p.self);
    const slots = Array.from(document.querySelectorAll("[data-slot=peers]"));
    const live = document.getElementById("wb-peers");
    slots.forEach((slot) => {
      if (slot.dataset.rmv === String(R.version)) return;
      slot.dataset.rmv = String(R.version);
      slot.textContent = "";
      if (!R.ready || !others.length) return;
      slot.appendChild(peersButton(others));
    });
    if (live) live.hidden = !R.ready;
  }
  function peersButton(others) {
    const faces = el("span", { class: "rm-faces", "aria-hidden": "true" });
    others.slice(0, 3).forEach((p) => faces.appendChild(el("span", { class: "rm-face" + (p.mission && p.mission.endsAt > nowMs() ? " is-mission" : ""), text: p.initials })));
    if (others.length > 3) faces.appendChild(el("span", { class: "rm-face rm-face--more", text: "+" + (others.length - 3) }));
    const label = others.length === 1 ? firstName(others[0].name) + " is here" : others.length + " people here";
    return el("button", { type: "button", class: "rm-peers", "aria-label": label + ". Show who.", on: { click: () => openPeers() } }, faces);
  }
  let peerSheet = null;
  function openPeers() {
    if (!has("ui", "sheet")) return;
    const list = el("ul", { class: "rm-list" });
    const draw = () => {
      list.textContent = "";
      const others = R.peers.filter((p) => !p.self);
      if (!others.length) list.appendChild(el("li", { class: "rm-row rm-row--empty", text: "Nobody else has this page open right now." }));
      others.forEach((p) => {
        const share = R.shared[p.key];
        const row = el("li", { class: "rm-row" },
          el("span", { class: "rm-face rm-face--lg" + (p.mission && p.mission.endsAt > nowMs() ? " is-mission" : ""), "aria-hidden": "true", text: p.initials }),
          el("span", { class: "rm-row__text" },
            el("span", { class: "rm-row__name", text: p.name ? clip(p.name, 40) : "Someone" }),
            el("span", { class: "rm-row__what wb-mono", text: activity(p) + (p.mission && p.mission.endsAt > nowMs() && p.mission.title ? " · " + p.mission.title : "") })),
          share ? el("button", { type: "button", class: "wb-btn wb-btn--quiet rm-row__open", text: "Watch",
            "aria-label": "Watch " + (share.snapshot.side === "work" && clockedOut() ? "a work instrument" : (share.snapshot.title || "their instrument")), on: { click: () => { close(); WB.router.go("mirror", { peerKey: p.key }); } } }) : null);
        list.appendChild(row);
      });
    };
    draw();
    const body = el("div", { class: "rm-sheet" }, list,
      el("p", { class: "wb-micro rm-fine", text: "PEOPLE WITH THIS PAGE OPEN RIGHT NOW. THEY SEE WHICH SCREEN YOU'RE ON AND ANY MISSION CLOCK. THEY NEVER SEE YOUR NUMBERS UNLESS YOU TAP SHOW TO SOMEONE HERE." }));
    const timer = setInterval(draw, 1000);
    let sh = null;
    const close = () => { if (sh) sh.close(); };
    sh = WB.ui.sheet({ title: "Here now", body, actions: [{ label: "Close", kind: "quiet", onTap: (c) => c() }],
      onClose: () => { clearInterval(timer); peerSheet = null; } });
    peerSheet = { refresh: draw };
  }

  /* ------------------------------------------------------------ sharing */
  const lastScrub = { t: 0, timer: 0, pending: null };
  function share(id) {
    if (!R.ready) { if (has("ui", "toast")) WB.ui.toast("Nobody else has this page open right now."); return false; }
    const inst = has("store", "get") ? safe("store.get", () => WB.store.get(id), null) : null;
    if (!inst) return false;
    if (clockedOut() && sideOfInst(inst) === "work") { if (has("ui", "toast")) WB.ui.toast("Clocked out. Work stays off the room."); return false; }
    const snap = snapshotOf(inst);
    if (!emit("wb.share", { snapshot: snap })) { if (has("ui", "toast")) WB.ui.toast("That didn't reach anyone. Try again."); return false; }
    R.sharing = { id, at: nowMs() };
    const n = R.peers.filter((p) => !p.self).length;
    if (has("ui", "toast")) WB.ui.toast(n ? "Showing " + (inst.title || "this") + " to " + (n === 1 ? firstName(R.peers.find((p) => !p.self).name) : n + " people") + " here. Leave it to stop."
      : "Showing " + (inst.title || "this") + ". Anyone who opens the page sees it. Leave it to stop.", { ms: 4200 });
    return true;
  }
  function stopSharing() { R.sharing = null; clearTimeout(reshareT); }
  let reshareT = 0;
  function reshareSoon() {
    clearTimeout(reshareT);
    reshareT = setTimeout(() => {
      if (!R.sharing) return;
      const inst = has("store", "get") ? safe("store.get", () => WB.store.get(R.sharing.id), null) : null;
      if (inst && !(clockedOut() && sideOfInst(inst) === "work")) emit("wb.share", { snapshot: snapshotOf(inst) });
    }, 800);
  }
  function sendScrub(p) {
    if (!R.sharing || !p || p.id !== R.sharing.id || !isNum(p.value)) return;
    if (clockedOut()) { const inst = has("store", "get") ? safe("store.get", () => WB.store.get(p.id), null) : null; if (inst && sideOfInst(inst) === "work") return; }
    lastScrub.pending = { id: p.id, varId: String(p.varId), value: p.value };
    const t = nowMs();
    const gap = 66;   // ≤15 messages a second
    if (t - lastScrub.t >= gap) { lastScrub.t = t; emit("wb.scrub", lastScrub.pending); lastScrub.pending = null; }
    else if (!lastScrub.timer) {
      lastScrub.timer = setTimeout(() => {
        lastScrub.timer = 0; lastScrub.t = nowMs();
        if (lastScrub.pending) { emit("wb.scrub", lastScrub.pending); lastScrub.pending = null; }
      }, gap - (t - lastScrub.t));
    }
  }

  /* ------------------------------------------------------------ incoming */
  function onShare() {
    const { msg, from } = unwrap(arguments);
    if (!msg || fromSelf(msg, from)) return;
    const key = from || String(msg.from || "");
    if (!key) return;
    const snap = sanitize(msg.snapshot);
    if (!snap) return;
    const isNew = !R.shared[key] || R.shared[key].snapshot.id !== snap.id;
    R.shared[key] = { snapshot: snap, at: nowMs() };
    if (mirror.el && mirror.peerKey === key) { mirror.update(snap, null); return; }
    const hideTitle = snap.side === "work" && clockedOut();
    if (isNew && has("ui", "toast")) {
      WB.ui.toast(nameFor(key, msg) + " is showing you " + (hideTitle ? "a work instrument" : snap.title) + ".", { action: { label: "Watch", onTap: () => WB.router.go("mirror", { peerKey: key }) }, ms: 6000 });
    }
    if (peerSheet) peerSheet.refresh();
  }
  function onScrub() {
    const { msg, from } = unwrap(arguments);
    if (!msg || fromSelf(msg, from)) return;
    const key = from || String(msg.from || "");
    const sh = R.shared[key];
    if (!sh || String(msg.id) !== sh.snapshot.id) return;
    const v = sh.snapshot.vars[String(msg.varId)];
    const val = Number(msg.value);
    if (!v || !isNum(val)) return;
    v.value = v.max > v.min ? Math.min(v.max, Math.max(v.min, val)) : val;
    if (mirror.el && mirror.peerKey === key) mirror.update(sh.snapshot, String(msg.varId));
  }
  function onMission() {
    const { msg, from } = unwrap(arguments);
    if (!msg || fromSelf(msg, from) || !has("ui", "toast")) return;
    const who = nameFor(from, msg);
    const title = clip(String(msg.title || "a mission").replace(/\.$/, ""), 70);
    if (msg.state === "start") {
      const ends = Number(msg.endsAt);
      const mins = isNum(ends) ? Math.max(1, Math.round((ends - nowMs()) / 60000)) : null;
      WB.ui.toast(who + " started " + (mins ? "a " + mins + "-minute mission" : "a mission") + ": " + title + ".");
    } else if (msg.state === "done") {
      const pct = isNum(Number(msg.reclaimed)) && msg.reclaimed !== null ? Math.round(Number(msg.reclaimed)) : null;
      const note = msg.fieldNote && msg.fieldNote !== "Checked by you." ? clip(String(msg.fieldNote).replace(/\.$/, ""), 90) : title;
      const said = /^[A-Z][a-z]/.test(note) ? note.charAt(0).toLowerCase() + note.slice(1) : note;
      WB.ui.toast(who + " finished: " + said + "." + (pct != null ? " " + pct + "% reclaimed." : ""), { ms: 5200 });
    }
  }

  /* ------------------------------------------------------------ mirror view */
  const mirror = {
    el: null, peerKey: null, handle: null, wrap: null, body: null, status: null, raf: 0, badgeT: 0, pendingVar: null,
    enter(sectionEl, params) {
      this.leave();
      this.el = sectionEl;
      this.peerKey = params && params.peerKey ? String(params.peerKey) : null;
      this.render();
    },
    leave() {
      cancelAnimationFrame(this.raf); clearTimeout(this.badgeT);
      this.destroyHandle();
      this.el = null; this.wrap = null; this.body = null; this.status = null;
    },
    destroyHandle() {
      const h = this.handle;
      this.handle = null;
      if (h && typeof h === "object") {
        const fn = h.destroy || h.unmount || h.dispose;
        if (typeof fn === "function") safe("mirror.destroy", () => fn.call(h));
      } else if (typeof h === "function") safe("mirror.dispose", () => h());
    },
    render() {
      if (!this.el || !has("util", "el")) return;
      this.el.textContent = "";
      const sh = this.peerKey ? R.shared[this.peerKey] : null;
      const who = this.peerKey ? nameFor(this.peerKey) : "Someone here";
      const back = el("button", { type: "button", class: "wb-iconbtn rm-top__back", "aria-label": "Back", html: icon("back"), on: { click: () => WB.router.back() } });
      this.status = el("span", { class: "rm-live wb-micro" });
      const top = el("header", { class: "rm-top" }, back,
        el("span", { class: "wb-micro rm-top__label", text: "SHOWN BY " + who.toUpperCase() }), this.status);
      if (!sh) {
        this.el.appendChild(el("div", { class: "rm-mirror" }, top,
          el("div", { class: "rm-empty" },
            el("h1", { class: "rm-empty__title wb-serif", text: "Nothing is being shown right now." }),
            el("p", { class: "rm-empty__sub", text: "When someone here taps Show to someone here, it appears on this screen." }),
            el("button", { type: "button", class: "wb-btn wb-btn--quiet wb-btn--block", text: "Back", on: { click: () => WB.router.back() } }))));
        this.refreshStatus();
        return;
      }
      this.body = el("div", { class: "rm-mirror__body" });
      this.wrap = el("div", { class: "rm-mirror__wrap" }, this.body);
      this.el.appendChild(el("div", { class: "rm-mirror" }, top, this.wrap,
        el("p", { class: "wb-micro rm-fine", text: "READ-ONLY. THIS IS " + who.toUpperCase() + "'S INSTRUMENT. NOTHING HERE IS SAVED TO YOUR BENCH." })));
      this.mount(sh.snapshot);
      this.refreshStatus();
    },
    mount(snap) {
      this.destroyHandle();
      this.body.textContent = "";
      if (snap && snap.side === "work" && clockedOut()) {
        this.body.appendChild(el("p", { class: "rm-locked wb-serif", text: "A work instrument. You are clocked out." }));
        return;
      }
      if (has("instrument", "mount")) {
        this.handle = safe("instrument.mount", () => WB.instrument.mount(this.body, null, { snapshot: snap, readOnly: true }), null);
        if (this.body.childNodes.length) return;
      }
      this.body.appendChild(fallbackCard(snap));
    },
    update(snap, varId) {
      if (!this.el) return;
      if (!this.body) { this.render(); return; }
      if (varId) this.pendingVar = varId;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => {
        const h = this.handle;
        const vId = this.pendingVar;
        this.pendingVar = null;
        let done = false;
        if (h && typeof h === "object") {
          if (vId && typeof h.scrub === "function") done = safe("mirror.scrub", () => { h.scrub(vId, snap.vars[vId].value); return true; }, false);
          if (!done && typeof h.update === "function") done = safe("mirror.update", () => { h.update(snap); return true; }, false);
          if (!done && typeof h.setSnapshot === "function") done = safe("mirror.setSnapshot", () => { h.setSnapshot(snap); return true; }, false);
        }
        if (!done) this.mount(snap);
        if (vId) this.badge(vId);
        this.refreshStatus();
      });
    },
    badge(varId) {
      if (!this.wrap) return;
      const who = nameFor(this.peerKey);
      let b = this.wrap.querySelector(".rm-badge");
      if (!b) { b = el("span", { class: "rm-badge wb-mono", "aria-hidden": "true" }); this.wrap.appendChild(b); }
      b.textContent = initials(peerFor(this.peerKey) ? peerFor(this.peerKey).name : who);
      const q = (s) => { try { return this.body.querySelector(s); } catch (e) { return null; } };
      const css = (window.CSS && CSS.escape) ? CSS.escape(varId) : varId.replace(/[^a-zA-Z0-9_-]/g, "");
      const chip = q('[data-var="' + css + '"]') || q('[data-var-id="' + css + '"]') || q('[data-varid="' + css + '"]') || q('[data-id="' + css + '"]');
      if (chip) {
        const wr = this.wrap.getBoundingClientRect(), cr = chip.getBoundingClientRect();
        b.style.transform = "translate(" + Math.round(cr.right - wr.left - 8) + "px," + Math.round(cr.top - wr.top - 14) + "px)";
        b.classList.remove("is-floating");
      } else {
        b.style.transform = "";
        b.classList.add("is-floating");
      }
      b.classList.add("is-on");
      clearTimeout(this.badgeT);
      this.badgeT = setTimeout(() => { if (b) b.classList.remove("is-on"); }, 1400);
    },
    refreshStatus() {
      if (!this.status) return;
      const sh = this.peerKey ? R.shared[this.peerKey] : null;
      const p = peerFor(this.peerKey);
      const live = !!(sh && p && p.instrumentId === sh.snapshot.id);
      this.status.textContent = !sh ? "" : !p ? "LEFT" : live ? "LIVE" : "THEY MOVED ON";
      this.status.classList.toggle("is-live", live);
    },
  };
  function fallbackCard(snap) {
    const parts = has("molds", "sentence") ? safe("molds.sentence", () => WB.molds.sentence(snap), []) || [] : [];
    const c = has("molds", "compute") ? safe("molds.compute", () => WB.molds.compute(snap), null) : null;
    const def = has("molds", "get") ? WB.molds.get(snap.mold) : null;
    const p = el("p", { class: "rm-card__sentence wb-serif" });
    parts.forEach((x) => {
      if (x.t === "text") p.appendChild(document.createTextNode(decode(x.text)));
      else if (x.t === "var" && snap.vars[x.id]) p.appendChild(el("span", { class: "rm-card__num wb-mono", text: WB.molds.format(snap.vars[x.id].value, snap.vars[x.id].format, snap) }));
      else if (x.t === "out" && c && def && def.outputs[x.id]) p.appendChild(el("span", { class: "rm-card__num rm-card__num--out wb-mono", text: WB.molds.format(c.outputs[x.id], def.outputs[x.id].format, snap) }));
    });
    return el("article", { class: "rm-card" },
      snap.photo ? el("img", { class: "rm-card__img", src: snap.photo.src, alt: "Their photo", decoding: "async" }) : null,
      el("h2", { class: "rm-card__title", text: snap.title }), p);
  }
  function decode(s) {   // molds.sentence pre-escapes text; we insert as text, so undo the entities
    return String(s || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  }

  /* ------------------------------------------------------------ init */
  async function connect() {
    let room = null;
    try { room = has("ai", "room") ? await WB.ai.room() : null; } catch (e) { room = null; }
    if (!room || typeof room.emit !== "function" || typeof room.on !== "function") { R.ready = false; renderSlots(); return; }
    R.room = room;
    try {
      const u = has("ai", "cap") ? await WB.ai.cap("user") : null;
      const me = u && typeof u.me === "function" ? await u.me() : null;
      const nm = me && (me.name || me.displayName || me.fullName || me.given_name || me.firstName);
      R.name = typeof nm === "string" ? clip(nm, 40) : "";   // never stored, never an email
    } catch (e) { R.name = ""; }
    const on = (topic, fn) => {
      try {
        const off = room.on(topic, function () { try { fn.apply(null, arguments); } catch (err) { console.error("[WB.room] " + topic, err); } });
        if (typeof off === "function") R.offs.push(off);
      } catch (e) { /* topic not supported */ }
    };
    on("wb.share", onShare);
    on("wb.scrub", onScrub);
    on("wb.mission", onMission);
    if (typeof room.onPeers === "function") {
      try { const off = room.onPeers((raw) => { try { onPeers(raw); } catch (err) { console.error("[WB.room] peers", err); } }); if (typeof off === "function") R.offs.push(off); }
      catch (e) { /* no presence */ }
    }
    R.ready = true;
    sendPresence();
    R.version++;
    renderSlots();
  }

  function init() {
    if (R.starting || !WB.bus || !WB.router) return;
    R.starting = true;
    WB.router.register("mirror", { enter: (e, p) => mirror.enter(e, p), leave: () => mirror.leave() });
    const bus = WB.bus;
    bus.on("view:enter", () => { sendPresence(); R.version++; renderSlots(); });
    bus.on("view:leave", (p) => { if (R.sharing && p && p.view === "instrument" && p.params && p.params.id === R.sharing.id) stopSharing(); });
    bus.on("side:changed", () => { lastPresence = ""; sendPresence(); if (R.sharing) { const i = has("store", "get") ? safe("store.get", () => WB.store.get(R.sharing.id), null) : null; if (i && clockedOut() && sideOfInst(i) === "work") stopSharing(); } if (mirror.el && mirror.peerKey && R.shared[mirror.peerKey]) mirror.mount(R.shared[mirror.peerKey].snapshot); });
    bus.on("instrument:scrub", sendScrub);
    bus.on("instrument:set", sendScrub);
    bus.on("instrument:updated", (p) => {
      if (p && R.sharing && p.id === R.sharing.id && p.source !== "scrub") reshareSoon();
      if (p && p.source === "mission") sendPresence();
    });
    bus.on("mission:start", (p) => {
      sendPresence();
      const m = p && p.mission;
      if (m && R.missionVisible) emit("wb.mission", { state: "start", title: clip(m.title, 80), endsAt: m.endsAt || null, fieldNote: null, reclaimed: null });
    });
    bus.on("mission:done", (p) => {
      sendPresence();
      const m = p && p.mission;
      if (m && R.missionVisible) emit("wb.mission", { state: "done", title: clip(m.title, 80), endsAt: m.endsAt || null, fieldNote: m.fieldNote ? clip(m.fieldNote, 160) : null,
        reclaimed: m.verified && isNum(m.verified.reclaimed) ? m.verified.reclaimed : null });
    });
    // fill any peers slot a view renders later (bench bar), without looping on our own writes
    const views = document.getElementById("wb-views");
    if (views && typeof MutationObserver === "function") {
      let queued = false;
      R.observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          const stale = Array.from(document.querySelectorAll("[data-slot=peers]")).some((s) => s.dataset.rmv !== String(R.version));
          if (stale) renderSlots();
        });
      });
      R.observer.observe(views, { childList: true, subtree: true });
    }
    const live = document.getElementById("wb-peers");
    if (live) live.hidden = true;
    connect().catch((e) => console.error("[WB.room] connect", e));
  }

  WB.room = {
    init, share, stopSharing,
    available: () => R.ready,
    /* opt-in, per load: missions are broadcast to the room only after "Let people here see this mission" */
    missionVisible: () => !!R.missionVisible,
    setMissionVisible(on) { R.missionVisible = !!on; lastPresence = ""; sendPresence(); },
    others: () => R.peers.filter((p) => !p.self).map((p) => Object.assign({}, p)),
    peers: () => R.peers.map((p) => Object.assign({}, p)),
    sharing: () => (R.sharing ? R.sharing.id : null),
    shared: (peerKey) => (R.shared[peerKey] ? R.shared[peerKey].snapshot : null),
    _test: { normPeers, initials, activity, snapshotOf, sanitize, okSrc },
  };
})();
