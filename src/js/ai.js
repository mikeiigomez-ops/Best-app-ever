/* Upscroll — Claude-powered features (rabbit holes, go deeper, untangle, answer).
   Everything here degrades to "unavailable" when the page is not running inside Claude. */
(function () {
  const UP = window.UP;
  const { bus, now, slug } = UP;

  let sample = null;
  let status = "unknown"; // unknown | ready | denied | none
  const inflight = {};

  async function init() {
    if (!window.claude || !window.claude.use) { status = "none"; bus.emit("ai", status); return; }
    try {
      sample = await window.claude.use("sample");
      status = sample ? "ready" : "none";
    } catch (e) {
      status = "none";
    }
    bus.emit("ai", status);
  }

  function handleError(e) {
    const code = e && e.code;
    if (code === "not_granted" || code === "sampling_disabled" || code === "not_declared" || code === "capability_disabled" || code === "capability_removed") {
      status = "denied";
      bus.emit("ai", status);
      return "Claude features are turned off for this page. You can allow them from the page's permissions menu.";
    }
    if (code === "rate_limited") return "Claude is busy for you right now. Give it a minute and try again.";
    if (code === "session_expired") return "Your Claude session expired. Sign in again to keep digging.";
    if (code === "refused") return "Claude passed on that one. Try wording it differently.";
    if (code === "cancelled") return "";
    if (code === "invalid_json") return "Claude's answer came back garbled. Try again.";
    return "Couldn't reach Claude. Check your connection and try again.";
  }

  const available = () => status === "ready" && !!sample;

  /* ---------- rabbit holes: infinite, progressively deeper cards on any topic ---------- */
  function validCard(c) {
    if (!c || typeof c !== "object") return false;
    c.a = Number(c.a);
    const str = (x) => typeof x === "string" && x.trim().length > 0;
    return str(c.headline) && str(c.body) && str(c.q) &&
      Array.isArray(c.options) && c.options.length >= 3 && c.options.length <= 4 &&
      c.options.every(str) && new Set(c.options.map((o) => o.trim().toLowerCase())).size === c.options.length &&
      Number.isInteger(c.a) && c.a >= 0 && c.a < c.options.length;
  }

  async function digHole(hole, n = 5) {
    if (!available()) throw { code: "unavailable" };
    if (inflight[hole.id]) return inflight[hole.id];
    const done = hole.count || 0;
    const stage = done < 6 ? "foundations a curious beginner needs first" : done < 18 ? "the important intermediate ideas, mechanisms and surprising details" : "advanced, expert-level nuance, edge cases, and the frontier of the topic";
    const recent = (hole.headlines || []).slice(-24);
    const prompt =
      `You write cards for a learning feed that replaces doomscrolling. Topic: "${hole.topic}".\n` +
      `The reader has already done ${done} cards on it. This batch should cover ${stage}, building on what came before, one idea per card, in a sensible teaching order.\n` +
      (recent.length ? `Do NOT repeat these earlier cards:\n- ${recent.join("\n- ")}\n` : "") +
      `Accuracy rules: only include claims you are at least 95% sure of and that experts broadly agree on. Skip myths, contested or fast-changing claims, and anything surprising you can't stand behind; if the honest answer is debated, teach the debate instead. If the topic is practical (a skill, a language, a craft), make cards the reader can use today.\n` +
      `Quiz rules: the card is shown QUESTION FIRST, then the headline and body are revealed, so the question must be a self-contained, intriguing guess the reader can reason about; prefer applying the idea to a new case over restating it. Options must be similar in length and grammar, with distractors that are common misconceptions, and the correct one must not tend to be the longest.\n` +
      `Reply with only a JSON array of ${n} objects with exactly these keys:\n` +
      `{"headline": a surprising or clarifying statement, max 70 chars,\n "body": 1-3 vivid sentences explaining it, max 260 chars,\n "q": a self-contained multiple-choice question testing the idea, max 110 chars,\n "options": 4 short answer strings (max 40 chars), one correct,\n "a": index of the correct option (vary it),\n "explain": one extra detail shown after answering, max 150 chars,\n "tip": a practical "try this" line or ""}\n` +
      `Example: [{"headline":"...","body":"...","q":"...","options":["...","...","...","..."],"a":2,"explain":"...","tip":""}]`;
    const p = (async () => {
      try {
        const arr = await sample.json(prompt, { cache: false });
        const list = (Array.isArray(arr) ? arr : (arr && arr.cards) || []).filter(validCard).slice(0, n);
        const cards = list.map((c, i) => ({
          id: "ai-" + slug(hole.topic) + "-" + (done + i) + "-" + now().toString(36),
          kind: "ai",
          hole: hole.id,
          topic: hole.topic,
          headline: c.headline.slice(0, 120),
          body: c.body.slice(0, 420),
          q: c.q.slice(0, 200),
          options: c.options.map((o) => o.slice(0, 80)),
          a: c.a,
          explain: String(c.explain || "").slice(0, 240),
          tip: String(c.tip || "").slice(0, 200),
          at: now(),
        }));
        for (const c of cards) UP.aiCards[c.id] = c;
        UP.store.markAi();
        hole.count = done + cards.length;
        hole.headlines = (hole.headlines || []).concat(cards.map((c) => c.headline)).slice(-40);
        hole.queue = (hole.queue || []).concat(cards.map((c) => c.id));
        UP.store.save();
        bus.emit("hole", hole);
        return cards;
      } finally {
        delete inflight[hole.id];
      }
    })();
    inflight[hole.id] = p;
    return p;
  }
  const digging = (id) => !!inflight[id];

  /* ---------- go deeper: streamed explanation + follow-up chat ---------- */
  function deeper(card, turns, onText, signal) {
    const context =
      `The reader is scrolling a learning feed and tapped "Go deeper" on this card:\n` +
      `Title: ${card.headline || card.word || card.title}\n${card.body || card.def || ""}\n${card.explain ? "Extra: " + card.explain : ""}\n\n` +
      `Explain the idea in more depth for a curious adult on a phone: the why and how, a concrete example, and one connection to everyday life. ` +
      `Keep it under 180 words, plain text with short paragraphs, no headings, no markdown symbols. If the card contains an error or oversimplification, say so plainly. ` +
      `If they ask a follow-up, answer it directly in the same style.`;
    const input = [{ role: "user", content: context }, ...turns];
    return sample(input, { cache: turns.length ? false : { gcTime: 3600000 }, onText, signal });
  }

  /* ---------- answer a question from the vault ---------- */
  function answer(question, onText, signal) {
    return sample(
      `Answer this question someone saved while scrolling, for a curious adult reading on a phone. Be accurate, concrete and brief (under 150 words), plain text, no markdown. If the honest answer is uncertain or debated, say so.\n\nQuestion: ${question}`,
      { onText, signal, cache: { gcTime: 3600000 } }
    );
  }

  /* ---------- untangle a brain dump into vault items ---------- */
  async function untangle(text) {
    const res = await sample.json(
      `Someone did a quick brain dump on their phone. Split it into separate items and classify each as "task" (something to do), "idea" (an idea, plan, gift, place, thing to try) or "question" (something they wonder about). ` +
      `Rewrite each item as a short clear line (max 80 chars) in their voice. For tasks, add "step": the tiniest first physical action that would get it moving (max 60 chars), else "". ` +
      `Reply with only a JSON array like [{"kind":"task","text":"Book dentist appointment","step":"Find the dentist's number"}].\n\nBrain dump:\n${text.slice(0, 4000)}`,
      { cache: false }
    );
    return (Array.isArray(res) ? res : []).filter((x) => x && typeof x.text === "string" && ["task", "idea", "question"].includes(x.kind));
  }

  /* ---------- expand a saved idea ---------- */
  function expandIdea(idea, onText, signal) {
    return sample(
      `Someone saved this idea in their notes: "${idea}". Give them 3 concrete, small next steps to move it forward this week, and one question that would sharpen it. Numbered lines, plain text, under 110 words.`,
      { onText, signal, cache: { gcTime: 3600000 } }
    );
  }

  UP.ai = { init, available, status: () => status, digHole, digging, deeper, answer, untangle, expandIdea, handleError };
})();
