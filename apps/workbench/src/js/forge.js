/* ---- Workbench forge (Lu) ----
   Every prompt in the app lives here. Each flow is one job: forge:start → forge:progress* → forge:done | forge:error.
   Flows run only from user gestures; each has a Stop (WB.forge.cancel(jobId) or the caller's AbortSignal).
   Demo instruments never call sample: they use WB.demo canned responses or local fallbacks. */
(function () {
  "use strict";
  const WB = window.WB;

  const DAY = 86400000;
  const jobs = {};

  /* ---------------- tiny helpers ---------------- */
  const S = () => WB.store || null;
  const M = () => WB.molds;
  const emit = (name, payload) => { try { WB.bus && WB.bus.emit(name, payload); } catch (e) { /* no bus */ } };
  const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function uid(p) {
    const u = WB.util;
    if (u && typeof u.uid === "function") { try { return u.uid(p); } catch (e) { /* fall through */ } }
    return p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function clip(s, n) { s = s == null ? "" : String(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }
  function plain(s, n) { return clip(s, n).replace(/[<>]/g, "").replace(/!+/g, "."); }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function dayNum(ms) {
    const u = WB.util;
    if (u && typeof u.dayNum === "function") return u.dayNum(ms);
    const d = new Date(ms);
    return Math.floor((ms - d.getTimezoneOffset() * 60000) / DAY);
  }
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject({ code: "cancelled", message: "" });
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject({ code: "cancelled", message: "" }); }, { once: true });
    });
  }
  function fail(code, message, extra) {
    return Object.assign({ code, message: message != null ? message : (WB.ai && WB.ai.message ? WB.ai.message(code) : "Something went wrong. Try again.") }, extra || {});
  }
  function storeAll() { try { return (S() && typeof S().all === "function" ? S().all() : []) || []; } catch (e) { return []; } }
  function storeGet(id) { try { return S() && typeof S().get === "function" ? S().get(id) : null; } catch (e) { return null; } }
  function storeMelted() { try { return (S() && typeof S().melted === "function" ? S().melted() : []) || []; } catch (e) { return []; } }
  async function capsNow() {
    try { return await WB.ai.caps(); }
    catch (e) { return { sample: false, images: false, gmail: "unavailable", drive: "unavailable", db: false, user: false, assets: false, room: false, downloads: false }; }
  }
  /* store.update takes fn(clone) → void; copy a computed instrument onto the clone. */
  function replaceWith(next) {
    return (inst) => {
      for (const k of Object.keys(inst)) if (!(k in next) && k !== "id") delete inst[k];
      for (const k of Object.keys(next)) if (k !== "id") inst[k] = next[k];
    };
  }
  function saveUpdate(id, next, source) {
    const st = S();
    if (!st || typeof st.update !== "function") throw fail("unknown", "The bench isn’t ready yet.");
    return st.update(id, replaceWith(next), source);
  }

  /* ---------------- copy ---------------- */
  const NOUN = { leak: "RECEIPT", spoil: "SHELF", perUse: "TAG", dial: "BILL", countdown: "SLIP", reset: "CORNER", zones: "SPACE", project: "PROJECT", week: "WEEK" };
  function label(kind, stage, ctx) {
    switch (stage) {
      case "reading": return kind === "verify" ? "LOOKING AT THE AFTER…" : "READING THE " + ((ctx && NOUN[ctx.mold]) || "PHOTO") + "…";
      case "measuring": return "MEASURING…";
      case "hinge": return "FINDING THE HINGE…";
      case "checking": return "CHECKING THE NUMBERS…";
      case "retrying": return "LOOKING AGAIN, MORE CAREFULLY…";
      case "searching": return "SEARCHING YOUR MAIL…";
      case "reading-mail": return "READING AN EMAIL…";
      case "comparing": return "CHECKING WHAT CHANGED…";
      case "writing":
        return kind === "plan" ? "PLANNING THE MISSION…" : kind === "brief" ? "WRITING THE BRIEF…" : kind === "draft" ? "WRITING THE DRAFT…" : "WRITING IT UP…";
      default: return String(stage || "").toUpperCase() + "…";
    }
  }
  const KIND_COPY = {
    photo: { unavailable: "Reading photos needs Claude. The example bench still works, and every number still moves." },
    snap: { unavailable: "Reading photos needs Claude. The example bench still works, and every number still moves." },
    enrich: {
      invalid_json: "I couldn’t make sense of what I found in your mail. Try again.",
      refused: "I can’t work with that mail.",
      unavailable: "Checking mail needs Claude and Gmail.",
      timeout: "Your mail took too long to search. Try again.",
    },
    mail: {
      invalid_json: "I couldn’t make clean instruments from your mail. Try again.",
      refused: "I can’t work with that mail.",
      unavailable: "Forging from mail needs Claude and Gmail.",
      timeout: "Your mail took too long to search. Try again.",
    },
    verify: { invalid_json: "I couldn’t compare those two photos. Try the after photo again." },
    plan: { invalid_json: "I couldn’t plan that one. Try again." },
    brief: { invalid_json: "I couldn’t write that brief. Try again." },
    draft: { invalid_json: "I couldn’t write that draft. Try again.", refused: "I can’t write that one." },
  };

  /* ---------------- jobs ---------------- */
  function startJob(kind, instrumentId, signal, onStart) {
    const jobId = uid("job");
    const ctl = new AbortController();
    const job = {
      jobId, kind, instrumentId: instrumentId || null, ctl, signal: ctl.signal, timers: [], fatal: null, ctx: null,
      progress(stage, detail, text) {
        if (!jobs[jobId]) return;
        emit("forge:progress", { jobId, kind, stage, label: text || label(kind, stage, job.ctx), detail: detail == null ? null : String(detail).slice(0, 200) });
      },
      later(ms, fn) { job.timers.push(setTimeout(() => { if (jobs[jobId] && !ctl.signal.aborted) fn(); }, ms)); },
      quiet() { job.timers.forEach(clearTimeout); job.timers = []; },
      check() { if (ctl.signal.aborted) throw fail("cancelled", ""); },
      abort(why) { if (why && why.code) job.fatal = why; ctl.abort(); },
      end() { job.quiet(); delete jobs[jobId]; if (signal) signal.removeEventListener("abort", onExt); },
    };
    const onExt = () => ctl.abort();
    if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener("abort", onExt, { once: true }); }
    jobs[jobId] = job;
    emit("forge:start", { jobId, kind, instrumentId: job.instrumentId });
    if (typeof onStart === "function") { try { onStart(jobId); } catch (e) { /* caller */ } }
    return job;
  }

  async function run(kind, instrumentId, opts, fn) {
    opts = opts || {};
    const job = startJob(kind, instrumentId, opts.signal, opts.onStart);
    try {
      const r = await fn(job);
      job.end();
      const d = r.done || {};
      emit("forge:done", { jobId: job.jobId, kind, instrumentId: d.instrumentId !== undefined ? d.instrumentId : job.instrumentId,
        isNew: !!d.isNew, snapped: !!d.snapped, summary: d.summary || null });
      return r.value;
    } catch (e) {
      const aborted = job.signal.aborted;
      job.end();
      const n = job.fatal || (aborted ? { code: "cancelled" } : e) || {};
      const hasCode = isObj(n) && typeof n.code === "string";
      const code = hasCode && WB.ai && WB.ai.error ? WB.ai.error(n).code : hasCode ? n.code : "unknown";
      const kc = KIND_COPY[kind] || {};
      const generic = WB.ai && WB.ai.message ? WB.ai.message(code) : "Something went wrong. Try again.";
      let message;
      if (code === "cancelled") message = "";
      else if (n.server && typeof n.message === "string" && n.message) message = n.message;
      else if (kc[code]) message = kc[code];
      else if (hasCode && typeof n.message === "string" && n.message) message = n.message;
      else message = generic;
      const err = { code, message };
      if (n && n.why) err.why = n.why;
      if (n && n.try) err.try = n.try;
      emit("forge:error", Object.assign({ jobId: job.jobId, kind }, err));
      throw err;
    }
  }

  function cancel(jobId) {
    if (jobId == null) { Object.keys(jobs).forEach((k) => jobs[k].ctl.abort()); return; }
    const j = jobs[jobId];
    if (j) j.ctl.abort();
  }

  /* ---------------- photos ---------------- */
  async function storePhoto(prep, role) {
    const st = S();
    if (st && typeof st.putPhoto === "function") {
      try {
        const ref = await st.putPhoto(prep.blob, role);
        if (ref && ref.src) return Object.assign({ assetId: null, thumb: prep.thumb, w: prep.w, h: prep.h, at: Date.now() }, ref, { role });
      } catch (e) { /* local fallback below */ }
    }
    let src = prep.thumb;
    try { src = await WB.ai.shrink(prep.blob, 900, 0.65); } catch (e) { /* keep the thumb */ }
    return { src, assetId: null, thumb: prep.thumb, w: prep.w, h: prep.h, at: Date.now(), role };
  }

  /* ---------------- 7.1 forge from photo ---------------- */
  function indexOfBench() {
    return storeAll().filter((i) => i && !i.demo).map((i) => ({ id: i.id, mold: i.mold, kind: i.kind, title: i.title, system: i.system }));
  }
  function meltedList() { return storeMelted().slice(-50).map((m) => ({ mold: m.mold, kind: m.kind, title: m.title })); }

  const FOCUS_LABELS = { space: "Basement / garage", social: "Social media", design3d: "3D design", work: "Work projects", family: "Family time", budget: "Budget" };
  function focusLine() {
    let keys = [];
    try { keys = (S() && typeof S().focus === "function" ? S().focus() : []) || []; } catch (e) { keys = []; }
    const labels = keys.map((k) => FOCUS_LABELS[k]).filter(Boolean);
    return labels.length ? "The user said they are working on: " + labels.join(", ") + ". Prefer zones for a whole room, project for work-in-progress." : null;
  }
  function photoPrompt(target) {
    const guides = M().list().map((m) => "- " + m.promptGuide).join("\n");
    const snapLine = target
      ? "\nThe user says this is a new reading of \"" + clip(target.title, 40) + "\" (id " + target.id + ", mold " + target.mold + "). If it plausibly is, set \"snapTo\" to \"" + target.id + "\".\n"
      : "";
    return [
      "You are the instrument-maker inside Workbench. The user photographed something from their life.",
      "Turn it into ONE instrument by choosing exactly one MOLD and filling its variables from what is",
      "visible. You never invent formulas; the app computes everything.",
      "",
      "MOLDS (pick one):",
      guides,
      "",
      "HONESTY RULES (critical):",
      "- origin \"seen\": the number is printed/visible in the photo. Give evidence.bbox around it and evidence.text = the exact characters.",
      "- origin \"inferred\": not printed but strongly implied by what is visible (e.g. spinach that looks wilted → 2 days). Give a one-line \"reason\".",
      "- origin \"assumed\": a reasonable default the user should set. Give a \"reason\" and a sensible value.",
      "- Never mark something seen unless you can box it. Prefer fewer, truer numbers.",
      "- Levers start at a value that shows a meaningful but realistic change (e.g. target 1 when rate is 3).",
      "- Coordinates are fractions 0..1 of the image from its top-left. bbox = [x, y, w, h]. pin = [x, y].",
      "- Money is a plain number in the currency printed on the photo; put its symbol in words.currency.",
      "",
      "EXISTING INSTRUMENTS (snap if this photo is a new reading of one of them; same kind of thing, same place/vendor):",
      JSON.stringify(indexOfBench()),
      "If it matches, set \"snapTo\" to that id and still fill all vars from THIS photo." + snapLine,
      "",
      "THE USER DOES NOT WANT instruments like: " + JSON.stringify(meltedList()),
      "",
      focusLine(),
      "If nothing fits: if it shows a physical space or objects to deal with, use \"reset\". Otherwise return",
      "{\"fit\": false, \"why\": \"<one short sentence>\", \"try\": \"<one suggestion of a better photo>\"}.",
      "",
      "Return ONLY JSON:",
      "{",
      " \"fit\": true,",
      " \"mold\": \"leak|spoil|perUse|dial|countdown|reset|zones|project|week\",",
      " \"kind\": \"<stable lowercase slug for this kind of thing, e.g. takeout-golden-wok, home-fridge, electric-bill>\",",
      " \"system\": \"Food|Money|Energy|Things|Space|Health|Work|Time\",",
      " \"side\": \"work|home|both\",",
      " \"title\": \"<2-3 words>\",",
      " \"snapTo\": \"<existing id or null>\",",
      " \"words\": { \"subject\": \"...\", \"period\": \"week|month\", \"basis\": \"once|month\", \"stepUnit\": \"...\", \"unit\": \"<plural noun, project only>\", \"currency\": \"$\" },",
      " \"vars\": { \"<varId>\": { \"value\": <number>, \"origin\": \"seen|inferred|assumed\",",
      "                         \"evidence\": { \"bbox\": [x,y,w,h], \"text\": \"...\" } | null, \"reason\": \"...\" | null } },",
      " \"items\": [ { \"id\": \"i1\", \"name\": \"...\", \"value\": <number>, \"days\": <number>, \"origin\": \"seen|inferred|assumed\", \"pin\": [x,y] } ],",
      " \"steps\": [ { \"id\": \"s1\", \"n\": 1, \"text\": \"<imperative, specific to this photo, <= 9 words>\", \"minutes\": <number>, \"pin\": [x,y] } ],",
      " \"zones\": [ { \"name\": \"...\", \"bbox\": [x,y,w,h], \"pin\": [x,y], \"minutes\": <15-60>, \"steps\": [ { \"text\": \"...\", \"minutes\": <number>, \"pin\": [x,y] } ] } ],",
      " \"fieldNote\": \"<one dry, specific sentence about this exact photo, no exclamation marks>\",",
      " \"nextPhotos\": [\"<what to photograph next to keep this true>\"],",
      " \"mailQuery\": \"<Gmail search query that would find more evidence, or null>\",",
      " \"act\": { \"type\": \"draft|ics|mission\", \"to\": \"<email if visible or null>\", \"why\": \"<short>\" }",
      "}",
      "Dates: for countdown.deadline give \"value\" as days from TODAY=" + todayISO() + " (integer), the app converts.",
      "items is required for spoil (3-12 items), steps for reset (3-7 steps) and zones for zones (3-8 zones, each with 2-5 steps); for project give 1-3 steps. Omit what does not apply.",
    ].join("\n");
  }

  async function fromPhoto(file, opts) {
    opts = opts || {};
    const intent = opts.intent === "snap" ? "snap" : "new";
    const target = intent === "snap" && opts.instrumentId ? storeGet(opts.instrumentId) : null;
    return run(intent === "snap" ? "snap" : "photo", target ? target.id : null, opts, async (job) => {
      job.ctx = target ? { mold: target.mold } : null;
      job.progress("reading");
      if (!file) throw fail("unknown", "No photo was chosen.");
      const caps = await capsNow();
      if (!caps.sample || !caps.images) throw fail("unavailable");
      job.check();
      job.later(2500, () => job.progress("measuring"));
      job.later(5000, () => job.progress("hinge"));
      const prep = await WB.ai.prepImage(file);
      job.check();
      const photoP = storePhoto(prep, intent === "snap" ? "snap" : "hero");
      photoP.catch(() => {});
      const spec = await WB.ai.json(photoPrompt(target), {
        images: [prep.blob], tier: "quick", signal: job.signal,
        validate: (s) => M().validate(s),
        onChecking: () => { job.quiet(); job.progress("checking"); },
        onRetry: () => job.progress("retrying"),
      });
      job.check();
      if (spec.fit === false) {
        throw fail("no_fit", "That one doesn’t make an instrument yet.", { why: plain(spec.why, 140) || null, try: plain(spec.try, 140) || null });
      }
      const photo = await photoP;
      job.check();

      let snapId = null;
      const cand = typeof spec.snapTo === "string" ? storeGet(spec.snapTo) : null;
      if (cand && !cand.demo && cand.mold === spec.mold) snapId = cand.id;
      else if (target && target.mold === spec.mold) snapId = target.id;

      if (snapId) {
        const cur = storeGet(snapId);
        const merged = M().snap(cur, spec, photo);
        saveUpdate(snapId, merged, "snap");
        const after = storeGet(snapId) || merged;
        const obs = M().observe(after, "photo", "New photo");
        if (S() && typeof S().addObservation === "function") S().addObservation(snapId, obs);
        else saveUpdate(snapId, Object.assign({}, after, { observations: (after.observations || []).concat([obs]).slice(-60) }), "snap");
        return { value: { id: snapId, isNew: false, snapped: true }, done: { instrumentId: snapId, isNew: false, snapped: true, summary: (after.fieldNote) || null } };
      }
      const inst = M().build(spec, photo, { source: "photo" });
      if (!S() || typeof S().upsert !== "function") throw fail("unknown", "The bench isn’t ready yet.");
      await S().upsert(inst);
      return { value: { id: inst.id, isNew: true, snapped: false }, done: { instrumentId: inst.id, isNew: true, snapped: false, summary: inst.fieldNote || null } };
    });
  }

  /* ---------------- 7.1b forge from a form (local only, no Claude) ---------------- */
  function slug(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); }
  function formNum(v) { return typeof v === "string" && !v.trim() ? NaN : Number(v); }
  function validEmail(v) {
    const e = clip(v, 120);
    return e && /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}$/i.test(e) ? e : null;
  }
  const WEEK_RANGES = {
    workHours: [20, 70, "Hours at work"], focusBlocks: [0, 10, "Focus blocks"], meetingHours: [0, 40, "Hours of meetings"],
    spillHours: [0, 20, "Hours that spill into evenings"], mornings: [0, 2, "Protected mornings"], familyEvenings: [0, 7, "Family evenings"],
  };
  async function fromForm(moldId, fields) {
    fields = isObj(fields) ? fields : {};
    if (moldId !== "project" && moldId !== "week") throw fail("unknown", "That form isn’t one I can build.");
    let spec;
    if (moldId === "project") {
      const title = plain(fields.title, 28) || "Project";
      const unit = plain(fields.unit, 16) || "pieces";
      const done = formNum(fields.done), total = formNum(fields.total), pace = formNum(fields.pace);
      if (!isNum(total) || total < 1) throw fail("invalid", "How many in all? At least 1.");
      if (!isNum(done) || done < 0 || done > total) throw fail("invalid", "Done has to be between 0 and " + total + ".");
      if (!isNum(pace) || pace < 0.5 || pace > 20) throw fail("invalid", "A week’s pace runs from 0.5 to 20.");
      const side = fields.side === "work" ? "work" : "home";
      const next = plain(fields.next, 72);
      spec = {
        fit: true, mold: "project", kind: slug(title) || "project", system: side === "work" ? "Work" : "Things", title, side,
        words: { subject: title, unit },
        vars: { done: { value: done }, total: { value: total }, pace: { value: pace } },
        steps: next ? [{ text: next, minutes: 25 }] : [],
        act: { type: "ics", to: validEmail(fields.to) },
      };
    } else {
      const vars = {};
      for (const k in WEEK_RANGES) {
        const r = WEEK_RANGES[k];
        const n = formNum(fields[k]);
        if (!isNum(n) || n < r[0] || n > r[1]) throw fail("invalid", r[2] + " runs from " + r[0] + " to " + r[1] + ".");
        vars[k] = { value: n };
      }
      spec = { fit: true, mold: "week", kind: "week", system: "Time", title: "This week", side: "both", words: { subject: "This week" }, vars, act: { type: "ics" } };
    }
    const inst = M().build(spec, null, { source: "manual" });
    if (!S() || typeof S().upsert !== "function") throw fail("unknown", "The bench isn’t ready yet.");
    await S().upsert(inst);
    return { id: inst.id, isNew: true };
  }

  /* ---------------- mail tools (7.2 / 7.3) ---------------- */
  const FATAL = ["not_granted", "needs_reauth", "server_not_connected", "unavailable"];
  function mailTools(job, seen) {
    const onFatal = (n) => {
      if (FATAL.indexOf(n.code) < 0) return false;
      job.abort(Object.assign({}, n, { server: "Gmail", message: WB.ai.message(n.code, "Gmail") }));
      return true;
    };
    return [
      {
        name: "search_mail",
        description: "Search the user's Gmail with Gmail search syntax (from:, subject:, newer_than:, category:purchases, quotes). Returns up to 15 threads as {threadId, subject, sender, date, snippet}.",
        inputSchema: { type: "object", properties: { query: { type: "string", description: "Gmail search query" } }, required: ["query"] },
        onFatal,
        async execute(input) {
          const query = clip(input && input.query, 240);
          if (!query) return { error: "query is required" };
          job.progress("searching", query);
          const list = await WB.ai.gmail.search(query, 15);
          for (const t of list) seen[t.threadId] = Object.assign({}, seen[t.threadId], { subject: t.subject, sender: t.sender, date: t.date });
          return list;
        },
      },
      {
        name: "read_mail",
        description: "Read one email thread by threadId (from search_mail). Returns {subject, sender, date, text} with the first and last message text.",
        inputSchema: { type: "object", properties: { threadId: { type: "string" } }, required: ["threadId"] },
        onFatal,
        async execute(input) {
          const id = clip(input && input.threadId, 80);
          if (!id) return { error: "threadId is required" };
          job.progress("reading-mail", (seen[id] && seen[id].subject) || null);
          const t = await WB.ai.gmail.thread(id);
          seen[id] = Object.assign({}, seen[id], { subject: t.subject || (seen[id] && seen[id].subject), sender: t.sender || (seen[id] && seen[id].sender), date: t.date || (seen[id] && seen[id].date), messageIds: t.messageIds, read: true });
          return { subject: t.subject, sender: t.sender, date: t.date, text: t.text };
        },
      },
    ];
  }
  function isoDate(s) {
    if (typeof s !== "string") return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const t = Date.parse(s);
    if (!isNum(t)) return null;
    const d = new Date(t);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function threadMeta(seen) {
    const out = {};
    for (const id in seen) out[id] = { subject: seen[id].subject || null, sender: seen[id].sender || null, date: isoDate(seen[id].date) };
    return out;
  }
  function senderEmail(s) {
    const m = String(s || "").match(/[^\s<>()"',;]+@[^\s<>()"',;]+\.[a-z]{2,}/i);
    if (!m) return null;
    return /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon)([._-]|@)/i.test(m[0]) ? null : m[0];
  }
  async function mailGate() {
    const caps = await capsNow();
    if (!caps.sample) throw fail("unavailable");
    if (caps.gmail === "unavailable") throw Object.assign(fail("server_not_connected", WB.ai.message("server_not_connected", "Gmail")), { server: "Gmail" });
    if (caps.gmail === "denied") throw Object.assign(fail("not_granted", WB.ai.message("not_granted", "Gmail")), { server: "Gmail" });
    return caps;
  }

  /* ---------------- 7.2 enrich ---------------- */
  function describeVars(inst) {
    const mold = M().get(inst.mold);
    const lines = [];
    for (const id in inst.vars) {
      const v = inst.vars[id];
      if (!mold.vars[id]) continue;
      let shown = M().format(v.value, v.format, inst);
      if (id === "deadline") shown += " (" + Math.round(v.value - dayNum(Date.now())) + " days from today)";
      lines.push("- " + id + " (" + v.kind + (v.kind === "fact" ? ", origin " + v.origin : "") + "): " + v.label + " = " + shown + " [raw " + Math.round(v.value * 100) / 100 + "]");
    }
    return lines.join("\n");
  }
  function enrichPrompt(inst) {
    const facts = Object.keys(inst.vars).filter((k) => inst.vars[k].kind === "fact");
    return [
      "You are helping Workbench make one of the user's instruments truer using their own email.",
      "",
      "INSTRUMENT",
      "mold: " + inst.mold + " · kind: " + inst.kind + " · title: " + inst.title + (inst.words && inst.words.subject ? " · subject: " + inst.words.subject : "") +
        (inst.words && inst.words.period ? " · period: " + inst.words.period : "") + (inst.words && inst.words.basis ? " · basis: " + inst.words.basis : ""),
      "variables:",
      describeVars(inst),
      "mail search hint: " + (inst.mailQuery || "(none, choose your own)"),
      "TODAY=" + todayISO(),
      "",
      "Find evidence in the user's mail that makes this instrument truer. Only change a variable when an email proves it; then origin becomes 'seen' with evidence {threadId, quote (≤120 chars), date}. Also return dated past readings so the app can plot history.",
      "Tools: search_mail first (try 1-3 focused queries), then read_mail on at most 4 threads. Use no more than 6 tool calls in total.",
      "Rules: you may only change these fact ids: " + JSON.stringify(facts) + ". Levers are the user's and never change. threadId must come from search_mail. quote must be copied from the email text. Money is a plain number. For countdown.deadline give value as days from TODAY. A rate is per " + ((inst.words && inst.words.period) || "week") + "; compute it from dated orders if you find several.",
      "If nothing in the mail proves anything, return empty vars and history and say so in summary.",
      "",
      "Return ONLY JSON:",
      "{ \"vars\": { \"<varId>\": { \"value\": n, \"origin\": \"seen\", \"evidence\": { \"threadId\": \"...\", \"quote\": \"...\", \"date\": \"YYYY-MM-DD\" } } },",
      "  \"items\": [ ... optional, same shape as forge ... ],",
      "  \"history\": [ { \"date\": \"YYYY-MM-DD\", \"facts\": { \"<varId>\": n } } ],",
      "  \"contact\": { \"to\": \"<vendor/support email or null>\", \"threadId\": \"<or null>\", \"messageId\": \"<or null>\" },",
      "  \"summary\": \"<one sentence, e.g. 'I found 7 more orders since July: it's really 4.2 a week.'>\" }",
    ].join("\n");
  }
  function validateEnrich(inst) {
    return (p) => {
      const errs = [];
      if (!isObj(p)) return ["The reply must be one JSON object."];
      if (p.vars != null && !isObj(p.vars)) errs.push("\"vars\" must be an object.");
      if (isObj(p.vars)) for (const k in p.vars) {
        const v = p.vars[k];
        if (!inst.vars[k] || inst.vars[k].kind !== "fact") { errs.push("vars." + k + " is not a fact of this instrument; only change " + Object.keys(inst.vars).filter((x) => inst.vars[x].kind === "fact").join(", ") + "."); continue; }
        if (!isObj(v) || !isNum(Number(v.value))) errs.push("vars." + k + ".value must be a number.");
        if (!isObj(v) || !isObj(v.evidence) || typeof v.evidence.threadId !== "string") errs.push("vars." + k + ".evidence.threadId is required.");
      }
      if (p.history != null && !Array.isArray(p.history)) errs.push("\"history\" must be an array.");
      if (typeof p.summary !== "string" || !p.summary.trim()) errs.push("\"summary\" must be one sentence.");
      return errs;
    };
  }
  function honestPatch(inst, p, seen) {
    const out = { vars: {}, items: Array.isArray(p.items) ? p.items : undefined, history: [], contact: null, summary: plain(p.summary, 200) };
    const today = dayNum(Date.now());
    for (const k in (isObj(p.vars) ? p.vars : {})) {
      const v = p.vars[k];
      if (!isObj(v) || !isObj(v.evidence) || !seen[v.evidence.threadId]) continue;
      let value = Number(v.value);
      if (!isNum(value)) continue;
      if (inst.mold === "countdown" && k === "deadline") value = today + Math.round(value);
      out.vars[k] = { value, origin: "seen", evidence: { threadId: v.evidence.threadId, quote: clip(v.evidence.quote, 120), date: isoDate(v.evidence.date) || isoDate(seen[v.evidence.threadId].date) } };
    }
    for (const h of Array.isArray(p.history) ? p.history.slice(0, 40) : []) {
      if (!isObj(h) || !isObj(h.facts)) continue;
      const facts = {};
      for (const k in h.facts) {
        if (!inst.vars[k] || inst.vars[k].kind !== "fact" || k === "deadline") continue;
        const n = Number(h.facts[k]);
        if (isNum(n)) facts[k] = n;
      }
      if (Object.keys(facts).length) out.history.push({ date: isoDate(h.date), facts });
    }
    if (isObj(p.contact)) {
      const tid = typeof p.contact.threadId === "string" && seen[p.contact.threadId] ? p.contact.threadId : null;
      const mids = tid && seen[tid].messageIds ? seen[tid].messageIds : [];
      const mid = typeof p.contact.messageId === "string" && mids.indexOf(p.contact.messageId) >= 0 ? p.contact.messageId : mids.length ? mids[mids.length - 1] : null;
      const known = Object.keys(seen).map((id) => senderEmail(seen[id].sender)).filter(Boolean).map((e) => e.toLowerCase());
      const to = typeof p.contact.to === "string" && known.indexOf(p.contact.to.toLowerCase()) >= 0 ? p.contact.to : (tid && senderEmail(seen[tid].sender)) || null;
      if (to || tid) out.contact = { to, threadId: tid, messageId: mid };
    }
    return out;
  }

  const DEMO_QUERIES = ["from:(example gym) newer_than:3m", "subject:(visit OR check-in) newer_than:3m", "\"visit summary\""];
  async function demoEnrich(job, inst) {
    let patch = null;
    try { if (WB.demo && typeof WB.demo.enrichPatch === "function") patch = await WB.demo.enrichPatch(inst); } catch (e) { patch = null; }
    if (!patch && inst.mold === "perUse" && inst.vars.uses) {
      const d = new Date(Date.now() - 9 * DAY);
      const date = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      patch = { vars: { uses: { value: 3, origin: "seen", evidence: { threadId: "example-thread-1", quote: "EXAMPLE · You checked in 3 times last month.", date } } },
        summary: "EXAMPLE mail: 3 check-ins last month, not 2.", queries: DEMO_QUERIES };
    }
    const queries = (patch && (patch.queries || patch.searches)) || (inst.mailQuery ? [inst.mailQuery] : DEMO_QUERIES);
    for (const q of queries.slice(0, 4)) { job.progress("searching", clip(q, 200)); await sleep(650, job.signal); }
    job.progress("writing");
    await sleep(350, job.signal);
    if (!patch) return { value: { id: inst.id, summary: "Nothing in the example mail changes this one." }, done: { instrumentId: inst.id, summary: "Nothing in the example mail changes this one." } };
    let next;
    if (patch.id === inst.id && patch.mold && patch.vars) next = patch;
    else {
      const threads = {};
      const pv = isObj(patch.vars) ? patch.vars : {};
      for (const k in pv) { const ev = pv[k] && pv[k].evidence; if (ev && ev.threadId) threads[ev.threadId] = { subject: ev.subject || "EXAMPLE email", sender: ev.sender || "EXAMPLE", date: ev.date || null }; }
      next = M().applyPatch(inst, patch, { threads });
    }
    saveUpdate(inst.id, next, "enrich");
    const summary = (next.enriched && next.enriched.summary) || plain(patch.summary, 200) || null;
    return { value: { id: inst.id, summary }, done: { instrumentId: inst.id, summary } };
  }

  async function enrich(id, opts) {
    opts = opts || {};
    const inst = storeGet(id);
    return run("enrich", id, opts, async (job) => {
      if (!inst) throw fail("unknown", "That instrument isn’t on the bench any more.");
      if (inst.demo) return demoEnrich(job, inst);
      await mailGate();
      job.check();
      const seen = {};
      const p = await WB.ai.json(enrichPrompt(inst), {
        tools: mailTools(job, seen), maxToolCalls: 8, tier: "default", signal: job.signal, timeoutMs: 60000,
        validate: validateEnrich(inst),
        onChecking: () => job.progress("writing"),
        onRetry: () => job.progress("retrying"),
      });
      job.check();
      const patch = honestPatch(inst, p, seen);
      const changed = Object.keys(patch.vars).length;
      if (!changed && !patch.history.length) patch.summary = patch.summary || "I looked, and nothing in your mail changes these numbers.";
      const cur = storeGet(id) || inst;
      const next = M().applyPatch(cur, patch, { threads: threadMeta(seen) });
      saveUpdate(id, next, "enrich");
      const summary = (next.enriched && next.enriched.summary) || null;
      return { value: { id, summary }, done: { instrumentId: id, summary } };
    });
  }

  /* ---------------- 7.3 forge from mail ---------------- */
  const MAIL_MOLDS = ["leak", "perUse", "countdown"];
  function mailPrompt() {
    const guides = M().list().filter((m) => MAIL_MOLDS.indexOf(m.id) >= 0).map((m) => "- " + m.promptGuide).join("\n");
    return [
      "You are the instrument-maker inside Workbench, working from the user's own email this time (no photo).",
      "Find up to 3 things in their mail worth an instrument: purchases, subscriptions, renewals, return windows, invoices, supplier orders.",
      "Useful searches: category:purchases newer_than:3m; subject:(receipt OR invoice OR renewal OR subscription OR \"return by\") newer_than:3m. Use search_mail, then read_mail on at most 4 threads. No more than 6 tool calls in total.",
      "",
      "MOLDS (only these three):",
      guides,
      "",
      "HONESTY RULES: origin \"seen\" only when an email states the number; give evidence {threadId (from search_mail), quote (≤120 chars copied from the email), date YYYY-MM-DD}. Otherwise \"inferred\" or \"assumed\" with a one-line reason. Levers start at a realistic change. Prefer fewer, truer numbers. No pins, no bboxes.",
      "",
      "ALREADY ON THE BENCH (do not duplicate): " + JSON.stringify(indexOfBench()),
      "THE USER DOES NOT WANT instruments like: " + JSON.stringify(meltedList()),
      "TODAY=" + todayISO() + ". For countdown.deadline give value as days from TODAY (integer).",
      "",
      "Return ONLY JSON:",
      "{ \"instruments\": [ { \"fit\": true, \"mold\": \"leak|perUse|countdown\", \"kind\": \"<lowercase slug>\", \"system\": \"Food|Money|Energy|Things|Space|Health\", \"title\": \"<2-3 words>\",",
      "    \"words\": { \"subject\": \"...\", \"period\": \"week|month\", \"basis\": \"once|month\", \"currency\": \"$\" },",
      "    \"vars\": { \"<varId>\": { \"value\": <number>, \"origin\": \"seen|inferred|assumed\", \"evidence\": { \"threadId\": \"...\", \"quote\": \"...\", \"date\": \"YYYY-MM-DD\" } | null, \"reason\": \"...\" | null } },",
      "    \"fieldNote\": \"<one dry, specific sentence, no exclamation marks>\", \"mailQuery\": \"<query that finds more of these>\",",
      "    \"act\": { \"type\": \"draft|ics\", \"to\": \"<support/vendor email seen in the mail or null>\", \"why\": \"<short>\" } } ],",
      "  \"summary\": \"<one sentence about what you found>\" }",
      "If nothing is worth it, return {\"instruments\": [], \"summary\": \"<why>\"}.",
    ].join("\n");
  }
  function validateMail(o) {
    if (!isObj(o)) return ["The reply must be one JSON object."];
    if (!Array.isArray(o.instruments)) return ["\"instruments\" must be an array (it may be empty)."];
    const errs = [];
    o.instruments.slice(0, 3).forEach((s, i) => {
      if (!isObj(s)) { errs.push("instruments[" + i + "] must be an object."); return; }
      if (MAIL_MOLDS.indexOf(s.mold) < 0) { errs.push("instruments[" + i + "].mold must be leak, perUse or countdown."); return; }
      M().validate(s, { source: "mail" }).forEach((e) => errs.push("instruments[" + i + "]: " + e));
    });
    return errs;
  }
  async function fromMail(opts) {
    opts = opts || {};
    return run("mail", null, opts, async (job) => {
      await mailGate();
      job.check();
      const seen = {};
      const o = await WB.ai.json(mailPrompt(), {
        tools: mailTools(job, seen), maxToolCalls: 8, tier: "default", signal: job.signal, timeoutMs: 60000,
        validate: validateMail,
        onChecking: () => job.progress("writing"),
        onRetry: () => job.progress("retrying"),
      });
      job.check();
      const existingKinds = storeAll().filter((i) => !i.demo).map((i) => i.kind);
      const meltedKinds = storeMelted().map((m) => m.kind);
      const threads = threadMeta(seen);
      const ids = [];
      for (const spec of o.instruments.slice(0, 3)) {
        if (!isObj(spec) || spec.fit === false || MAIL_MOLDS.indexOf(spec.mold) < 0) continue;
        const s = JSON.parse(JSON.stringify(spec));
        let firstThread = null;
        for (const k in (isObj(s.vars) ? s.vars : {})) {
          const v = s.vars[k];
          if (!isObj(v)) continue;
          if (isObj(v.evidence)) { delete v.evidence.bbox; if (!seen[v.evidence.threadId]) v.evidence = null; else if (!firstThread) firstThread = v.evidence.threadId; }
        }
        const inst = M().build(s, null, { source: "mail", threads });
        if (existingKinds.indexOf(inst.kind) >= 0 || meltedKinds.indexOf(inst.kind) >= 0) continue;
        const inMail = (addr) => Object.keys(seen).some((tid) => (seen[tid].sender || "").toLowerCase().indexOf(String(addr).toLowerCase()) >= 0);
        if (inst.act && inst.act.to && !inMail(inst.act.to)) inst.act.to = null;
        if (inst.contact && inst.contact.to && !inMail(inst.contact.to)) inst.contact = null;
        if (firstThread && (!inst.contact || !inst.contact.to)) {
          const mids = seen[firstThread].messageIds || [];
          inst.contact = { to: senderEmail(seen[firstThread].sender), threadId: firstThread, messageId: mids.length ? mids[mids.length - 1] : null };
        }
        if (!S() || typeof S().upsert !== "function") throw fail("unknown", "The bench isn’t ready yet.");
        await S().upsert(inst);
        existingKinds.push(inst.kind);
        ids.push(inst.id);
      }
      const summary = plain(o.summary, 200) || (ids.length ? "I made " + ids.length + " from your mail." : "Nothing in your mail made a good instrument.");
      return { value: { ids, summary }, done: { instrumentId: ids[0] || null, isNew: ids.length > 0, snapped: false, summary } };
    });
  }

  /* ---------------- 7.4 plan mission ---------------- */
  function sortedSteps(inst) { return (inst.steps || []).slice().sort((a, b) => a.n - b.n); }
  function missionShell(inst) {
    return { id: uid("msn"), instrumentId: inst.id, title: "", minutes: 0, steps: [], beforePhoto: inst.photo || null,
      zoneId: null, focus: null,
      startedAt: null, endsAt: null, afterPhoto: null, verified: null, fieldNote: null };
  }
  function finishSteps(steps, cap) {
    let list = steps.filter((s) => s && s.text).slice(0, 7).map((s, i) => ({
      id: "m" + (i + 1), n: i + 1, text: plain(s.text, 72), minutes: clamp(Math.round(Number(s.minutes) * 2) / 2 || 1, 0.5, 25),
      pin: Array.isArray(s.pin) && s.pin.length >= 2 && isNum(Number(s.pin[0])) && Number(s.pin[0]) <= 1 && Number(s.pin[1]) <= 1 ? [Math.max(0, Number(s.pin[0])), Math.max(0, Number(s.pin[1]))] : null,
      done: false,
    }));
    let total = list.reduce((a, s) => a + s.minutes, 0);
    if (cap && total > cap) { const k = cap / total; list = list.map((s) => Object.assign(s, { minutes: Math.max(0.5, Math.round(s.minutes * k * 2) / 2) })); total = list.reduce((a, s) => a + s.minutes, 0); }
    return { steps: list, minutes: Math.round(total * 2) / 2 };
  }
  function cookList(inst) {
    const c = M().compute(inst);
    const raw = c._raw || {};
    const byId = {};
    (inst.items || []).forEach((it) => { byId[it.id] = it; });
    let ids = (raw._saved && raw._saved.length ? raw._saved : raw._risk) || [];
    if (!ids.length) ids = (inst.items || []).filter((i) => !i.cooked).slice().sort((a, b) => a.days - b.days).slice(0, 3).map((i) => i.id);
    return ids.map((id) => byId[id]).filter(Boolean);
  }
  /* a step that says what to do with this food, not "Cook the berries" */
  const FOOD = [
    [/chicken|turkey|roast/, (n, w) => "Shred the " + n + (w ? " into the " + w : " into a hot pan"), 5],
    [/spinach|kale|greens|lettuce|chard/, (n, w) => "Wilt the " + n + (w ? " into the " + w : " with garlic"), 3],
    [/berr|grape|cherr/, (n) => "Eat the " + n + " with yogurt", 2],
    [/feta|cheese|parmesan|mozzarella/, (n, w) => "Crumble the " + n + (w ? " over the " + w : " over the top"), 1],
    [/yogurt|yoghurt|cream/, (n) => "Spoon the " + n + " over the fruit", 1],
    [/pepper|zucchini|courgette|squash|aubergine|eggplant|carrot|broccoli/, (n) => "Slice and roast the " + n, 6],
    [/milk/, (n) => "Use the " + n + " in tomorrow’s oats", 1],
    [/bread|bun|roll|tortilla/, (n) => "Toast the " + n + " for the side", 2],
    [/mushroom/, (n) => "Fry the " + n + " until brown", 5],
    [/tomato/, (n) => "Halve the " + n + " and roast them", 5],
    [/egg/, (n) => "Scramble the " + n, 3],
    [/fish|salmon|cod|shrimp|prawn/, (n) => "Pan-sear the " + n, 6],
    [/rice|pasta|noodle/, (n) => "Fry the leftover " + n, 5],
    [/banana|apple|pear|peach|plum/, (n) => "Slice the " + n + " for dessert", 2],
  ];
  function foodStep(it, items, i) {
    const name = String(it.name || "food");
    const low = name.toLowerCase();
    const first = items[0] && items[0] !== it ? String(items[0].name || "") : "";
    for (const [re, make, min] of FOOD) if (re.test(low)) return { text: make(name, i > 0 && first && !/berr|yogurt/.test(low) ? first.replace(/^(half |a |an )/i, "") : ""), minutes: min, pin: it.pin };
    return { text: "Use the " + name + " tonight", minutes: 4, pin: it.pin };
  }
  function localPlan(inst) {
    const m = missionShell(inst);
    const subject = (inst.words && inst.words.subject) || inst.title.toLowerCase();
    if (inst.mold === "reset") {
      const take = Math.max(1, Math.round((inst.vars.take && inst.vars.take.value) || sortedSteps(inst).length));
      const f = finishSteps(sortedSteps(inst).slice(0, take), 0);
      const scale = inst.vars.minutes && f.minutes ? inst.vars.minutes.value / sortedSteps(inst).reduce((a, s) => a + s.minutes, 0) : 1;
      if (isNum(scale) && scale > 0 && Math.abs(scale - 1) > 0.05) f.steps.forEach((s) => { s.minutes = Math.max(0.5, Math.round(s.minutes * scale * 2) / 2); });
      return Object.assign(m, { title: "Clear " + (/^(the|this|my|your)\b/i.test(subject) ? subject : "the " + subject) + ".", steps: f.steps, minutes: Math.round(f.steps.reduce((a, s) => a + s.minutes, 0) * 2) / 2 });
    }
    if (inst.mold === "spoil") {
      const items = cookList(inst);
      const names = items.map((i) => i.name);
      const steps = [{ text: "Pull out the " + names.slice(0, 3).join(", "), minutes: 2, pin: items[0] && items[0].pin }]
        .concat(items.slice(0, 4).map((it, i) => foodStep(it, items, i)))
        .concat([{ text: "Box what’s left for tomorrow", minutes: 2, pin: null }]);
      const f = finishSteps(steps, 25);
      return Object.assign(m, { title: "Cook tonight: " + (names.length ? names.slice(0, 4).join(", ") : "what’s turning") + ".", steps: f.steps, minutes: f.minutes });
    }
    if (inst.mold === "dial") {
      const n = Math.round((inst.vars.steps && inst.vars.steps.value) || 1);
      const unit = (inst.words && inst.words.stepUnit) || "steps";
      const f = finishSteps([
        { text: "Find the control this bill runs on", minutes: 1 },
        { text: "Move it " + n + " " + unit, minutes: 1 },
        { text: "Seal the worst door or window gap", minutes: 3 },
        { text: "Photograph the meter for next time", minutes: 1 },
      ], 7);
      return Object.assign(m, { title: plain(n + " " + unit + ", starting now", 60) + ".", steps: f.steps, minutes: f.minutes });
    }
    const f = finishSteps([{ text: plain((inst.act && inst.act.why) || "Do the one thing this needs", 60), minutes: 5 }], 0);
    return Object.assign(m, { title: plain(inst.title, 40) + ".", steps: f.steps, minutes: f.minutes });
  }
  /* zones: one zone is one mission */
  function pickZone(inst, zoneId) {
    const zs = Array.isArray(inst.zones) ? inst.zones : [];
    const z = zoneId ? zs.find((x) => x.id === zoneId) : null;
    if (z) return z;
    return typeof M().nextZone === "function" ? M().nextZone(inst) : (zs.filter((x) => x.state !== "done")[0] || null);
  }
  function zoneBase(name) { return String(name || "zone").replace(/^(the|a|an)\s+/i, "").replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()); }
  function zoneMission(inst, zone, steps) {
    const m = missionShell(inst);
    const needMin = !steps.length || steps.some((s) => !isNum(Number(s.minutes)) || Number(s.minutes) <= 0);
    const list = needMin ? steps.map((s) => Object.assign({}, s, { minutes: Math.max(1, Math.round((zone.minutes || 30) / Math.max(1, steps.length))) })) : steps;
    const f = finishSteps(list, 0);
    return Object.assign(m, { title: "Clear the " + zoneBase(zone.name) + ".", steps: f.steps, minutes: needMin ? Math.round(zone.minutes || f.minutes) : f.minutes,
      zoneId: zone.id, focus: Array.isArray(zone.bbox) ? zone.bbox.slice(0, 4) : null, beforePhoto: inst.photo || null });
  }
  function zoneGenericSteps(zone) {
    const n = zoneBase(zone.name).toLowerCase();
    return [{ text: "Pull everything out of the " + n, minutes: 10, pin: zone.pin }, { text: "Sort keep / give / toss", minutes: 10, pin: zone.pin }, { text: "Put the keeps back, labelled", minutes: 10, pin: zone.pin }];
  }
  function validatePlan(o) {
    if (!isObj(o)) return ["The reply must be one JSON object."];
    const errs = [];
    if (typeof o.title !== "string" || !o.title.trim()) errs.push("\"title\" must be a short string.");
    if (!Array.isArray(o.steps) || !o.steps.length) errs.push("\"steps\" must be a non-empty array.");
    else o.steps.forEach((s, i) => { if (!isObj(s) || typeof s.text !== "string") errs.push("steps[" + i + "].text must be a string."); });
    return errs;
  }
  async function planMission(id, opts) {
    opts = opts || {};
    return run("plan", id, opts, async (job) => {
      const inst = storeGet(id);
      if (!inst) throw fail("unknown", "That instrument isn’t on the bench any more.");
      job.ctx = { mold: inst.mold };
      job.progress("writing");
      if (inst.mold === "zones") {
        const zone = pickZone(inst, opts.zoneId);
        if (!zone) throw fail("unknown", "Every zone here is clear.");
        const own = (zone.steps || []).filter((x) => x && x.text);
        if (own.length || inst.demo) {
          const m = zoneMission(inst, zone, own.length ? own : zoneGenericSteps(zone));
          return { value: m, done: { instrumentId: id, summary: m.title } };
        }
        let steps = zoneGenericSteps(zone);
        const caps = await capsNow();
        if (caps.sample) {
          try {
            const images = [];
            if (caps.images && inst.photo && (inst.photo.thumb || inst.photo.src)) {
              try { images.push(await WB.ai.rasterBlob(inst.photo.src || inst.photo.thumb, 1000)); } catch (e) { /* plan without the photo */ }
            }
            const o = await WB.ai.json(
              "You plan a short clearing mission in Workbench. The photo is the user's " + ((inst.words && inst.words.subject) || "space") + ".\n" +
              "Plan only the area called \"" + plain(zone.name, 28) + "\"" + (Array.isArray(zone.bbox) ? ", the region [x,y,w,h] = " + JSON.stringify(zone.bbox) + " (fractions 0..1 of the photo from its top-left)" : "") + ".\n" +
              "Give 2-5 imperative steps, each at most 9 words, specific to what is visible there, with minutes and a pin [x,y] in whole-photo fractions. No exclamation marks.\n" +
              "Return ONLY JSON: {\"title\": \"Clear the " + plain(zoneBase(zone.name), 28) + ".\", \"steps\": [{\"text\": \"...\", \"minutes\": <number>, \"pin\": [x,y]}]}",
              { images: images.length ? images : undefined, tier: "quick", signal: job.signal, validate: validatePlan });
            steps = o.steps.slice(0, 5);
          } catch (e) {
            if (job.signal.aborted || (e && e.code === "cancelled")) throw e;
          }
        }
        const m = zoneMission(inst, zone, steps);
        return { value: m, done: { instrumentId: id, summary: m.title } };
      }
      const local = localPlan(inst);
      const caps = inst.demo || inst.mold === "reset" || (inst.mold !== "spoil" && inst.mold !== "dial") ? null : await capsNow();
      if (!caps || !caps.sample) return { value: local, done: { instrumentId: id, summary: local.title } };
      let mission = local;
      try {
        if (inst.mold === "spoil") {
          const items = cookList(inst);
          const list = items.map((it) => ({ itemId: it.id, name: it.name, value: it.value, days: it.days, pin: it.pin }));
          const images = [];
          if (caps.images && inst.photo && (inst.photo.thumb || inst.photo.src)) {
            try { images.push(await WB.ai.rasterBlob(inst.photo.thumb || inst.photo.src, 640)); } catch (e) { /* plan without the photo */ }
          }
          const o = await WB.ai.json(
            "You plan a short cooking mission in Workbench. The photo is the user's " + ((inst.words && inst.words.subject) || "fridge") + ".\n" +
            "Plan tonight's cooking using exactly these at-risk items: " + JSON.stringify(list) + ".\n" +
            "Plain, specific, dry steps a tired person can follow. Each step text is imperative and at most 9 words. No exclamation marks.\n" +
            "Return ONLY JSON: {\"title\": \"<e.g. Cook tonight: spinach, chicken, feta.>\", \"minutes\": <number <= 25>, \"steps\": [{\"id\": \"m1\", \"n\": 1, \"text\": \"...\", \"minutes\": <number>, \"itemId\": \"<itemId it uses or null>\", \"pin\": [x,y] of the item it uses or null}]}",
            { images: images.length ? images : undefined, tier: "quick", signal: job.signal, validate: validatePlan });
          const byId = {};
          items.forEach((it) => { byId[it.id] = it; });
          const steps = o.steps.map((s) => Object.assign({}, s, { pin: (s.itemId && byId[s.itemId] && byId[s.itemId].pin) || s.pin || null }));
          const f = finishSteps(steps, 25);
          mission = Object.assign(missionShell(inst), { title: plain(o.title, 64), steps: f.steps, minutes: f.minutes });
        } else if (inst.mold === "dial") {
          const n = Math.round((inst.vars.steps && inst.vars.steps.value) || 1);
          const unit = (inst.words && inst.words.stepUnit) || "steps";
          const o = await WB.ai.json(
            "You plan a short physical mission in Workbench for a " + plain(inst.title, 40) + " (" + ((inst.words && inst.words.subject) || "utility bill") + ").\n" +
            "Give 3–5 physical steps (≤7 minutes total) to achieve '" + n + " " + unit + "' in a home, for this bill. Each step text is imperative and at most 9 words. No exclamation marks.\n" +
            "Return ONLY JSON: {\"title\": \"<short, e.g. Set the thermostat, seal the door gap.>\", \"minutes\": <number <= 7>, \"steps\": [{\"id\": \"m1\", \"n\": 1, \"text\": \"...\", \"minutes\": <number>, \"pin\": null}]}",
            { tier: "quick", signal: job.signal, validate: validatePlan });
          const f = finishSteps(o.steps.slice(0, 5).map((s) => Object.assign({}, s, { pin: null })), 7);
          mission = Object.assign(missionShell(inst), { title: plain(o.title, 64), steps: f.steps, minutes: f.minutes });
        }
      } catch (e) {
        if (job.signal.aborted || (e && e.code === "cancelled")) throw e;
        mission = local;
      }
      return { value: mission, done: { instrumentId: id, summary: mission.title } };
    });
  }

  /* ---------------- 7.5 verify mission ---------------- */
  /* zone missions also say whether the zone itself is clear */
  function withZone(mission, m, hint) {
    if (!mission || !mission.zoneId || !m || !m.verified) return m;
    const v = m.verified;
    if (typeof v.zoneClear !== "boolean") {
      const ids = (m.steps || []).map((s) => s.id);
      v.zoneClear = typeof hint === "boolean" ? hint : !!ids.length && (v.notDone || []).length === 0 && (v.done || []).length === ids.length;
    }
    return m;
  }
  async function selfCheck(mission, afterPhoto, inst) {
    if (inst && inst.demo && WB.demo && typeof WB.demo.verifyFallback === "function") {
      try {
        const r = await WB.demo.verifyFallback(mission, afterPhoto);
        if (isObj(r) && isObj(r.verified)) return withZone(mission, Object.assign({}, mission, r, { afterPhoto: r.afterPhoto || afterPhoto }), r.zoneClear);
        if (isObj(r) && Array.isArray(r.done)) {
          const done = r.done.map(String);
          return withZone(mission, Object.assign({}, mission, { afterPhoto, steps: (mission.steps || []).map((s) => Object.assign({}, s, { done: done.indexOf(s.id) >= 0 })),
            verified: { done, notDone: Array.isArray(r.notDone) ? r.notDone.map(String) : (mission.steps || []).map((s) => s.id).filter((x) => done.indexOf(x) < 0),
              reclaimed: clamp(Math.round(Number(r.reclaimed) || 0), 0, 100), by: r.by === "claude" ? "claude" : "self" },
            fieldNote: plain(r.fieldNote, 160) || "Checked by you." }), r.zoneClear);
        }
      } catch (e) { /* local self-check below */ }
    }
    const steps = mission.steps || [];
    const done = steps.filter((s) => s.done).map((s) => s.id);
    const notDone = steps.filter((s) => !s.done).map((s) => s.id);
    const reclaimed = steps.length ? Math.round((done.length / steps.length) * 100) : 0;
    return withZone(mission, Object.assign({}, mission, { afterPhoto, verified: { done, notDone, reclaimed, by: "self" }, fieldNote: "Checked by you." }));
  }
  function validateVerify(stepIds, zone) {
    return (o) => {
      if (!isObj(o)) return ["The reply must be one JSON object."];
      const errs = [];
      if (!Array.isArray(o.done)) errs.push("\"done\" must be an array of step ids.");
      if (!Array.isArray(o.notDone)) errs.push("\"notDone\" must be an array of step ids.");
      if (!isNum(Number(o.reclaimed))) errs.push("\"reclaimed\" must be a number 0-100.");
      if (typeof o.sameSpot !== "boolean") errs.push("\"sameSpot\" must be true or false.");
      if (typeof o.fieldNote !== "string") errs.push("\"fieldNote\" must be one sentence.");
      if (zone && typeof o.zoneClear !== "boolean") errs.push("\"zoneClear\" must be true or false.");
      const all = (o.done || []).concat(o.notDone || []);
      if (all.some((x) => stepIds.indexOf(String(x)) < 0)) errs.push("Use only these step ids: " + stepIds.join(", ") + ".");
      return errs;
    };
  }
  async function verifyMission(mission, afterFile, opts) {
    opts = opts || {};
    const instId = mission && mission.instrumentId;
    return run("verify", instId || null, opts, async (job) => {
      if (!mission) throw fail("unknown", "No mission to check.");
      if (!afterFile) throw fail("unknown", "No after photo was chosen.");
      job.progress("comparing");
      const inst = instId ? storeGet(instId) : null;
      const prep = await WB.ai.prepImage(afterFile);
      job.check();
      const afterPhoto = await storePhoto(prep, "after");
      job.check();
      const caps = inst && inst.demo ? null : await capsNow();
      const before = mission.beforePhoto;
      if (!caps || !caps.sample || !caps.images || !before || !(before.src || before.thumb)) {
        const m = await selfCheck(mission, afterPhoto, inst);
        return { value: m, done: { instrumentId: instId, summary: m.fieldNote } };
      }
      let beforeBlob = null;
      try { beforeBlob = await WB.ai.rasterBlob(before.src || before.thumb, 1600); }
      catch (e) { try { beforeBlob = await WB.ai.rasterBlob(before.thumb, 480); } catch (e2) { beforeBlob = null; } }
      job.check();
      if (!beforeBlob) {
        const m = await selfCheck(mission, afterPhoto, inst);
        return { value: m, done: { instrumentId: instId, summary: m.fieldNote } };
      }
      const steps = (mission.steps || []).map((s) => ({ id: s.id, text: s.text, tickedByUser: !!s.done }));
      const ids = steps.map((s) => s.id);
      const zone = !!mission.zoneId && Array.isArray(mission.focus) && mission.focus.length === 4;
      const zoneBlock = mission.zoneId
        ? "This is one zone of a bigger space. Compare only inside the region of image 1 at [x,y,w,h] = " + JSON.stringify(zone ? mission.focus : [0, 0, 1, 1]) +
          " (fractions 0..1 from the top-left) against the same region of image 2; ignore the rest. Also say whether that zone is now clear.\n"
        : "";
      const o = await WB.ai.json(
        "Image 1 is BEFORE, image 2 is AFTER of the same spot. Steps: " + JSON.stringify(steps) + ".\n" + zoneBlock +
        "Judge only what is visible. A step the user ticked but you cannot see done goes in notDone. If image 2 is clearly a different place, sameSpot is false.\n" +
        "Return ONLY JSON: {\"done\": [stepIds], \"notDone\": [stepIds], \"reclaimed\": <0-100, how much of the spot's mess is gone>, \"sameSpot\": <bool>," + (mission.zoneId ? " \"zoneClear\": <bool>," : "") + " \"fieldNote\": \"<one dry, specific line naming a concrete change, e.g. the mugs are gone; no exclamation marks>\"}",
        { images: [beforeBlob, prep.blob], tier: "default", signal: job.signal, timeoutMs: 90000, validate: validateVerify(ids, !!mission.zoneId),
          onChecking: () => job.progress("checking", null, "CHECKING THE CHANGES…"), onRetry: () => job.progress("retrying") });
      job.check();
      if (o.sameSpot === false) throw fail("not_same_spot");
      const done = o.done.map(String).filter((x) => ids.indexOf(x) >= 0);
      const notDone = ids.filter((x) => done.indexOf(x) < 0);
      const m = Object.assign({}, mission, {
        afterPhoto,
        steps: (mission.steps || []).map((s) => Object.assign({}, s, { done: done.indexOf(s.id) >= 0 })),
        verified: Object.assign({ done, notDone, reclaimed: clamp(Math.round(Number(o.reclaimed)), 0, 100), by: "claude" }, mission.zoneId ? { zoneClear: o.zoneClear === true } : {}),
        fieldNote: plain(o.fieldNote, 160) || null,
      });
      return { value: m, done: { instrumentId: instId, summary: m.fieldNote } };
    });
  }

  /* ---------------- 7.6 write draft ---------------- */
  const PURPOSES = ["cancel", "pause", "return", "ask", "renew", "update"];
  function intentionLine(inst) {
    const it = inst.intention;
    if (!it) return "none yet";
    const v = inst.vars[it.varId];
    const mold = M().get(inst.mold);
    const fmt = mold && mold.outputs[mold.primary] ? mold.outputs[mold.primary].format : "num";
    const g = M().ghost(inst);
    return (v ? v.label + ": " + M().format(it.value, v.format, inst) : "") + " (primary " + M().format(g.baseline, fmt, inst) + " → " + M().format(g.target, fmt, inst) + ")";
  }
  function givenAddresses(inst) {
    const out = [];
    [inst.contact && inst.contact.to, inst.act && inst.act.to].forEach((e) => { if (typeof e === "string" && /@/.test(e) && out.indexOf(e) < 0) out.push(e); });
    return out;
  }
  /* where a progress-style instrument stands, in words (project / zones) */
  function progressFacts(inst) {
    let done = 0, total = 0, unit = (inst.words && inst.words.unit) || "pieces", pace = null;
    if (inst.mold === "zones") {
      const z = typeof M().zoneStats === "function" ? M().zoneStats(inst) : { done: 0, total: (inst.zones || []).length };
      done = z.done; total = z.total; unit = "zones";
    } else {
      done = Math.round((inst.vars.done && inst.vars.done.value) || 0);
      total = Math.round((inst.vars.total && inst.vars.total.value) || 0);
    }
    if (inst.vars.pace) pace = inst.vars.pace.value;
    let finish = null;
    try { const c = M().compute(inst); if (c.outputs && isNum(c.outputs.finish)) finish = M().format(c.outputs.finish, "day", inst); } catch (e) { finish = null; }
    const stepList = (inst.steps || []).slice().sort((a, b) => (a.n || 0) - (b.n || 0));
    const nextStep = stepList.find((x) => x && !x.done);
    return { done, total, unit, pace, finish, next: nextStep ? clip(nextStep.text, 80) : null };
  }
  function updateDraft(inst) {
    const f = progressFacts(inst);
    const title = clip(inst.title, 40);
    const lines = [
      "Hi,",
      "",
      title + " stands at " + f.done + " of " + f.total + " " + f.unit + " done.",
      f.next ? "Next up: " + f.next.replace(/[.!]+$/, "") + "." : "Next up: I’ll pick the next piece this week.",
      f.finish ? "At this pace I expect to finish by " + f.finish + ". Does that date work, or is there something you need from me before then?" : "Could you tell me what date works for you for the next check-in?",
      "",
      "Thanks,",
      "[Name]",
    ];
    const to = inst.contact && validEmail(inst.contact.to);
    return { to: to ? [to] : [], subject: title + ": " + f.done + " of " + f.total + " " + f.unit + " done", body: lines.join("\n"), replyToMessageId: (inst.contact && inst.contact.messageId) || null, _f: f };
  }
  function localDraft(inst, purpose) {
    if (purpose === "update") { const d = updateDraft(inst); delete d._f; return d; }
    const subj = (inst.words && inst.words.subject) || inst.title;
    const sx = subj.replace(/^(the|this|my)\s+/i, "");
    const deadline = inst.vars.deadline ? M().format(inst.vars.deadline.value, "day", inst) : null;
    const T = {
      cancel: ["Cancel my " + sx, "Hi,\n\nPlease cancel my " + sx + " at the end of the current period. Could you confirm by email once it’s done, and tell me the date of the final charge?\n\nThanks,\n[Name]"],
      pause: ["Pause my " + sx, "Hi,\n\nCould you pause my " + sx + " for now? I’d like to keep the account, just stop the orders and charges until I restart it. Please confirm by email.\n\nThanks,\n[Name]"],
      return: ["Return request: " + sx, "Hi,\n\nI’d like to return " + sx + (deadline ? ". The return window closes " + deadline : "") + ". Could you send a return label, or tell me the next step?\n\nThanks,\n[Name]"],
      ask: ["Question about " + sx, "Hi,\n\nI have a question about " + sx + ". Could you tell me what my options are to bring the cost down, and whether there is a cheaper plan?\n\nThanks,\n[Name]"],
      renew: ["Before " + sx + " renews", "Hi,\n\nBefore " + sx + " renews, could you tell me the renewal price and whether a smaller plan is available? I’d like to decide before the date.\n\nThanks,\n[Name]"],
    };
    const t = T[purpose] || T.ask;
    return { to: givenAddresses(inst), subject: t[0], body: t[1], replyToMessageId: (inst.contact && inst.contact.messageId) || null };
  }
  async function writeDraft(id, opts) {
    opts = opts || {};
    const purpose = PURPOSES.indexOf(opts.purpose) >= 0 ? opts.purpose : "ask";
    return run("draft", id, opts, async (job) => {
      const inst = storeGet(id);
      if (!inst) throw fail("unknown", "That instrument isn’t on the bench any more.");
      job.progress("writing");
      const fallback = localDraft(inst, purpose);
      if (inst.demo) {
        let d = null;
        try { if (WB.demo && typeof WB.demo.draftFallback === "function") d = await WB.demo.draftFallback(inst, { purpose }); } catch (e) { d = null; }
        const out = isObj(d) && typeof d.body === "string" ? { to: Array.isArray(d.to) ? d.to.map(String) : fallback.to, subject: String(d.subject || fallback.subject), body: d.body, replyToMessageId: d.replyToMessageId || null } : fallback;
        return { value: out, done: { instrumentId: id, summary: out.subject } };
      }
      const caps = await capsNow();
      if (!caps.sample) return { value: fallback, done: { instrumentId: id, summary: fallback.subject } };
      const given = purpose === "update" ? fallback.to.slice() : givenAddresses(inst);
      let out = fallback;
      try {
        const upd = purpose === "update" ? updateDraft(inst)._f : null;
        const o = await WB.ai.json(
          (upd
            ? "Write a short progress note as the user to their collaborator, for Workbench.\n" +
              "About: " + plain(inst.title, 40) + ". Done: " + upd.done + " of " + upd.total + " " + upd.unit + ". Next step: " + (upd.next || "not set") + ". Expected finish: " + (upd.finish || "unknown") + ".\n" +
              "Exactly 3-5 plain lines in the body: where it stands, the next step, one concrete ask or date. Subject: \"" + plain(inst.title, 40) + ": " + upd.done + " of " + upd.total + " " + upd.unit + " done\".\n"
            : "Write a short email as the user, for Workbench.\n") +
          (upd ? "" :
          "About: " + plain(inst.title, 40) + " — " + plain((inst.words && inst.words.subject) || inst.title, 60) + " (" + inst.mold + ").\n" +
          "Their intention: " + intentionLine(inst) + ".\n" +
          "Purpose: " + purpose + ".\n") +
          "Addresses you were given: " + JSON.stringify(given) + ".\n" +
          (inst.enriched && inst.enriched.summary ? "What their mail showed: " + plain(inst.enriched.summary, 200) + "\n" : "") +
          "Write as the user. Plain text, ≤90 words, polite, specific, no exclamation marks, no AI phrasing, no placeholders except [Name] if unknown.\n" +
          "Return ONLY JSON: {\"to\": [only addresses you were given], \"subject\": \"...\", \"body\": \"...\"}",
          { tier: "quick", signal: job.signal,
            validate: (x) => (!isObj(x) ? ["Return one JSON object."] : [typeof x.subject !== "string" || !x.subject.trim() ? "\"subject\" is required." : null, typeof x.body !== "string" || !x.body.trim() ? "\"body\" is required." : null].filter(Boolean)) });
        const lower = given.map((e) => e.toLowerCase());
        let to = (Array.isArray(o.to) ? o.to : []).map(String).filter((e) => lower.indexOf(e.toLowerCase()) >= 0);
        if (!to.length) to = given.slice();
        out = { to, subject: clip(o.subject, 120).replace(/!+/g, ""), body: String(o.body).replace(/!/g, ".").slice(0, 1200).trim(), replyToMessageId: (inst.contact && inst.contact.messageId) || null };
      } catch (e) {
        if (job.signal.aborted || (e && e.code === "cancelled")) throw e;
        if (e && e.code === "rate_limited") throw e;
        out = fallback;
      }
      return { value: out, done: { instrumentId: id, summary: out.subject } };
    });
  }

  /* ---------------- 7.7 write a Drive brief for the next step ---------------- */
  function briefText(inst, outline) {
    const f = progressFacts(inst);
    const title = clip(inst.title, 40);
    const step = f.next || "Pick the next piece and write down what it needs";
    const stepRec = (inst.steps || []).slice().sort((a, b) => (a.n || 0) - (b.n || 0)).find((x) => x && !x.done);
    const mins = stepRec && isNum(Number(stepRec.minutes)) ? Math.round(Number(stepRec.minutes)) : 25;
    const lines = (outline && outline.length ? outline : [1, 2, 3].map((i) => "Unit " + (f.done + i) + ": …")).slice(0, 3);
    return {
      title: title + " — next step brief",
      text: [
        "Where it stands",
        f.done + " of " + f.total + " " + f.unit + " done" + (isNum(f.pace) ? ", at " + M().format(f.pace, "num", inst) + " a week" : "") + (f.finish ? ", finishing " + f.finish : "") + ".",
        "",
        "The next step",
        step.replace(/[.!]+$/, "") + " (" + mins + " min).",
        "",
        "Outline for the next 3 " + f.unit,
        lines.map((l) => "- " + l).join("\n"),
        "",
        "Done means",
        "That step is finished and the count moves from " + f.done + " to " + Math.min(f.total, f.done + 1) + ".",
      ].join("\n"),
    };
  }
  async function writeBrief(id, opts) {
    opts = opts || {};
    return run("brief", id, opts, async (job) => {
      const inst = storeGet(id);
      if (!inst) throw fail("unknown", "That instrument isn’t on the bench any more.");
      job.progress("writing");
      let out = briefText(inst, null);
      const caps = inst.demo ? null : await capsNow();
      if (caps && caps.sample) {
        try {
          const f = progressFacts(inst);
          const o = await WB.ai.json(
            "You help the user keep a project moving, inside Workbench.\n" +
            "Project: " + plain(inst.title, 40) + (inst.fieldNote ? " — " + plain(inst.fieldNote, 180) : "") + ". Done " + f.done + " of " + f.total + " " + f.unit + ". Next step: " + (f.next || "not set") + ".\n" +
            "Steps on the list: " + JSON.stringify((inst.steps || []).map((x) => x.text)) + ".\n" +
            "Write a one-line outline for each of the next 3 " + f.unit + ", each starting \"Unit N: \" style with the number and a specific, plain idea (at most 14 words). No exclamation marks.\n" +
            "Return ONLY JSON: {\"outline\": [\"<line 1>\", \"<line 2>\", \"<line 3>\"]}",
            { tier: "quick", signal: job.signal,
              validate: (x) => (!isObj(x) || !Array.isArray(x.outline) || !x.outline.length ? ["\"outline\" must be an array of 3 short lines."] : []) });
          const lines = o.outline.map((l) => plain(l, 120)).filter(Boolean).slice(0, 3);
          if (lines.length) out = briefText(inst, lines);
        } catch (e) {
          if (job.signal.aborted || (e && e.code === "cancelled")) throw e;
          if (e && e.code === "rate_limited") throw e;
        }
      }
      return { value: out, done: { instrumentId: id, summary: out.title } };
    });
  }

  WB.forge = { fromPhoto, enrich, fromMail, planMission, verifyMission, writeDraft, cancel, fromForm, writeBrief,
    /* extras beyond the contract */
    active: () => Object.keys(jobs).map((k) => ({ jobId: k, kind: jobs[k].kind, instrumentId: jobs[k].instrumentId })),
    _prompts: { photo: photoPrompt, enrich: enrichPrompt, mail: mailPrompt },
  };
})();
