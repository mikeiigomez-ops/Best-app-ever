/* Upscroll — state, progression, spaced repetition, persistence. */
(function () {
  const UP = window.UP;
  const { now, dayKey, daysBetween, DAY, MIN, mulberry, hash, debounce, safeStorage } = UP;

  const LS_KEY = "upscroll.v1";
  const LS_AI = "upscroll.ai.v1";

  /* ---------- event bus ---------- */
  const handlers = {};
  const bus = {
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    emit(name, data) { (handlers[name] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); },
  };

  function fresh() {
    return {
      v: 1,
      createdAt: now(),
      updatedAt: 0,
      onboarded: false,
      settings: { sound: true, haptics: true, dailyGoal: 150 },
      goals: [],
      interests: [],
      xp: 0,
      days: {},
      streak: { count: 0, last: "", best: 0, freezes: 1 },
      snooze: {},
      golden: 0,
      combo: 0,
      bestCombo: 0,
      srs: {},
      seen: {},
      affinity: {},
      kindAffinity: {},
      stats: {
        cards: 0, answered: 0, correct: 0, reviews: 0, reviewsCorrect: 0,
        estimates: 0, estErr: 0, bullseyes: 0, deeds: 0, breaths: 0,
        captures: 0, reflects: 0, sprintBest: 0, sprints: 0, chests: 0, secs: 0,
      },
      vault: [],
      journal: [],
      holes: [],
      quests: null,
      lastBrief: "",
      oneThing: null,
    };
  }

  let state = fresh();
  let aiCards = {}; // id -> card, kept in its own record (it can grow)

  /* ---------- levels ---------- */
  const TITLES = [
    "Spark", "Kindling", "Ember", "Flame", "Torch", "Lantern", "Beacon", "Lighthouse",
    "Comet", "Star", "Binary Star", "Constellation", "Nebula", "Star Cluster", "Galaxy",
    "Supercluster", "Cosmic Web", "Quasar", "Singularity", "Universe",
  ];
  function levelInfo(xp) {
    let level = 1, floor = 0, need = 150;
    while (xp >= floor + need) {
      floor += need;
      level++;
      need = 150 + 70 * (level - 1);
    }
    return { level, floor, need, into: xp - floor, pct: (xp - floor) / need, title: TITLES[Math.min(level - 1, TITLES.length - 1)] };
  }

  function today() {
    const k = dayKey();
    if (!state.days[k]) state.days[k] = { xp: 0, cards: 0, learned: 0, deeds: 0, secs: 0 };
    return state.days[k];
  }

  /* ---------- streak ---------- */
  const STREAK_MIN = 30; // XP in a day that keeps the streak alive
  function touchStreak() {
    const t = dayKey();
    const s = state.streak;
    if (s.last === t) return;
    if (today().xp < STREAK_MIN) return;
    const gap = s.last ? daysBetween(s.last, t) : 999;
    if (gap <= 0) return; // clock or timezone moved backwards: keep the streak as is
    let usedFreeze = 0;
    if (gap === 1) s.count += 1;
    else if (gap > 1 && gap - 1 <= s.freezes && s.count > 0) {
      usedFreeze = gap - 1;
      s.freezes -= usedFreeze;
      s.count += 1;
    } else s.count = 1;
    s.last = t;
    s.best = Math.max(s.best, s.count);
    bus.emit("streak", { count: s.count, usedFreeze });
  }
  function streakAlive() {
    const s = state.streak;
    if (!s.last) return 0;
    const gap = daysBetween(s.last, dayKey());
    if (gap <= 1) return s.count;
    if (gap - 1 <= s.freezes) return s.count; // will be saved by freezes
    return 0;
  }

  /* ---------- xp ---------- */
  function award(amount, meta = {}) {
    amount = Math.max(0, Math.round(amount));
    if (!amount) return 0;
    const before = levelInfo(state.xp).level;
    const goalBefore = today().xp >= state.settings.dailyGoal;
    state.xp += amount;
    today().xp += amount;
    touchStreak();
    const after = levelInfo(state.xp);
    bus.emit("xp", { amount, ...meta });
    if (after.level > before) bus.emit("level", after);
    if (!goalBefore && today().xp >= state.settings.dailyGoal) {
      let freeze = false;
      if ((state.streak.freezes || 0) < 2 && state.streak.count >= 2) { state.streak.freezes = (state.streak.freezes || 0) + 1; freeze = true; }
      bus.emit("goal", { freeze });
    }
    save();
    return amount;
  }

  function comboHit(ok) {
    if (ok) {
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
    } else state.combo = 0;
    bus.emit("combo", state.combo);
    questProgress("combo", state.combo, true);
    return state.combo;
  }
  const comboMult = () => 1 + Math.min(state.combo, 10) * 0.1;

  /* ---------- spaced repetition (Leitner boxes with real intervals) ---------- */
  const BOX_MS = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY, 80 * DAY, 180 * DAY];
  const MASTERED = 6; // survived a gap of about five weeks
  const STRONG = 4;
  function srsGrade(id, ok, kind) {
    const existing = state.srs[id];
    if (existing && ok && existing.n >= 2 && existing.d > now()) return existing; // not due yet: a right answer doesn't skip ahead
    const r = existing || { b: 0, d: 0, n: 0, ok: 0, l: 0, k: kind, f: now() };
    r.n += 1;
    if (ok) {
      r.ok += 1;
      // credit the real gap: remembering something after 40 days counts as surviving 40 days
      const elapsed = existing ? now() - (r.seenAt || r.f || now()) : 0;
      let earned = r.b + 1;
      while (earned < BOX_MS.length - 1 && elapsed > BOX_MS[earned] * 1.5) earned++;
      r.b = Math.min(earned, BOX_MS.length - 1);
    } else {
      r.l += 1;
      r.b = Math.max(0, r.b - 2); // a slip costs a couple of steps, not everything
    }
    r.seenAt = now();
    // first exposure answered correctly still gets a same-session check
    const wait = r.n === 1 ? BOX_MS[0] : BOX_MS[Math.max(0, r.b - (ok ? 1 : 0))];
    r.d = now() + wait * (0.9 + Math.random() * 0.2);
    r.k = kind || r.k;
    state.srs[id] = r;
    save();
    return r;
  }
  function dueReviews() {
    const t = now();
    return Object.entries(state.srs)
      .filter(([, r]) => r.d <= t)
      .sort((a, b) => a[1].d - b[1].d)
      .map(([id]) => id);
  }
  const mastered = () => Object.values(state.srs).filter((r) => r.b >= MASTERED).length;

  /* ---------- daily quests ---------- */
  const QUEST_POOL = [
    { type: "learn", target: 5, label: "Learn 5 new things" },
    { type: "review", target: 3, label: "Nail 3 memory checks" },
    { type: "deed", target: 2, label: "Do 2 real-world quests" },
    { type: "bullseye", target: 1, label: "Estimate within 25%" },
    { type: "capture", target: 1, label: "Get 1 thing out of your head" },
    { type: "reflect", target: 1, label: "Write 1 journal line" },
    { type: "breathe", target: 1, label: "Finish a breathing round" },
    { type: "combo", target: 5, label: "Hit a 5x streak of right answers" },
    { type: "sprint", target: 1, label: "Play a math sprint" },
    { type: "word", target: 2, label: "Learn 2 new words" },
  ];
  function ensureQuests() {
    const k = dayKey();
    if (state.quests && state.quests.day === k) return state.quests;
    const rng = mulberry(hash(k + state.createdAt));
    const pool = QUEST_POOL.slice();
    const hasDue = dueReviews().length >= 3;
    const list = [];
    while (list.length < 3 && pool.length) {
      const i = Math.floor(rng() * pool.length);
      const q = pool.splice(i, 1)[0];
      if (q.type === "review" && !hasDue) continue;
      list.push({ ...q, progress: 0, done: false });
    }
    state.quests = { day: k, list, bonus: false };
    return state.quests;
  }
  function questProgress(type, amount = 1, absolute = false) {
    const qs = ensureQuests();
    for (const q of qs.list) {
      if (q.type !== type || q.done) continue;
      q.progress = absolute ? Math.max(q.progress, amount) : q.progress + amount;
      if (q.progress >= q.target) {
        q.progress = q.target;
        q.done = true;
        bus.emit("quest", q);
        award(30, { reason: "Quest: " + q.label });
      }
    }
    if (!qs.bonus && qs.list.length && qs.list.every((q) => q.done)) {
      qs.bonus = true;
      bus.emit("allquests", {});
    }
  }

  /* ---------- affinity (the feed learns what you lean into) ---------- */
  function lean(topic, kind, amt) {
    if (topic) state.affinity[topic] = Math.max(-3, Math.min(5, (state.affinity[topic] || 0) + amt));
    if (kind) state.kindAffinity[kind] = Math.max(-3, Math.min(5, (state.kindAffinity[kind] || 0) + amt));
    save();
  }

  /* ---------- vault ---------- */
  function addVault(kind, text, extra = {}) {
    const item = { id: UP.uid("v"), kind, text: String(text).trim().slice(0, 600), createdAt: now(), done: false, ...extra };
    if (!item.text) return null;
    state.vault.unshift(item);
    if (state.vault.length > 800) state.vault.length = 800;
    save();
    bus.emit("vault", item);
    return item;
  }
  function addJournal(prompt, text) {
    const e = { id: UP.uid("j"), prompt, text: String(text).trim().slice(0, 1200), createdAt: now(), back: 0 };
    if (!e.text) return null;
    state.journal.unshift(e);
    if (state.journal.length > 500) state.journal.length = 500;
    save();
    bus.emit("vault", e);
    return e;
  }

  /* ---------- persistence: local first, synced to the artifact db when present ----------
     The cloud copy is merged field by field (never last-writer-wins on the whole object),
     and merged INTO the live state object so every reference the UI holds stays valid. */
  const ls = safeStorage();
  let db = null, userId = null, remoteReady = false;

  function load() {
    if (!ls) return;
    try {
      const raw = ls.getItem(LS_KEY);
      if (raw) state = merge(fresh(), JSON.parse(raw));
      const rawAi = ls.getItem(LS_AI);
      if (rawAi) aiCards = JSON.parse(rawAi) || {};
    } catch (e) {
      console.warn("Upscroll: could not read saved progress", e);
    }
  }
  function merge(base, saved) {
    for (const k of Object.keys(saved || {})) {
      if (base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) && saved[k] && typeof saved[k] === "object" && !Array.isArray(saved[k]) && k !== "srs" && k !== "days" && k !== "seen" && k !== "affinity" && k !== "kindAffinity") {
        base[k] = Object.assign(base[k], saved[k]);
      } else base[k] = saved[k];
    }
    return base;
  }

  // Combine a remote snapshot into the live state. Returns true when anything changed.
  function absorb(remote) {
    const L = state;
    const before = JSON.stringify(L);
    const remoteNewer = (remote.updatedAt || 0) > (L.updatedAt || 0);
    const maxNum = (a, b) => Math.max(a || 0, b || 0);
    L.xp = maxNum(L.xp, remote.xp);
    L.bestCombo = maxNum(L.bestCombo, remote.bestCombo);
    L.onboarded = !!(L.onboarded || remote.onboarded);
    L.createdAt = Math.min(L.createdAt || now(), remote.createdAt || now());
    for (const [k, d] of Object.entries(remote.days || {})) {
      const mine = L.days[k] || (L.days[k] = { xp: 0, cards: 0, learned: 0, deeds: 0, secs: 0 });
      for (const f of Object.keys(d)) mine[f] = maxNum(mine[f], d[f]);
    }
    for (const [k, v] of Object.entries(remote.stats || {})) L.stats[k] = maxNum(L.stats[k], v);
    for (const [id, r] of Object.entries(remote.srs || {})) {
      const mine = L.srs[id];
      if (!mine || (r.n || 0) > (mine.n || 0)) L.srs[id] = r;
    }
    for (const [id, t] of Object.entries(remote.seen || {})) L.seen[id] = maxNum(L.seen[id], t);
    const rs = remote.streak || {}, ms = L.streak;
    if ((rs.last || "") > (ms.last || "") || ((rs.last || "") === (ms.last || "") && (rs.count || 0) > (ms.count || 0))) {
      ms.count = rs.count || 0; ms.last = rs.last || "";
    }
    ms.best = maxNum(ms.best, rs.best);
    if (remoteNewer && rs.freezes != null) ms.freezes = rs.freezes;
    // lists keyed by id: union, keeping the live objects and folding in the other side's progress
    const unite = (mineList, theirs, fold) => {
      const byId = new Map(mineList.map((x) => [x.id, x]));
      for (const t of theirs || []) {
        const m = byId.get(t.id);
        if (!m) { mineList.push(t); byId.set(t.id, t); }
        else fold(m, t);
      }
      mineList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    };
    unite(L.vault, remote.vault, (m, t) => {
      m.done = !!(m.done || t.done); m.archived = !!(m.archived || t.archived);
      m.rewarded = !!(m.rewarded || t.rewarded);
      m.r = maxNum(m.r, t.r); m.doneAt = m.doneAt || t.doneAt || null;
      if (!m.step && t.step) m.step = t.step;
    });
    unite(L.journal, remote.journal, (m, t) => { m.back = maxNum(m.back, t.back); });
    unite(L.holes, remote.holes, (m, t) => {
      if ((t.count || 0) > (m.count || 0)) { m.count = t.count; m.headlines = t.headlines || m.headlines; }
      const q = new Set(m.queue || []);
      for (const id of t.queue || []) if (!q.has(id)) (m.queue = m.queue || []).push(id);
      if (remoteNewer) m.active = t.active;
    });
    if (remoteNewer) {
      for (const k of ["settings", "goals", "interests", "affinity", "kindAffinity"]) if (remote[k]) L[k] = k === "settings" ? Object.assign(L.settings, remote[k]) : remote[k];
    }
    if (remote.quests && (!L.quests || remote.quests.day > L.quests.day || (remote.quests.day === L.quests.day && remoteNewer))) L.quests = remote.quests;
    if (remote.oneThing && (!L.oneThing || remote.oneThing.day > L.oneThing.day || (remote.oneThing.day === L.oneThing.day && remote.oneThing.done))) L.oneThing = remote.oneThing;
    if ((remote.lastBrief || "") > (L.lastBrief || "")) L.lastBrief = remote.lastBrief;
    return JSON.stringify(L) !== before;
  }

  function trimSeen() {
    const keys = Object.keys(state.seen);
    if (keys.length > 1500) {
      keys.sort((a, b) => state.seen[a] - state.seen[b]);
      for (const k of keys.slice(0, keys.length - 1200)) delete state.seen[k];
    }
    const aiKeys = Object.keys(aiCards);
    if (aiKeys.length > 240) {
      aiKeys.sort((a, b) => (aiCards[a].at || 0) - (aiCards[b].at || 0));
      for (const k of aiKeys.slice(0, aiKeys.length - 220)) {
        if (!state.srs[k]) { delete aiCards[k]; aiDirty = true; }
      }
    }
  }

  let aiDirty = true, warnedFull = false;
  function writeLocal() {
    if (!ls) return;
    try {
      ls.setItem(LS_KEY, JSON.stringify(state));
      if (aiDirty) { ls.setItem(LS_AI, JSON.stringify(aiCards)); aiDirty = false; }
    } catch (e) {
      // storage full: drop the cheapest history and try once more, then tell the person
      const keys = Object.keys(state.seen);
      keys.sort((a, b) => state.seen[a] - state.seen[b]).slice(0, Math.floor(keys.length / 2)).forEach((k) => delete state.seen[k]);
      try { ls.setItem(LS_KEY, JSON.stringify(state)); } catch (e2) {
        if (!warnedFull) { warnedFull = true; bus.emit("storagefull", {}); }
      }
    }
  }
  const writeLocalSoon = debounce(writeLocal, 400);
  const markAi = () => { aiDirty = true; };

  /* The cloud copy is split into documents well under the per-document size cap:
     main (scalars), srs-N, vault-N, journal-N, ai-N. Only documents whose content changed are written. */
  const CHUNK = { srs: 900, vault: 120, journal: 90, ai: 80 };
  const lastWritten = {};
  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out.length ? out : [[]];
  }
  function snapshotDocs() {
    const docs = {};
    const { vault, journal, srs, ...rest } = state;
    const parts = {
      srs: chunk(Object.entries(srs), CHUNK.srs),
      vault: chunk(vault, CHUNK.vault),
      journal: chunk(journal, CHUNK.journal),
      ai: chunk(Object.values(aiCards), CHUNK.ai),
    };
    const counts = {};
    for (const [name, list] of Object.entries(parts)) {
      counts[name] = list.length;
      list.forEach((items, i) => { docs[name + "-" + i] = { items }; });
    }
    docs.main = { ...rest, chunks: counts };
    return docs;
  }
  let pushing = null;
  async function pushNow() {
    if (!db || !userId || !remoteReady) return;
    if (pushing) { await pushing; }
    pushing = (async () => {
      const col = db.collection("data/users/" + userId);
      const docs = snapshotDocs();
      try {
        for (const [name, data] of Object.entries(docs)) {
          const json = JSON.stringify(data);
          if (lastWritten[name] === json) continue;
          await col.doc(name).set(JSON.parse(json));
          lastWritten[name] = json;
        }
        bus.emit("synced", {});
      } catch (e) {
        console.warn("Upscroll: sync failed", e && (e.code || e.message));
      }
    })();
    try { await pushing; } finally { pushing = null; }
  }
  const pushRemote = debounce(pushNow, 3000);

  function save() {
    state.updatedAt = now();
    trimSeen();
    writeLocalSoon();
    pushRemote();
  }
  function flush() {
    state.updatedAt = state.updatedAt || now();
    writeLocal();
    return pushNow();
  }

  async function readRemote(col) {
    const main = await col.doc("main").get();
    if (!main || !main.exists) return null;
    const m = main.data();
    const counts = m.chunks || {};
    const read = async (name) => {
      const n = counts[name] || 0;
      const snaps = await Promise.all(Array.from({ length: n }, (_, i) => col.doc(name + "-" + i).get()));
      return snaps.flatMap((sn) => (sn && sn.exists && Array.isArray(sn.data().items) ? sn.data().items : []));
    };
    const [srs, vault, journal, ai] = await Promise.all([read("srs"), read("vault"), read("journal"), read("ai")]);
    delete m.chunks;
    return { ...m, srs: Object.fromEntries(srs), vault, journal, ai };
  }

  async function attachDb() {
    if (!window.claude || !window.claude.use) return;
    try {
      const [dbNs, userNs] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
      if (!dbNs || !userNs) return;
      const id = await userNs.id();
      if (!id) return;
      db = dbNs;
      userId = id;
      const remote = await readRemote(db.collection("data/users/" + userId));
      let changed = false;
      if (remote) {
        for (const c of remote.ai || []) if (c && c.id && !aiCards[c.id]) { aiCards[c.id] = c; changed = true; aiDirty = true; }
        delete remote.ai;
        changed = absorb(remote) || changed;
        if (changed) writeLocal();
      }
      remoteReady = true;
      await pushNow();
      if (changed) bus.emit("remote", {});
      bus.emit("synced", {});
    } catch (e) {
      console.warn("Upscroll: cloud save unavailable", e && (e.code || e.message));
    }
  }

  // Erase in place (so live references stay valid), and wait for the cloud copy before returning.
  async function reset() {
    const f = fresh();
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, f);
    for (const k of Object.keys(aiCards)) delete aiCards[k];
    aiDirty = true;
    state.updatedAt = now();
    writeLocal();
    if (db && userId && remoteReady) {
      const col = db.collection("data/users/" + userId);
      for (const k of Object.keys(lastWritten)) delete lastWritten[k];
      try {
        // overwrite every chunk the old state may have used
        for (const name of ["srs", "vault", "journal", "ai"]) for (let i = 0; i < 12; i++) await col.doc(name + "-" + i).set({ items: [] });
      } catch (e) { /* best effort */ }
      await pushNow();
    }
  }

  load();
  ensureQuests();

  UP.bus = bus;
  Object.defineProperty(UP, "state", { get: () => state, set: (v) => { state = v; }, configurable: true });
  Object.defineProperty(UP, "aiCards", { get: () => aiCards, configurable: true });
  UP.store = {
    save, flush, markAi, attachDb, reset, award, comboHit, comboMult, levelInfo, today, srsGrade, dueReviews, mastered,
    ensureQuests, questProgress, lean, STRONG, addVault, addJournal, streakAlive, MASTERED, STREAK_MIN, TITLES,
    hasCloud: () => !!(db && userId),
  };
})();
