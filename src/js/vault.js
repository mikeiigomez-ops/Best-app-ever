/* Upscroll — the Vault: everything the feed pulled out of your head. */
(function () {
  const UP = window.UP;
  const { $, h, icon, store, timeAgo, now } = UP;

  const TABS = [
    { key: "task", label: "To-dos", empty: "Nothing on your list. Capture cards in the feed fill this up, or add one above." },
    { key: "idea", label: "Ideas", empty: "Ideas you save come back to you in the feed later." },
    { key: "question", label: "Questions", empty: "Curious about something? Park it here and ask Claude later." },
    { key: "journal", label: "Journal", empty: "Journal cards in the feed land here as time capsules." },
    { key: "saved", label: "Saved", empty: "Tap Save on any card to keep it here." },
  ];
  let tab = "task";
  let shown = 100;

  function counts() {
    const st = UP.state;
    const c = { task: 0, idea: 0, question: 0, saved: 0, journal: st.journal.length };
    for (const v of st.vault) if (!v.archived && !(v.kind === "task" && v.done)) c[v.kind] = (c[v.kind] || 0) + 1;
    return c;
  }

  function render() {
    const root = $("#vault");
    root.innerHTML = "";
    const c = counts();
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Vault sections" }, ...TABS.map((t) => {
      const b = h("button", { class: "seg-btn" + (tab === t.key ? " on" : ""), "aria-pressed": String(tab === t.key) }, t.label, c[t.key] ? h("span", { class: "count" }, String(c[t.key])) : null);
      b.addEventListener("click", () => { tab = t.key; shown = 100; render(); });
      return b;
    }));
    const head = h("div", { class: "vault-head" },
      h("h2", { class: "view-title" }, "Vault"),
      h("p", { class: "view-sub" }, "Your feed pulls things out of your head and keeps them here. To-dos come back to you until they're done.")
    );
    root.append(head, seg);

    if (tab !== "journal" && tab !== "saved") {
      const id = "vault-add-" + tab;
      const input = h("input", { id, class: "field", placeholder: tab === "task" ? "Add a to-do" : tab === "idea" ? "Add an idea" : "Add a question", maxlength: "300", "aria-label": "Add to " + tab });
      const add = h("button", { class: "icon-btn add", type: "submit", "aria-label": "Add" }, icon("plus"));
      const form = h("form", { class: "add-row" }, input, add);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        store.addVault(tab, input.value);
        UP.state.stats.captures++;
        store.questProgress("capture");
        input.value = "";
        render();
        setTimeout(() => $("#" + id) && $("#" + id).focus(), 0);
      });
      root.append(form);
      {
        const unt = h("button", { class: "btn ghost small needs-ai" }, icon("spark"), "Untangle a brain dump");
        unt.addEventListener("click", () => untangle());
        root.append(h("div", { class: "vault-tools" }, unt));
      }
    }

    const list = h("div", { class: "vlist" });
    const st = UP.state;
    if (tab === "journal") {
      for (const j of st.journal) {
        list.append(h("article", { class: "vitem journal" },
          h("p", { class: "vmeta" }, timeAgo(j.createdAt)),
          h("p", { class: "vprompt" }, j.prompt),
          h("p", { class: "vtext" }, j.text)));
      }
    } else {
      const items = st.vault.filter((v) => v.kind === tab && !v.archived);
      items.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || b.createdAt - a.createdAt);
      for (const v of items.slice(0, shown)) list.append(item(v));
      if (items.length > shown) {
        const more = h("button", { class: "btn ghost small" }, "Show " + Math.min(100, items.length - shown) + " more");
        more.addEventListener("click", () => { shown += 100; render(); });
        list.append(more);
      }
    }
    if (!list.children.length) list.append(h("p", { class: "empty" }, TABS.find((t) => t.key === tab).empty));
    root.append(list);
  }

  function item(v) {
    const del = h("button", { class: "icon-btn", "aria-label": "Archive" }, icon("trash"));
    del.addEventListener("click", () => { v.archived = true; store.save(); render(); });
    const row = h("article", { class: "vitem" + (v.done ? " done" : "") });
    if (v.kind === "task") {
      const cb = h("button", { class: "check" + (v.done ? " on" : ""), "aria-label": v.done ? "Mark not done" : "Mark done", "aria-pressed": String(!!v.done) }, icon("check"));
      cb.addEventListener("click", () => {
        v.done = !v.done;
        const ot = UP.state.oneThing;
        if (ot && ot.vid === v.id) ot.done = v.done;
        v.doneAt = v.done ? now() : null;
        if (v.done && !v.rewarded) {
          v.rewarded = true;
          UP.state.stats.deeds++;
          store.today().deeds++;
          store.questProgress("deed");
          store.award(20, { reason: "To-do done", anchor: cb });
          UP.sfx.done();
          UP.ui.burst(cb, 14);
        }
        store.save();
        setTimeout(render, 250);
      });
      row.append(cb);
    }
    const main = h("div", { class: "vmain" }, h("p", { class: "vtext" }, v.text));
    if (v.due && !v.done) main.append(h("p", { class: "vdue" + (v.due < Date.now() ? " late" : "") }, UP.dueLabel(v.due)));
    if (v.step) main.append(h("p", { class: "vstep" }, "First step: " + v.step));
    if (v.body) main.append(h("p", { class: "vstep" }, v.body));
    main.append(h("p", { class: "vmeta" }, timeAgo(v.createdAt)));
    row.append(main);
    if (v.kind === "question" || v.kind === "idea") {
      const ask = h("button", { class: "icon-btn spark needs-ai", "aria-label": v.kind === "question" ? "Ask Claude" : "Get next steps" }, icon("spark"));
      ask.addEventListener("click", () => {
        if (v.kind === "question") UP.ui.claudeSheet("Answer", v.text, (onText, signal) => UP.ai.answer(v.text, onText, signal));
        else UP.ui.claudeSheet("Next steps", v.text, (onText, signal) => UP.ai.expandIdea(v.text, onText, signal));
      });
      row.append(ask);
    }
    row.append(del);
    return row;
  }

  function untangle(prefill) {
    const id = "dump-" + Date.now();
    const ta = h("textarea", { id, class: "field", rows: "7", placeholder: "Type everything on your mind, messy is fine. Dentist, mom's birthday gift, why do cats knead, fix bike brakes, start running again...", "aria-label": "Brain dump" });
    if (typeof prefill === "string") ta.value = prefill;
    const go = h("button", { class: "btn primary wide" }, icon("spark"), "Sort it for me");
    const out = h("div", { class: "untangle-out", "aria-live": "polite" });
    const LABEL = { task: "To-do", idea: "Idea", question: "Question" };
    const NEXT = { task: "idea", idea: "question", question: "task" };
    go.addEventListener("click", async () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      go.disabled = true;
      out.textContent = "Claude is sorting your thoughts...";
      try {
        const items = await UP.ai.untangle(text);
        if (!items.length) { out.textContent = "Couldn't find separate items in that. Try listing a few things."; return; }
        // review before filing: fix the type, drop what's wrong
        out.innerHTML = "";
        items.forEach((it) => (it.keep = true));
        const list = h("div", { class: "review-list" });
        const file = h("button", { class: "btn primary wide" });
        const draw = () => {
          list.replaceChildren(...items.map((it) => {
            const kind = h("button", { class: "chip-btn kind-" + it.kind, title: "Change type" }, LABEL[it.kind]);
            kind.addEventListener("click", () => { it.kind = NEXT[it.kind]; draw(); });
            const keep = h("button", { class: "icon-btn", "aria-label": it.keep ? "Remove " + it.text : "Keep " + it.text, "aria-pressed": String(it.keep) }, icon(it.keep ? "close" : "plus"));
            keep.addEventListener("click", () => { it.keep = !it.keep; draw(); });
            return h("div", { class: "review-item" + (it.keep ? "" : " off") }, kind, h("div", { class: "vmain" }, h("p", { class: "vtext" }, it.text), it.step && it.kind === "task" ? h("p", { class: "vstep" }, "First step: " + it.step) : null), keep);
          }));
          const n = items.filter((i) => i.keep).length;
          file.textContent = n ? "File " + n + (n === 1 ? " item" : " items") : "Nothing to file";
          file.disabled = !n;
        };
        file.addEventListener("click", () => {
          const keep = items.filter((i) => i.keep);
          for (const it of keep) store.addVault(it.kind, it.text, it.step && it.kind === "task" ? { step: String(it.step).slice(0, 120) } : {});
          UP.state.stats.captures += keep.length;
          store.questProgress("capture");
          store.award(10 + keep.length * 3, { reason: "Untangled", anchor: file });
          out.replaceChildren(h("p", { class: "hint" }, keep.length + " items filed in your vault. To-dos will come back to you in the feed."));
          ta.value = "";
          if (document.body.dataset.tab === "vault") render();
        });
        draw();
        out.append(h("p", { class: "hint" }, "Check it over. Tap a label to change it, or remove anything that's wrong."), list, file);
      } catch (e) {
        out.textContent = UP.ai.handleError(e) || "Stopped.";
      } finally {
        go.disabled = false;
      }
    });
    UP.ui.closeSheet();
    setTimeout(() => {
      const body = h("div", { class: "compose" }, h("p", { class: "lede" }, "Dump everything on your mind. Claude splits it into to-dos, ideas and questions, and finds the first tiny step for each to-do."), ta, go, out);
      UP.ui.sheetRaw("Untangle", body);
      setTimeout(() => ta.focus(), 80);
    }, 10);
  }

  UP.vault = { render, untangle };
})();
