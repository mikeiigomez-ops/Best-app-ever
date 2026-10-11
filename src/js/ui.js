/* Upscroll — shell: feed, HUD, tabs, sheets, effects. */
(function () {
  const UP = window.UP;
  const { $, $$, h, icon, store, engine, bus, sfx, buzz, now, clamp } = UP;
  const S = engine.session;

  const ui = (UP.ui = {});
  let feed, history = [], filter = "mix", current = null, io;
  const pending = []; // specs to insert next

  /* ================= feed ================= */
  function append(spec) {
    const el = UP.cards.render(spec);
    history.push(spec);
    feed.append(el);
    io.observe(el);
    return el;
  }
  function fill(min = 3) {
    const cards = $$(".card", feed);
    const idx = current ? cards.indexOf(current) : 0;
    let ahead = cards.length - 1 - idx;
    while (ahead < min) {
      const spec = pending.length ? pending.shift() : engine.next(history, filter);
      if (spec.key == null) spec.key = UP.uid("c");
      append(spec);
      ahead++;
    }
  }
  ui.insertNext = (spec) => {
    spec.key = UP.uid("c");
    // replace the card right after the current one so it is literally next
    const cards = $$(".card", feed);
    const idx = cards.indexOf(current);
    const el = UP.cards.render(spec);
    if (idx >= 0 && cards[idx + 1]) feed.insertBefore(el, cards[idx + 1]);
    else feed.append(el);
    history.push(spec);
    io.observe(el);
  };
  let kbNav = false;
  ui.advance = () => {
    const cards = $$(".card", feed);
    const idx = cards.indexOf(current);
    const nxt = cards[idx + 1];
    if (nxt) nxt.scrollIntoView({ behavior: UP.reducedMotion() ? "auto" : "smooth", block: "start" });
  };
  function back() {
    const cards = $$(".card", feed);
    const idx = cards.indexOf(current);
    if (idx > 0) cards[idx - 1].scrollIntoView({ behavior: UP.reducedMotion() ? "auto" : "smooth", block: "start" });
  }

  let enteredAt = now();
  function onCurrent(el) {
    if (current === el) return;
    if (current && current._leave) current._leave();
    if (current) {
      const secs = Math.min(120, (now() - enteredAt) / 1000);
      // the feed also learns from how you scroll: instant skips count a little against, lingering a little for
      const ps = current._spec;
      if (ps && !["brief", "chest", "receipt", "one", "review"].includes(ps.kind)) {
        const engaged = current.classList.contains("done");
        if (!engaged && secs < 1.5) store.lean(current._topicKey, ps.kind, -0.15);
        else if (engaged || secs > 8) store.lean(current._topicKey, ps.kind, 0.06);
      }
      UP.state.stats.secs += secs;
      store.today().secs += secs;
    }
    current = el;
    enteredAt = now();
    $$(".card.active", feed).forEach((c) => { c.classList.remove("active"); c.inert = true; });
    el.classList.add("active");
    el.inert = false;
    if (kbNav) { kbNav = false; el.focus({ preventScroll: true }); }
    const spec = el._spec;
    if (!el._counted) {
      el._counted = true;
      S.cards++;
      UP.state.stats.cards++;
      store.today().cards++;
      if (spec.data && spec.data.id === spec.id && !/^[vj]-/.test(spec.id)) UP.state.seen[spec.id] = now();
    }
    const slot = $("#rail-slot");
    if (slot) slot.replaceChildren(...(el._rail ? [el._rail] : []));
    if (el._enter) el._enter();
    fill(5);
    schedulePrune();
    maybeDig();
    hint(false);
    store.save();
  }
  let pruneT;
  function schedulePrune() {
    // never prune mid-scroll: removing cards during a smooth scroll makes the feed jump
    clearTimeout(pruneT);
    pruneT = setTimeout(prune, 900);
  }
  let lastScroll = 0;
  function prune() {
    if (now() - lastScroll < 700) return schedulePrune();
    const cards = $$(".card", feed);
    const idx = cards.indexOf(current);
    if (idx > 40) {
      const drop = cards.slice(0, idx - 30);
      const offset = feed.scrollTop - current.offsetTop;
      drop.forEach((c) => { io.unobserve(c); c.remove(); });
      feed.scrollTop = current.offsetTop + offset;
    }
  }
  function resetFeed() {
    $$(".card", feed).forEach((c) => { io.unobserve(c); c.remove(); });
    history = [];
    current = null;
    fill(3);
    feed.scrollTop = 0;
    const first = $(".card", feed);
    if (first) onCurrent(first);
  }
  ui.resetFeed = resetFeed;

  /* rabbit holes refill as you scroll (each fetch rides on a swipe, never a timer) */
  const holeFails = {}; // id -> {n, at}: back off after failures instead of retrying on every swipe
  function maybeDig() {
    if (!UP.ai.available() || !UP.state.holes.length) return;
    for (const hole of engine.holesNeedingCards()) {
      const f = holeFails[hole.id];
      if (f && now() - f.at < Math.min(30 * 60000, 20000 * Math.pow(2, f.n))) continue;
      UP.ai.digHole(hole).then((cards) => {
        if (cards.length) delete holeFails[hole.id];
        else holeFails[hole.id] = { n: ((f && f.n) || 0) + 1, at: now() };
      }).catch((e) => {
        holeFails[hole.id] = { n: ((f && f.n) || 0) + 1, at: now() };
        const msg = UP.ai.handleError(e);
        if (msg && !maybeDig.warned) { maybeDig.warned = true; ui.toast(msg); }
      });
      break;
    }
  }

  /* ================= HUD ================= */
  function renderHud() {
    const st = UP.state;
    const L = store.levelInfo(st.xp);
    const t = store.today();
    const goal = st.settings.dailyGoal;
    const pct = clamp(t.xp / goal, 0, 1);
    const ringC = 2 * Math.PI * 15;
    $("#goal-ring .fg").style.strokeDashoffset = String(ringC * (1 - pct));
    $("#goal-ring").classList.toggle("full", pct >= 1);
    $("#goal-num").textContent = String(t.xp);
    $("#goal-ring").setAttribute("aria-label", t.xp + " of " + goal + " XP today");
    $("#lvl-num").textContent = String(L.level);
    $("#lvl-title").textContent = L.title;
    $("#lvl-bar i").style.transform = "scaleX(" + L.pct + ")";
    const streak = store.streakAlive();
    $("#streak-num").textContent = String(streak);
    $("#streak").setAttribute("aria-label", "Streak: " + streak + (streak === 1 ? " day" : " days"));
    $("#lvl-bar").setAttribute("aria-valuenow", String(Math.round(L.pct * 100)));
    $("#streak").classList.toggle("lit", st.streak.last === UP.dayKey());
    $("#streak").title = st.streak.last === UP.dayKey() ? "Streak safe today" : "Earn " + store.STREAK_MIN + " XP today to keep your streak";
    const c = st.combo;
    const combo = $("#combo");
    combo.hidden = c < 2;
    combo.textContent = c + "x";
    combo.classList.toggle("hot", c >= 5);
    const boost = $("#boost");
    boost.hidden = !(S.boost > 0);
    boost.textContent = "2x XP · " + (S.boost || 0);
  }
  ui.renderHud = renderHud;

  /* ================= effects ================= */
  let fx, fxc, parts = [], fxRun = false;
  function fxLoop() {
    fxc.clearRect(0, 0, fx.width, fx.height);
    parts = parts.filter((p) => p.life > 0);
    for (const p of parts) {
      p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.985; p.life -= 1; p.rot += p.vr;
      fxc.globalAlpha = Math.min(1, p.life / 30);
      fxc.fillStyle = p.color;
      fxc.save();
      fxc.translate(p.x, p.y);
      fxc.rotate(p.rot);
      if (p.shape === "dot") { fxc.beginPath(); fxc.arc(0, 0, p.s, 0, 7); fxc.fill(); }
      else fxc.fillRect(-p.s, -p.s / 2.5, p.s * 2, p.s / 1.25);
      fxc.restore();
    }
    fxc.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(fxLoop);
    else fxRun = false;
  }
  function spawn(x, y, n, spread, shape) {
    if (UP.reducedMotion()) return;
    const dpr = window.devicePixelRatio || 1;
    const colors = ["#f6cf6f", "#ffe6a6", "#7ee0cf", "#ff9a8a", "#b9a4ff", "#ffffff"];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (1 + Math.random() * spread) * dpr;
      parts.push({ x: x * dpr, y: y * dpr, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spread * 0.6 * dpr, g: 0.18 * dpr, life: 50 + Math.random() * 40, color: UP.pick(colors), s: (2 + Math.random() * 3) * dpr, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, shape: shape || (Math.random() < 0.5 ? "dot" : "rect") });
    }
    if (!fxRun) { fxRun = true; requestAnimationFrame(fxLoop); }
  }
  function centerOf(el) {
    if (!el || !el.getBoundingClientRect) return { x: innerWidth / 2, y: innerHeight / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  ui.burst = (el, n = 12) => { const c = centerOf(el); spawn(c.x, c.y, n, 3, "dot"); };
  ui.confetti = (el) => { const c = centerOf(el); spawn(c.x, c.y, 70, 7); };

  function floatXP(amount, anchor) {
    const c = centerOf(anchor);
    const f = h("div", { class: "float-xp" }, "+" + amount);
    f.style.left = c.x + "px";
    f.style.top = c.y + "px";
    document.body.append(f);
    setTimeout(() => f.remove(), 1100);
  }

  ui.announce = (text) => {
    const live = $("#sr-live");
    if (!live) return;
    live.textContent = "";
    setTimeout(() => { live.textContent = text; }, 30);
  };
  let toastT;
  ui.toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("show"), 2200);
  };

  function banner(kicker, title, sub) {
    const b = h("div", { class: "banner", role: "status" }, h("span", { class: "b-kick" }, kicker), h("strong", null, title), sub ? h("span", { class: "b-sub" }, sub) : null);
    document.body.append(b);
    requestAnimationFrame(() => b.classList.add("show"));
    setTimeout(() => { b.classList.remove("show"); setTimeout(() => b.remove(), 500); }, 2600);
  }

  ui.banner = banner;
  ui.countUp = (el, from, to, unit, fmt) => {
    const show = fmt || ((v) => UP.fmtNum(v, unit));
    if (UP.reducedMotion()) { el.textContent = show(to); return; }
    const t0 = performance.now(), dur = 900;
    const log = from > 0 && to > 0;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      const v = log ? Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * e) : from + (to - from) * e;
      el.textContent = show(p >= 1 ? to : v);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ================= sheets ================= */
  let lastFocus = null;
  function sheet(title, body, opts = {}) {
    closeSheet();
    lastFocus = document.activeElement;
    const close = h("button", { class: "icon-btn", "aria-label": "Close" }, icon("close"));
    const panel = h("div", { class: "sheet" + (opts.tall ? " tall" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "sheet-head" }, h("h3", null, title), close),
      h("div", { class: "sheet-body" }, body)
    );
    const scrim = h("div", { class: "scrim" }, panel);
    scrim.addEventListener("click", (e) => { if (e.target === scrim) closeSheet(); });
    close.addEventListener("click", closeSheet);
    document.body.append(scrim);
    $("#app").inert = true;
    if (!$("#onboard").hidden) $("#onboard").inert = true;
    requestAnimationFrame(() => scrim.classList.add("show"));
    scrim._onClose = opts.onClose;
    scrim.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeSheet(); } });
    setTimeout(() => { if (!panel.contains(document.activeElement)) close.focus(); }, 60);
    return { panel, scrim };
  }
  function closeSheet() {
    const s = $(".scrim:not(.closing)");
    if (!s) return;
    s.classList.add("closing");
    $("#app").inert = !$("#onboard").hidden;
    $("#onboard").inert = false;
    if (s._onClose) s._onClose();
    s.classList.remove("show");
    setTimeout(() => s.remove(), 250);
    if (lastFocus && lastFocus.isConnected && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    lastFocus = null;
  }
  ui.closeSheet = closeSheet;
  ui.sheetRaw = (title, body) => sheet(title, body, { tall: true });

  ui.compose = ({ title, prompt, placeholder, onSave, multi, hint }) => {
    const id = "compose-" + Date.now();
    const input = h(multi ? "textarea" : "input", { id, class: "field", placeholder: placeholder || "", rows: multi ? "4" : null, maxlength: "1200", "aria-label": title });
    const save = h("button", { class: "btn primary wide" }, "Save");
    const body = h("div", { class: "compose" }, prompt ? h("p", { class: "compose-prompt" }, prompt) : null, input, hint ? h("p", { class: "hint" }, hint) : null, save);
    sheet(title, body);
    setTimeout(() => input.focus(), 80);
    let saved = false;
    const go = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      if (saved) return;
      saved = true;
      save.disabled = true;
      closeSheet();
      onSave(v);
    };
    save.addEventListener("click", go);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing && (!multi || e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); }
    });
  };

  /* streamed Claude answer in a sheet, with optional follow-up chat */
  ui.claudeSheet = (title, quote, run, chat) => {
    const out = h("div", { class: "claude-out", "aria-live": "polite" }, h("p", { class: "thinking" }, "Thinking..."));
    const stop = h("button", { class: "btn ghost small" }, "Stop");
    const thread = h("div", { class: "thread" }, out);
    const body = h("div", { class: "claude" }, quote ? h("p", { class: "claude-quote" }, quote) : null, thread);
    let ctl = new AbortController();
    stop.addEventListener("click", () => ctl.abort());
    const foot = h("div", { class: "claude-foot" }, stop);
    body.append(foot);
    sheet(title, body, { tall: true, onClose: () => ctl.abort() });
    const turns = [];
    async function ask(target, runner) {
      stop.hidden = false;
      try {
        const res = await runner(({ text }) => { target.textContent = text; }, ctl.signal);
        target.textContent = res.text;
        return res.text;
      } catch (e) {
        target.textContent = e.text || "";
        const msg = UP.ai.handleError(e);
        if (msg) target.append(h("span", { class: "err" }, (e.text ? "\n" : "") + msg));
        return null;
      } finally {
        stop.hidden = true;
      }
    }
    (async () => {
      const first = await ask(out, run);
      if (!chat || first == null) return;
      turns.push({ role: "assistant", content: first });
      const fid = "followup-" + Date.now();
      const input = h("input", { id: fid, class: "field", placeholder: "Ask a follow-up", "aria-label": "Ask a follow-up" });
      const send = h("button", { class: "icon-btn send", "aria-label": "Send" }, icon("send"));
      const form = h("form", { class: "ask-row" }, input, send);
      foot.prepend(form);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (!q || send.disabled) return;
        input.value = "";
        send.disabled = input.disabled = true;
        thread.append(h("p", { class: "me" }, q));
        const ans = h("div", { class: "claude-out" }, h("p", { class: "thinking" }, "Thinking..."));
        thread.append(ans);
        ans.scrollIntoView({ block: "end" });
        turns.push({ role: "user", content: q });
        ctl = new AbortController();
        const text = await ask(ans, (onText, signal) => chat(turns.slice(-8), onText, signal));
        if (text) turns.push({ role: "assistant", content: text });
        else turns.pop();
        send.disabled = input.disabled = false;
        input.focus();
      });
    })();
  };

  ui.deeper = (spec) => {
    const d = spec.data || {};
    const card = { headline: d.headline || d.word, body: d.body || d.def, explain: d.explain || d.example, word: d.word };
    store.lean(d.topic, spec.kind, 0.5);
    ui.claudeSheet("Go deeper", card.headline,
      (onText, signal) => UP.ai.deeper(card, [], onText, signal),
      (turns, onText, signal) => UP.ai.deeper(card, turns, onText, signal));
  };

  ui.endSession = () => {
    const list = UP.cards.tomorrowList();
    const mins = Math.max(1, Math.round((now() - S.start) / 60000));
    const body = h("div", { class: "compose end" },
      h("p", { class: "compose-prompt" }, "Good session. " + mins + " minute" + (mins === 1 ? "" : "s") + " that paid you back."),
      h("p", { class: "lede" }, "Go do something offline. Upscroll will be here when you reach for your phone again."),
      list.length ? h("div", { class: "tomorrow" }, h("p", { class: "kicker" }, "Waiting for you tomorrow"), h("ul", null, ...list.map((x) => h("li", null, x)))) : null,
      h("button", { class: "btn ghost wide", onclick: () => closeSheet() }, "Actually, a few more")
    );
    sheet("See you later", body);
  };

  /* ---------- share a card as a picture ---------- */
  function wrapLines(ctx, text, maxW) {
    const words = String(text).split(/\s+/), lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  ui.shareCard = async (spec) => {
    const d = spec.data || {};
    const hue = engine.TOPICS[d.topic] ? engine.TOPICS[d.topic].hue : spec.kind === "word" ? 340 : spec.kind === "ai" ? 265 : 172;
    let kicker, title, body;
    if (spec.kind === "word") { kicker = "A word worth knowing"; title = d.word; body = d.def + (d.example ? "\n\n\u201c" + d.example + "\u201d" : ""); }
    else if (spec.kind === "estimate") { kicker = "Guess first"; title = d.q; body = "Answer: " + UP.fmtNum(d.answer, d.unit) + ". " + (d.explain || ""); }
    else { kicker = spec.kind === "ai" ? d.topic : (engine.TOPICS[d.topic] || { label: "Did you know" }).label; title = d.headline; body = d.body; }
    try { await document.fonts.ready; } catch (e) { /* draw with fallbacks */ }
    const c = document.createElement("canvas");
    c.width = 1080; c.height = 1350;
    const x = c.getContext("2d");
    const bg = x.createLinearGradient(0, 0, 0, 1350);
    bg.addColorStop(0, "hsl(" + hue + ",45%,14%)"); bg.addColorStop(0.7, "#0a0e1b"); bg.addColorStop(1, "#0a0e1b");
    x.fillStyle = bg; x.fillRect(0, 0, 1080, 1350);
    const glow = x.createRadialGradient(900, 80, 0, 900, 80, 700);
    glow.addColorStop(0, "hsla(" + hue + ",80%,55%,0.45)"); glow.addColorStop(1, "hsla(" + hue + ",80%,55%,0)");
    x.fillStyle = glow; x.fillRect(0, 0, 1080, 1350);
    const stars = UP.mulberry(UP.hash(spec.id || "x"));
    for (let i = 0; i < 70; i++) { x.fillStyle = "rgba(220,228,255," + (0.15 + stars() * 0.5) + ")"; x.beginPath(); x.arc(stars() * 1080, stars() * 1350, stars() * 2.2, 0, 7); x.fill(); }
    x.fillStyle = "hsl(" + hue + ",85%,80%)";
    x.font = '700 30px "JetBrains Mono", monospace';
    x.fillText(String(kicker).toUpperCase(), 96, 190);
    x.fillStyle = "#eef1fa";
    let size = 84;
    x.font = '800 ' + size + 'px "Bricolage Grotesque", sans-serif';
    let tl = wrapLines(x, title, 888);
    while (tl.length > 5 && size > 54) { size -= 6; x.font = '800 ' + size + 'px "Bricolage Grotesque", sans-serif'; tl = wrapLines(x, title, 888); }
    let y = 300;
    for (const l of tl) { x.fillText(l, 96, y); y += size * 1.08; }
    x.fillStyle = "#c3cadf";
    x.font = '400 40px "Figtree", sans-serif';
    y += 30;
    for (const para of String(body || "").split("\n")) {
      for (const l of wrapLines(x, para, 888)) { if (y > 1180) break; x.fillText(l, 96, y); y += 56; }
    }
    x.fillStyle = "#f5c95c";
    x.font = '800 40px "Bricolage Grotesque", sans-serif';
    x.fillText("upscroll", 96, 1262);
    x.fillStyle = "#8b95b3";
    x.font = '400 28px "Figtree", sans-serif';
    x.fillText("a feed that gives back", 300, 1260);
    const url = c.toDataURL("image/png");
    const text = title + "\n\n" + (body || "") + "\n\n(via Upscroll)";
    const save = h("button", { class: "btn primary" }, "Save image");
    const copy = h("button", { class: "btn ghost" }, icon("copy"), "Copy text");
    const note = h("p", { class: "hint", "aria-live": "polite" });
    save.addEventListener("click", async () => {
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      let ok = false;
      try {
        const dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
        if (dl) { await dl.save({ filename: "upscroll-card.png", data: blob }); ok = true; }
      } catch (e) { ok = false; }
      if (!ok) {
        try { const u = URL.createObjectURL(blob); const a = h("a", { href: u, download: "upscroll-card.png" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); ok = true; } catch (e) { ok = false; }
      }
      note.textContent = ok ? "Saved. Send it to someone who'd love it." : "Long-press the picture to save it.";
    });
    copy.addEventListener("click", async () => {
      const ok = await UP.copyText(text);
      note.textContent = ok ? "Copied. Paste it anywhere." : "Select the text in the picture's caption to copy it.";
    });
    sheet("Share", h("div", { class: "compose share" }, h("img", { src: url, alt: title, class: "share-img" }), h("div", { class: "row" }, save, copy), note), { tall: true });
  };

  ui.quickCapture = () => {
    let kind = "task";
    const kinds = [["task", "To-do"], ["idea", "Idea"], ["question", "Question"]];
    const chips = h("div", { class: "chips" }, ...kinds.map(([k, label]) => {
      const b = h("button", { class: "chip-btn" + (k === kind ? " on" : ""), "aria-pressed": String(k === kind) }, label);
      b.addEventListener("click", () => {
        kind = k;
        chips.querySelectorAll(".chip-btn").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
        input.focus();
      });
      return b;
    }));
    const input = h("textarea", { id: "quick-capture", class: "field", rows: "3", maxlength: "600", placeholder: "Whatever's on your mind. One per line.", "aria-label": "Capture" });
    const save = h("button", { class: "btn primary wide" }, "Save to vault");
    let saved = false;
    const go = () => {
      const lines = input.value.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 40);
      if (!lines.length) { input.focus(); return; }
      if (saved) return;
      saved = true;
      save.disabled = true;
      lines.forEach((l) => store.addVault(kind, l));
      UP.state.stats.captures += lines.length; S.captures += lines.length;
      store.questProgress("capture");
      store.award(store.captureXp(lines.length), { reason: "Captured", anchor: $("#capture-btn") });
      closeSheet();
      ui.toast(lines.length === 1 ? "Saved to your vault" : lines.length + " things saved to your vault");
      if (document.body.dataset.tab === "vault") UP.vault.render();
    };
    save.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } });
    const sort = h("button", { class: "btn ghost wide needs-ai" }, icon("spark"), "Messy list? Let Claude sort it");
    sort.addEventListener("click", () => { const text = input.value.trim(); closeSheet(); setTimeout(() => UP.vault.untangle(text), 260); });
    sheet("Capture", h("div", { class: "compose" }, chips, input, save, sort));
    setTimeout(() => input.focus(), 80);
  };

  /* ================= rabbit holes ================= */
  const HOLE_IDEAS = ["How the stock market actually works", "Ancient Rome", "Spanish for travel", "Black holes", "Negotiation", "The science of cooking", "Stoicism", "How AI models work", "Wine basics", "Human evolution", "Investing for beginners", "Photography basics"];
  ui.holes = () => {
    let ownScrim = null;
    const avail = UP.ai.available();
    const list = h("div", { class: "hole-list" });
    const renderList = () => {
      list.innerHTML = "";
      for (const hole of UP.state.holes) {
        const tog = h("button", { class: "chip-btn" + (hole.active ? " on" : ""), "aria-pressed": hole.active ? "true" : "false" }, hole.active ? "On" : "Off");
        tog.addEventListener("click", () => { hole.active = !hole.active; store.save(); renderList(); });
        const del = h("button", { class: "icon-btn", "aria-label": "Remove " + hole.topic }, icon("trash"));
        del.addEventListener("click", () => { UP.state.holes = UP.state.holes.filter((x) => x !== hole); store.save(); renderList(); });
        list.append(h("div", { class: "hole" },
          h("div", { class: "hole-main" }, h("b", null, hole.topic), h("span", null, (hole.count || 0) + " cards dug" + (UP.ai.digging(hole.id) ? " · digging..." : ""))),
          tog, del));
      }
      if (!UP.state.holes.length) list.append(h("p", { class: "hint" }, "No rabbit holes yet. Pick anything you've been meaning to understand."));
    };
    renderList();
    const input = h("input", { id: "hole-input", class: "field", placeholder: "Any topic: chess openings, the French Revolution, sourdough...", maxlength: "80", "aria-label": "Rabbit hole topic" });
    const go = h("button", { class: "btn primary", type: "submit" }, "Dig in");
    const status = h("p", { class: "hint", "aria-live": "polite" });
    const form = h("form", { class: "hole-form" }, input, go);
    const chips = h("div", { class: "chips" }, ...HOLE_IDEAS.map((t) => h("button", { class: "chip-btn", type: "button", onclick: () => { input.value = t; input.focus(); } }, t)));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const topic = input.value.trim();
      if (!topic) return;
      const hole = { id: UP.uid("h"), topic, active: true, createdAt: now(), count: 0, headlines: [], queue: [] };
      UP.state.holes.unshift(hole);
      store.save();
      input.value = "";
      renderList();
      go.disabled = true;
      status.textContent = "Claude is writing your first cards on " + topic + "...";
      try {
        const cards = await UP.ai.digHole(hole);
        if (!cards.length) { status.textContent = "Claude's cards for that didn't come through cleanly. Try again, or word the topic a little differently."; renderList(); return; }
        UP.state.aiOk = true;
        store.save();
        status.textContent = cards.length + (cards.length === 1 ? " card" : " cards") + " ready. They're next in your feed.";
        const id = hole.queue.shift();
        if (id) pending.unshift({ kind: "ai", id, data: UP.aiCards[id] });
        // drop the pre-rendered lookahead so the hole shows up right away
        const cards2 = $$(".card", feed);
        const idx = cards2.indexOf(current);
        cards2.slice(idx + 1).forEach((c) => { if (!c.classList.contains("done")) { io.unobserve(c); c.remove(); } });
        fill(3);
        renderList();
        setTimeout(() => { if (ownScrim && ownScrim.isConnected && !ownScrim.classList.contains("closing")) { closeSheet(); ui.goTab("feed"); ui.advance(); } }, 900);
      } catch (err) {
        status.textContent = UP.ai.handleError(err) || "Stopped.";
        renderList();
      } finally {
        go.disabled = false;
      }
    });
    const body = h("div", { class: "holes" },
      h("p", { class: "lede" }, "Name anything. Claude turns it into an endless course that gets deeper the further you scroll, mixed right into your feed, with memory checks so it sticks."),
      avail ? form : h("p", { class: "notice" }, "Rabbit holes are written by Claude, so they only work when Upscroll is opened inside Claude. Everything else works here."),
      avail ? status : null,
      avail ? chips : null,
      h("h4", null, "Your rabbit holes"),
      list
    );
    const mine = sheet("Rabbit holes", body, { tall: true });
    ownScrim = mine.scrim;
    if (avail) setTimeout(() => input.focus(), 120);
  };

  /* ================= tabs ================= */
  ui.goTab = (name) => {
    $$(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
    $$(".tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("on", on);
      if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    document.body.dataset.tab = name;
    if (name === "sky") UP.sky.show();
    else UP.sky.hide();
    if (name === "vault") UP.vault.render();
    if (name === "feed" && current) current.scrollIntoView({ block: "start" });
  };

  function hint(show) {
    const el = $("#swipe-hint");
    if (!el) return;
    if (show) el.hidden = false;
    else if (S.cards > 1) el.hidden = true;
  }

  /* ================= build shell ================= */
  ui.mount = () => {
    feed = $("#feed");
    fx = $("#fx");
    fxc = fx.getContext("2d");
    const sizeFx = () => { const d = window.devicePixelRatio || 1; fx.width = innerWidth * d; fx.height = innerHeight * d; };
    sizeFx();
    addEventListener("resize", sizeFx);

    feed.addEventListener("scroll", () => { lastScroll = now(); }, { passive: true });
    io = new IntersectionObserver((entries) => {
      // a card becomes current when it crosses the middle of the screen (works for tall cards too)
      for (const e of entries) if (e.isIntersecting) onCurrent(e.target);
    }, { root: feed, rootMargin: "-50% 0px -50% 0px", threshold: 0 });

    // filters
    $$(".filter").forEach((b) => b.addEventListener("click", () => {
      if (filter === b.dataset.filter) return;
      filter = b.dataset.filter;
      $$(".filter").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      // keep the current card, swap out what's ahead
      const cards = $$(".card", feed);
      const idx = cards.indexOf(current);
      cards.slice(idx + 1).forEach((c) => { io.unobserve(c); c.remove(); });
      fill(3);
      ui.advance();
    }));
    $$(".tab").forEach((t) => t.addEventListener("click", () => ui.goTab(t.dataset.tab)));
    $("#holes-btn").addEventListener("click", ui.holes);
    $("#capture-btn").addEventListener("click", ui.quickCapture);
    $("#streak").addEventListener("click", () => ui.goTab("sky"));
    $("#goal-ring").addEventListener("click", () => ui.goTab("sky"));

    // keyboard
    addEventListener("keydown", (e) => {
      if ($(".scrim:not(.closing)") || $("#onboard:not([hidden])")) { if (e.key === "Escape") closeSheet(); return; }
      if (document.body.dataset.tab !== "feed") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const inCard = e.target === document.body || (current && current.contains(e.target));
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === " " && tag === "button") return;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) { e.preventDefault(); kbNav = true; ui.advance(); }
      else if (e.key === "ArrowUp" || e.key === "k" || e.key === "PageUp") { e.preventDefault(); kbNav = true; back(); }
      else if (UP.state.settings.shortcuts !== false && inCard && (/^[1-4]$/.test(e.key) || /^[a-d]$/i.test(e.key))) {
        const i = /^[1-4]$/.test(e.key) ? +e.key - 1 : e.key.toLowerCase().charCodeAt(0) - 97;
        const btn = current && $$(".opt:not([aria-disabled])", current)[i];
        if (btn) btn.click();
      }
    });

    // bus → HUD + effects
    bus.on("xp", ({ amount, anchor }) => { S.xp += amount; if (anchor) floatXP(amount, anchor); renderHud(); });
    bus.on("combo", renderHud);
    bus.on("boost", renderHud);
    bus.on("level", (L) => { sfx.level(); buzz([20, 40, 20, 40, 60]); banner("Level " + L.level, L.title, "Your sky just got brighter."); spawn(innerWidth / 2, innerHeight / 3, 90, 8); });
    bus.on("goal", ({ freeze }) => { banner("Daily goal", "Ring closed", freeze ? "You earned a streak freeze." : "Everything from here is bonus."); spawn(innerWidth - 40, 40, 50, 6); });
    bus.on("streak", ({ count, usedFreeze }) => { if (count > 1) banner("Streak", count + " days", usedFreeze ? "A streak freeze saved you." : "Kept alive for today."); renderHud(); });
    bus.on("quest", (q) => ui.toast("Quest done: " + q.label + " (+30 XP)"));
    bus.on("allquests", () => { banner("All quests done", "Bonus unlocked", "A bonus is next in your feed."); ui.insertNext({ kind: "chest", id: UP.uid("chest") }); });
    bus.on("remote", () => {
      renderHud();
      // rebuild what's ahead so it reflects the merged progress
      const cards = $$(".card", feed);
      const idx = cards.indexOf(current);
      cards.slice(idx + 1).forEach((c) => { io.unobserve(c); c.remove(); });
      if (current) fill(3);
      const tab = document.body.dataset.tab;
      if (tab === "vault") UP.vault.render();
      if (tab === "sky") UP.sky.show();
      ui.toast("Synced with your other devices");
    });
    bus.on("storagefull", ({ trimmed }) => ui.toast(trimmed ? "This browser's storage is full. Older history was trimmed to keep saving." : "This browser won't let Upscroll save right now. Free up space or progress may be lost."));
    if (!store.storageOk()) setTimeout(() => { if (!store.hasCloud()) ui.toast("This browser is blocking storage, so progress won't be kept after you close it."); }, 4000);
    bus.on("ai", (s) => document.body.classList.toggle("has-ai", s === "ready"));

    // on-screen keyboard: lift bottom sheets by its height
    if (window.visualViewport) {
      const vv = window.visualViewport;
      const kb = () => document.documentElement.style.setProperty("--kb", Math.max(0, innerHeight - vv.height - vv.offsetTop) + "px");
      vv.addEventListener("resize", kb);
      vv.addEventListener("scroll", kb);
    }
    renderHud();
    setInterval(renderHud, 60000);
  };

  ui.start = () => {
    resetFeed();
    hint(true);
  };
})();
