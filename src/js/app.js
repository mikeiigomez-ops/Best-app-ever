/* Upscroll — boot + onboarding. */
(function () {
  const UP = window.UP;
  const { $, h, icon, store, engine } = UP;

  function onboarding() {
    const ob = $("#onboard");
    ob.hidden = false;
    const st = UP.state;
    const step = h("div", { class: "ob-step" });
    ob.innerHTML = "";
    ob.append(h("div", { class: "ob-sky", "aria-hidden": "true" }), step);
    const dots = (i) => h("div", { class: "ob-dots" }, ...[0, 1, 2, 3].map((j) => h("i", { class: j === i ? "on" : "" })));

    function s0() {
      step.innerHTML = "";
      step.append(
        h("p", { class: "ob-kicker" }, "A feed that gives back"),
        h("h1", { class: "ob-title" }, "Every swipe leaves you a little better off."),
        h("ul", { class: "ob-list" },
          h("li", null, h("b", null, "Learn things that stick. "), "Bite-size cards, then memory checks timed so you actually remember."),
          h("li", null, h("b", null, "Do small real things. "), "Ten-second quests that move your body, your inbox, your relationships."),
          h("li", null, h("b", null, "Empty your head. "), "Capture to-dos and ideas. The feed brings them back until they're done.")
        ),
        h("button", { class: "btn primary wide", onclick: s1 }, "Set up my feed"),
        dots(0)
      );
    }
    function chipGroup(entries, selected) {
      return h("div", { class: "chips big" }, ...entries.map(([k, label, sub]) => {
        const b = h("button", { class: "chip-btn" + (selected.includes(k) ? " on" : ""), "aria-pressed": String(selected.includes(k)) }, h("b", null, label), sub ? h("span", null, sub) : null);
        b.addEventListener("click", () => {
          const i = selected.indexOf(k);
          i >= 0 ? selected.splice(i, 1) : selected.push(k);
          b.classList.toggle("on", i < 0);
          b.setAttribute("aria-pressed", String(i < 0));
        });
        return b;
      }));
    }
    function s1() {
      step.innerHTML = "";
      st.goals = st.goals.length ? st.goals : ["mind"];
      step.append(
        h("p", { class: "ob-kicker" }, "Step 1 of 3"),
        h("h2", { class: "ob-title sm" }, "What should your scrolling do for you?"),
        h("p", { class: "ob-sub" }, "Pick any. The mix adapts to what you lean into."),
        chipGroup(Object.entries(engine.GOALS).map(([k, g]) => [k, g.label, g.sub]), st.goals),
        h("button", { class: "btn primary wide", onclick: s2 }, "Next"),
        dots(1)
      );
    }
    function s2() {
      step.innerHTML = "";
      const topics = Object.entries(engine.TOPICS).filter(([k]) => k !== "holes" && k !== "words").map(([k, t]) => [k, t.label]);
      step.append(
        h("p", { class: "ob-kicker" }, "Step 2 of 3"),
        h("h2", { class: "ob-title sm" }, "What are you curious about?"),
        h("p", { class: "ob-sub" }, "You'll see a bit of everything, and more of these."),
        chipGroup(topics, st.interests),
        h("button", { class: "btn primary wide", onclick: s3 }, "Next"),
        dots(2)
      );
    }
    function s3() {
      step.innerHTML = "";
      const avail = UP.ai.available();
      const input = h("input", { id: "ob-hole", class: "field", placeholder: "e.g. How the stock market works", maxlength: "80", "aria-label": "Topic to learn" });
      input.addEventListener("keydown", (e) => e.stopPropagation());
      const status = h("p", { class: "ob-sub", "aria-live": "polite" });
      const go = h("button", { class: "btn primary wide" }, avail ? "Start scrolling" : "Start scrolling");
      const ideas = ["Ancient Rome", "Investing basics", "Spanish for travel", "Black holes", "Negotiation", "Cooking science"];
      go.addEventListener("click", async () => {
        const topic = input.value.trim();
        if (avail && topic) {
          go.disabled = true;
          status.textContent = "Claude is writing your first " + topic + " cards...";
          const hole = { id: UP.uid("h"), topic, active: true, createdAt: Date.now(), count: 0, headlines: [], queue: [] };
          st.holes.unshift(hole);
          try {
            await UP.ai.digHole(hole);
            st.aiOk = true;
          } catch (e) {
            const msg = UP.ai.handleError(e);
            if (msg) UP.ui.toast(msg);
          }
        }
        finish();
      });
      step.append(
        h("p", { class: "ob-kicker" }, "Step 3 of 3"),
        h("h2", { class: "ob-title sm" }, "Anything you've been meaning to learn?"),
        avail
          ? h("p", { class: "ob-sub" }, "Name any topic and Claude turns it into an endless course woven into your feed. It gets deeper the further you go.")
          : h("p", { class: "ob-sub" }, "Open Upscroll inside Claude to turn any topic into an endless course. For now you get the built-in library of 400+ cards, and it's plenty to start."),
        avail ? input : null,
        avail ? h("div", { class: "chips" }, ...ideas.map((t) => h("button", { class: "chip-btn", onclick: () => { input.value = t; } }, t))) : null,
        go,
        avail ? h("button", { class: "btn ghost wide", onclick: () => { input.value = ""; finish(); } }, "Skip for now") : null,
        status,
        dots(3)
      );
    }
    function finish() {
      st.onboarded = true;
      store.save();
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
    addEventListener("visibilitychange", () => { if (document.hidden) store.save(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
