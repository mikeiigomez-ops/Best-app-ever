/* Upscroll — boot + onboarding. */
(function () {
  const UP = window.UP;
  const { $, h, icon, store, engine } = UP;

  function onboarding() {
    const ob = $("#onboard");
    ob.hidden = false;
    ob.setAttribute("role", "dialog");
    ob.setAttribute("aria-modal", "true");
    ob.setAttribute("aria-label", "Set up Upscroll");
    $("#app").inert = true;
    const st = UP.state;
    const step = h("div", { class: "ob-step" });
    ob.innerHTML = "";
    ob.append(h("div", { class: "ob-sky", "aria-hidden": "true" }), step);
    // after each step renders, move focus to its heading so keyboard and screen-reader users follow along
    const focusStep = () => setTimeout(() => { const t = step.querySelector(".ob-title"); if (t) { t.tabIndex = -1; t.focus({ preventScroll: true }); } }, 30);
    const steps = () => (UP.ai.available() ? 3 : 2);
    const dots = (i) => h("div", { class: "ob-dots", "aria-hidden": "true" }, ...Array.from({ length: steps() }, (_, j) => h("i", { class: j === i ? "on" : "" })));
    let finished = false;

    function s0() {
      step.innerHTML = "";
      focusStep();
      step.append(
        h("p", { class: "ob-kicker" }, "A feed that gives back"),
        h("h1", { class: "ob-title" }, "Every swipe leaves you a little better off."),
        h("p", { class: "ob-sub contrast" }, "Same swipe as TikTok. Except after five minutes you know ten new things and did two real ones."),
        h("ul", { class: "ob-list" },
          h("li", null, h("b", null, "Learn things that stick. "), "Guess first, then the reveal. It comes back right before you'd forget it."),
          h("li", null, h("b", null, "Do small real things. "), "Ten-second quests for your body, your inbox, your people."),
          h("li", null, h("b", null, "Empty your head. "), "Jot down to-dos and ideas. The feed brings them back until they're done.")
        ),
        h("button", { class: "btn primary wide", onclick: s1 }, "Show me a card"),
        dots(0)
      );
    }
    function chipGroup(entries, selected, big) {
      return h("div", { class: "chips" + (big ? " big" : "") }, ...entries.map(([k, label, sub]) => {
        const b = h("button", { class: "chip-btn" + (selected.includes(k) ? " on" : ""), "aria-pressed": String(selected.includes(k)) }, big ? h("b", null, label) : label, sub ? h("span", null, sub) : null);
        b.addEventListener("click", () => {
          const i = selected.indexOf(k);
          i >= 0 ? selected.splice(i, 1) : selected.push(k);
          b.classList.toggle("on", i < 0);
          b.setAttribute("aria-pressed", String(i < 0));
        });
        return b;
      }));
    }
    // one screen of choices: what you want out of it, and (optionally) what you're curious about
    function s1() {
      step.innerHTML = "";
      focusStep();
      if (!st.goals.length) st.goals = ["mind"];
      const topics = Object.entries(engine.TOPICS).filter(([k]) => k !== "holes" && k !== "words").map(([k, t]) => [k, t.label]);
      const next = h("button", { class: "btn primary wide" }, UP.ai.available() ? "Next" : "Start scrolling");
      next.addEventListener("click", () => (UP.ai.available() ? s2() : finish()));
      step.append(
        h("p", { class: "ob-kicker" }, steps() === 2 ? "Last step" : "Step 1 of 2"),
        h("h2", { class: "ob-title sm" }, "Pick what you want more of."),
        chipGroup(Object.entries(engine.GOALS).map(([k, g]) => [k, g.label, g.sub]), st.goals, true),
        h("p", { class: "ob-sub" }, "Curious about any of these? Optional. The feed learns as you go."),
        chipGroup(topics, st.interests, false),
        next,
        dots(1)
      );
    }
    // inside Claude: name a topic; never wait on it
    function s2() {
      step.innerHTML = "";
      focusStep();
      const input = h("input", { id: "ob-hole", class: "field", placeholder: "e.g. How the stock market works", maxlength: "80", "aria-label": "Topic to learn" });
      const ideas = ["Ancient Rome", "Investing basics", "Spanish for travel", "Black holes", "Negotiation", "Cooking science"];
      const chips = h("div", { class: "chips" }, ...ideas.map((t) => {
        const c = h("button", { class: "chip-btn", "aria-pressed": "false" }, t);
        c.addEventListener("click", () => {
          input.value = t;
          chips.querySelectorAll(".chip-btn").forEach((x) => { const on = x === c; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
        });
        return c;
      }));
      input.addEventListener("input", () => chips.querySelectorAll(".chip-btn").forEach((x) => { const on = x.textContent === input.value; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); }));
      const go = h("button", { class: "btn primary wide" }, "Start scrolling");
      go.addEventListener("click", () => {
        const topic = input.value.trim();
        if (topic) startHole(topic);
        finish();
      });
      const skip = h("button", { class: "btn ghost wide" }, "No topic, just start");
      skip.addEventListener("click", () => finish());
      step.append(
        h("p", { class: "ob-kicker" }, "Last step"),
        h("h2", { class: "ob-title sm" }, "Anything you've been meaning to learn?"),
        h("p", { class: "ob-sub" }, "Name any topic and Claude writes you an endless course, woven into the feed. It gets deeper the further you go."),
        input, chips, go, skip, dots(2)
      );
    }
    function startHole(topic) {
      const hole = { id: UP.uid("h"), topic, active: true, createdAt: Date.now(), count: 0, headlines: [], queue: [] };
      st.holes.unshift(hole);
      store.save();
      UP.ui.toast("Claude is writing your " + topic + " course. It'll slot in shortly.");
      UP.ai.digHole(hole).then((cards) => {
        if (!cards.length) return;
        const id = hole.queue.shift();
        if (id) { UP.ui.insertNext({ kind: "ai", id, data: UP.aiCards[id] }); UP.ui.toast("Your " + topic + " course is ready. It's next."); }
      }).catch((e) => { const msg = UP.ai.handleError(e); if (msg) UP.ui.toast(msg); });
    }
    function finish() {
      if (finished) return;
      finished = true;
      st.onboarded = true;
      store.save();
      $("#app").inert = false;
      ob.classList.add("leaving");
      setTimeout(() => { ob.hidden = true; ob.classList.remove("leaving"); }, 400);
      UP.ui.start();
    }
    s0();
  }

  function boot() {
    UP.ui.mount();
    UP.ui.goTab("feed");
    UP.ai.init();
    store.attachDb();
    if (!UP.state.onboarded) onboarding();
    else UP.ui.start();
    UP.bus.on("remote", () => {
      if (UP.state.onboarded && !$("#onboard").hidden) {
        $("#onboard").hidden = true;
        UP.ui.start();
      }
    });
    // save time-on-card when leaving
    addEventListener("visibilitychange", () => { if (document.hidden) store.flush(); });
    addEventListener("pagehide", () => store.flush());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
