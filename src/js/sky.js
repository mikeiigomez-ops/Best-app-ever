/* Upscroll — "Your sky": every card you learn becomes a star; mastered ones shine and join constellations. */
(function () {
  const UP = window.UP;
  const { $, h, icon, store, engine, hash, mulberry, now } = UP;

  let canvas, ctx, raf = null, stars = [], t0 = 0, W = 0, H = 0, dpr = 1;

  const TOPIC_HUES = Object.fromEntries(Object.entries(engine.TOPICS).map(([k, v]) => [k, v.hue]));

  function topicOfId(id, rec) {
    if (rec && rec.k === "word") return "words";
    if (rec && rec.k === "ai") return "holes";
    const f = ((window.UP_CONTENT || {}).facts || []).find((x) => x.id === id);
    return f ? f.topic : "science";
  }

  function buildStars() {
    const st = UP.state;
    const topics = Object.keys(engine.TOPICS);
    stars = Object.entries(st.srs).map(([id, r]) => {
      const topic = topicOfId(id, r);
      const ti = Math.max(0, topics.indexOf(topic));
      // each topic owns a region of the sky so constellations form naturally
      const rng = mulberry(hash(id));
      const cx = 0.16 + ((ti * 0.37) % 1) * 0.68;
      const cy = 0.18 + (((ti * 0.61) % 1) * 0.56);
      const ang = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * 0.16;
      return {
        id, topic, b: r.b, f: r.f || 0,
        x: Math.min(0.94, Math.max(0.06, cx + Math.cos(ang) * rad)),
        y: Math.min(0.88, Math.max(0.08, cy + Math.sin(ang) * rad * 1.3)),
        hue: TOPIC_HUES[topic] != null ? TOPIC_HUES[topic] : 200,
        tw: rng() * Math.PI * 2,
      };
    });
  }

  // Performance: dust + constellation lines are drawn once to an offscreen layer, each star is a
  // pre-rendered glow sprite, and the loop runs at ~30fps only while the Sky is on screen.
  let layer = null, lastFrame = 0, visible = true;
  const sprites = new Map();
  function sprite(hue, bucket) {
    const key = hue + ":" + bucket;
    if (sprites.has(key)) return sprites.get(key);
    const strength = (bucket + 1) / 8;
    const r = (1.2 + strength * 3.2) * dpr;
    const size = Math.ceil(r * 10) + 2;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d"), m = size / 2;
    const g = x.createRadialGradient(m, m, 0, m, m, r * 5);
    g.addColorStop(0, "hsla(" + hue + ",80%,80%," + 0.6 * strength + ")");
    g.addColorStop(1, "hsla(" + hue + ",80%,60%,0)");
    x.fillStyle = g; x.beginPath(); x.arc(m, m, r * 5, 0, 7); x.fill();
    x.fillStyle = "hsl(" + hue + ",70%," + (82 + strength * 15) + "%)";
    x.beginPath(); x.arc(m, m, r, 0, 7); x.fill();
    sprites.set(key, c);
    return c;
  }
  function buildLayer() {
    layer = document.createElement("canvas");
    layer.width = W; layer.height = H;
    const x = layer.getContext("2d");
    const dust = mulberry(7);
    for (let i = 0; i < 140; i++) {
      x.fillStyle = "rgba(200,210,255," + (0.1 + dust() * 0.15) + ")";
      x.fillRect(dust() * W, dust() * H, dpr, dpr);
    }
    // golden stars from bonuses: rare, big, always in the upper sky
    const gold = mulberry(99);
    for (let i = 0; i < (UP.state.golden || 0); i++) {
      const X = (0.08 + gold() * 0.84) * W, Y = (0.06 + gold() * 0.3) * H, R = 3.2 * dpr;
      const g = x.createRadialGradient(X, Y, 0, X, Y, R * 7);
      g.addColorStop(0, "rgba(255,227,161,0.85)"); g.addColorStop(1, "rgba(245,201,92,0)");
      x.fillStyle = g; x.beginPath(); x.arc(X, Y, R * 7, 0, 7); x.fill();
      x.fillStyle = "#fff6dc"; x.beginPath();
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, rr = k % 2 ? R * 0.9 : R * 2.6; x.lineTo(X + Math.cos(a) * rr, Y + Math.sin(a) * rr); }
      x.closePath(); x.fill();
    }
    // faint outlines where each subject's constellation will form
    const byTopic = {};
    for (const s of stars) if (s.b >= store.STRONG) (byTopic[s.topic] = byTopic[s.topic] || []).push(s);
    x.lineWidth = dpr;
    for (const [topic, list] of Object.entries(byTopic)) {
      if (list.length < 2) continue;
      x.strokeStyle = "hsla(" + (TOPIC_HUES[topic] || 200) + ",70%,75%,0.25)";
      const sorted = list.slice().sort((a, b) => a.x - b.x);
      x.beginPath();
      sorted.forEach((s, i) => { const X = s.x * W, Y = s.y * H; i ? x.lineTo(X, Y) : x.moveTo(X, Y); });
      x.stroke();
    }
  }
  function draw(t) {
    raf = null;
    if (!visible) return;
    if (t - lastFrame < 32 && !UP.reducedMotion()) { raf = requestAnimationFrame(draw); return; }
    lastFrame = t;
    const time = (t - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    if (layer) ctx.drawImage(layer, 0, 0);
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    for (const s of stars) {
      const bucket = Math.min(7, s.b);
      const spr = sprite(s.hue, bucket);
      const strength = (bucket + 1) / 8;
      ctx.globalAlpha = 0.65 + 0.35 * Math.sin(time * (1.2 + strength) + s.tw);
      ctx.drawImage(spr, s.x * W - spr.width / 2, s.y * H - spr.height / 2);
      if (s.f >= today0.getTime()) {
        // today's new stars pulse with a ring
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(time * 3 + s.tw);
        ctx.strokeStyle = "hsl(" + s.hue + ",90%,80%)";
        ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, (7 + 2 * Math.sin(time * 2)) * dpr, 0, 7); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (!UP.reducedMotion()) raf = requestAnimationFrame(draw);
  }

  // tap a star to see what it holds
  function onTap(e) {
    const r = canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    let best = null, bd = Infinity;
    for (const s of stars) {
      const dx = (s.x - px) * r.width, dy = (s.y - py) * r.height, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = s; }
    }
    if (!best || bd > 28 * 28) return;
    showStar(best);
  }
  function showStar(s) {
    const item = UP.engine.findItem(s.id);
    if (!item) return;
    const rec = UP.state.srs[s.id] || {};
    const pips = h("span", { class: "strength", style: { "--hue": s.hue } }, ...Array.from({ length: 7 }, (_, i) => h("i", { class: i < rec.b ? "on" : "" })));
    const isWord = item.__kind === "word";
    const body = h("div", { class: "compose" },
      h("p", { class: "kicker", style: { "--hue": s.hue } }, (engine.TOPICS[s.topic] || { label: s.topic }).label + " · learned " + UP.timeAgo(rec.f || Date.now())),
      h("p", { class: "compose-prompt" }, isWord ? item.word + ": " + item.def : item.headline),
      h("p", { class: "lede" }, isWord ? item.example : item.body),
      h("div", { class: "star-meta" }, pips, h("span", { class: "hint" }, rec.b >= store.MASTERED ? "Mastered" : rec.b >= store.STRONG ? "Strong" : "Still settling in")),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => { UP.ui.closeSheet(); UP.ui.goTab("feed"); UP.ui.insertNext({ kind: "review", id: s.id, data: item }); setTimeout(() => UP.ui.advance(), 300); } }, "Test me now"),
        h("button", { class: "btn ghost needs-ai", onclick: () => { UP.ui.closeSheet(); setTimeout(() => UP.ui.deeper({ kind: isWord ? "word" : "fact", id: s.id, data: item }), 260); } }, "Go deeper"))
    );
    UP.ui.sheetRaw(isWord ? "A word you know" : "A star in your sky", body);
  }

  function size() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    W = canvas.width = Math.max(1, r.width * dpr);
    H = canvas.height = Math.max(1, r.height * dpr);
  }

  /* ---------- stats panel ---------- */
  function heatmap() {
    const days = UP.state.days;
    const wrap = h("div", { class: "heat", role: "img", "aria-label": "Daily XP over the last 12 weeks" });
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (7 * 12 - 1) - start.getDay());
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const k = UP.dayKey(d.getTime());
      const xp = (days[k] && days[k].xp) || 0;
      const lvl = xp === 0 ? 0 : xp < store.STREAK_MIN ? 1 : xp < 100 ? 2 : xp < 200 ? 3 : 4;
      wrap.append(h("i", { class: "l" + lvl, title: k + ": " + xp + " XP" }));
    }
    return wrap;
  }

  function render() {
    const st = UP.state;
    const L = store.levelInfo(st.xp);
    const panel = $("#sky-panel");
    panel.innerHTML = "";
    const acc = st.stats.answered ? Math.round((st.stats.correct / st.stats.answered) * 100) : 0;
    const calib = st.stats.estimates ? Math.max(0, Math.round(100 - (st.stats.estErr / st.stats.estimates) * 100)) : null;
    const mins = Math.round(st.stats.secs / 60);
    const counts = {};
    for (const s of stars) counts[s.topic] = (counts[s.topic] || 0) + 1;
    const legend = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) =>
      h("span", { class: "leg", style: { "--hue": TOPIC_HUES[t] || 200 } }, h("i"), (engine.TOPICS[t] || { label: t }).label + " " + n));
    const big = (n, l) => h("div", { class: "stat" }, h("b", null, n), h("span", null, l));
    panel.append(...[
      h("div", { class: "sky-head" },
        h("p", { class: "kicker" }, "Level " + L.level),
        h("h2", { class: "sky-title" }, L.title),
        h("div", { class: "lvl-line" }, h("div", { class: "bar" }, h("i", { style: { transform: "scaleX(" + L.pct + ")" } })), h("span", null, L.into + " / " + L.need + " XP"))
      ),
      h("p", { class: "sky-lede" }, stars.length
        ? "Each star is something you learned. It brightens every time you remember it, and once you've mastered a few in one subject they link up into a constellation."
        : "Your sky is empty. Every card you learn adds a star."),
      legend.length ? h("div", { class: "legend" }, ...legend) : null,
      constellationLine(),
      h("div", { class: "stat-grid" },
        big(String(stars.length), "stars"),
        big(String(store.mastered()), "mastered"),
        big(String(store.streakAlive()), "day streak"),
        big(String(st.streak.best || 0), "best streak"),
        big(acc + "%", "right answers"),
        big(calib == null ? "–" : calib + "%", "estimate accuracy"),
        big(String(st.stats.deeds), "real-world quests"),
        big(String(st.stats.sprintBest || 0), "sprint best"),
        big(mins + "m", "time invested"),
        big(String(st.streak.freezes || 0), "streak freezes"),
        big(String(st.golden || 0), "golden stars")
      ),
      calibration(),
      h("h4", null, "Last 12 weeks"),
      heatmap(),
      settings()
    ].filter(Boolean));
  }

  function calibration() {
    const log = UP.state.calib || [];
    if (log.length < 4) return null;
    const recent = log.slice(-40);
    const hit = Math.round((recent.reduce((s, x) => s + x.hit, 0) / recent.length) * 100);
    const bias = recent.reduce((s, x) => s + x.r, 0) / recent.length;
    const factor = Math.pow(10, Math.abs(bias));
    const lean = Math.abs(bias) < 0.08 ? "You don't lean high or low. That's rare." :
      "You tend to " + (bias < 0 ? "underestimate" : "overestimate") + " by about " + (factor < 1.95 ? Math.round((factor - 1) * 100) + "%" : (Math.round(factor * 10) / 10) + "x") + ".";
    return h("div", { class: "calib" }, h("h4", null, "Your calibration"), h("p", { class: "sky-lede" }, hit + "% of your last " + recent.length + " estimates landed within 25%. " + lean));
  }

  function constellationLine() {
    const strong = {};
    for (const s of stars) if (s.b >= store.STRONG) strong[s.topic] = (strong[s.topic] || 0) + 1;
    const counts = {};
    for (const s of stars) counts[s.topic] = (counts[s.topic] || 0) + 1;
    const lead = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!lead) return null;
    const [topic] = lead;
    const have = strong[topic] || 0;
    const label = (engine.TOPICS[topic] || { label: topic }).label;
    const text = have >= 3 ? "Your " + label + " constellation is lit. Keep remembering to make it brighter." : (3 - have) + " more strong " + label + " star" + (3 - have === 1 ? "" : "s") + " to light up its constellation. Stars get strong when you remember them days later.";
    return h("p", { class: "hint" }, text + " Tap any star to revisit it.");
  }

  // A calendar event that repeats daily: the one trigger that works from outside the app
  function reminder() {
    const st = UP.state;
    const time = h("input", { type: "time", id: "remind-time", class: "field time", value: st.settings.remindAt || "08:30", "aria-label": "Reminder time" });
    const btn = h("button", { class: "btn ghost small" }, "Add to my calendar");
    const note = h("p", { class: "hint", "aria-live": "polite" });
    btn.addEventListener("click", async () => {
      st.settings.remindAt = time.value || "08:30";
      store.save();
      const [hh, mm] = st.settings.remindAt.split(":");
      const d = new Date();
      const stamp = (x) => x.getUTCFullYear() + String(x.getUTCMonth() + 1).padStart(2, "0") + String(x.getUTCDate()).padStart(2, "0") + "T" + String(x.getUTCHours()).padStart(2, "0") + String(x.getUTCMinutes()).padStart(2, "0") + "00Z";
      const local = d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + "T" + hh + mm + "00";
      const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Upscroll//EN", "BEGIN:VEVENT", "UID:upscroll-daily-" + Date.now() + "@upscroll", "DTSTAMP:" + stamp(d),
        "DTSTART:" + local, "DURATION:PT10M", "RRULE:FREQ=DAILY", "SUMMARY:Upscroll: 10 minutes that pay you back",
        "DESCRIPTION:Your memory checks are ready. Open Upscroll instead of the doomscroll.",
        "BEGIN:VALARM", "TRIGGER:PT0M", "ACTION:DISPLAY", "DESCRIPTION:Upscroll time", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
      const ok = await saveFile("upscroll-reminder.ics", ics, "text/calendar");
      note.textContent = ok ? "Open the file to add a daily reminder to your calendar." : "Your browser blocked the file. Set a daily phone alarm for " + st.settings.remindAt + " instead.";
    });
    return h("div", { class: "remind" }, h("div", { class: "row" }, time, btn), note);
  }
  async function saveFile(name, text, type) {
    try {
      const dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
      if (dl) { await dl.save({ filename: name, data: text }); return true; }
    } catch (e) { return false; }
    try {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const a = h("a", { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch (e) { return false; }
  }

  function settings() {
    const st = UP.state;
    const box = h("div", { class: "settings" }, h("h4", null, "Tune your feed"));
    const goals = h("div", { class: "chips" });
    for (const [k, g] of Object.entries(engine.GOALS)) {
      const b = h("button", { class: "chip-btn" + (st.goals.includes(k) ? " on" : ""), "aria-pressed": String(st.goals.includes(k)) }, g.label);
      b.addEventListener("click", () => {
        st.goals = st.goals.includes(k) ? st.goals.filter((x) => x !== k) : st.goals.concat(k);
        b.classList.toggle("on"); b.setAttribute("aria-pressed", String(st.goals.includes(k)));
        store.save();
      });
      goals.append(b);
    }
    const ints = h("div", { class: "chips" });
    for (const [k, t] of Object.entries(engine.TOPICS)) {
      if (k === "holes" || k === "words") continue;
      const b = h("button", { class: "chip-btn" + (st.interests.includes(k) ? " on" : ""), "aria-pressed": String(st.interests.includes(k)) }, t.label);
      b.addEventListener("click", () => {
        st.interests = st.interests.includes(k) ? st.interests.filter((x) => x !== k) : st.interests.concat(k);
        b.classList.toggle("on"); b.setAttribute("aria-pressed", String(st.interests.includes(k)));
        store.save();
      });
      ints.append(b);
    }
    const toggle = (label, key) => {
      const isOn = () => st.settings[key] !== false;
      const b = h("button", { class: "chip-btn" + (isOn() ? " on" : ""), "aria-pressed": String(isOn()) }, label);
      b.addEventListener("click", () => { st.settings[key] = !isOn(); b.classList.toggle("on"); b.setAttribute("aria-pressed", String(st.settings[key])); store.save(); });
      return b;
    };
    const goalSel = h("div", { class: "chips" }, ...[50, 100, 150, 250, 400].map((n) => {
      const b = h("button", { class: "chip-btn" + (st.settings.dailyGoal === n ? " on" : "") }, n + " XP");
      b.addEventListener("click", () => { st.settings.dailyGoal = n; store.save(); UP.ui.renderHud(); render(); });
      return b;
    }));
    const resetZone = h("div", { class: "reset-zone" });
    const resetBtn = h("button", { class: "btn ghost small danger" }, "Erase all progress");
    resetBtn.addEventListener("click", () => {
      resetZone.innerHTML = "";
      const yes = h("button", { class: "btn small danger-fill" }, "Yes, erase everything");
      const no = h("button", { class: "btn ghost small" }, "Keep it");
      yes.addEventListener("click", async () => { yes.disabled = true; yes.textContent = "Erasing..."; await store.reset(); location.reload(); });
      no.addEventListener("click", () => { resetZone.innerHTML = ""; resetZone.append(resetBtn); });
      resetZone.append(h("p", { class: "hint" }, "This deletes your stars, vault and journal on this account. It can't be undone."), yes, no);
    });
    resetZone.append(resetBtn);
    box.append(
      h("p", { class: "label" }, "What do you want out of it?"), goals,
      h("p", { class: "label" }, "Interests"), ints,
      h("p", { class: "label" }, "Daily goal"), goalSel,
      h("p", { class: "label" }, "Feel"), h("div", { class: "chips" }, toggle("Sound", "sound"), toggle("Vibration", "haptics"), toggle("Keyboard shortcuts", "shortcuts")),
      h("p", { class: "label" }, "Daily reminder"), reminder(),
      h("p", { class: "hint" }, store.hasCloud() ? "Progress is saved to your Claude account and follows you across devices." : "Progress is saved in this browser."),
      resetZone
    );
    return box;
  }

  UP.sky = {
    show() {
      canvas = $("#sky-canvas");
      ctx = canvas.getContext("2d");
      if (!canvas._wired) {
        canvas._wired = true;
        canvas.addEventListener("click", onTap);
        new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible && !raf && document.body.dataset.tab === "sky") raf = requestAnimationFrame(draw); }).observe(canvas);
      }
      buildStars();
      size();
      sprites.clear();
      buildLayer();
      render();
      cancelAnimationFrame(raf);
      t0 = performance.now();
      raf = requestAnimationFrame(draw);
    },
    hide() { cancelAnimationFrame(raf); raf = null; },
  };
  addEventListener("resize", () => { if (raf) { size(); sprites.clear(); buildLayer(); } });
})();
