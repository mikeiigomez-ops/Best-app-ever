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
      UP.state.stats.secs += secs;
      store.today().secs += secs;
    }
    current = el;
    enteredAt = now();
    $$(".card.active", feed).forEach((c) => c.classList.remove("active"));
    el.classList.add("active");
    const spec = el._spec;
    if (!el._counted) {
      el._counted = true;
      S.cards++;
      UP.state.stats.cards++;
      store.today().cards++;
      if (spec.id && !String(spec.id).startsWith("v-") && !String(spec.id).startsWith("j-")) UP.state.seen[spec.id] = now();
    }
    if (el._enter) el._enter();
    fill(3);
    prune();
    maybeDig();
    hint(false);
    store.save();
  }
  function prune() {
    const cards = $$(".card", feed);
    const idx = cards.indexOf(current);
    if (idx > 40) {
      const drop = cards.slice(0, idx - 30);
      const hgt = drop.reduce((s, c) => s + c.offsetHeight, 0);
      drop.forEach((c) => { io.unobserve(c); c.remove(); });
      feed.scrollTop -= hgt;
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
  function maybeDig() {
    if (!UP.ai.available() || !UP.state.aiOk) return;
    for (const hole of engine.holesNeedingCards()) {
      UP.ai.digHole(hole).catch((e) => {
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

  ui.countUp = (el, from, to, unit) => {
    if (UP.reducedMotion()) { el.textContent = UP.fmtNum(to, unit); return; }
    const t0 = performance.now(), dur = 900;
    const log = from > 0 && to > 0;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      const v = log ? Math.exp(Math.log(from) + (Math.log(to) - Math.log(from)) * e) : from + (to - from) * e;
      el.textContent = UP.fmtNum(p >= 1 ? to : v, unit);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ================= sheets ================= */
  function sheet(title, body, opts = {}) {
    closeSheet();
    const close = h("button", { class: "icon-btn", "aria-label": "Close" }, icon("close"));
    const panel = h("div", { class: "sheet" + (opts.tall ? " tall" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "sheet-head" }, h("h3", null, title), close),
      h("div", { class: "sheet-body" }, body)
    );
    const scrim = h("div", { class: "scrim" }, panel);
    scrim.addEventListener("click", (e) => { if (e.target === scrim) closeSheet(); });
    close.addEventListener("click", closeSheet);
    document.body.append(scrim);
    requestAnimationFrame(() => scrim.classList.add("show"));
    scrim._onClose = opts.onClose;
    return { panel, scrim };
  }
  function closeSheet() {
    const s = $(".scrim");
    if (!s) return;
    if (s._onClose) s._onClose();
    s.classList.remove("show");
    setTimeout(() => s.remove(), 250);
  }
  ui.closeSheet = closeSheet;
  ui.sheetRaw = (title, body) => sheet(title, body, { tall: true });

  ui.compose = ({ title, placeholder, onSave, multi, hint }) => {
    const id = "compose-" + Date.now();
    const input = h(multi ? "textarea" : "input", { id, class: "field", placeholder: placeholder || "", rows: multi ? "4" : null, maxlength: "1200", "aria-label": title });
    const save = h("button", { class: "btn primary wide" }, "Save");
    const body = h("div", { class: "compose" }, input, hint ? h("p", { class: "hint" }, hint) : null, save);
    sheet(title, body);
    setTimeout(() => input.focus(), 80);
    const go = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      closeSheet();
      onSave(v);
    };
    save.addEventListener("click", go);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (!multi || e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); }
      e.stopPropagation();
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
        if (!q) return;
        input.value = "";
        thread.append(h("p", { class: "me" }, q));
        const ans = h("div", { class: "claude-out" }, h("p", { class: "thinking" }, "Thinking..."));
        thread.append(ans);
        ans.scrollIntoView({ block: "end" });
        turns.push({ role: "user", content: q });
        ctl = new AbortController();
        const text = await ask(ans, (onText, signal) => chat(turns.slice(-8), onText, signal));
        if (text) turns.push({ role: "assistant", content: text });
        else turns.pop();
      });
      input.addEventListener("keydown", (e) => e.stopPropagation());
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

  /* ================= rabbit holes ================= */
  const HOLE_IDEAS = ["How the stock market actually works", "Ancient Rome", "Spanish for travel", "Black holes", "Negotiation", "The science of cooking", "Stoicism", "How AI models work", "Wine basics", "Human evolution", "Investing for beginners", "Photography basics"];
  ui.holes = () => {
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
        UP.state.aiOk = true;
        store.save();
        status.textContent = cards.length + " cards ready. They're next in your feed.";
        const id = hole.queue.shift();
        if (id) pending.unshift({ kind: "ai", id, data: UP.aiCards[id] });
        // drop the pre-rendered lookahead so the hole shows up right away
        const cards2 = $$(".card", feed);
        const idx = cards2.indexOf(current);
        cards2.slice(idx + 1).forEach((c) => { if (!c.classList.contains("done")) { io.unobserve(c); c.remove(); } });
        fill(3);
        renderList();
        setTimeout(() => { closeSheet(); ui.goTab("feed"); ui.advance(); }, 900);
      } catch (err) {
        status.textContent = UP.ai.handleError(err) || "Stopped.";
        renderList();
      } finally {
        go.disabled = false;
      }
    });
    input.addEventListener("keydown", (e) => e.stopPropagation());
    const body = h("div", { class: "holes" },
      h("p", { class: "lede" }, "Name anything. Claude turns it into an endless course that gets deeper the further you scroll, mixed right into your feed, with memory checks so it sticks."),
      avail ? form : h("p", { class: "notice" }, "Rabbit holes are written by Claude, so they only work when Upscroll is opened inside Claude. Everything else works here."),
      avail ? status : null,
      avail ? chips : null,
      h("h4", null, "Your rabbit holes"),
      list
    );
    sheet("Rabbit holes", body, { tall: true });
    if (avail) setTimeout(() => input.focus(), 120);
  };

  /* ================= tabs ================= */
  ui.goTab = (name) => {
    $$(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
    $$(".tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
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

    // keyboard
    addEventListener("keydown", (e) => {
      if ($(".scrim") || $("#onboard:not([hidden])")) { if (e.key === "Escape") closeSheet(); return; }
      if (document.body.dataset.tab !== "feed") return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) { e.preventDefault(); ui.advance(); }
      else if (e.key === "ArrowUp" || e.key === "k" || e.key === "PageUp") { e.preventDefault(); back(); }
      else if (/^[1-4]$/.test(e.key) || /^[a-d]$/i.test(e.key)) {
        const i = /^[1-4]$/.test(e.key) ? +e.key - 1 : e.key.toLowerCase().charCodeAt(0) - 97;
        const btn = current && $$(".opt:not(:disabled)", current)[i];
        if (btn) btn.click();
      }
    });

    // bus → HUD + effects
    bus.on("xp", ({ amount, anchor }) => { S.xp += amount; if (anchor) floatXP(amount, anchor); renderHud(); });
    bus.on("combo", renderHud);
    bus.on("boost", renderHud);
    bus.on("level", (L) => { sfx.level(); buzz([20, 40, 20, 40, 60]); banner("Level " + L.level, L.title, "Your sky just got brighter."); spawn(innerWidth / 2, innerHeight / 3, 90, 8); });
    bus.on("goal", () => { banner("Daily goal", "Ring closed", "Everything from here is bonus."); spawn(innerWidth - 40, 40, 50, 6); });
    bus.on("streak", ({ count, usedFreeze }) => { if (count > 1) banner("Streak", count + " days", usedFreeze ? "A streak freeze saved you." : "Kept alive for today."); renderHud(); });
    bus.on("quest", (q) => ui.toast("Quest done: " + q.label + " (+30 XP)"));
    bus.on("allquests", () => { banner("All quests done", "Bonus unlocked", "A bonus is next in your feed."); ui.insertNext({ kind: "chest", id: UP.uid("chest") }); });
    bus.on("remote", () => { renderHud(); ui.toast("Progress synced from your other device"); });
    bus.on("ai", (s) => document.body.classList.toggle("has-ai", s === "ready"));

    renderHud();
    setInterval(renderHud, 60000);
  };

  ui.start = () => {
    resetFeed();
    hint(true);
  };
})();
