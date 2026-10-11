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
    do: new Set(["action", "capture", "task", "idea", "breathe"]),
    calm: new Set(["breathe", "reflect", "capsule", "calmaction"]),
  };
  const DO_KINDS = new Set(["action", "breathe", "capture", "reflect", "task", "idea", "capsule", "sprint"]);

  let sinceChest = 0, nextChestAt = 9 + Math.floor(rand() * 5);
  let sinceReceipt = 0, sinceReview = 0, sinceOne = 8;
  const sessionUsed = new Set();
  const session = { start: now(), cards: 0, learned: 0, correct: 0, answered: 0, deeds: 0, captures: 0, xp: 0, words: 0, stars: 0 };

  function goals() { return new Set(UP.state.goals || []); }

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
    return f && { kind: "fact", id: f.id, data: f };
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
    const list = (C().actions || []).filter((a) => a.cat !== "breathe" && (!calmOnly || a.cat === "mind"));
    const st = UP.state;
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
    return UP.state.vault.filter((v) => v.kind === "task" && !v.done && !v.archived && now() - v.createdAt > 20 * MIN && (!v.r || now() - v.r > 20 * 3600000) && !sessionUsed.has(v.id));
  }
  function staleIdeas() {
    return UP.state.vault.filter((v) => v.kind === "idea" && !v.archived && now() - v.createdAt > 20 * 3600000 && (!v.r || now() - v.r > 5 * DAY) && !sessionUsed.has(v.id));
  }
  function capsules() {
    return UP.state.journal.filter((j) => now() - j.createdAt > 20 * 3600000 && (!j.back || now() - j.back > 10 * DAY) && !sessionUsed.has(j.id));
  }
  function pickReview() {
    const due = UP.store.dueReviews().filter((id) => !recentlyShown(id));
    for (const id of due) {
      const data = findItem(id);
      if (data) return { kind: "review", id, data, src: data.__kind };
    }
    return null;
  }
  const shownAt = new Map(); // id -> card index in this session
  function recentlyShown(id) {
    const i = shownAt.get(id);
    return i != null && session.cards - i < 6;
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
      if (card) { UP.store.save(); return { kind: "ai", id, data: card }; }
    }
    return null;
  }

  /* ---------- the mixer ---------- */
  function next(history, filter = "mix") {
    const allow = FILTERS[filter];
    const ok = (k) => !allow || allow.has(k);
    const st = UP.state;
    let spec = null;

    if (st.lastBrief !== UP.dayKey() && !history.length) {
      spec = { kind: "brief", id: "brief-" + UP.dayKey() };
    }
    const ot = st.oneThing;
    if (!spec && ot && ot.day === UP.dayKey() && !ot.done && sinceOne >= 16 && filter !== "learn") {
      spec = { kind: "one", id: "one-" + sinceOne + "-" + session.cards };
      sinceOne = 0;
    }
    if (!spec && sinceChest >= nextChestAt) {
      spec = { kind: "chest", id: UP.uid("chest") };
    }
    if (!spec && sinceReceipt >= 22 && session.cards >= 22) {
      spec = { kind: "receipt", id: UP.uid("receipt") };
    }
    if (!spec && ok("review")) {
      const dueCount = UP.store.dueReviews().length;
      if (dueCount && (sinceReview >= 5 || rand() < 0.22 + Math.min(0.25, dueCount * 0.02))) spec = pickReview();
    }
    if (!spec) {
      const g = goals();
      const ka = (k) => Math.max(0.3, 1 + 0.15 * (st.kindAffinity[k] || 0));
      const holesReady = st.holes.filter((h) => h.active && h.queue && h.queue.length).length;
      const W = {
        fact: 30 * (g.has("mind") ? 1.3 : 1),
        ai: holesReady ? 26 + 6 * holesReady : 0,
        estimate: 9 * (g.has("mind") ? 1.5 : 1),
        word: 7 * (g.has("words") ? 3 : 1),
        action: 11 * (g.has("body") || g.has("order") || g.has("people") ? 1.4 : 1),
        breathe: 2.5 * (g.has("calm") ? 2.5 : 1),
        capture: 4 * (g.has("order") ? 2 : 1),
        reflect: 3.5 * (g.has("calm") ? 2 : 1),
        sprint: 3 * (g.has("mind") ? 1.5 : 1),
        task: openTasks().length ? 7 : 0,
        idea: staleIdeas().length ? 3 : 0,
        capsule: capsules().length ? 3 : 0,
        calmaction: filter === "calm" ? 4 : 0,
      };
      const last = lastKinds(history, 2);
      if (last.length === 2 && last[0] === last[1]) W[last[0]] = 0;
      const lastDo = DO_KINDS.has(last[last.length - 1]);
      for (const k of Object.keys(W)) {
        if (!ok(k)) W[k] = 0;
        else {
          W[k] *= ka(k);
          if (lastDo && DO_KINDS.has(k) && filter === "mix") W[k] *= 0.25;
        }
      }
      for (let tries = 0; tries < 8 && !spec; tries++) {
        const kind = weighted(Object.entries(W));
        if (!kind) break;
        spec = build(kind);
        if (!spec) W[kind] = 0;
      }
    }
    if (!spec) spec = pickFact() || pickEstimate() || pickAction() || { kind: "chest", id: UP.uid("chest") };

    // bookkeeping
    if (spec.kind === "chest") { sinceChest = 0; nextChestAt = 9 + Math.floor(rand() * 6); } else sinceChest++;
    if (spec.kind === "receipt") sinceReceipt = 0; else sinceReceipt++;
    if (spec.kind === "review") sinceReview = 0; else sinceReview++;
    if (spec.kind !== "one") sinceOne++;
    if (spec.id) { sessionUsed.add(spec.id); shownAt.set(spec.id, session.cards + history.length); }
    spec.key = UP.uid("c");
    return spec;
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
      case "task": { const t = pick(openTasks()); return t && { kind: "task", id: t.id, data: t }; }
      case "idea": { const t = pick(staleIdeas()); return t && { kind: "idea", id: t.id, data: t }; }
      case "capsule": { const j = pick(capsules()); return j && { kind: "capsule", id: j.id, data: j }; }
      case "review": return pickReview();
    }
    return null;
  }

  function wordOptions(word) {
    const others = UP.shuffle((C().words || []).filter((w) => w.id !== word.id)).slice(0, 3).map((w) => w.def);
    const opts = UP.shuffle([word.def, ...others]);
    return { options: opts, a: opts.indexOf(word.def) };
  }

  UP.engine = { next, TOPICS, GOALS, FILTERS, session, pickLegendary, findItem, wordOptions, holesNeedingCards };

  function holesNeedingCards() {
    return UP.state.holes.filter((h) => h.active && (!h.queue || h.queue.length < 3) && !UP.ai.digging(h.id));
  }
})();
