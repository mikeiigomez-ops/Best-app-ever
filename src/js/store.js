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
    let level = 1, floor = 0, need = 100;
    while (xp >= floor + need) {
      floor += need;
      level++;
      need = 100 + 45 * (level - 1);
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
    if (!goalBefore && today().xp >= state.settings.dailyGoal) bus.emit("goal", {});
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
  const MASTERED = 4;
  function srsGrade(id, ok, kind) {
    const r = state.srs[id] || { b: 0, d: 0, n: 0, ok: 0, l: 0, k: kind, f: now() };
    r.n += 1;
    if (ok) {
      r.ok += 1;
      r.b = Math.min(r.b + 1, BOX_MS.length - 1);
    } else {
      r.l += 1;
      r.b = 0;
    }
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

  /* ---------- persistence: local first, synced to the artifact db when present ---------- */
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
        if (!state.srs[k]) delete aiCards[k];
      }
    }
  }

  function writeLocal() {
    if (!ls) return;
    try {
      ls.setItem(LS_KEY, JSON.stringify(state));
      ls.setItem(LS_AI, JSON.stringify(aiCards));
    } catch (e) { /* quota or blocked: the db copy still holds it */ }
  }

  const pushRemote = debounce(async () => {
    if (!db || !userId || !remoteReady) return;
    try {
      const col = db.collection("data/users/" + userId);
      await col.doc("main").set(JSON.parse(JSON.stringify(state)));
      await col.doc("ai").set({ updatedAt: state.updatedAt, cards: aiCards });
      bus.emit("synced", {});
    } catch (e) {
      console.warn("Upscroll: sync failed", e && (e.code || e.message));
    }
  }, 3500);

  function save() {
    state.updatedAt = now();
    trimSeen();
    writeLocal();
    pushRemote();
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
      const col = db.collection("data/users/" + userId);
      const [main, ai] = await Promise.all([col.doc("main").get(), col.doc("ai").get()]);
      const remote = main && main.exists ? main.data() : null;
      if (remote && (remote.updatedAt || 0) > (state.updatedAt || 0)) {
        state = merge(fresh(), remote);
        if (ai && ai.exists && ai.data().cards) aiCards = ai.data().cards;
        writeLocal();
        remoteReady = true;
        bus.emit("remote", {});
      } else {
        remoteReady = true;
        if (state.updatedAt) pushRemote();
      }
      bus.emit("synced", {});
    } catch (e) {
      console.warn("Upscroll: cloud save unavailable", e && (e.code || e.message));
    }
  }

  function reset() {
    state = fresh();
    aiCards = {};
    UP.state = state;
    save();
  }

  load();
  ensureQuests();

  UP.bus = bus;
  Object.defineProperty(UP, "state", { get: () => state, set: (v) => { state = v; }, configurable: true });
  Object.defineProperty(UP, "aiCards", { get: () => aiCards, configurable: true });
  UP.store = {
    save, attachDb, reset, award, comboHit, comboMult, levelInfo, today, srsGrade, dueReviews, mastered,
    ensureQuests, questProgress, lean, addVault, addJournal, streakAlive, MASTERED, STREAK_MIN, TITLES,
    hasCloud: () => !!(db && userId),
  };
})();
