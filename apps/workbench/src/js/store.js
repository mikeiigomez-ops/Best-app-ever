/* ---- Workbench store (Zhuo) ----
   State and persistence. localStorage is always written (a cache, every access guarded);
   when WB.ai.db() and WB.ai.userId() resolve, documents also live in data/users/<uid>/ and merge by updatedAt.
   Demo instruments live only in memory (plus the "wb:v1:demo" flag) and are never written anywhere.
   Registers functions only; init() is called by WB.app.boot(). */
(function () {
  "use strict";
  const WB = window.WB;

  const K = { bench: "wb:v1:bench", ins: "wb:v1:ins:", demo: "wb:v1:demo" };
  const DAY = 86400000;
  const DOC_BUDGET = 200 * 1024;
  const WRITE_MS = 500;
  const ANNUAL = { leak: 1, dial: 1 };       // molds whose primary is a $/yr figure
  const KEPT_DIRECT = { spoil: 1 };         // molds whose primary is already "money this period"

  /* ------------------------------------------------------------ small helpers */
  const now = () => Date.now();
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const emit = (name, payload) => { try { if (WB.bus) WB.bus.emit(name, payload); } catch (e) { console.error(e); } };
  function uid(prefix) {
    if (WB.util && typeof WB.util.uid === "function") return WB.util.uid(prefix);
    let s = "";
    while (s.length < 8) s += Math.random().toString(36).slice(2);
    return prefix + "_" + s.slice(0, 8);
  }
  function bytes(str) {
    try { if (typeof TextEncoder === "function") return new TextEncoder().encode(str).length; } catch (e) { /* fall through */ }
    return str.length;
  }
  const M = () => WB.molds || null;
  function moldDef(inst) { const m = M(); return m && typeof m.get === "function" ? m.get(inst && inst.mold) : null; }

  /* localStorage: every access in try/catch */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* blocked */ } }
  function lsKeys(prefix) {
    const out = [];
    try {
      const ls = window.localStorage;
      for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.indexOf(prefix) === 0) out.push(k); }
    } catch (e) { /* blocked */ }
    return out;
  }
  function lsJSON(k) { const s = lsGet(k); if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }

  /* ------------------------------------------------------------ shapes */
  function newBench(t) {
    return { v: 1, profile: { createdAt: t, firstRunDone: false, lastOpenAt: t, prevOpenAt: 0, gmailAsked: false, theme: "auto" },
      order: [], melted: [], sessions: [], updatedAt: 0 };
  }
  function normBench(b, t) {
    const d = newBench(t);
    if (!isObj(b)) return d;
    const p = isObj(b.profile) ? b.profile : {};
    return {
      v: 1,
      profile: {
        createdAt: isNum(p.createdAt) ? p.createdAt : t,
        firstRunDone: !!p.firstRunDone,
        lastOpenAt: isNum(p.lastOpenAt) ? p.lastOpenAt : 0,
        prevOpenAt: isNum(p.prevOpenAt) ? p.prevOpenAt : 0,
        gmailAsked: !!p.gmailAsked,
        theme: p.theme === "light" || p.theme === "dark" ? p.theme : "auto",
      },
      order: Array.isArray(b.order) ? b.order.filter((x) => typeof x === "string") : [],
      melted: Array.isArray(b.melted) ? b.melted.filter(isObj).slice(-50) : [],
      sessions: Array.isArray(b.sessions) ? b.sessions.filter(isObj).slice(-30) : [],
      updatedAt: isNum(b.updatedAt) ? b.updatedAt : 0,
    };
  }
  function validInst(o) { return isObj(o) && typeof o.id === "string" && /^ins_/.test(o.id) && typeof o.mold === "string" && !o.melted; }
  function normInst(o) {
    const t = now();
    const i = o;
    i.v = 1;
    if (!isNum(i.createdAt)) i.createdAt = t;
    if (!isNum(i.updatedAt)) i.updatedAt = i.createdAt;
    ["photos", "items", "steps", "evidence", "nextPhotos", "observations", "actions"].forEach((k) => { if (!Array.isArray(i[k])) i[k] = []; });
    if (!isObj(i.vars)) i.vars = {};
    if (!isObj(i.words)) i.words = { currency: "$" };
    if (!i.words.currency) i.words.currency = "$";
    ["photo", "fieldNote", "mailQuery", "act", "contact", "intention", "mission", "enriched"].forEach((k) => { if (i[k] === undefined) i[k] = null; });
    if (i.observations.length > 60) i.observations = i.observations.slice(-60);
    if (i.actions.length > 20) i.actions = i.actions.slice(-20);
    if (i.photos.length > 6) i.photos = i.photos.slice(-6);
    return i;
  }

  /* ------------------------------------------------------------ state */
  const real = { bench: newBench(now()), instruments: {} };
  let demo = null;                // {bench, instruments} while the example bench is active
  let inited = false;
  const bootAt = now();
  const cloud = { active: false, col: null, promise: null, docs: {} };
  const ses = { forged: 0, committed: 0, closed: 0, ended: false, steeredUSD: 0, steeredBy: {}, keys: {}, lastCommitId: null,
    real: { forged: 0, committed: 0, closed: 0 } };
  let lastMelt = null;

  const active = () => demo || real;
  function findIn(st, id) { return st && st.instruments[id] ? st.instruments[id] : null; }
  function find(id) { return findIn(active(), id) || findIn(real, id); }

  /* ------------------------------------------------------------ budget */
  function sameRef(a, b) { return !!(a && b && a.src === b.src && a.at === b.at); }
  function slimPhoto(p) { if (p && p.thumb && p.src && p.src !== p.thumb && /^data:/.test(p.src)) { p.src = p.thumb; return true; } return false; }
  function sizeOf(o) { try { return bytes(JSON.stringify(o)); } catch (e) { return 0; } }
  /* Doc budget ≤200 KB: drop the src of the oldest non-hero photos first (keeping thumbs), then observations beyond 30.
     As a last resort (the db refuses >256 KiB) mission photos and then the hero fall back to thumbs too. */
  function fitBudget(inst) {
    if (sizeOf(inst) <= DOC_BUDGET) return inst;
    const others = (inst.photos || []).filter((p) => !sameRef(p, inst.photo)).sort((a, b) => (a.at || 0) - (b.at || 0));
    for (const p of others) { if (slimPhoto(p) && sizeOf(inst) <= DOC_BUDGET) return inst; }
    if ((inst.observations || []).length > 30) { inst.observations = inst.observations.slice(-30); if (sizeOf(inst) <= DOC_BUDGET) return inst; }
    const m = inst.mission;
    if (m) { if (slimPhoto(m.beforePhoto) && sizeOf(inst) <= DOC_BUDGET) return inst; if (slimPhoto(m.afterPhoto) && sizeOf(inst) <= DOC_BUDGET) return inst; }
    if (inst.photo) {
      const hero = (inst.photos || []).find((p) => sameRef(p, inst.photo));
      slimPhoto(inst.photo); if (hero) slimPhoto(hero);
    }
    return inst;
  }
  function slimAll(inst) {
    const c = clone(inst);
    (c.photos || []).forEach(slimPhoto); slimPhoto(c.photo);
    if (c.mission) { slimPhoto(c.mission.beforePhoto); slimPhoto(c.mission.afterPhoto); }
    return c;
  }

  /* ------------------------------------------------------------ local persistence */
  let warnedQuota = false;
  function writeLocalInst(inst) {
    if (!inst || inst.demo) return;
    let json = JSON.stringify(inst);
    if (lsSet(K.ins + inst.id, json)) return;
    json = JSON.stringify(slimAll(inst));
    if (!lsSet(K.ins + inst.id, json) && !warnedQuota) { warnedQuota = true; console.warn("[WB.store] this device's storage is full; " + inst.id + " lives in memory for now."); }
  }
  function writeLocalBench() { lsSet(K.bench, JSON.stringify(real.bench)); }

  function readLocal() {
    const t = now();
    real.bench = normBench(lsJSON(K.bench), t);
    const seen = {};
    const order = [];
    real.bench.order.forEach((id) => {
      if (seen[id]) return;
      const o = lsJSON(K.ins + id);
      if (validInst(o) && !o.demo) { real.instruments[id] = normInst(o); order.push(id); seen[id] = 1; }
    });
    // orphans: an instrument doc written without its bench (a crash between the two writes)
    const meltedIds = meltedIdSet(real.bench.melted);
    lsKeys(K.ins).forEach((k) => {
      const id = k.slice(K.ins.length);
      if (seen[id]) return;
      if (meltedIds[id]) { lsDel(k); return; }
      const o = lsJSON(k);
      if (validInst(o) && !o.demo) { real.instruments[id] = normInst(o); order.push(id); seen[id] = 1; }
    });
    real.bench.order = order;
  }
  function meltedIdSet(list) { const s = {}; (list || []).forEach((m) => { if (m && m.id) s[m.id] = 1; }); return s; }

  /* ------------------------------------------------------------ cloud persistence */
  const pend = {};   // docId -> {timer, inflight, again}
  function docRef(docId) { try { return cloud.col ? cloud.col.doc(docId) : null; } catch (e) { return null; } }
  function snapData(s) {
    if (!s) return null;
    let ok = false;
    try { ok = typeof s.exists === "function" ? s.exists() : !!s.exists; } catch (e) { ok = false; }
    if (!ok) return null;
    try { return typeof s.data === "function" ? s.data() : s.data || null; } catch (e) { return null; }
  }
  function schedule(docId) {
    if (!cloud.active) return;
    const p = pend[docId] || (pend[docId] = { timer: 0, inflight: false, again: false });
    clearTimeout(p.timer);
    p.timer = setTimeout(() => { p.timer = 0; flushDoc(docId); }, WRITE_MS);
  }
  async function flushDoc(docId) {
    const p = pend[docId] || (pend[docId] = { timer: 0, inflight: false, again: false });
    if (p.inflight) { p.again = true; return; }
    const ref = docRef(docId);
    if (!ref) return;
    p.inflight = true;
    try {
      if (docId === "bench") await ref.set(clone(real.bench));
      else {
        const inst = real.instruments[docId];
        if (inst && !inst.demo) {
          const data = clone(inst);
          fitBudget(data);
          if (sizeOf(data) > 250 * 1024) Object.assign(data, slimAll(data));
          await ref.set(data);
        } else if (!inst) {
          if (typeof ref.delete === "function") await ref.delete();
          else await ref.set({ id: docId, melted: true, updatedAt: now() });
        }
      }
    } catch (e) {
      console.warn("[WB.store] cloud write failed for " + docId, e && (e.code || e.message || e));
    } finally {
      p.inflight = false;
      if (p.again) { p.again = false; schedule(docId); }
    }
  }
  function flushAll() {
    Object.keys(pend).forEach((id) => {
      const p = pend[id];
      if (p.timer) { clearTimeout(p.timer); p.timer = 0; flushDoc(id); }
    });
  }

  function mergeBench(L, C) {
    if (!C) return { bench: L, push: true };
    const lw = (L.updatedAt || 0) >= (C.updatedAt || 0);
    const W = lw ? L : C, X = lw ? C : L;
    const melted = [];
    const mk = {};
    (L.melted || []).concat(C.melted || []).forEach((m) => {
      const key = (m.id || "") + "|" + (m.title || "") + "|" + (m.at || 0);
      if (!mk[key]) { mk[key] = 1; melted.push(m); }
    });
    melted.sort((a, b) => (a.at || 0) - (b.at || 0));
    const sessions = [];
    const sk = {};
    (L.sessions || []).concat(C.sessions || []).forEach((s) => { if (!sk[s.at]) { sk[s.at] = 1; sessions.push(s); } });
    sessions.sort((a, b) => (a.at || 0) - (b.at || 0));
    const prevCloudOpen = C.profile && isNum(C.profile.lastOpenAt) && C.profile.lastOpenAt < bootAt ? C.profile.lastOpenAt : 0;
    const profile = Object.assign({}, X.profile, W.profile, {
      createdAt: Math.min(L.profile.createdAt || bootAt, (C.profile && C.profile.createdAt) || bootAt),
      firstRunDone: !!(L.profile.firstRunDone || (C.profile && C.profile.firstRunDone)),
      gmailAsked: !!(L.profile.gmailAsked || (C.profile && C.profile.gmailAsked)),
      lastOpenAt: L.profile.lastOpenAt,
      prevOpenAt: Math.max(L.profile.prevOpenAt || 0, prevCloudOpen),
    });
    const bench = { v: 1, profile, order: W.order.slice(), melted: melted.slice(-50), sessions: sessions.slice(-30), updatedAt: Math.max(L.updatedAt || 0, C.updatedAt || 0) };
    return { bench, push: true, loserOrder: X.order || [], winnerAt: W.updatedAt || 0 };
  }

  function startCloud() {
    if (cloud.promise) return cloud.promise;
    cloud.promise = (async () => {
      const ai = WB.ai;
      if (!ai || typeof ai.db !== "function" || typeof ai.userId !== "function") return false;
      let db = null, user = null;
      try { db = await ai.db(); } catch (e) { db = null; }
      if (!db || typeof db.collection !== "function") return false;
      try { user = await ai.userId(); } catch (e) { user = null; }
      if (!user) return false;
      let col;
      try { col = db.collection("data/users/" + user); } catch (e) { return false; }
      if (!col || typeof col.doc !== "function") return false;
      cloud.col = col;
      let cb = null;
      try { cb = snapData(await col.doc("bench").get()); } catch (e) {
        console.warn("[WB.store] cloud read failed", e && (e.code || e.message || e));
        cloud.col = null;
        return false;
      }
      const cBench = cb ? normBench(cb, bootAt) : null;
      const ids = [];
      const add = (id) => { if (typeof id === "string" && ids.indexOf(id) < 0) ids.push(id); };
      (cBench ? cBench.order : []).forEach(add);
      real.bench.order.forEach(add);
      const docs = {};
      const queue = ids.slice();
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift();
          try { const d = snapData(await col.doc(id).get()); if (validInst(d) && !d.demo) docs[id] = normInst(d); } catch (e) { /* one bad doc */ }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);

      const mb = mergeBench(real.bench, cBench);
      const bench = mb.bench;
      const meltedIds = meltedIdSet(bench.melted);
      const all = Object.assign({}, docs);
      const push = [];
      Object.keys(real.instruments).forEach((id) => {
        const l = real.instruments[id], c = docs[id];
        if (!c || (l.updatedAt || 0) > (c.updatedAt || 0)) { all[id] = l; push.push(id); }
        else if ((c.updatedAt || 0) > (l.updatedAt || 0)) writeLocalInst(c);
      });
      Object.keys(docs).forEach((id) => { if (!real.instruments[id]) writeLocalInst(docs[id]); });
      // order: the newer bench's order, then anything only the other side knows; melted ids (recorded with their id) never return
      const order = [];
      const keep = (id) => { if (all[id] && !meltedIds[id] && order.indexOf(id) < 0) order.push(id); };
      bench.order.forEach(keep);
      const extra = (mb.loserOrder || []).concat(Object.keys(all)).filter((id) => all[id] && !meltedIds[id] && order.indexOf(id) < 0);
      extra.sort((a, b) => (all[a].createdAt || 0) - (all[b].createdAt || 0)).forEach((id) => { if (order.indexOf(id) < 0) order.unshift(id); });
      Object.keys(all).forEach((id) => {
        if (meltedIds[id] || order.indexOf(id) < 0) { delete all[id]; lsDel(K.ins + id); if (docs[id]) push.push(id); }
      });
      bench.order = order;
      real.bench = bench;
      real.instruments = all;
      cloud.active = true;
      writeLocalBench();
      schedule("bench");
      push.forEach(schedule);
      if (demo) {
        // real instruments shown on the example bench follow their merged copies
        Object.keys(demo.instruments).forEach((id) => { if (!demo.instruments[id].demo) { if (real.instruments[id]) demo.instruments[id] = real.instruments[id]; else { delete demo.instruments[id]; demo.bench.order = demo.bench.order.filter((x) => x !== id); } } });
      }
      emit("store:loaded", { mode: "cloud", count: all_().length });
      return true;
    })().catch((e) => { console.warn("[WB.store] cloud load failed", e); return false; });
    return cloud.promise;
  }

  /* ------------------------------------------------------------ persistence entry points */
  function persist(inst) {
    if (!inst || inst.demo) return;
    fitBudget(inst);
    writeLocalInst(inst);
    schedule(inst.id);
  }
  function saveBench() {
    real.bench.updatedAt = Math.max(now(), (real.bench.updatedAt || 0) + 1);
    writeLocalBench();
    schedule("bench");
    return real.bench;
  }

  /* ------------------------------------------------------------ demo */
  function buildDemo() {
    let list = [];
    try { list = WB.demo && typeof WB.demo.build === "function" ? WB.demo.build() || [] : []; } catch (e) { console.error("[WB.store] demo build", e); list = []; }
    const st = { bench: newBench(now()), instruments: {} };
    st.bench.profile.firstRunDone = true;
    list.forEach((inst) => { if (validInst(inst)) { inst.demo = true; st.instruments[inst.id] = normInst(inst); st.bench.order.push(inst.id); } });
    // real instruments stay visible on the example bench
    real.bench.order.forEach((id) => { if (real.instruments[id] && !st.instruments[id]) { st.instruments[id] = real.instruments[id]; st.bench.order.push(id); } });
    return st;
  }
  function enterDemo() {
    if (!inited) init();
    demo = buildDemo();
    lsSet(K.demo, "1");
    emit("store:loaded", { mode: "demo", count: all_().length });
    return api.state;
  }
  function exitDemo() {
    if (!demo) return api.state;
    demo = null;
    lsDel(K.demo);
    emit("store:loaded", { mode: mode(), count: all_().length });
    return api.state;
  }

  /* ------------------------------------------------------------ session */
  function sessionRecord() {
    const r = ses.real;
    if (!r.forged && !r.committed && !r.closed) return;
    const list = real.bench.sessions || (real.bench.sessions = []);
    let row = list.find((s) => s.at === bootAt);
    if (!row) { row = { at: bootAt, forged: 0, committed: 0, closed: 0 }; list.push(row); }
    row.forged = r.forged; row.committed = r.committed; row.closed = r.closed;
    if (list.length > 30) real.bench.sessions = list.slice(-30);
    saveBench();
  }
  function annualDelta(inst, it) {
    if (!inst || !it || !ANNUAL[inst.mold]) return 0;
    const d = moldDef(inst);
    if (!d || !d.outputs || !d.outputs[d.primary] || d.outputs[d.primary].format !== "usd") return 0;
    let target = it.target;
    const m = M();
    if (m && typeof m.ghost === "function") { try { const g = m.ghost(inst); if (isNum(g.target)) target = g.target; } catch (e) { /* stored target */ } }
    if (!isNum(it.baseline) || !isNum(target)) return 0;
    // only a step the right way counts as money in play; a worse number is never "steered"
    const delta = d.better === "higher" ? target - it.baseline : it.baseline - target;
    return delta > 0 ? delta : 0;
  }
  function bump(kind, inst, key) {
    if (key) { if (ses.keys[key]) return false; ses.keys[key] = 1; }
    ses[kind] += 1;
    if (inst && !inst.demo) { ses.real[kind] += 1; sessionRecord(); }
    if (kind === "committed" && inst) {
      ses.lastCommitId = inst.id;
      // a re-commit replaces that instrument's open promise instead of stacking on top of it
      ses.steeredBy[inst.id] = annualDelta(inst, inst.intention);
      ses.steeredUSD = Object.keys(ses.steeredBy).reduce((a, k) => a + ses.steeredBy[k], 0);
    }
    emit("session:set", { forged: ses.forged, committed: ses.committed, closed: ses.closed, steeredUSD: Math.round(ses.steeredUSD) });
    return true;
  }
  function noteCommit(id, intention) {
    if (!intention || !isNum(intention.committedAt)) return;
    const inst = find(id);
    if (inst && intention.committedAt >= bootAt - 1000) bump("committed", Object.assign({}, inst, { intention }), "c:" + id + ":" + intention.committedAt);
  }
  function session() { return { forged: ses.forged, committed: ses.committed, closed: ses.closed, ended: ses.ended }; }

  /* ------------------------------------------------------------ ledger */
  function keptFor(inst, g) {
    const after = (g.points || []).filter((p) => p.t > g.start && !p.hollow);
    if (!after.length || !isNum(g.baseline)) return 0;
    const d = moldDef(inst);
    if (!d) return 0;
    const last = after[after.length - 1].v;
    const delta = d.better === "lower" ? g.baseline - last : last - g.baseline;
    if (!(delta > 0)) return 0;
    if (ANNUAL[inst.mold]) {
      const span = Math.max(0, Math.min(now(), g.end || now()) - (g.start || now()));
      return delta * (span / (365 * DAY));
    }
    if (KEPT_DIRECT[inst.mold]) return delta;
    return 0;
  }
  function ledger() {
    let inPlayUSD = 0, keptUSD = 0, held = 0, total = 0, missed = 0, open = 0, closer = 0;
    const m = M();
    all_().forEach((inst) => {
      if (!inst.intention) return;
      total += 1;
      let g = null;
      try { g = m && typeof m.ghost === "function" ? m.ghost(inst) : null; } catch (e) { g = null; }
      const status = g ? g.status : inst.intention.status || "open";
      if (status === "held") { held += 1; if (g) keptUSD += keptFor(inst, g); }
      else if (status === "closer") { closer += 1; if (g) keptUSD += keptFor(inst, g); }
      else if (status === "missed") missed += 1;
      else { open += 1; inPlayUSD += annualDelta(inst, inst.intention); }
    });
    return { inPlayUSD: Math.round(inPlayUSD), keptUSD: Math.round(keptUSD * 100) / 100, held, total, missed, open, closer };
  }

  /* ------------------------------------------------------------ public API */
  function all_() {
    const st = active();
    return st.bench.order.map((id) => st.instruments[id]).filter(Boolean);
  }
  function get(id) { return id ? find(id) : null; }
  function mode() { return demo ? "demo" : cloud.active ? "cloud" : "local"; }

  function place(st, inst, front) {
    st.instruments[inst.id] = inst;
    if (st.bench.order.indexOf(inst.id) < 0) { if (front) st.bench.order.unshift(inst.id); else st.bench.order.push(inst.id); }
  }
  function upsert(inst) {
    if (!inited) init();
    if (!isObj(inst) || typeof inst.mold !== "string") return Promise.reject({ code: "unknown", message: "Not an instrument." });
    const next = normInst(clone(inst));
    if (typeof next.id !== "string" || !/^ins_/.test(next.id)) next.id = uid("ins");
    const prev = find(next.id);
    const isNew = !prev;
    if (prev && isNum(prev.createdAt)) next.createdAt = prev.createdAt;
    next.updatedAt = Math.max(now(), prev ? (prev.updatedAt || 0) + 1 : 0);
    if (next.demo) {
      if (demo) place(demo, next, true);
      else return Promise.resolve(next);   // nowhere to keep a demo instrument outside the example bench
    } else {
      place(real, next, true);
      if (isNew) saveBench();
      persist(next);
      if (demo) place(demo, next, true);
      if (isNew && !real.bench.profile.firstRunDone) { real.bench.profile.firstRunDone = true; saveBench(); }
    }
    emit("instrument:saved", { instrument: next, isNew });
    if (isNew) bump("forged", next, "f:" + next.id);
    return Promise.resolve(next);
  }

  function update(id, fn, source) {
    const cur = find(id);
    if (!cur) return null;
    const next = clone(cur);
    try { if (typeof fn === "function") fn(next); }
    catch (e) { console.error("[WB.store] update " + id + " failed", e); return null; }
    next.id = id;
    next.demo = !!cur.demo;
    normInst(next);
    next.updatedAt = Math.max(now(), (cur.updatedAt || 0) + 1);
    if (demo && demo.instruments[id]) demo.instruments[id] = next;
    if (real.instruments[id]) real.instruments[id] = next;
    persist(next);
    const src = ["scrub", "set", "enrich", "snap", "intention", "action", "mission", "system"].indexOf(source) >= 0 ? source : "system";
    emit("instrument:updated", { id, instrument: next, source: src });
    if (next.intention && (!cur.intention || cur.intention.committedAt !== next.intention.committedAt)) noteCommit(id, next.intention);
    return next;
  }

  function melt(id) {
    const inst = find(id);
    if (!inst) return Promise.resolve(false);
    const entry = { mold: inst.mold, kind: inst.kind, title: inst.title, at: now(), id: inst.id };
    const st = inst.demo ? demo : real;
    if (demo) { delete demo.instruments[id]; demo.bench.order = demo.bench.order.filter((x) => x !== id); }
    if (!inst.demo) {
      delete real.instruments[id];
      real.bench.order = real.bench.order.filter((x) => x !== id);
      lsDel(K.ins + id);
      if (cloud.active) schedule(id);
    }
    if (st) { st.bench.melted = (st.bench.melted || []).concat([entry]).slice(-50); }
    if (!inst.demo) saveBench();
    lastMelt = { inst: clone(inst), entry };
    emit("instrument:melted", { id, mold: inst.mold, kind: inst.kind, title: inst.title });
    return Promise.resolve(true);
  }
  /* extra: undo the last melt (the bench offers it in a toast) */
  function unmelt(id) {
    if (!lastMelt || lastMelt.inst.id !== id) return Promise.resolve(null);
    const { inst, entry } = lastMelt;
    lastMelt = null;
    const st = inst.demo ? demo : real;
    if (!st) return Promise.resolve(null);
    st.bench.melted = (st.bench.melted || []).filter((m) => !(m.id === entry.id && m.at === entry.at));
    if (inst.demo) { place(demo, inst, true); emit("instrument:saved", { instrument: inst, isNew: false }); return Promise.resolve(inst); }
    if (cloud.active && pend[id] && pend[id].timer) { clearTimeout(pend[id].timer); pend[id].timer = 0; }
    place(real, inst, true);
    if (demo) place(demo, inst, true);
    saveBench();
    persist(inst);
    emit("instrument:saved", { instrument: inst, isNew: false });
    return Promise.resolve(inst);
  }
  function melted() { return (real.bench.melted || []).map((m) => ({ mold: m.mold, kind: m.kind, title: m.title, at: m.at })); }

  function addObservation(id, obs) {
    if (!isObj(obs)) return null;
    const o = { t: isNum(obs.t) ? obs.t : now(), value: obs.value, facts: isObj(obs.facts) ? obs.facts : {},
      source: ["photo", "email", "mission", "manual"].indexOf(obs.source) >= 0 ? obs.source : "manual", note: obs.note || null };
    if (obs.hollow) o.hollow = true;
    const src = { photo: "snap", email: "enrich", mission: "mission" }[o.source] || "system";
    const r = update(id, (i) => {
      i.observations = (i.observations || []).concat([o]).sort((a, b) => a.t - b.t).slice(-60);
    }, src);
    // a loop closes when reality reports back on a promise: a decisive reading that lands after the commit
    const it = r && r.intention;
    if (it && !o.hollow && isNum(it.committedAt) && o.t > it.committedAt) bump("closed", r, "o:" + id + ":" + it.committedAt);
    return r;
  }
  function setIntention(id, intention) {
    return update(id, (i) => { i.intention = intention ? clone(intention) : null; }, "intention");
  }
  function addAction(id, action) {
    const a = Object.assign({ type: "remember", status: "prepared", payload: {}, result: null }, isObj(action) ? action : {});
    if (!a.id) a.id = uid("act");
    if (!isNum(a.at)) a.at = now();
    const r = update(id, (i) => {
      const list = (i.actions || []).filter((x) => x && x.id !== a.id);
      i.actions = list.concat([a]).slice(-20);
    }, "action");
    return r ? clone(a) : null;
  }

  async function putPhoto(file, role) {
    const ai = WB.ai || {};
    const r = ["hero", "snap", "before", "after"].indexOf(role) >= 0 ? role : "hero";
    let prep = null;
    if (typeof ai.prepImage === "function") prep = await ai.prepImage(file);
    else prep = await localPrep(file);
    let up = null;
    if (typeof ai.upload === "function") { try { up = await ai.upload(prep.blob); } catch (e) { up = null; } }
    let src, assetId = null;
    if (up && up.url) { src = up.url; assetId = up.id || null; }
    else {
      try { src = typeof ai.shrink === "function" ? await ai.shrink(prep.blob, 900, 0.65) : await encode(prep.blob, 900, 0.65); }
      catch (e) { src = prep.thumb; }
    }
    return { src, assetId, thumb: prep.thumb, w: prep.w, h: prep.h, at: now(), role: r };
  }
  /* minimal local image path, only used if WB.ai is missing */
  async function decode(blob) {
    if (typeof createImageBitmap === "function") return createImageBitmap(blob);
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
      img.src = url;
    });
  }
  function canvasFor(img, max) {
    const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  async function encode(blob, max, q) { const img = await decode(blob); return canvasFor(img, max).toDataURL("image/jpeg", q); }
  async function localPrep(file) {
    const img = await decode(file);
    const big = canvasFor(img, 1600);
    const out = await new Promise((res) => big.toBlob((b) => res(b), "image/jpeg", 0.82));
    return { blob: out || file, thumb: canvasFor(img, 480).toDataURL("image/jpeg", 0.7), w: big.width, h: big.height };
  }

  /* ------------------------------------------------------------ init / load */
  function wire() {
    const bus = WB.bus;
    if (!bus) return;
    bus.on("intention:created", (p) => { if (p && p.id && p.intention) noteCommit(p.id, p.intention); });
    // a prepared act (.ics, draft, Drive file, "just remember it") is not a closed loop: nothing has happened in the
    // world yet. Loops close on a verified mission, or when a decisive reading lands after a commit (addObservation).
    bus.on("mission:done", (p) => {
      const m = p && p.mission;
      if (!m || !m.verified) return;
      const inst = find(p && p.id);
      const it = inst && inst.intention;
      bump("closed", inst, it && isNum(it.committedAt) ? "o:" + inst.id + ":" + it.committedAt : "m:" + (m.id || p.id || ""));
    });
    try {
      window.addEventListener("pagehide", flushAll);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); });
    } catch (e) { /* no window */ }
  }
  function init() {
    if (inited) return;
    inited = true;
    readLocal();
    const p = real.bench.profile;
    if (p.lastOpenAt && p.lastOpenAt < bootAt) p.prevOpenAt = p.lastOpenAt;
    p.lastOpenAt = bootAt;
    writeLocalBench();
    if (lsGet(K.demo) === "1") demo = buildDemo();
    wire();
    emit("store:loaded", { mode: demo ? "demo" : "local", count: all_().length });
    startCloud();
  }
  function load() {
    if (!inited) init();
    return startCloud().then(() => api.state, () => api.state);
  }

  const api = {
    init, load, all: all_, get, upsert, update, melt, melted, addObservation, setIntention, addAction, saveBench, mode,
    enterDemo, exitDemo, session, ledger, putPhoto,
    /* extras beyond the contract */
    unmelt, flush: flushAll, isDemo: () => !!demo, profile: () => real.bench.profile,
    markEnded() { ses.ended = true; return session(); },
    /* undo of a commit made this session: it no longer counts as a future committed, or as money in play */
    forgetCommit(id, committedAt, prev) {
      const key = "c:" + id + ":" + committedAt;
      if (!ses.keys[key]) return session();
      delete ses.keys[key];
      ses.committed = Math.max(0, ses.committed - 1);
      const inst = find(id);
      if (inst && !inst.demo) { ses.real.committed = Math.max(0, ses.real.committed - 1); sessionRecord(); }
      if (prev && isNum(prev.committedAt) && prev.committedAt >= bootAt - 1000 && inst) ses.steeredBy[id] = annualDelta(inst, prev);
      else delete ses.steeredBy[id];
      ses.steeredUSD = Object.keys(ses.steeredBy).reduce((a, k) => a + ses.steeredBy[k], 0);
      if (ses.lastCommitId === id && !(prev && prev.committedAt >= bootAt - 1000)) ses.lastCommitId = null;
      emit("session:set", { forged: ses.forged, committed: ses.committed, closed: ses.closed, steeredUSD: Math.round(ses.steeredUSD) });
      return session();
    },
    lastCommit: () => (ses.lastCommitId ? find(ses.lastCommitId) : null),
    steered: () => Math.round(ses.steeredUSD),
    cloud: () => cloud.active,
    _test: { fitBudget, mergeBench, normBench, keptFor, annualDelta, bootAt },
  };
  Object.defineProperty(api, "state", { enumerable: true, get() { const st = active(); return { bench: st.bench, instruments: st.instruments }; } });
  WB.store = api;
})();
