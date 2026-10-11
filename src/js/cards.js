/* Upscroll — card renderers. Each returns a <section class="card"> with optional _enter/_leave hooks. */
(function () {
  const UP = window.UP;
  const { h, icon, store, engine, sfx, buzz, now, timeAgo, fmtNum, clamp } = UP;
  const S = engine.session;

  const KIND = {
    fact: { label: "Mind snack", hue: 172 },
    ai: { label: "Rabbit hole", hue: 265 },
    review: { label: "Memory check", hue: 212 },
    word: { label: "Word", hue: 340 },
    estimate: { label: "Calibrate", hue: 36 },
    action: { label: "Real-world quest", hue: 12 },
    breathe: { label: "Breathe", hue: 200 },
    capture: { label: "Capture", hue: 95 },
    reflect: { label: "Journal", hue: 255 },
    task: { label: "From your vault", hue: 95 },
    idea: { label: "From your vault", hue: 48 },
    capsule: { label: "Time capsule", hue: 255 },
    sprint: { label: "Math sprint", hue: 186 },
    chest: { label: "Bonus", hue: 44 },
    receipt: { label: "Session receipt", hue: 44 },
    brief: { label: "Today", hue: 44 },
    one: { label: "Today's one thing", hue: 44 },
  };

  function gain(base, anchor, reason) {
    let m = store.comboMult();
    if (S.boost > 0) { m *= 2; S.boost--; }
    const amt = Math.round(base * m);
    store.award(amt, { reason, anchor });
    return amt;
  }

  /* ---------- shared frame ---------- */
  function frame(spec, opts = {}) {
    const k = KIND[spec.kind] || KIND.fact;
    const hue = opts.hue != null ? opts.hue : k.hue;
    const el = h("section", { class: "card k-" + spec.kind + (spec.legendary ? " legendary" : ""), "data-key": spec.key, style: { "--hue": hue }, tabindex: "-1", "aria-roledescription": "card", "aria-label": (spec.legendary ? "Legendary" : opts.label || k.label) + (opts.topic ? ", " + opts.topic : "") });
    el._spec = spec;
    el._topicKey = opts.topicKey;
    const bg = h("div", { class: "card-bg", "aria-hidden": "true" });
    const inner = h("div", { class: "card-inner" });
    const eyebrow = h("div", { class: "eyebrow" },
      h("span", { class: "chip" }, spec.legendary ? "Legendary" : opts.label || k.label),
      opts.topic ? h("span", { class: "topic" }, opts.topic) : null,
      opts.meta || null
    );
    inner.append(eyebrow);
    el.append(bg, inner);
    if (opts.rail !== false) { el._rail = rail(spec, opts); el.classList.add("has-rail"); }
    el._inner = inner;
    return el;
  }

  function rail(spec, opts) {
    const r = h("div", { class: "rail" });
    const learnable = ["fact", "ai", "word", "review"].includes(spec.kind);
    const save = h("button", { class: "rail-btn", "aria-label": "Save to vault", "aria-pressed": "false", title: "Save to vault" }, icon("bookmark"), h("span", null, "Save"));
    save.addEventListener("click", () => {
      if (save.classList.contains("on")) return;
      save.classList.add("on");
      const d = spec.data || {};
      const text = d.headline || (d.word ? d.word + " — " + d.def : "") || d.title || d.text || "Saved card";
      store.addVault("saved", text, { ref: spec.id, body: d.body || d.example || "" });
      save.setAttribute("aria-pressed", "true");
      save.querySelector("span:last-child").textContent = "Saved";
      UP.ui.toast("Saved to your vault");
      buzz(10);
    });
    const more = h("button", { class: "rail-btn", "aria-label": "More like this", "aria-pressed": "false", title: "More like this" }, icon("heart"), h("span", null, "Like"));
    more.addEventListener("click", (e) => {
      more.classList.toggle("on");
      const on = more.classList.contains("on");
      more.setAttribute("aria-pressed", String(on));
      store.lean(opts.topicKey, spec.kind, on ? 1 : -1);
      if (on) { UP.ui.burst(e.currentTarget, 8); buzz(8); UP.ui.toast("You'll see more like this"); }
    });
    const less = h("button", { class: "rail-btn", "aria-label": "Less like this", title: "Less like this" }, icon("less"), h("span", null, "Less"));
    less.addEventListener("click", () => {
      if (less.classList.contains("on")) return;
      less.classList.add("on");
      store.lean(opts.topicKey, spec.kind, -1);
      UP.ui.toast("Got it. Less of this.");
      setTimeout(() => UP.ui.advance(), 450);
    });
    if (spec.kind !== "brief" && spec.kind !== "receipt" && spec.kind !== "chest") r.append(save);
    if (learnable) {
      const deep = h("button", { class: "rail-btn deep", "aria-label": "Go deeper with Claude", title: "Go deeper" }, icon("spark"), h("span", null, "Deeper"));
      deep.addEventListener("click", () => UP.ui.deeper(spec));
      r.append(deep);
    }
    if (!["brief", "receipt", "chest", "task", "idea", "capsule"].includes(spec.kind)) r.append(more, less);
    return r;
  }

  /* ---------- multiple choice ---------- */
  function quiz({ q, options, a, onAnswer }) {
    const wrap = h("div", { class: "quiz" });
    if (q) wrap.append(h("p", { class: "q" }, q));
    const list = h("div", { class: "opts", role: "group", "aria-label": q || "Choose an answer" });
    const btns = options.map((o, i) => {
      const b = h("button", { class: "opt", "data-i": i }, h("span", { class: "opt-key" }, String.fromCharCode(65 + i)), h("span", { class: "opt-text" }, o));
      b.addEventListener("click", () => {
        if (wrap.classList.contains("answered")) return;
        wrap.classList.add("answered");
        const ok = i === a;
        btns.forEach((x, j) => {
          x.setAttribute("aria-disabled", "true");
          const key = x.querySelector(".opt-key");
          if (j === a) { x.classList.add("right"); key.textContent = "\u2713"; x.append(h("span", { class: "sr-only" }, " (correct answer)")); }
          else if (j === i) { x.classList.add("wrong"); key.textContent = "\u2715"; x.append(h("span", { class: "sr-only" }, " (your answer)")); }
          else x.classList.add("dim");
        });
        onAnswer(ok, b, options[a]);
        const v = wrap.querySelector(".verdict");
        if (v) {
          v.tabIndex = -1;
          if (document.activeElement === b || document.activeElement === document.body) v.focus({ preventScroll: true });
          UP.ui.announce(v.textContent);
        }
      });
      return b;
    });
    list.append(...btns);
    wrap.append(list);
    return wrap;
  }

  function verdict(ok, amt, extra) {
    const combo = UP.state.combo;
    return h("div", { class: "verdict " + (ok ? "ok" : "no") },
      h("strong", null, ok ? pickPraise(combo) : "Not quite."),
      amt ? h("span", { class: "xp-pill" }, "+" + amt + " XP") : null,
      ok && combo >= 3 ? h("span", { class: "combo-pill" }, combo + "x streak") : null,
      extra ? h("span", { class: "verdict-sub" }, extra) : null
    );
  }
  function pickPraise(c) {
    if (c >= 10) return "Unstoppable.";
    if (c >= 6) return "On fire.";
    if (c >= 3) return "Sharp.";
    return UP.pick(["Locked in.", "Correct.", "Got it.", "Yes."]);
  }
  function nextCheckText(r) {
    const ms = r.d - now();
    if (ms < 3600000) return "Memory check in about " + Math.max(5, Math.round(ms / 60000)) + " min";
    const d = Math.round(ms / 86400000);
    return "Next memory check in " + (d <= 1 ? "a day" : d + " days");
  }

  function afterBlock(d) {
    const box = h("div", { class: "after" });
    if (d.explain) box.append(h("p", { class: "explain" }, d.explain));
    if (d.tip) box.append(h("p", { class: "tip" }, h("b", null, "Try this "), d.tip));
    return box;
  }

  function topicOf(d) {
    const t = engine.TOPICS[d.topic];
    return t ? t.label : d.topic;
  }

  /* ---------- fact + rabbit-hole ---------- */
  function fact(spec) {
    const d = spec.data;
    const isAi = spec.kind === "ai";
    const t = engine.TOPICS[d.topic];
    const el = frame(spec, {
      topic: isAi ? d.topic : topicOf(d),
      topicKey: isAi ? "holes" : d.topic,
      hue: isAi ? 265 : t ? t.hue : undefined,
      meta: isAi ? h("span", { class: "by" }, "by Claude") : null,
    });
    const inner = el._inner;
    // Ask first, reveal second: guessing before reading makes the answer stick (and makes it a real game)
    inner.append(
      h("p", { class: "kicker" }, spec.legendary ? "Legendary. Take a guess." : UP.pick(["Take a guess.", "Guess first.", "What's your instinct?", "Quick one."])),
      h("h2", { class: "headline q-head" }, d.q)
    );
    const qz = quiz({
      options: d.options, a: d.a,
      onAnswer(ok, btn) {
        const st = UP.state;
        st.stats.answered++; if (ok) st.stats.correct++;
        S.answered++; if (ok) S.correct++;
        const newItem = !st.srs[spec.id];
        store.comboHit(ok);
        const r = store.srsGrade(spec.id, ok, isAi ? "ai" : "fact");
        if (newItem) { S.learned++; store.today().learned++; store.questProgress("learn"); S.stars++; engine.noteLearned(spec.id); }
        const amt = gain(ok ? (spec.legendary ? 25 : 12) : 4, btn, ok ? "Correct" : "Learned");
        ok ? sfx.good(st.combo) : sfx.bad();
        buzz(ok ? 12 : [20, 40, 20]);
        if (ok) UP.ui.burst(btn, 10 + Math.min(20, st.combo * 2));
        store.lean(isAi ? "holes" : d.topic, null, ok ? 0.15 : 0.1);
        el._interacted = true;
        const reveal = h("div", { class: "reveal" },
          h("h3", { class: "reveal-head" }, d.headline),
          h("p", { class: "body" }, d.body));
        qz.append(verdict(ok, amt, ok ? nextCheckText(r) : "Now you know. " + nextCheckText(r)), reveal, afterBlock(d));
        el.classList.add("done");
        store.save();
      },
    });
    inner.append(qz);
    return el;
  }

  /* ---------- memory check (spaced repetition) ---------- */
  function review(spec) {
    const d = spec.data;
    const isWord = d.__kind === "word";
    const r = UP.state.srs[spec.id] || { b: 0, f: now() };
    const strength = h("span", { class: "strength", title: "Memory strength" },
      ...Array.from({ length: 7 }, (_, i) => h("i", { class: i < r.b ? "on" : "" })));
    const el = frame(spec, { topic: isWord ? "Words" : d.__kind === "ai" ? d.topic : topicOf(d), topicKey: isWord ? "words" : d.topic, meta: strength, hue: 212 });
    const inner = el._inner;
    inner.append(h("p", { class: "kicker" }, "You learned this " + timeAgo(r.f || now()) + ". Still got it?"));
    let q, options, a;
    if (isWord && r.b >= 2 && Math.random() < 0.6) {
      const wo = engine.wordReverse(d);
      q = "Which word means this?";
      options = wo.options; a = wo.a;
      inner.append(h("h2", { class: "headline" }, d.def));
    } else if (isWord) {
      const wo = engine.wordOptions(d);
      q = "What does “" + d.word + "” mean?";
      options = wo.options; a = wo.a;
      inner.append(h("h2", { class: "headline word-big" }, d.word));
    } else {
      // shuffle options so position isn't what you remember
      const order = UP.shuffle(d.options.map((_, i) => i));
      options = order.map((i) => d.options[i]);
      a = order.indexOf(d.a);
      q = d.q;
    }
    const qz = quiz({
      q, options, a,
      onAnswer(ok, btn) {
        const st = UP.state;
        st.stats.reviews++; if (ok) st.stats.reviewsCorrect++;
        S.answered++; if (ok) S.correct++;
        store.comboHit(ok);
        const rr = store.srsGrade(spec.id, ok, d.__kind);
        if (ok) store.questProgress("review");
        const amt = gain(ok ? 15 : 3, btn, ok ? "Remembered" : "Relearned");
        ok ? sfx.good(st.combo) : sfx.bad();
        buzz(ok ? 12 : [20, 40, 20]);
        if (ok) UP.ui.burst(btn, 14);
        strength.querySelectorAll("i").forEach((x, i) => x.classList.toggle("on", i < rr.b));
        const sub = ok ? (rr.b >= store.MASTERED ? "Mastered. This one is yours now." : nextCheckText(rr)) : "Back to the start. You'll see it again soon.";
        qz.append(verdict(ok, amt, sub));
        if (!ok || isWord) {
          const recap = h("div", { class: "after" });
          if (isWord) recap.append(h("p", { class: "explain" }, h("b", null, d.word + ": "), d.def), h("p", { class: "example" }, d.example));
          else recap.append(h("p", { class: "explain" }, h("b", null, d.headline + " "), d.body));
          qz.append(recap);
        }
        el.classList.add("done");
      },
    });
    inner.append(qz);
    return el;
  }

  /* ---------- word ---------- */
  function word(spec) {
    const d = spec.data;
    const el = frame(spec, { topic: "Vocabulary", topicKey: "words" });
    const inner = el._inner;
    inner.append(h("h2", { class: "headline word-big" }, d.word), h("p", { class: "kicker" }, "What does it mean?"));
    const wo = engine.wordOptions(d);
    const qz = quiz({
      options: wo.options, a: wo.a,
      onAnswer(ok, btn) {
        const st = UP.state;
        st.stats.answered++; if (ok) st.stats.correct++;
        S.answered++; if (ok) S.correct++; S.learned++; S.words++; S.stars++;
        store.today().learned++;
        store.comboHit(ok);
        const r = store.srsGrade(spec.id, ok, "word");
        store.questProgress("learn"); store.questProgress("word");
        const amt = gain(ok ? 10 : 3, btn, "Word");
        ok ? sfx.good(st.combo) : sfx.bad();
        if (ok) UP.ui.burst(btn, 10);
        const after = h("div", { class: "after" },
          h("p", { class: "example" }, "“" + d.example + "”"),
          d.origin ? h("p", { class: "origin" }, h("b", null, "Origin "), d.origin) : null,
          h("p", { class: "tip" }, h("b", null, "Try this "), "Use “" + d.word + "” once today, out loud or in a message.")
        );
        qz.append(verdict(ok, amt, nextCheckText(r)), after);
        el.classList.add("done");
      },
    });
    inner.append(qz);
    return el;
  }

  /* ---------- calibrate (estimation) ---------- */
  function estimate(spec) {
    const d = spec.data;
    const el = frame(spec, { topic: topicOf(d), topicKey: d.topic });
    const inner = el._inner;
    const lo = d.log ? Math.log10(Math.max(d.min, 1e-9)) : d.min;
    const hi = d.log ? Math.log10(d.max) : d.max;
    const toVal = (p) => { const x = lo + (hi - lo) * p; return d.log ? Math.pow(10, x) : x; };
    const toPos = (v) => clamp(((d.log ? Math.log10(v) : v) - lo) / (hi - lo), 0, 1);
    const nice = (v) => {
      if (v === 0) return 0;
      const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - 1); // 2 significant figures
      return Number((Math.round(v / p) * p).toPrecision(2));
    };
    // start somewhere random so the slider's midpoint never hints at the answer
    const startPos = 0.2 + Math.random() * 0.6;
    let guess = nice(toVal(startPos));
    inner.append(h("h2", { class: "headline est-q" }, d.q));
    const readout = h("div", { class: "est-readout" }, fmtNum(guess, d.unit));
    const slider = h("input", { type: "range", min: "0", max: "1000", value: String(Math.round(startPos * 1000)), class: "est-slider", "aria-label": "Your estimate", id: "est-" + spec.key });
    const scale = h("div", { class: "est-scale" }, h("span", null, fmtNum(d.min, d.unit)), h("span", null, fmtNum(d.max, d.unit)));
    const track = h("div", { class: "est-track" }, slider, h("i", { class: "est-answer", hidden: true }));
    slider.addEventListener("input", () => {
      guess = nice(toVal(slider.value / 1000));
      readout.textContent = fmtNum(guess, d.unit);
      slider.setAttribute("aria-valuetext", fmtNum(guess, d.unit));
      if (Math.random() < 0.3) sfx.tick();
    });
    // keep vertical swipes from being eaten by the slider on touch screens
    slider.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
    const lock = h("button", { class: "btn primary" }, "Lock in my guess");
    const box = h("div", { class: "est" }, readout, track, scale, lock);
    inner.append(box);
    lock.addEventListener("click", () => {
      slider.disabled = true;
      lock.remove();
      const ans = d.answer;
      let acc, ratio = null;
      if (d.log && ans > 0 && guess > 0) {
        ratio = Math.max(guess / ans, ans / guess);
        acc = clamp(1 - Math.log10(ratio) / 1.2, 0, 1);
      } else {
        const err = Math.abs(guess - ans) / (d.max - d.min);
        acc = clamp(1 - err * 3, 0, 1);
      }
      const pctOff = ans !== 0 ? Math.abs(guess - ans) / Math.abs(ans) : 0;
      const st = UP.state;
      st.stats.estimates++;
      st.stats.estErr += pctOff > 5 ? 5 : pctOff;
      let label;
      if (pctOff <= 0.1) label = "Bullseye.";
      else if (pctOff <= 0.25) label = "Sharp.";
      else if (ratio ? ratio <= 2 : pctOff <= 0.5) label = "Ballpark.";
      else if (ratio ? ratio <= 10 : pctOff <= 1) label = "Right order of magnitude.";
      else label = "Way off. Now you know.";
      const ok = pctOff <= 0.25;
      const tier = ok ? "ok" : (ratio ? ratio <= 10 : pctOff <= 1) ? "mid" : "no";
      if (ok) { st.stats.bullseyes++; store.questProgress("bullseye"); }
      S.answered++; if (ok) S.correct++;
      const amt = gain(4 + Math.round(acc * 22), readout, "Estimate");
      ok ? sfx.good(3) : sfx.tick();
      if (ok) UP.ui.burst(readout, 18);
      const mark = track.querySelector(".est-answer");
      mark.hidden = false;
      mark.style.left = toPos(ans) * 100 + "%";
      readout.classList.add("revealed");
      UP.ui.countUp(readout, guess, ans, d.unit);
      const offText = ratio && ratio >= 2 ? "Off by " + (Math.round(ratio * 10) / 10) + "x" : "Off by " + Math.round(pctOff * 100) + "%";
      box.append(
        h("div", { class: "verdict " + tier, tabindex: "-1" }, h("strong", null, label), h("span", { class: "xp-pill" }, "+" + amt + " XP"), h("span", { class: "verdict-sub" }, "You said " + fmtNum(guess, d.unit) + ". " + offText + ".")),
        h("div", { class: "after" }, h("p", { class: "explain" }, d.explain), d.src ? h("p", { class: "src" }, "Source: " + d.src) : null)
      );
      el.classList.add("done");
      const v = box.querySelector(".verdict");
      if (v) { v.focus({ preventScroll: true }); UP.ui.announce(v.textContent); }
    });
    return el;
  }

  /* ---------- real-world quest ---------- */
  function ring(seconds) {
    const R = 54, Cc = 2 * Math.PI * R;
    const wrap = h("div", { class: "ring" });
    wrap.innerHTML = '<svg viewBox="0 0 120 120"><circle class="ring-bg" cx="60" cy="60" r="' + R + '"/><circle class="ring-fg" cx="60" cy="60" r="' + R + '" stroke-dasharray="' + Cc + '" stroke-dashoffset="0"/></svg>';
    const num = h("div", { class: "ring-num" }, String(seconds));
    wrap.append(num);
    wrap._set = (left, total) => {
      wrap.querySelector(".ring-fg").style.strokeDashoffset = String(Cc * (1 - left / total));
      num.textContent = String(Math.ceil(left));
    };
    return wrap;
  }

  function completeDeed(el, spec, anchor, xp) {
    const st = UP.state;
    engine.deedDone();
    st.stats.deeds++; S.deeds++; store.today().deeds++;
    store.questProgress("deed");
    const amt = gain(xp, anchor, "Quest done");
    sfx.done(); buzz([15, 30, 15]);
    UP.ui.confetti(anchor);
    el.classList.add("done");
    return amt;
  }

  function action(spec) {
    const d = spec.data;
    const catLabel = { body: "Body", life: "Life admin", social: "People", mind: "Mind", focus: "Focus" }[d.cat] || d.cat;
    const el = frame(spec, { topic: catLabel, topicKey: d.cat, hue: { body: 12, life: 95, social: 330, mind: 255, focus: 186 }[d.cat] });
    const inner = el._inner;
    inner.append(h("h2", { class: "headline" }, d.title), h("p", { class: "body" }, d.body));
    if (d.steps && d.steps.length) inner.append(h("ol", { class: "steps" }, ...d.steps.map((s) => h("li", null, s))));
    const row = h("div", { class: "row" });
    const result = h("div", { class: "result" });
    let timer = null;
    if (d.timer) {
      const rg = ring(d.timer);
      const start = h("button", { class: "btn primary" }, "Start " + (d.timer >= 60 ? Math.round(d.timer / 60) + " min" : d.timer + "s"));
      const skip = h("button", { class: "btn ghost" }, "Not now");
      row.append(start, skip);
      inner.append(h("div", { class: "timer-zone" }, rg), row, result);
      start.addEventListener("click", () => {
        if (timer) return;
        start.hidden = true;
        skip.textContent = "Stop";
        skip.focus({ preventScroll: true });
        const t0 = performance.now();
        const total = d.timer;
        const tick = () => {
          if (!el.isConnected) { timer = null; return; }
          const left = total - (performance.now() - t0) / 1000;
          if (left <= 0) {
            rg._set(0, total);
            timer = null;
            row.remove();
            const amt = completeDeed(el, spec, rg, d.xp || 25);
            result.append(h("div", { class: "verdict ok" }, h("strong", null, "Done. That counted."), h("span", { class: "xp-pill" }, "+" + amt + " XP")));
            return;
          }
          rg._set(left, total);
          timer = requestAnimationFrame(tick);
        };
        timer = requestAnimationFrame(tick);
      });
      skip.addEventListener("click", () => {
        if (timer) { cancelAnimationFrame(timer); timer = null; rg._set(d.timer, d.timer); start.hidden = false; skip.textContent = "Not now"; start.focus({ preventScroll: true }); return; }
        UP.ui.advance();
      });
      el._leave = () => { /* keep running if they scroll away briefly; the work is real either way */ };
    } else {
      const done = h("button", { class: "btn primary" }, icon("check"), "Done it");
      const skip = h("button", { class: "btn ghost" }, "Not now");
      row.append(done, skip);
      inner.append(row, result);
      done.addEventListener("click", () => {
        row.remove();
        const amt = completeDeed(el, spec, result, d.xp || 25);
        result.append(h("div", { class: "verdict ok" }, h("strong", null, UP.pick(["Done. Real life +1.", "That's a real win.", "Nice. The feed paid off."])), h("span", { class: "xp-pill" }, "+" + amt + " XP")));
      });
      skip.addEventListener("click", () => UP.ui.advance());
    }
    const notHere = h("button", { class: "btn ghost small" }, "Can't do this here");
    notHere.addEventListener("click", () => {
      UP.state.snooze = UP.state.snooze || {};
      UP.state.snooze[d.id] = now() + 12 * 3600000;
      store.save();
      UP.ui.toast("Okay. It'll wait for a better moment.");
      UP.ui.advance();
    });
    row.append(notHere);
    if (d.cat === "social") {
      const m = (d.body.match(/["“]([^"”]+)["”]/) || [])[1];
      if (m) {
        const cp = h("button", { class: "btn ghost small" }, icon("copy"), "Copy message");
        cp.addEventListener("click", async () => {
          const ok = await UP.copyText(m);
          UP.ui.toast(ok ? "Copied. Paste it to someone." : "Select the message text to copy it");
        });
        row.append(cp);
      }
    }
    return el;
  }

  /* ---------- breathe ---------- */
  function breathe(spec) {
    const d = spec.data;
    const el = frame(spec, { topic: (d.rounds || 4) + " rounds", topicKey: "breathe" });
    const inner = el._inner;
    inner.append(h("h2", { class: "headline" }, d.title), h("p", { class: "body" }, d.body));
    const orb = h("div", { class: "orb" }, h("div", { class: "orb-core" }), h("div", { class: "orb-label" }, "Ready"));
    const start = h("button", { class: "btn primary" }, "Begin");
    const pause = h("button", { class: "btn ghost", hidden: true }, "Pause");
    const phaseLive = h("p", { class: "sr-only", "aria-live": "polite" });
    const result = h("div", { class: "result" });
    inner.append(h("div", { class: "orb-zone" }, orb), start, pause, phaseLive, result);
    pause.addEventListener("click", () => { cancel = true; clearTimeout(t); if (wake) wake(); });
    let running = false, cancel = false, t = null, wake = null;
    const label = orb.querySelector(".orb-label");
    const core = orb.querySelector(".orb-core");
    start.addEventListener("click", async () => {
      if (running) return;
      running = true; cancel = false;
      start.hidden = true;
      pause.hidden = false;
      pause.focus({ preventScroll: true });
      const pattern = d.pattern || [["Inhale", 4], ["Hold", 4], ["Exhale", 4], ["Hold", 4]];
      const rounds = d.rounds || 4;
      let scale = 0.55;
      for (let r = 0; r < rounds && !cancel; r++) {
        for (const [name, secs] of pattern) {
          if (cancel) break;
          const n = name.toLowerCase();
          if (n.includes("inhale")) scale = n.includes("more") ? 1 : 0.92;
          else if (n.includes("exhale")) scale = 0.55;
          core.style.transitionDuration = secs + "s";
          core.style.transform = "scale(" + scale + ")";
          if (n.includes("inhale")) sfx.breath(true); else if (n.includes("exhale")) sfx.breath(false);
          phaseLive.textContent = name + ", " + secs + " seconds";
          for (let s = secs; s > 0 && !cancel; s--) {
            label.textContent = name + " " + s;
            await new Promise((res) => { wake = res; t = setTimeout(res, 1000); });
          }
        }
      }
      running = false;
      pause.hidden = true;
      if (cancel) { start.hidden = false; start.textContent = "Start again"; label.textContent = "Paused"; core.style.transform = "scale(.55)"; return; }
      label.textContent = "Done";
      UP.state.stats.breaths++;
      store.questProgress("breathe");
      const amt = completeDeed(el, spec, orb, d.xp || 25);
      result.append(h("div", { class: "verdict ok" }, h("strong", null, "Nervous system: reset."), h("span", { class: "xp-pill" }, "+" + amt + " XP")));
    });
    el._leave = () => { if (running) { cancel = true; clearTimeout(t); if (wake) wake(); } };
    return el;
  }

  /* ---------- capture + journal ---------- */
  function capture(spec) {
    const d = spec.data;
    const kindLabel = { task: "To-do", idea: "Idea", question: "Question" }[d.kind] || "Note";
    const el = frame(spec, { topic: "Vault · " + kindLabel, topicKey: "capture" });
    const inner = el._inner;
    inner.append(h("h2", { class: "headline" }, d.text), h("p", { class: "body" }, d.sub));
    const result = h("div", { class: "result" });
    const write = h("button", { class: "btn primary" }, "Write it down");
    const skip = h("button", { class: "btn ghost" }, "Nothing right now");
    const row = h("div", { class: "row" }, write, skip);
    inner.append(row, result);
    write.addEventListener("click", () => {
      UP.ui.compose({
        title: "Write it down", prompt: d.text, placeholder: d.placeholder || "", multi: true,
        hint: "One per line works too.",
        onSave(text) {
          const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
          lines.forEach((line) => store.addVault(d.kind, line));
          UP.state.stats.captures += lines.length; S.captures += lines.length;
          store.questProgress("capture");
          row.remove();
          const amt = gain(15, result, "Captured");
          sfx.done(); UP.ui.burst(result, 12);
          result.append(
            h("div", { class: "verdict ok" }, h("strong", null, "Out of your head, into the vault."), h("span", { class: "xp-pill" }, "+" + amt + " XP"),
              h("span", { class: "verdict-sub" }, d.kind === "task" ? "It'll come back in your feed until it's done." : "It'll resurface when you least expect it.")),
            h("ul", { class: "captured" }, ...lines.map((l) => h("li", null, l)))
          );
          el.classList.add("done");
        },
      });
    });
    skip.addEventListener("click", () => UP.ui.advance());
    return el;
  }

  function reflect(spec) {
    const d = spec.data;
    const el = frame(spec, { topic: "Private", topicKey: "reflect" });
    const inner = el._inner;
    inner.append(h("h2", { class: "headline" }, d.text), h("p", { class: "body" }, d.sub));
    const result = h("div", { class: "result" });
    const write = h("button", { class: "btn primary" }, "Answer in a line");
    const skip = h("button", { class: "btn ghost" }, "Skip");
    const row = h("div", { class: "row" }, write, skip);
    inner.append(row, result);
    write.addEventListener("click", () => {
      UP.ui.compose({
        title: d.text, placeholder: "Just a line or two", multi: true,
        hint: "Only you can see this. It comes back as a time capsule.",
        onSave(text) {
          store.addJournal(d.text, text);
          UP.state.stats.reflects++;
          store.questProgress("reflect");
          row.remove();
          const amt = gain(20, result, "Reflected");
          sfx.done();
          result.append(
            h("div", { class: "verdict ok" }, h("strong", null, "Sealed in a time capsule."), h("span", { class: "xp-pill" }, "+" + amt + " XP")),
            h("blockquote", { class: "quote" }, text)
          );
          el.classList.add("done");
        },
      });
    });
    skip.addEventListener("click", () => UP.ui.advance());
    return el;
  }

  /* ---------- resurfacing your own stuff ---------- */
  function task(spec) {
    const v = spec.data;
    const el = frame(spec, { topic: "Added " + timeAgo(v.createdAt), topicKey: "task" });
    const inner = el._inner;
    inner.append(h("p", { class: "kicker" }, "Still on your list"), h("h2", { class: "headline" }, v.text));
    if (v.step) inner.append(h("p", { class: "tip" }, h("b", null, "Smallest first step "), v.step));
    const result = h("div", { class: "result" });
    const done = h("button", { class: "btn primary" }, icon("check"), "Done");
    const later = h("button", { class: "btn ghost" }, "Not yet");
    const drop = h("button", { class: "btn ghost" }, "Drop it");
    const row = h("div", { class: "row" }, done, later, drop);
    inner.append(row, result);
    done.addEventListener("click", () => {
      const already = v.rewarded;
      v.done = true; v.doneAt = now(); v.rewarded = true;
      const ot = UP.state.oneThing;
      if (ot && ot.vid === v.id) ot.done = true;
      row.remove();
      const amt = already ? 0 : completeDeed(el, spec, result, 35);
      result.append(h("div", { class: "verdict ok" }, h("strong", null, "Crossed off. That's the feed working for you."), amt ? h("span", { class: "xp-pill" }, "+" + amt + " XP") : null));
      store.save();
    });
    later.addEventListener("click", () => { v.r = now(); store.save(); UP.ui.toast("It'll come back tomorrow"); UP.ui.advance(); });
    drop.addEventListener("click", () => { v.archived = true; store.save(); UP.ui.toast("Dropped. One less thing."); UP.ui.advance(); });
    el._enter = () => { v.r = now(); };
    return el;
  }

  function idea(spec) {
    const v = spec.data;
    const el = frame(spec, { topic: "Saved " + timeAgo(v.createdAt), topicKey: "idea" });
    const inner = el._inner;
    inner.append(h("p", { class: "kicker" }, "An idea you had"), h("h2", { class: "headline" }, v.text));
    const result = h("div", { class: "result" });
    const keep = h("button", { class: "btn primary" }, "Still good");
    const drop = h("button", { class: "btn ghost" }, "Archive");
    const row = h("div", { class: "row" }, keep, drop);
    {
      const grow = h("button", { class: "btn ghost" }, icon("spark"), "Next steps");
      grow.classList.add("needs-ai");
      grow.addEventListener("click", () => UP.ui.claudeSheet("Next steps", v.text, (onText, signal) => UP.ai.expandIdea(v.text, onText, signal)));
      row.append(grow);
    }
    inner.append(row, result);
    keep.addEventListener("click", () => { if (keep.disabled) return; keep.disabled = drop.disabled = true; v.r = now(); store.save(); gain(5, keep, "Kept"); UP.ui.advance(); });
    drop.addEventListener("click", () => { if (drop.disabled) return; keep.disabled = drop.disabled = true; v.archived = true; store.save(); UP.ui.toast("Archived"); UP.ui.advance(); });
    el._enter = () => { v.r = now(); };
    return el;
  }

  function capsule(spec) {
    const j = spec.data;
    const el = frame(spec, { topic: timeAgo(j.createdAt), topicKey: "capsule" });
    const inner = el._inner;
    inner.append(h("p", { class: "kicker" }, j.prompt), h("blockquote", { class: "quote big" }, j.text), h("p", { class: "body" }, "That was you, " + timeAgo(j.createdAt) + ". Anything changed?"));
    const result = h("div", { class: "result" });
    const write = h("button", { class: "btn primary" }, "Write a follow-up");
    const nod = h("button", { class: "btn ghost" }, "Still true");
    const row = h("div", { class: "row" }, write, nod);
    inner.append(row, result);
    write.addEventListener("click", () => {
      UP.ui.compose({
        title: "Follow-up", placeholder: "What's different now?", multi: true,
        onSave(text) {
          store.addJournal("Follow-up to: " + j.text.slice(0, 80), text);
          UP.state.stats.reflects++;
          store.questProgress("reflect");
          row.remove();
          const amt = gain(20, result, "Reflected");
          sfx.done();
          result.append(h("div", { class: "verdict ok" }, h("strong", null, "Added to the capsule."), h("span", { class: "xp-pill" }, "+" + amt + " XP")));
        },
      });
    });
    nod.addEventListener("click", () => { if (nod.disabled) return; nod.disabled = true; gain(5, nod, "Capsule"); UP.ui.advance(); });
    el._enter = () => { j.back = now(); store.save(); };
    return el;
  }

  /* ---------- math sprint ---------- */
  function sprint(spec) {
    const el = frame(spec, { topic: "30 seconds", topicKey: "sprint" });
    const inner = el._inner;
    const best = UP.state.stats.sprintBest || 0;
    inner.append(h("h2", { class: "headline" }, "How many can you get in 30 seconds?"), h("p", { class: "body" }, best ? "Your best is " + best + ". Mental math keeps working memory in shape." : "Mental math keeps working memory in shape. Tap the right answer, fast."));
    const zone = h("div", { class: "sprint" });
    const start = h("button", { class: "btn primary" }, "Start sprint");
    zone.append(start);
    inner.append(zone);
    let running = false, raf = null;
    function problem(level) {
      const ops = level < 4 ? ["+", "-"] : ["+", "-", "×"];
      const op = UP.pick(ops);
      let a, b, ans;
      const big = 10 + level * 6;
      if (op === "+") { a = 2 + Math.floor(Math.random() * big); b = 2 + Math.floor(Math.random() * big); ans = a + b; }
      else if (op === "-") { a = 5 + Math.floor(Math.random() * big); b = 1 + Math.floor(Math.random() * a); ans = a - b; }
      else { a = 2 + Math.floor(Math.random() * Math.min(12, 3 + level)); b = 2 + Math.floor(Math.random() * 9); ans = a * b; }
      const opts = new Set([ans]);
      while (opts.size < 3) {
        const delta = UP.pick([-10, -2, -1, 1, 2, 10, op === "×" ? a : 3]);
        const v = ans + delta;
        if (v >= 0) opts.add(v);
      }
      return { text: a + " " + op + " " + b, ans, opts: UP.shuffle([...opts]) };
    }
    start.addEventListener("click", () => {
      if (running) return;
      running = true;
      let score = 0, level = 0;
      const total = 30;
      const t0 = performance.now();
      zone.innerHTML = "";
      const bar = h("div", { class: "sprint-bar" }, h("i"));
      const scoreEl = h("div", { class: "sprint-score" }, "0");
      const qEl = h("div", { class: "sprint-q" });
      const opts = h("div", { class: "sprint-opts" });
      zone.append(bar, scoreEl, qEl, opts);
      let cur;
      const show = () => {
        cur = problem(level);
        qEl.textContent = cur.text;
        opts.innerHTML = "";
        cur.opts.forEach((o) => {
          const b = h("button", { class: "opt sprint-opt" }, String(o));
          b.addEventListener("click", () => {
            if (!running) return;
            if (o === cur.ans) { score++; level++; sfx.good(Math.min(score, 12)); buzz(6); scoreEl.textContent = String(score); scoreEl.classList.remove("pop"); void scoreEl.offsetWidth; scoreEl.classList.add("pop"); }
            else { sfx.bad(); buzz([10, 20, 10]); level = Math.max(0, level - 2); qEl.classList.remove("shake"); void qEl.offsetWidth; qEl.classList.add("shake"); }
            show();
          });
          opts.append(b);
        });
      };
      show();
      const tick = () => {
        const left = total - (performance.now() - t0) / 1000;
        bar.firstChild.style.transform = "scaleX(" + Math.max(0, left / total) + ")";
        if (left <= 0) return finish();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      finishNow = finish;
      function finish() {
        if (!running) return;
        running = false;
        const st = UP.state;
        const prev = st.stats.sprintBest || 0;
        st.stats.sprints++;
        st.stats.sprintBest = Math.max(prev, score);
        store.questProgress("sprint");
        zone.innerHTML = "";
        const amt = gain(5 + score * 2, zone, "Sprint");
        const isBest = score > prev;
        if (isBest && score > 0) { UP.ui.confetti(zone); sfx.level(); }
        zone.append(
          h("div", { class: "sprint-final" }, String(score)),
          h("div", { class: "verdict ok" }, h("strong", null, isBest && prev ? "New personal best." : score >= 15 ? "Lightning." : "Done."), h("span", { class: "xp-pill" }, "+" + amt + " XP"), h("span", { class: "verdict-sub" }, "Best: " + st.stats.sprintBest))
        );
        el.classList.add("done");
      }
    });
    let finishNow = null;
    el._leave = () => { if (running && finishNow) { cancelAnimationFrame(raf); finishNow(); } };
    return el;
  }

  /* ---------- reward chest ---------- */
  function chest(spec) {
    const el = frame(spec, { rail: false, topic: "Tap to open" });
    const inner = el._inner;
    inner.classList.add("center");
    const gem = h("button", { class: "gem", "aria-label": "Open bonus" }, h("span", { class: "gem-core" }), h("span", { class: "gem-ring" }));
    const title = h("h2", { class: "headline" }, "You found a bonus");
    const sub = h("p", { class: "body" }, "Every few cards, the feed pays you back.");
    const result = h("div", { class: "result" });
    inner.append(gem, title, sub, result);
    gem.addEventListener("click", () => {
      if (gem.classList.contains("open")) return;
      gem.classList.add("open");
      sfx.chest(); buzz([10, 30, 10, 30, 40]);
      UP.ui.confetti(gem);
      UP.state.stats.chests++;
      const roll = Math.random();
      let headline, body;
      if (roll < 0.14) {
        const x = 30 + Math.floor(Math.random() * 4) * 10;
        store.award(x, { reason: "Bonus", anchor: gem });
        headline = "+" + x + " XP"; body = "Straight into your level bar.";
      } else if (roll < 0.34) {
        headline = "Pick your next card"; body = "Two sealed cards. Your call.";
        const choices = UP.shuffle([
          ["A legendary fact", () => engine.pickLegendary()],
          ["A math sprint", () => ({ kind: "sprint", id: UP.uid("sprint") })],
          ["A calibration challenge", () => engine.build("estimate")],
          ["A new word", () => engine.build("word")],
          ["A breathing reset", () => engine.build("breathe")],
        ]).slice(0, 2);
        const row = h("div", { class: "row center-row" }, ...choices.map(([label, make]) => {
          const b = h("button", { class: "btn sealed" }, label);
          b.addEventListener("click", () => {
            const spec = make();
            if (spec) { UP.ui.insertNext(spec); row.replaceChildren(h("p", { class: "hint" }, label + " is next. Swipe up.")); setTimeout(() => UP.ui.advance(), 500); }
          });
          return b;
        }));
        result.append(row);
      } else if (roll < 0.52) {
        UP.state.golden = (UP.state.golden || 0) + 1;
        store.save();
        headline = "A golden star"; body = "A rare one for your sky. You have " + UP.state.golden + ".";
      } else if (roll < 0.8) {
        const leg = engine.pickLegendary();
        if (leg) {
          UP.ui.insertNext(leg);
          headline = "A legendary card"; body = "One of the most mind-bending facts in the deck. It's next. Swipe up.";
        } else { store.award(40, { reason: "Bonus", anchor: gem }); headline = "+40 XP"; body = "Straight into your level bar."; }
      } else {
        S.boost = (S.boost || 0) + 5;
        headline = "Double XP"; body = "Your next 5 rewards count twice.";
        UP.bus.emit("boost", S.boost);
      }
      title.textContent = headline;
      sub.textContent = body;
      const eb = el.querySelector(".eyebrow .topic");
      if (eb) eb.textContent = "Opened";
      UP.ui.announce(headline + ". " + body);
      el.classList.add("done");
    });
    return el;
  }

  /* ---------- daily brief ---------- */
  function brief(spec) {
    const el = frame(spec, { rail: false, topic: new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) });
    const inner = el._inner;
    const hr = new Date().getHours();
    const hello = hr < 5 ? "Up late." : hr < 12 ? "Good morning." : hr < 18 ? "Good afternoon." : "Good evening.";
    const st = UP.state;
    const streak = store.streakAlive();
    const due = store.dueReviews().length;
    const qs = store.ensureQuests();
    inner.append(
      h("h2", { class: "headline" }, hello),
      h("p", { class: "body" }, briefStreakLine(streak)),
      h("div", { class: "brief-grid" },
        stat(String(due), due === 1 ? "memory check due" : "memory checks due"),
        stat(String(st.vault.filter((v) => v.kind === "task" && !v.done && !v.archived).length), "open to-dos"),
        stat(String(store.mastered()), "cards mastered")
      ),
      oneThingBlock(),
      h("p", { class: "kicker" }, "Today's quests"),
      h("ul", { class: "quests" }, ...qs.list.map((q) => {
        const QK = { sprint: "sprint", breathe: "breathe", bullseye: "estimate", reflect: "reflect", capture: "capture", word: "word", deed: "action", learn: "fact", review: "review", combo: "fact" };
        const go = h("button", { class: "quest-btn", disabled: q.done }, h("span", { class: "q-dot" }), h("span", { class: "q-label" }, q.label), h("span", { class: "q-xp" }, q.done ? "Done" : "+30"));
        go.addEventListener("click", () => {
          const spec = engine.build(QK[q.type] || "fact");
          if (spec) { UP.ui.insertNext(spec); UP.ui.advance(); }
        });
        return h("li", { class: q.done ? "done" : "" }, go);
      })),
    );
    el._enter = () => { st.lastBrief = UP.dayKey(); store.save(); };
    return el;
  }
  function oneThingBlock() {
    const st = UP.state;
    const box = h("div", { class: "one-thing" });
    const draw = () => {
      box.innerHTML = "";
      const ot = st.oneThing && st.oneThing.day === UP.dayKey() ? st.oneThing : null;
      if (ot) {
        box.append(h("p", { class: "kicker" }, "Today's one thing"), h("p", { class: "one-text" + (ot.done ? " done" : "") }, ot.text));
        return;
      }
      const b = h("button", { class: "btn primary wide" }, "Set today's one thing");
      b.addEventListener("click", () => UP.ui.compose({
        title: "What one thing would make today a win?",
        placeholder: "Finish the proposal draft",
        hint: "The feed will keep nudging you until it's done.",
        onSave(text) { setOneThing(text); gain(15, box, "One thing"); draw(); },
      }));
      box.append(b);
    };
    draw();
    return box;
  }
  function setOneThing(text) {
    const v = store.addVault("task", text, { one: true });
    UP.state.oneThing = { day: UP.dayKey(), text: v.text, vid: v.id, done: false };
    store.save();
  }

  /* ---------- today's one thing, resurfaced ---------- */
  function one(spec) {
    const st = UP.state;
    const ot = st.oneThing;
    const el = frame(spec, { rail: false, label: "Today's one thing", topic: "Set this morning" });
    const inner = el._inner;
    inner.append(h("h2", { class: "headline" }, ot.text), h("p", { class: "body" }, "You said this would make today a win. Is it done?"));
    const result = h("div", { class: "result" });
    const done = h("button", { class: "btn primary" }, icon("check"), "Done");
    const later = h("button", { class: "btn ghost" }, "Working on it");
    const row = h("div", { class: "row" }, done, later);
    inner.append(row, result);
    done.addEventListener("click", () => {
      ot.done = true;
      const v = st.vault.find((x) => x.id === ot.vid);
      const already = v && v.rewarded;
      if (v) { v.done = true; v.doneAt = now(); v.rewarded = true; }
      row.remove();
      const amt = already ? 0 : completeDeed(el, spec, result, 60);
      UP.ui.banner("Today", "Won.", "Your one thing is done. Everything else is a bonus.");
      result.append(h("div", { class: "verdict ok" }, h("strong", null, "Day won."), h("span", { class: "xp-pill" }, "+" + amt + " XP")));
      store.save();
    });
    later.addEventListener("click", () => { UP.ui.toast("Go get it. I'll check back."); UP.ui.advance(); });
    return el;
  }

  function briefStreakLine(streak) {
    const st = UP.state;
    const safe = st.streak.last === UP.dayKey();
    if (!streak) return "Earn " + store.STREAK_MIN + " XP today to start a streak.";
    if (safe) return streak + "-day streak, safe for today.";
    return streak + "-day streak. Earn " + store.STREAK_MIN + " XP today to make it " + (streak + 1) + ".";
  }
  function stat(n, label) {
    return h("div", { class: "stat" }, h("b", null, n), h("span", null, label));
  }

  /* ---------- session receipt ---------- */
  function receipt(spec) {
    const el = frame(spec, { rail: false });
    const inner = el._inner;
    el._enter = () => { inner.replaceChildren(inner.firstChild); fillReceipt(el, inner); };
    return el;
  }
  function fillReceipt(el, inner) {
    const mins = Math.max(1, Math.round((now() - S.start) / 60000));
    const line = (k, v) => h("div", { class: "rc-line" }, h("span", null, k), h("i"), h("b", null, v));
    inner.append(
      h("div", { class: "receipt" },
        h("div", { class: "rc-head" }, h("b", null, "UPSCROLL"), h("span", null, new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))),
        h("div", { class: "rc-rule" }),
        line("Time", mins + " min"),
        line("Cards", String(S.cards)),
        line("New things learned", String(S.learned)),
        line("Right answers", S.correct + "/" + S.answered),
        line("Real-world quests", String(S.deeds)),
        line("Thoughts captured", String(S.captures)),
        h("div", { class: "rc-rule" }),
        line("XP earned", "+" + S.xp),
        line("Stars added to your sky", String(S.stars)),
        h("div", { class: "rc-rule" }),
        h("p", { class: "rc-foot" }, "Same thumb. Better outcome.")
      ),
      tomorrowBlock(),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => UP.ui.endSession() }, "Done for now"),
        h("button", { class: "btn ghost", onclick: () => UP.ui.advance() }, "Keep going")
      )
    );
  }
  function tomorrowBlock() {
    const t = tomorrowList();
    if (!t.length) return null;
    return h("div", { class: "tomorrow" }, h("p", { class: "kicker" }, "Waiting for you tomorrow"), h("ul", null, ...t.map((x) => h("li", null, x))));
  }
  function tomorrowList() {
    const st = UP.state, out = [];
    const soon = now() + 30 * 3600000;
    const due = Object.values(st.srs).filter((r) => r.d <= soon).length;
    if (due) out.push(due + (due === 1 ? " memory check" : " memory checks") + " to lock in what you learned");
    const caps = st.journal.filter((j) => !j.back && j.createdAt + 20 * 3600000 > now() && j.createdAt + 20 * 3600000 < soon).length;
    if (caps) out.push(caps + (caps === 1 ? " time capsule opens" : " time capsules open"));
    const todos = st.vault.filter((v) => v.kind === "task" && !v.done && !v.archived).length;
    if (todos) out.push(todos + (todos === 1 ? " to-do" : " to-dos") + " the feed will nudge you on");
    const hole = st.holes.find((x) => x.active);
    if (hole) out.push("The next lesson in " + hole.topic);
    const streak = store.streakAlive();
    if (streak) out.push("Day " + (streak + 1) + " of your streak");
    return out;
  }

  const R = { one, fact, ai: fact, review, word, estimate, action, breathe, capture, reflect, task, idea, capsule, sprint, chest, brief, receipt };
  UP.cards = {
    render(spec) {
      const fn = R[spec.kind] || fact;
      return fn(spec);
    },
    KIND,
    tomorrowList,
  };
})();
