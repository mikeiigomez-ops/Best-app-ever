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
      const cx = 0.14 + ((ti * 0.37) % 1) * 0.72;
      const cy = 0.16 + (((ti * 0.61) % 1) * 0.6);
      const ang = rng() * Math.PI * 2, rad = Math.sqrt(rng()) * 0.16;
      return {
        id, topic, b: r.b,
        x: Math.min(0.97, Math.max(0.03, cx + Math.cos(ang) * rad)),
        y: Math.min(0.9, Math.max(0.05, cy + Math.sin(ang) * rad * 1.3)),
        hue: TOPIC_HUES[topic] != null ? TOPIC_HUES[topic] : 200,
        tw: rng() * Math.PI * 2,
      };
    });
  }

  function draw(t) {
    const time = (t - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    // faint dust
    const dust = mulberry(7);
    for (let i = 0; i < 140; i++) {
      const x = dust() * W, y = dust() * H, a = 0.12 + 0.12 * Math.sin(time * 0.7 + i);
      ctx.fillStyle = "rgba(200,210,255," + a + ")";
      ctx.fillRect(x, y, dpr, dpr);
    }
    // constellation lines between mastered stars of the same topic
    const byTopic = {};
    for (const s of stars) if (s.b >= store.MASTERED) (byTopic[s.topic] = byTopic[s.topic] || []).push(s);
    ctx.lineWidth = 1 * dpr;
    for (const [topic, list] of Object.entries(byTopic)) {
      if (list.length < 2) continue;
      const hue = TOPIC_HUES[topic] || 200;
      ctx.strokeStyle = "hsla(" + hue + ",70%,75%,0.22)";
      const sorted = list.slice().sort((a, b) => a.x - b.x);
      ctx.beginPath();
      sorted.forEach((s, i) => { const X = s.x * W, Y = s.y * H; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.stroke();
    }
    for (const s of stars) {
      const X = s.x * W, Y = s.y * H;
      const strength = (s.b + 1) / 8;
      const tw = 0.75 + 0.25 * Math.sin(time * (1.2 + strength) + s.tw);
      const r = (1.2 + strength * 3.2) * dpr;
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, r * 5);
      g.addColorStop(0, "hsla(" + s.hue + ",80%,80%," + 0.55 * tw * strength + ")");
      g.addColorStop(1, "hsla(" + s.hue + ",80%,60%,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(X, Y, r * 5, 0, 7); ctx.fill();
      ctx.fillStyle = "hsla(" + s.hue + ",70%," + (82 + strength * 15) + "%," + (0.5 + 0.5 * tw) + ")";
      ctx.beginPath(); ctx.arc(X, Y, r, 0, 7); ctx.fill();
    }
    if (!UP.reducedMotion()) raf = requestAnimationFrame(draw);
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
        big(String(st.streak.freezes || 0), "streak freezes")
      ),
      h("h4", null, "Last 12 weeks"),
      heatmap(),
      settings()
    ].filter(Boolean));
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
      const b = h("button", { class: "chip-btn" + (st.settings[key] ? " on" : ""), "aria-pressed": String(!!st.settings[key]) }, label);
      b.addEventListener("click", () => { st.settings[key] = !st.settings[key]; b.classList.toggle("on"); b.setAttribute("aria-pressed", String(st.settings[key])); store.save(); });
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
      h("p", { class: "label" }, "Feel"), h("div", { class: "chips" }, toggle("Sound", "sound"), toggle("Vibration", "haptics")),
      h("p", { class: "hint" }, store.hasCloud() ? "Progress is saved to your Claude account and follows you across devices." : "Progress is saved in this browser."),
      resetZone
    );
    return box;
  }

  UP.sky = {
    show() {
      canvas = $("#sky-canvas");
      ctx = canvas.getContext("2d");
      buildStars();
      size();
      render();
      cancelAnimationFrame(raf);
      t0 = performance.now();
      raf = requestAnimationFrame(draw);
    },
    hide() { cancelAnimationFrame(raf); raf = null; },
  };
  addEventListener("resize", () => { if (raf) size(); });
})();
