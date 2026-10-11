# Workbench

**Photograph any piece of your life. Hold the system behind it under your thumb, steer it, and commit to the future you want.**

Chosen by a panel of five designer-inspired agents (debate, scores and spec in `../_debate/`), built by the same five
in parallel against a shared contract, then integrated, tested and reviewed in two rounds.

- **Instruments, not feeds.** A photo of a receipt, fridge, bill, basement or project becomes a live sentence with
  draggable numbers. Every number shows where it came from (seen / inferred / assumed / set), one hinge glows, and a
  hold commits one real act: a pinned mission, a calendar check-in (.ics), a Gmail draft (never sent) or a Drive file.
- **Molds:** recurring cost, spoiling food, cost per use, bill dial, countdown, quick reset, plus the personal round:
  **zones** (big spaces like a basement, one zone per session, verified by an after photo), **project** (social media,
  3D design, work projects: pace lever, finish date, one next step) and **week** (focus blocks, meetings and family
  evenings, committed as calendar blocks).
- **Work and Home.** The bench splits in two. A 60-second **Clock out** saves open work loops as tomorrow's first step,
  then work is put away until **Clock in**; Home never shows work content.
- **Sessions end.** No streaks or XP. The ghost line, where you said you'd be versus where reality is, is the only score.

Run: `node build.mjs` then serve `dist/` (`index.html` standalone; `workbench.html` is the Claude artifact body).
Inside Claude it uses `sample` (vision + tools), `mcp` (Gmail search/read/draft, Drive create), `db`, `assets`,
`room` and `downloads`; outside Claude the example bench runs with drawn photos and real math.
