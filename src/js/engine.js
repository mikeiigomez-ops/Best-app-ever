/* Upscroll — the feed algorithm. It optimizes for what you get out of a session, not for time on app. */
(function () {
  const UP = window.UP;
  const { now, DAY, MIN, weighted, pick, rand } = { ...UP, rand: Math.random };

  const C = () => window.UP_CONTENT || {};

  const TOPICS = {
    space: { label: "Space", hue: 230 },
    science: { label: "Science", hue: 190 },
    earth: { label: "Earth", hue: 160 },
    nature: { label: "Nature", hue: 120 },
    body: { label: "Body", hue: 8 },
    history: { label: "History", hue: 35 },
    money: { label: "Money", hue: 50 },
    mind: { label: "Mind", hue: 280 },
    tech: { label: "Tech", hue: 205 },
    culture: { label: "Culture", hue: 330 },
    skills: { label: "Life skills", hue: 140 },
    words: { label: "Words", hue: 345 },
    holes: { label: "Rabbit holes", hue: 265 },
  };

  const GOALS = {
    mind: { label: "Sharpen my mind", sub: "Facts, mental models, estimation" },
    body: { label: "Move more", sub: "Tiny movement breaks between cards" },
    order: { label: "Get my life in order", sub: "Capture tasks, small admin wins" },
    calm: { label: "Feel calmer", sub: "Breathing, journaling, grounding" },
    people: { label: "Stay close to people", sub: "Nudges to reach out" },
    words: { label: "Speak sharper", sub: "Useful words, used well" },
  };

  const FILTERS = {
    mix: null,
    learn: new Set(["fact", "review", "ai", "estimate", "word", "sprint"]),
    do: new Set(["action", "capture", "task", "idea", "question", "breathe"]),
    calm: new Set(["breathe", "reflect", "capsule", "calmaction"]),
  };
  const DO_KINDS = new Set(["action", "breathe", "capture", "reflect", "task", "idea", "question", "capsule", "sprint"]);

  let chestGap = 11, sinceChest = 0, nextChestAt = 11 + Math.floor(rand() * 4);
  let sinceReceipt = 0, sinceReview = 0, sinceOne = 8;
  const sessionUsed = new Set();
  const session = { start: now(), cards: 0, learned: 0, correct: 0, answered: 0, deeds: 0, captures: 0, xp: 0, words: 0, stars: 0 };

  function goals() { return new Set(UP.state.goals || []); }
  function openQuest(type) { const q = UP.state.quests; return !!(q && q.list.some((x) => x.type === type && !x.done)); }

  function lastKinds(history, n) { return history.slice(-n).map((s) => s.kind); }

  function topicWeight(topic) {
    const st = UP.state;
    const interested = st.interests && st.interests.length ? (st.interests.includes(topic) ? 2.6 : 0.7) : 1;
    const aff = st.affinity[topic] || 0;
    return interested * Math.max(0.2, 1 + 0.22 * aff);
  }

  /* ---------- per-kind item pickers ---------- */
  function pickFact() {
    const facts = C().facts || [];
    const st = UP.state;
    let pool = facts.filter((f) => !st.srs[f.id] && !sessionUsed.has(f.id) && !f.legendary);
    if (!pool.length) pool = facts.filter((f) => !sessionUsed.has(f.id) && !f.legendary);
    if (!pool.length) return null;
    const f = weighted(pool.map((f) => [f, topicWeight(f.topic)]));
    if (!f) return null;
    const read = (st.stats.answered || 0) > 5 && rand() < 0.35;
    return { kind: "fact", id: f.id, data: f, read };
  }
  function pickLegendary() {
    const facts = (C().facts || []).filter((f) => f.legendary);
    const st = UP.state;
    let pool = facts.filter((f) => !st.srs[f.id] && !sessionUsed.has(f.id));
    if (!pool.length) pool = facts.filter((f) => !sessionUsed.has(f.id));
    if (!pool.length) return null;
    const f = weighted(pool.map((f) => [f, topicWeight(f.topic)]));
    return { kind: "fact", id: f.id, data: f, legendary: true };
  }
  function leastRecent(list, filter) {
    const st = UP.state;
    const pool = list.filter((x) => !sessionUsed.has(x.id) && (!filter || filter(x)));
    if (!pool.length) return null;
    const unseen = pool.filter((x) => !st.seen[x.id]);
    if (unseen.length) return pick(unseen);
    pool.sort((a, b) => (st.seen[a.id] || 0) - (st.seen[b.id] || 0));
    return pick(pool.slice(0, Math.max(1, Math.ceil(pool.length / 4))));
  }
  function pickEstimate() {
    const list = C().estimates || [];
    const e = weightedFresh(list, (x) => topicWeight(x.topic));
    return e && { kind: "estimate", id: e.id, data: e };
  }
  function weightedFresh(list, wfn) {
    const st = UP.state;
    let pool = list.filter((x) => !sessionUsed.has(x.id) && !st.seen[x.id]);
    if (!pool.length) {
      const all = list.filter((x) => !sessionUsed.has(x.id)).sort((a, b) => (st.seen[a.id] || 0) - (st.seen[b.id] || 0));
      pool = all.slice(0, Math.max(1, Math.ceil(all.length / 3)));
    }
    if (!pool.length) return null;
    return weighted(pool.map((x) => [x, wfn ? wfn(x) : 1]));
  }
  function pickWord() {
    const st = UP.state;
    const list = (C().words || []).filter((w) => !st.srs[w.id] && !sessionUsed.has(w.id));
    if (!list.length) return null;
    const w = pick(list);
    return { kind: "word", id: w.id, data: w };
  }
  function pickAction(calmOnly) {
    const g = goals();
    const st = UP.state;
    const hr = new Date().getHours();
    const night = hr >= 22 || hr < 6;
    const snoozed = st.snooze || {};
    const list = (C().actions || []).filter((a) => a.cat !== "breathe" && (!calmOnly || a.cat === "mind") &&
      !(snoozed[a.id] > now()) && !(night && (a.cat === "body" || a.cat === "life" || a.cat === "social")));
    const fresh = list.filter((a) => !sessionUsed.has(a.id) && (!st.seen[a.id] || now() - st.seen[a.id] > 2 * DAY));
    const pool = fresh.length ? fresh : list.filter((a) => !sessionUsed.has(a.id));
    if (!pool.length) return null;
    const catW = { body: g.has("body") ? 3 : 1, life: g.has("order") ? 3 : 1, focus: g.has("order") ? 2.5 : 1, social: g.has("people") ? 3.5 : 0.8, mind: g.has("calm") ? 2.5 : 1 };
    const a = weighted(pool.map((a) => [a, catW[a.cat] || 1]));
    return a && { kind: "action", id: a.id, data: a };
  }
  function pickBreathe() {
    const a = leastRecent((C().actions || []).filter((x) => x.cat === "breathe"));
    return a && { kind: "breathe", id: a.id, data: a };
  }
  function pickCapture() {
    const c = leastRecent(C().captures || []);
    return c && { kind: "capture", id: c.id, data: c };
  }
  function pickReflect() {
    const r = leastRecent(C().reflects || []);
    return r && { kind: "reflect", id: r.id, data: r };
  }
  function openTasks() {
    const ot = UP.state.oneThing;
    const oneId = ot && ot.day === UP.dayKey() ? ot.vid : null;
    return UP.state.vault
      .filter((v) => v.kind === "task" && v.id !== oneId && !v.done && !v.archived && now() - v.createdAt > 2 * MIN &&
        !(v.snooze > now()) && (!v.r || now() - v.r > 3 * 3600000) && !sessionUsed.has(v.id))
      .sort((a, b) => (a.due || Infinity) - (b.due || Infinity) || (a.r || 0) - (b.r || 0));
  }
  function openQuestions() {
    return UP.state.vault.filter((v) => v.kind === "question" && !v.archived && now() - v.createdAt > 30 * MIN && (!v.r || now() - v.r > 2 * DAY) && !sessionUsed.has(v.id));
  }
  function staleIdeas() {
    return UP.state.vault.filter((v) => v.kind === "idea" && !v.archived && now() - v.createdAt > 20 * 3600000 && (!v.r || now() - v.r > 5 * DAY) && !sessionUsed.has(v.id));
  }
  function capsules() {
    return UP.state.journal.filter((j) => now() - j.createdAt > 20 * 3600000 && (!j.back || now() - j.back > 10 * DAY) && !sessionUsed.has(j.id));
  }
  const learnedAt = new Map(); // id -> history index when first learned this session
  function noteLearned(id) { learnedAt.set(id, histLen); }
  function freshDue() {
    const out = [];
    for (const [id, i] of learnedAt) {
      const r = UP.state.srs[id];
      if (r && r.n === 1 && histLen - i >= 15) out.push(id);
    }
    return out;
  }
  function pickReview() {
    const fresh = freshDue();
    for (const id of fresh) learnedAt.delete(id);
    const due = [...fresh, ...UP.store.dueReviews()].filter((id, i, arr) => arr.indexOf(id) === i && !recentlyShown(id));
    for (const id of due) {
      const data = findItem(id);
      if (data) return { kind: "review", id, data, src: data.__kind };
    }
    return null;
  }
  const shownAt = new Map(); // id -> card index in this session
  let histLen = 0;
  function recentlyShown(id) {
    const i = shownAt.get(id);
    return i != null && histLen - i < 6;
  }
  function findItem(id) {
    const c = C();
    if (id.startsWith("ai-")) {
      const a = UP.aiCards[id];
      return a ? { ...a, __kind: "ai" } : null;
    }
    const f = (c.facts || []).find((x) => x.id === id);
    if (f) return { ...f, __kind: "fact" };
    const w = (c.words || []).find((x) => x.id === id);
    if (w) return { ...w, __kind: "word" };
    return null;
  }
  function pickHoleCard() {
    const holes = UP.state.holes.filter((h) => h.active && h.queue && h.queue.length);
    if (!holes.length) return null;
    const h = pick(holes);
    while (h.queue.length) {
      const id = h.queue.shift();
      const card = UP.aiCards[id];
      if (card) { UP.store.save(); return { kind: "ai", id, data: card, read: (h.count || 0) > 3 && rand() < 0.3 }; }
    }
    return null;
  }

  /* ---------- the mixer ---------- */
  function next(history, filter = "mix") {
    histLen = history.length;
    const allow = FILTERS[filter];
    const ok = (k) => !allow || allow.has(k);
    const st = UP.state;
    let spec = null;

    const newUser = (st.stats.answered || 0) < 6 && session.cards < 8;
    const firstEver = !st.lastBrief && (st.stats.cards || 0) < 3;
    const histK = lastKinds(history, 3);

    // the daily brief opens each day, except a brand-new user's very first session (hook first)
    if (st.lastBrief !== UP.dayKey() && !history.length && !firstEver) {
      spec = { kind: "brief", id: "brief-" + UP.dayKey() };
    }
    // a brand-new user's first three cards are scripted: a jaw-dropper, an estimate, a guaranteed bonus
    if (!spec && firstEver && history.length < 3 && filter === "mix") {
      spec = [() => pickHoleCard() || pickLegendary(), () => pickHoleCard() || pickEstimate(), () => ({ kind: "chest", id: UP.uid("chest") })][history.length]();
    }
    // your own list gets a guaranteed slot in the first few cards of every session
    if (!spec && !firstEver && !session.taskShown && filter !== "learn" && filter !== "calm" && history.length <= 3 && !histK.includes("task") && (history.length >= 1 || st.lastBrief === UP.dayKey())) {
      const t = openTasks()[0];
      if (t) { spec = { kind: "task", id: t.id, data: t }; session.taskShown = true; }
    }
    const ot = st.oneThing;
    if (!spec && ot && ot.day === UP.dayKey() && !ot.done && (sinceOne >= 16 || (!session.oneShown && history.length >= 2)) && filter !== "learn") {
      session.oneShown = true;
      spec = { kind: "one", id: "one-" + sinceOne + "-" + session.cards };
      sinceOne = 0;
    }
    if (!spec && sinceChest >= nextChestAt && filter !== "calm") {
      spec = { kind: "chest", id: UP.uid("chest") };
    }
    if (!spec && !session.receiptShown && filter !== "calm" && ((session.receiptPending && session.cards >= 8) || (session.cards >= 25 && now() - session.start > 12 * 60000))) {
      session.receiptShown = true;
      spec = { kind: "receipt", id: UP.uid("receipt") };
    }
    // memory checks: never two in a row, at most about one in four cards
    if (!spec && ok("review") && histK[histK.length - 1] !== "review") {
      const recent = lastKinds(history, 10).filter((k) => k === "review").length;
      const dueCount = UP.store.dueReviews().length + freshDue().length;
      const cap = dueCount > 15 ? 3 : 2; // a big backlog earns a little more room
      if (dueCount && recent < cap && (sinceReview >= 4 || rand() < 0.2 + Math.min(0.2, dueCount * 0.015))) spec = pickReview();
    }
    // in Calm, breathing comes round at least every fourth card
    if (!spec && filter === "calm" && !lastKinds(history, 3).includes("breathe")) spec = pickBreathe();
    if (!spec) {
      const g = goals();
      const ka = (k) => Math.max(0.12, 1 + 0.22 * (st.kindAffinity[k] || 0)) * Math.pow(0.5, Math.min(3, (session.skips && session.skips[k]) || 0));
      const holesReady = st.holes.filter((h) => h.active && h.queue && h.queue.length).length;
      const W = {
        fact: 30 * (g.has("mind") ? 1.3 : 1) * (UP.store.dueReviews().length > 20 ? 0.6 : 1),
        ai: holesReady ? 26 + 6 * holesReady : 0,
        estimate: 10 * (g.has("mind") ? 1.5 : 1),
        word: 7 * (g.has("words") ? 3 : 1),
        action: 11 * (g.has("body") || g.has("order") || g.has("people") ? 1.4 : 1),
        breathe: 2.5 * (g.has("calm") ? 2.5 : 1),
        capture: 4 * (g.has("order") ? 2 : 1),
        reflect: 3.5 * (g.has("calm") ? 2 : 1),
        sprint: 3.5 * (g.has("mind") ? 1.5 : 1),
        task: openTasks().length ? 7 : 0,
        idea: staleIdeas().length ? 3 : 0,
        question: openQuestions().length ? 4 : 0,
        capsule: capsules().length ? 3 : 0,
        calmaction: filter === "calm" ? 4 : 0,
      };
      // open daily quests pull their card types forward so every quest is reachable
      const QK = { sprint: "sprint", breathe: "breathe", bullseye: "estimate", reflect: "reflect", capture: "capture", word: "word", deed: "action" };
      for (const q of (st.quests && st.quests.list) || []) if (!q.done && QK[q.type] && W[QK[q.type]]) W[QK[q.type]] *= 2.6;
      // hook before homework: no chores in the first cards of a session, or for brand-new users
      if (session.cards + history.length < 5 || newUser) for (const k of ["capture", "reflect", "capsule"]) W[k] = 0;
      // respect the goals people picked
      if (g.size && !g.has("mind")) { W.fact *= 0.6; W.estimate *= 0.5; W.sprint *= 0.3; if (!g.has("words")) W.word *= 0.4; }
      if (g.size && !g.has("calm")) { W.breathe *= 0.4; W.reflect *= 0.5; }
      if (g.has("order")) { const ts = openTasks(); W.task = ts.length ? 10 + (ts[0].due && ts[0].due - now() < 2 * DAY ? 10 : 0) : 0; }
      // heavy journal prompts belong to calm moments, not a late-night scroll
      const hr = new Date().getHours();
      if (filter === "mix" && (hr >= 23 || hr < 6)) W.reflect = 0;
      // caps that keep the mix fresh: one sprint a session, estimates at most 1 in 7
      if (session.sprints >= (openQuest("sprint") ? 2 : 1)) W.sprint = 0;
      if (lastKinds(history, 6).includes("estimate")) W.estimate = 0;
      if (newUser) W.action *= 0.4;
      // no kind twice within the last three cards (facts may come back after one other card)
      for (const k of histK) if (k in W && k !== "fact" && k !== "ai") W[k] = 0;
      if (histK[histK.length - 1] === "fact") W.fact = 0;
      if (histK[histK.length - 1] === "ai") W.ai *= 0.5;
      if (histK.includes("action")) W.calmaction = 0;
      const lastDo = DO_KINDS.has(histK[histK.length - 1]);
      for (const k of Object.keys(W)) {
        if (!ok(k)) W[k] = 0;
        else {
          W[k] *= ka(k);
          if (lastDo && DO_KINDS.has(k) && filter === "mix") W[k] *= 0.25;
        }
      }
      for (let tries = 0; tries < 10 && !spec; tries++) {
        const kind = weighted(Object.entries(W));
        if (!kind) break;
        spec = build(kind);
        if (!spec) W[kind] = 0;
      }
    }
    if (!spec) {
      // everything has been shown this session: let older items come back
      sessionUsed.clear();
      const pool = UP.shuffle(allow ? [...allow].filter((k) => !histK.includes(k)) : ["fact", "action", "estimate", "word"]);
      for (const k of pool) { spec = build(k); if (spec) break; }
      if (!spec) spec = pickFact() || pickAction() || { kind: "chest", id: UP.uid("chest") };
    }

    // bookkeeping
    if (spec.kind === "chest") { sinceChest = 0; chestGap = Math.min(22, chestGap + 2); nextChestAt = chestGap + Math.floor(rand() * 5); } else sinceChest++;
    if (spec.kind === "receipt") sinceReceipt = 0; else sinceReceipt++;
    if (spec.kind === "task") session.taskShown = true;
    if (spec.kind === "sprint") session.sprints = (session.sprints || 0) + 1;
    if (spec.kind === "review") sinceReview = 0; else sinceReview++;
    if (spec.kind !== "one") sinceOne++;
    if (spec.id) { sessionUsed.add(spec.id); shownAt.set(spec.id, history.length); }
    spec.key = UP.uid("c");
    return spec;
  }

  // a finished real-world quest sometimes earns a bonus right away: reward doing, not swiping
  function deedDone() {
    if (rand() < 0.35 && sinceChest >= 6) sinceChest = Math.max(sinceChest, nextChestAt);
  }
  // cards inserted from outside the mixer (brief, bonus, sky) still count for repeats and spacing
  function mark(spec) {
    if (spec.id) { sessionUsed.add(spec.id); shownAt.set(spec.id, histLen); learnedAt.delete(spec.id); }
    if (spec.kind === "chest") sinceChest = 0;
    if (spec.kind === "review") sinceReview = 0;
    if (spec.kind === "sprint") session.sprints = (session.sprints || 0) + 1;
  }

  function build(kind) {
    switch (kind) {
      case "fact": return pickFact();
      case "ai": return pickHoleCard();
      case "estimate": return pickEstimate();
      case "word": return pickWord();
      case "action": return pickAction(false);
      case "calmaction": return pickAction(true);
      case "breathe": return pickBreathe();
      case "capture": return pickCapture();
      case "reflect": return pickReflect();
      case "sprint": return { kind: "sprint", id: UP.uid("sprint") };
      case "task": { const t = openTasks()[0]; return t && { kind: "task", id: t.id, data: t }; }
      case "idea": { const t = pick(staleIdeas()); return t && { kind: "idea", id: t.id, data: t }; }
      case "question": { const t = pick(openQuestions()); return t && { kind: "question", id: t.id, data: t }; }
      case "capsule": { const j = pick(capsules()); return j && { kind: "capsule", id: j.id, data: j }; }
      case "review": return pickReview();
    }
    return null;
  }

  // distractors come from the same part of speech, so grammar never gives the answer away
  function wordOptions(word) {
    const all = (C().words || []).filter((w) => w.id !== word.id);
    const same = UP.shuffle(all.filter((w) => w.pos === word.pos));
    const pool = same.length >= 3 ? same : same.concat(UP.shuffle(all.filter((w) => w.pos !== word.pos)));
    const opts = UP.shuffle([word.def, ...pool.slice(0, 3).map((w) => w.def)]);
    return { options: opts, a: opts.indexOf(word.def) };
  }
  // the reverse direction: see the meaning, recall the word
  function wordReverse(word) {
    const all = (C().words || []).filter((w) => w.id !== word.id);
    const same = UP.shuffle(all.filter((w) => w.pos === word.pos));
    const pool = same.length >= 3 ? same : same.concat(UP.shuffle(all));
    const opts = UP.shuffle([word.word, ...pool.slice(0, 3).map((w) => w.word)]);
    return { options: opts, a: opts.indexOf(word.word) };
  }

  UP.engine = { next, TOPICS, GOALS, FILTERS, session, pickLegendary, findItem, wordOptions, wordReverse, holesNeedingCards, noteLearned, deedDone, build, mark };

  function holesNeedingCards() {
    return UP.state.holes.filter((h) => h.active && (!h.queue || h.queue.length < 3) && !UP.ai.digging(h.id));
  }
})();
