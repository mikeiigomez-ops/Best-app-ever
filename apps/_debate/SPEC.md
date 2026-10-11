# Workbench — definitive build spec

Slug: `workbench`. Location: `apps/workbench/`. Output: `apps/workbench/dist/workbench.html` (Claude artifact page body) and `apps/workbench/dist/index.html` (standalone preview).

---

## 1. Concept

You point your phone at an ordinary object: a takeout receipt, the inside of your fridge, an electric bill, a gym tag, a return slip, a messy desk. Four to eight seconds later the photo is still on screen, mounted like a specimen. Thin hairlines run from the parts of the photo Claude read (the TOTAL line, the spinach, the kWh figure) down to a single sentence underneath. The numbers in that sentence are live:

> *Golden Wok, **$31.40** × **3** a week is **$4,898** a year. At **1** a week you'd keep **$3,265**.*

Drag the `3` with your thumb and every number, the chart, and the hairlines reflow while your finger is still moving. Nothing is a form and nothing has a submit button. Reading the instrument, steering it and acting on it are the same gesture.

When you find the setting you want, you **hold** the glowing lever. That pins an *intention* ("1 a week, check on Oct 18") and produces exactly **one prepared real act**: a 7-minute pinned mission on that same photo, a Gmail draft (never sent for you), a calendar reminder (.ics), or a Drive file. Next time you photograph the same kind of thing, the new photo **snaps onto the existing instrument**. A ghost line shows where you said you'd be, a solid point shows where reality is, and the gap between them is the only score in the app.

### Why it is groundbreaking
- **A new medium, not a new feed.** Software written about *your* object, on the spot, that you hold and steer. This only became possible once a frontier model could read a photo and fill a working model of it in seconds. No app ships this.
- **Honesty is part of the material.** Every number shows where it came from. A **solid** number was read from your photo or mail, and tapping it lights up the exact pixels or quote. A **dotted** number is an inference, with a one-line reason. A **hollow** chip with a `?` is a guess that is waiting for you to set it. When you drag a guess it turns **cobalt**: now it is yours, and so it is true. Making an instrument more accurate is itself the game, so the "false precision" objection is designed out.
- **One hinge.** The page runs a sensitivity sweep locally and makes only the single number that decides the outcome glow vermilion: *"Everything turns on this one: orders a week."*
- **It ends in the world.** Every commit becomes one real act. The after photo verifies missions with a before/after wipe.
- **It compounds.** The tenth fridge photo is worth more than the first, because it lands on a model that already knows you. The bench is a small cabinet of living systems (Food, Money, Energy, Things, Space, Health), not a grid of 200 one-offs.
- **The camera is the front door; the inbox is the second act.** The first session needs no permissions beyond Claude. Gmail only deepens an instrument that already exists ("I found 7 more of these orders since July. It's really 4.2 a week, not 3.") A shop-heavy inbox (orders, suppliers, invoices) is exactly the right material for that.
- **Humane pull.** The hooks are the reveal (a small magic trick on your own object), the steering (a curve bending under your finger), and the ghost line (you come back to see whether reality followed the promise you made). There are no streaks, XP, chests or infinite wall. A session is *tune one, commit one*, and then the bench says **"Bench is set."** and stops offering anything new.

Grafted from the runners-up: I11 One Square Meter becomes the `reset` mold and the mission/before-after action. I7 Underlay supplies the photo-as-interface, the ghost line and provenance. Kiln/H5 supplies "melt" (negative preferences) and "forge from mail" as a second act. H1/H4 supply the hold-to-commit consent gesture, drafts-only, and the designed ending. Kiln fusion, the desktop shell and the card deck are deliberately cut.

---

## 2. The six molds (Claude fills these; it never writes formulas)

Claude classifies the photo into one of six hand-designed **molds** and fills that mold's typed variables, pins and words. All math is fixed JS in `molds.js`, so there is no eval, no generic schema and no fragile renderer. Each mold has one chart type. A sentence has at most 3 draggable chips.

Variables have `kind: "fact"` (a claim about reality, with an origin of `seen | inferred | assumed | set`) or `kind: "lever"` (your choice, always yours). Commits happen on levers only.

| Mold | For | Vars (id: kind) | Outputs (primary in **bold**) | Better | Chart | Default act | checkDays |
|---|---|---|---|---|---|---|---|
| `leak` Recurring cost | takeout receipt, coffee, delivery, subscription email, ride receipt, supplier reorder | `price` fact $/occurrence; `rate` fact occurrences per period; `target` lever occurrences per period. `words.period` = `"week"`\|`"month"` | **`yearly`** = price·rate·ppy; `yearlyAtTarget` = price·target·ppy; `kept` = yearly − yearlyAtTarget (ppy 52 or 12) | lower | `costOverTime` | ics check-in; draft (cancel/pause) when a vendor email is known | 7 |
| `spoil` Decay clock | fridge, pantry shelf, fruit bowl, shop perishables | `horizon` fact: days until you next cook or shop (usually assumed, default 3); `cookN` lever: items you cook tonight (int 0..items). `items[]` = {id,name,value$,days,origin,pin} | **`lost`** = atRisk − saved; `atRisk` = Σ value of items with days ≤ horizon; `saved` = Σ value of the first cookN at-risk items sorted by days | lower | `timeline` (items as dots by day, draggable horizon line) | mission: "Cook tonight" (pins on the shelf) | 4 |
| `perUse` Cost per use | gym tag or membership email, a jacket tag, a gadget, a closet shelf | `cost` fact $; `uses` fact uses per month; `months` fact months owned/expected (ignored when `words.basis`="month"); `target` lever uses per month | **`cpu`** = basis month ? cost/uses : cost/(uses·months); `cpuAtTarget`; `alt` (optional fact: alternative price per use, e.g. a day pass) feeds the gauge threshold | lower | `gauge` | ics: recurring check-in; draft (cancel/downgrade) when an email is known | 14 |
| `dial` Bill dial | electric, gas, water, phone bill, shop utility | `amount` fact $ bill total; `days` fact billing days; `fixed` fact $ fixed charges; `pctPerStep` fact % usage change per step (inferred, e.g. 3%/°F); `steps` lever int −5..5. `words.stepUnit` e.g. "°F cooler" | **`annual`** = amount/days·365; `annualAtDial` = (fixed + (amount−fixed)·(1 − steps·pctPerStep/100))/days·365; `saved` | lower | `stackedBar` (fixed vs usage, now vs dialled) | ics: reminder for next bill; mission (e.g. "set thermostat, seal the door gap") | 30 |
| `countdown` Deadline | return slip, warranty card, lease letter, prescription label, parking ticket, invoice due date | `deadline` fact (epoch day number); `stake` fact $ at stake; `lead` lever days before the deadline you act (default 3) | **`daysLeft`**; `actBy` date; `stake` | higher (days of slack) | `timeline` (today, act-by, deadline) | ics on actBy; draft (return request, renewal question) | until the deadline |
| `reset` Square meter | any physical chaos: desk, drawer, nightstand, entryway, a dying plant (Revive), a pile to give away (Release) | `minutes` fact (inferred, sum of steps); `take` lever: steps you'll do now (default all). `steps[]` = {id,n,text,minutes,pin} | **`reclaimed`** % (0 until verified; set from verification) and `minutesNeeded` = Σ minutes of first `take` steps | higher | `gauge` | mission (always) | 7 |

Sentence templates (owned by `molds.js`; `{id}` = var or output chip; `{w.key}` = Claude-supplied words, escaped):
- leak: `{w.subject}, {price} × {rate} a {w.period} is {yearly} a year. At {target} a {w.period} you'd keep {kept}.`
- spoil: `{atRisk} of food turns in the next {horizon}. Cook {cookN} tonight and you keep {saved}.`
- perUse: `{cost} for {w.subject} at {uses} uses a month is {cpu} a use. At {target} it's {cpuAtTarget}.`
- dial: `This bill runs {annual} a year. {steps} {w.stepUnit} and it's {annualAtDial}, {saved} back.`
- countdown: `{w.subject}: {stake} is on the line, {daysLeft} left. Act {lead} early: by {actBy}.`
- reset: `{take} moves, about {minutesNeeded}, and this corner is clear.`

Rules: no number may render without an origin. Derived outputs render as plain ink; tapping one shows a one-line formula strip ("$31.40 × 3 × 52"). No equivalence flourishes ("= a flight to Lisbon") and no invented conversions ("hours waiting").

**Hinge** (`WB.molds.hinge`): for every lever and every non-`seen` fact, evaluate the primary output at the var's min and max with everything else held fixed. impact = |Δ|. The largest impact wins, and a lever wins ties. If the hinge is a lever, the note reads "This is the one that decides it." If it is an unset fact: "Everything turns on this guess. Set it."

**Confidence** (`WB.molds.confidence`): measured = facts with origin `seen` or `set`, out of all facts. Shown as "Measured 2 of 4".

**Ghost** (`WB.molds.ghost`): with an intention, the baseline (primary at commit) and target (primary at the committed lever value) form a dashed line from committedAt to checkAt. Observations (later snaps or enrichments) plot as solid points. Status: `open` until checkAt; then `held` if the latest observation is within 10% of target in the better direction, otherwise `missed`. A verified mission marks `held` immediately.

---

## 3. First-run experience (screen by screen)

**0. Boot (<300 ms).** Paper-colored screen, the wordmark *Workbench* in Instrument Serif italic, and one hairline drawing itself left to right. Store loads from localStorage immediately; cloud and capabilities light up later.

**1. Front door** (`view-front`). Full paper. Top-left in micro mono caps: `WORKBENCH · NO. 001`. Hero in Instrument Serif 40/44:
> Show me anything you paid for, own, or have to deal with.

Under it, in sans 16 ink-2: *A receipt. Inside your fridge. A bill. The corner that's bugging you.* A row of four small ink line-drawings (receipt, fridge shelf, bill, desk), each tappable as a hint. Primary button, full-width, ink with a vermilion dot: **Take a photo** (camera input). Secondary: **Choose from photos**. Tertiary text link: *See one I made earlier* (loads the demo bench). Footnote in micro mono: `YOUR MAIL STAYS CLOSED UNTIL YOU ASK.`
- If `sample` is unavailable (outside Claude, or denied): the hero stays, the buttons are replaced by **Open the example bench**, and a one-line note reads *"Reading photos needs Claude. Here's a bench built from four example photos. Every number still moves."*

**2. Forging** (`view-forging`, 4–10 s). The chosen photo fills the screen width, desaturated and high-contrast like a negative. A horizontal scan hairline sweeps top to bottom on a 1.6 s loop. Below it, a mono stage ticker driven by `forge:progress`: `READING THE RECEIPT…` → `MEASURING…` → `FINDING THE HINGE…`. A quiet **Stop** button. After 12 s an extra line appears: *still reading, receipts with tiny print take longer.* Errors are per code (§9) with **Try again** and **Choose another photo**.

**3. The develop.** The router moves to the instrument with `{develop:true}`. The photo color-transitions from negative to full color (600 ms). Corner brackets appear at each evidence bbox, then hairlines draw from each bracket to its chip in the sentence (stroke-dashoffset, 80 ms stagger), and the numbers count up to their values. The hinge chip begins its breath glow.

**4. Coach 1 (once).** A small ink tag with a finger glyph points at the hinge chip: **Drag me.** It disappears on the first drag.

**5. Coach 2 (once, after the first drag ends).** A tag under the sentence: *Solid numbers I read. Dotted ones I inferred. Hollow ones are guesses: make them true.* A `?` chip pulses once.

**6. Coach 3 (once, after any lever moved).** The bottom bar's hint changes to **Hold the glowing number to commit.** Holding fills a vermilion ring around the chip for 700 ms, then a haptic tick and the "stamp": the chip drops onto the page like a pressed plate, and the ghost line inks into the chart.

**7. Commit sheet** (Raskin). Title: *"1 a week, from 3."* Line: *"I'll check with you on Sat Oct 18. Photograph your next receipt and it lands here."* One prepared act card (e.g. **Add a check-in to my calendar**, .ics; or **Draft a pause request to Golden Wok**, a Gmail draft preview with editable body; or **Start a 7-minute mission**). Primary: **Do it** (hold for writes to Gmail/Drive, tap for .ics/mission). Quiet: **Just remember it**.

**8. End** (`view-end`). Paper dims slightly. Serif: **Bench is set.** Under it in mono: `1 INSTRUMENT BUILT · 1 FUTURE COMMITTED · $3,265/YR IN PLAY`. One line: *Come back with the next receipt.* Two quiet buttons: **Show me the bench**, and **One more photo**. There is never a "keep scrolling".

**9. Second visit.** The bench opens with the "Since last time" strip. If the first instrument was `leak`, `perUse` or `countdown` and Gmail is available and not yet asked, its card shows a chip: **Check my mail for more of these**. This is the first time the inbox is ever mentioned.

---

## 4. Core loop

1. **Open** → Bench. "Since last time" shows at most 3 real deltas. Tiles that are due for a check-in breathe.
2. **Shoot** something new, or tap a tile. A new photo of a known kind snaps onto its instrument (Claude returns `snapTo`), which adds an observation and moves the ghost point.
3. **Explore**: drag levers and guesses, tap solid numbers to see their evidence, set `?` chips to raise "Measured".
4. **Optionally deepen**: *Check my mail for more of these* runs the enrichment agent and turns guesses into `seen` facts with email evidence.
5. **Commit**: hold the lever → intention + one prepared act.
6. **Act**: mission timer, draft, .ics or Drive file.
7. **End**: "Bench is set." Session = tune one + commit one. Later commits in the same session show a toast instead of the end view.
8. **Return**: the ghost line asks whether reality followed.

---

## 5. Views

All views are `<section class="wb-view" data-view=…>` inside `#wb-views`. Only one is visible at a time. Phone-first at 360–430 px, 16 px gutters, safe-area insets on the fixed bottom bar, no horizontal scroll.

### 5.1 Bench (`view-bench`, Zhuo)
- **Header**: *Workbench* (serif italic 26) left; date in micro mono right (`SAT 11 OCT`); a `⋯` button opens a sheet: Export bench (Drive/.md), Theme (auto/light/dark), Exit example bench (demo only), About provenance.
- **Since last time strip** (only if there are deltas): a paper-2 band with up to 3 lines in sans 15, each starting with a small system glyph. Examples: *"Fridge: you kept $14 from spoiling."*, *"Takeout: check-in due. Photograph your next receipt."*, *"Desk: the corner held."* Tapping a line opens its instrument.
- **Ledger line** (mono 12, ink-2): `STEERED  $3,265/yr in play · $41 kept · 2 of 3 promises held`. The figures are computed only from intentions and verified observations.
- **Wall**: a 2-column grid of specimen tiles (1 column under 360 px). Each tile is paper-2 with a 1 px rule border and 10 px radius, and contains: the thumb (aspect 4:3, slightly desaturated) with a single hairline from its main bracket to the big primary number (mono 22); the title (sans 15/600) plus a system tag (micro mono caps); and a mini ghost spark (60×18 SVG). A due tile's border breathes vermilion over 3 s. Room peers appear as small initials on tiles they are viewing. Tiles are rendered with `WB.instrument.renderMini`. Long-press a tile → sheet: Open, Re-photograph, Melt.
- **Grouping**: tiles sorted by system (Food, Money, Energy, Things, Space, Health), then by updatedAt. A section header is shown only once there are more than 6 tiles.
- **Empty state** (signed-in, zero instruments, firstRunDone): three suggestion cards with ink drawings, "your last receipt", "inside your fridge", "a bill", each opening the camera; plus *See the example bench*.
- **Bottom bar** (fixed, 76 px + safe area): a centered 64 px round ink camera button with a vermilion dot → `WB.app.capture({intent:'new'})` (opens a sheet: Take a photo / Choose from photos / Look in my mail [only if Gmail is not `unavailable`]). On the left, a mail icon for "Forge from mail"; on the right, the peers indicator (Raskin's mount `#wb-peers`).

### 5.2 Front door (`view-front`, Ives) — see §3.1.

### 5.3 Forging (`view-forging`, Ives) — see §3.2. It is also reused for snap and verify with different ticker copy.

### 5.4 Instrument (`view-instrument`, Victor)
Top to bottom:
- **Top bar**: back chevron, title (sans 17/600), system tag, `⋯` (Re-photograph to update · Check my mail for more · Show to someone here [room] · Melt this instrument).
- **Specimen** — the photo is the hero: up to 54vh tall, natural aspect, mounted on a paper-3 mat with 8 px padding and a 1 px rule. An SVG overlay draws corner brackets (12 px ticks, not boxes) at each evidence bbox and numbered pins (22 px circles, ink fill, paper numerals) for items and steps. Pinch-free: tapping a bracket flashes its chip and vice versa.
- **Sentence**: Instrument Serif 28/36 ink, left-aligned, max 3 lines at 375 px. Chips are inline-block IBM Plex Mono 0.8 em with tabular numerals:
  - `seen`: ink text, 2 px solid underline. Not draggable. Tap → the photo smoothly zooms to the bbox crop with a bracket flash, or an email-quote card slides up (subject, date, the quoted line highlighted).
  - `inferred`: 2 px dotted underline. Draggable. Tap → the one-line reason.
  - `assumed`: hollow chip with a 1.5 px dashed ink-3 border and a superscript `?`. Draggable. On drag end its origin becomes `set`.
  - `set` (yours): cobalt text with a 2 px cobalt underline.
  - `lever`: ink chip with a paper-2 fill and a 1 px ink border. Always draggable.
  - `derived`: plain ink, no chrome; tap → formula strip.
  - **Hinge**: whichever chip is the hinge also gets a vermilion breath glow (`box-shadow 0 0 0 6px var(--signal-soft)` pulsing over 2.4 s) and a vermilion underline.
- **Hairline layer**: one absolutely positioned SVG covering the scroll content, which draws a 1 px hairline (light `--line` with a 1 px dark halo) from each bracket center to its chip's top-center as a gentle cubic. It recomputes on scrub (rAF), resize and scroll.
- **Hinge note**: micro mono caps `THE HINGE —` + sans 14 note.
- **Chart** (full width × 140 px), drawn by `WB.charts.render`. It updates synchronously on scrub. The ghost line is dashed ink-3 and observations are solid ink dots. `timeline` charts expose a draggable cursor bound to a var (spoil horizon, countdown lead).
- **Items/steps list** (spoil, reset): numbered rows matching the pins, each with name, value or minutes and an origin mark. Spoil rows within the horizon are tinted warn; cooked ones are struck through in good.
- **Confidence row**: `MEASURED 2 OF 4` + four tiny squares (filled = measured) + a *tap ? to set* hint. If Gmail is available and the mold has a `mailQuery`: a chip **Check my mail for more of these**. While enriching, the chip becomes a mono ticker of the search terms Claude is using, then a one-line summary.
- **Field note**: serif italic 17, ink-2. One dry, specific line from Claude.
- **Bottom bar**: the contextual hint ("Drag the glowing number" / "Hold it to commit" / after commit: `COMMITTED · CHECK SAT 18 OCT` + **Re-photograph**).

**Scrub physics**: pointer events with `touch-action: pan-y` on chips. Horizontal movement past 6 px captures the pointer; vertical movement scrolls the page. 1 step per 8 px, with ×3 acceleration above 1.2 px/ms. Values clamp to [min,max] with a 40 ms rubber-band. While dragging, a 140 px ruler strip with ticks floats 44 px above the finger, showing the value in mono 15. Every step boundary gives `navigator.vibrate?.(4)`, rate-limited to every 40 ms. `instrument:scrub` events are throttled to 30/s; `WB.store.update(…, 'scrub')` runs on drag end only, while live values stay in a view-local copy during the drag.

**Commit gesture**: `WB.ui.hold(chip, {ms:700})` on lever chips only. Progress draws a vermilion ring; cancel on movement over 10 px. On done: stamp animation, then emit `instrument:commit`.

### 5.5 Commit sheet (Raskin; uses `WB.ui.sheet`) — see §3.7. For a draft act, the sheet shows an editable `<textarea>` with the body Claude wrote, the To field, and a mono note `SAVED AS A DRAFT IN GMAIL. NOTHING IS SENT.` Gmail/Drive writes require a hold. Afterwards, **Open in Gmail** opens the draft's `viewUrl`.

### 5.6 Mission (`view-mission`, Raskin)
- **Brief**: photo with numbered pins, the step list, total minutes, and **Start** (big). The title comes from the plan, e.g. *"Cook tonight: spinach, chicken, feta."* or *"Clear the nightstand."*
- **Running**: the screen deliberately has nothing to scroll. The photo is dimmed to 35% with the pins at full strength. A huge mono countdown `6:59` (64 px) and the current step in serif 24. Tap a step to tick it (the pin fills good, haptic). A thin progress rule runs along the top. Leaving the screen doesn't stop the timer, which is computed from `endsAt`. At 0:00: *"Time. Show me the after."*
- **After**: **Take the after photo** → forging ticker `CHECKING WHAT CHANGED…` → `WB.forge.verifyMission`.
- **Reveal**: before and after stacked in one frame with a vertical wipe handle. Dragging wipes chaos to calm; the handle auto-sweeps once on entry. Below: the field note (serif italic), ticked steps (verified ones have a check, missed ones are struck faint), and `RECLAIMED 85%`. **Done** → `mission:done` → end view (first act this session) or back to the instrument.
- Without `sample` (demo): the after photo is still taken and the wipe still works; verification is the steps the user ticked, with the note *"Checked by you."*

### 5.7 End (`view-end`, Zhuo) — see §3.8. The copy adapts: `KILN`-style counts become `n INSTRUMENTS BUILT · n FUTURES COMMITTED · n LOOPS CLOSED`, plus the dollar figure if there is one.

### 5.8 Mirror (`view-mirror`, Raskin) — a read-only live mirror of an instrument a room peer shared, rendered with `WB.instrument.mount(el, null, {snapshot, readOnly:true})`. Peer scrubs animate the chips with a small initial badge.

---

## 6. Visual identity — "Vellum & Vermilion"

The material is a draftsman's bench: warm vellum paper, black ink, hairlines, and one signal color. There are no gradients, glassmorphism, purple or emoji. The photograph is the only full-color thing on screen.

**Palette (light, "Vellum")**: paper `#F3EFE6`, paper-2 `#EAE4D7`, paper-3 `#DDD5C4`, ink `#1A1916`, ink-2 `#4A463E`, ink-3 `#8A8476`, rule `#CFC6B3`, signal (hinge/commit) `#FF4D1A`, signal-soft `rgba(255,77,26,.16)`, mine (set by you) `#2741E6`, good `#1F8A5B`, warn `#B97900`, danger `#C2361B`, line (hairlines on photos) `#FFF6DC`, halo `rgba(10,8,4,.55)`.

**Dark ("Darkroom")**: paper `#12110E`, paper-2 `#1C1A16`, paper-3 `#27241E`, ink `#EEE8DA`, ink-2 `#B9B2A2`, ink-3 `#7C7566`, rule `#3A362E`, signal `#FF6A3D`, signal-soft `rgba(255,106,61,.20)`, mine `#8796FF`, good `#4CC38A`, warn `#E7B33A`, danger `#FF6B57`, line `#FFF6DC`, halo `rgba(0,0,0,.7)`.

**Type**: Instrument Serif (sentences, hero, field notes; italic for the wordmark and notes). Instrument Sans 400–700 (UI). IBM Plex Mono 400/500/600 (every number, plus micro caps labels with 0.08 em tracking). Always `font-variant-numeric: tabular-nums` on numbers.

**Texture**: a 2% paper grain via an inline SVG feTurbulence data-URI on body (disabled in dark mode, which uses a pure flat color). Rules are 1 px. Corners are 6 px on chips, 10 px on tiles and 18 px on sheets.

**Motion** (tokens in §contract): *develop* (negative → color + hairlines drawing, 600–900 ms); *count* (numbers tween 420 ms ease-out on non-scrub changes, instant during scrub); *breath* (hinge glow 2.4 s); *stamp* (scale 1.08→1 + 1 px offset shadow collapse, 240 ms spring, `vibrate(12)`); *ink-in* (ghost line dash draws 900 ms); *wipe* (before/after auto-sweep 1.2 s). Under `prefers-reduced-motion` there are no pulses or sweeps, and counts snap.

**Voice**: plain, specific and dry, like a good shop teacher. "You're out of slack on the spinach." Never "Amazing!" and never exclamation marks.

---

## 7. AI design (all calls via `WB.ai`, prompts owned by `forge.js`)

General rules: every prompt is self-contained (instructions + data + exact JSON shape). Coordinates are normalized 0..1 from the image's top-left. bbox = `[x, y, w, h]`. Money is plain numbers in the currency on the receipt (store `words.currency`, default "$"). Validation failure → one re-ask with the validator's errors appended, at `modelTier:"default"`. The negative-preferences list (melted instruments) and the existing-instrument index are always included.

### 7.1 Forge from photo — `WB.forge.fromPhoto`
Call: `WB.ai.json(prompt, {images:[jpegBlob], tier:"quick", validate: WB.molds.validate})`. The image is downscaled to ≤1600 px JPEG q0.82.

Prompt (verbatim skeleton; `${…}` filled at runtime):
```
You are the instrument-maker inside Workbench. The user photographed something from their life.
Turn it into ONE instrument by choosing exactly one MOLD and filling its variables from what is
visible. You never invent formulas; the app computes everything.

MOLDS (pick one):
${WB.molds.list().map(m => m.promptGuide).join("\n")}
(each guide lists: id, when to use, variable ids with meaning/unit/kind, words keys, items/steps needs)

HONESTY RULES (critical):
- origin "seen": the number is printed/visible in the photo. Give evidence.bbox around it and evidence.text = the exact characters.
- origin "inferred": not printed but strongly implied by what is visible (e.g. spinach that looks wilted → 2 days). Give a one-line "reason".
- origin "assumed": a reasonable default the user should set. Give a "reason" and a sensible value.
- Never mark something seen unless you can box it. Prefer fewer, truer numbers.
- Levers start at a value that shows a meaningful but realistic change (e.g. target 1 when rate is 3).

EXISTING INSTRUMENTS (snap if this photo is a new reading of one of them; same kind of thing, same place/vendor):
${JSON.stringify(index)}   // [{id, mold, kind, title, system}]
If it matches, set "snapTo" to that id and still fill all vars from THIS photo.

THE USER DOES NOT WANT instruments like: ${JSON.stringify(melted)}   // [{mold, kind, title}]

If nothing fits: if it shows a physical space or objects to deal with, use "reset". Otherwise return
{"fit": false, "why": "<one short sentence>", "try": "<one suggestion of a better photo>"}.

Return ONLY JSON:
{
 "fit": true,
 "mold": "leak|spoil|perUse|dial|countdown|reset",
 "kind": "<stable lowercase slug for this kind of thing, e.g. takeout-golden-wok, home-fridge, electric-bill>",
 "system": "Food|Money|Energy|Things|Space|Health",
 "title": "<2-3 words>",
 "snapTo": "<existing id or null>",
 "words": { "subject": "...", "period": "week|month", "basis": "once|month", "stepUnit": "...", "currency": "$" },
 "vars": { "<varId>": { "value": <number>, "origin": "seen|inferred|assumed",
                         "evidence": { "bbox": [x,y,w,h], "text": "..." } | null, "reason": "..." | null } },
 "items": [ { "id": "i1", "name": "...", "value": <number>, "days": <number>, "origin": "seen|inferred|assumed", "pin": [x,y] } ],
 "steps": [ { "id": "s1", "n": 1, "text": "<imperative, specific to this photo, <= 9 words>", "minutes": <number>, "pin": [x,y] } ],
 "fieldNote": "<one dry, specific sentence about this exact photo, no exclamation marks>",
 "nextPhotos": ["<what to photograph next to keep this true>"],
 "mailQuery": "<Gmail search query that would find more evidence, or null>",
 "act": { "type": "draft|ics|mission", "to": "<email if visible or null>", "why": "<short>" }
}
Dates: for countdown.deadline give "value" as days from TODAY=${todayISO} (integer), the app converts.
```
`items` is required for spoil (3–12 items) and `steps` for reset (3–7 steps); omit both otherwise. `WB.molds.build(spec, photoRef)` clamps values to mold ranges, assigns ids, converts countdown deadlines to epoch days, and attaches `evidence[]` entries (`{id, type:'photo', bbox, text}`) referenced by `vars[x].evidenceId`.

Progress stages emitted while waiting (timers, honest copy): `reading` (0 s) → `measuring` (2.5 s) → `hinge` (5 s) → after the reply, `checking` (validation) → `retrying` on re-ask.

### 7.2 Enrich from mail — `WB.forge.enrich(id)` (agentic, page tools)
Call: `WB.ai.json(prompt, {tools, tier:"default", validate})`, max 6 tool rounds, abort at 60 s.

Tools passed to `sample`:
- `search_mail({query:string})` → `[{threadId, subject, sender, date, snippet}]` (≤15; wraps Gmail `search_threads` with `pageSize:15`; snippets truncated to 200 chars).
- `read_mail({threadId:string})` → `{subject, sender, date, text}` (wraps `get_thread` with `messageFormat:"PLAIN_TEXT"`; first message text plus the last message text, ≤3000 chars total).

Every search query is also emitted as `forge:progress {stage:'searching', detail:query}` so the UI can show the search terms ticking past.

Prompt: the instrument summary (mold, kind, title, vars with values/origins, the `mailQuery` hint), plus: "Find evidence in the user's mail that makes this instrument truer. Only change a variable when an email proves it; then origin becomes 'seen' with evidence {threadId, quote (≤120 chars), date}. Also return dated past readings so the app can plot history. Return ONLY JSON:"
```
{ "vars": { "<varId>": { "value": n, "origin": "seen", "evidence": { "threadId": "...", "quote": "...", "date": "YYYY-MM-DD" } } },
  "items": [ ... optional, same shape as forge ... ],
  "history": [ { "date": "YYYY-MM-DD", "facts": { "<varId>": n } } ],
  "contact": { "to": "<vendor/support email or null>", "threadId": "<or null>", "messageId": "<or null>" },
  "summary": "<one sentence, e.g. 'I found 7 more orders since July: it's really 4.2 a week.'>" }
```
The page applies the patch: email evidence entries get `type:'email'`, history becomes observations (`source:'email'`), and the hinge is recomputed.

### 7.3 Forge from mail — `WB.forge.fromMail()` (second act)
Same tools. The prompt asks for up to 3 instruments using only `leak`, `perUse` or `countdown` from purchases, subscriptions, renewals, return windows, invoices and supplier orders (`category:purchases`, `subject:(receipt OR invoice OR renewal OR subscription OR "return by")` hints). Each instrument has the forge JSON shape minus pins/bboxes, with email evidence instead. These instruments have `photo: null` and render a "letterpress" specimen instead (subject line, sender and the quoted line set in mono on paper-3).

### 7.4 Plan mission — `WB.forge.planMission(id)`
- reset: no AI; steps = the first `take` steps.
- spoil: quick call with the photo thumb plus the items list: "Plan tonight's cooking using exactly these at-risk items: [...]. Return {title, minutes (≤ 25), steps:[{id,n,text (≤9 words), minutes, pin:[x,y] of the item it uses or null}]}".
- dial: quick call: "Give 3–5 physical steps (≤7 minutes total) to achieve '${steps} ${stepUnit}' in a home, for this bill. Return the same shape, pins null."
- Return shape: `Mission = {id, instrumentId, title, minutes, steps:[{id,n,text,minutes,pin|null,done:false}], beforePhoto: PhotoRef, startedAt:null, endsAt:null, afterPhoto:null, verified:null, fieldNote:null}`.

### 7.5 Verify mission — `WB.forge.verifyMission(mission, afterFile)`
`WB.ai.json(prompt, {images:[beforeBlobOrThumb, afterBlob], tier:"default"})`. The prompt: "Image 1 is BEFORE, image 2 is AFTER of the same spot. Steps: [...]. Judge only what is visible. Return {done:[stepIds], notDone:[stepIds], reclaimed:<0-100>, sameSpot:<bool>, fieldNote:'<one dry, specific line naming a concrete change, e.g. the mugs are gone>'}". If `sameSpot` is false, the UI asks to retake. The before image is fetched from `photo.src` (asset URL or data URL) and turned into a Blob.

### 7.6 Write draft — `WB.forge.writeDraft(id, {purpose})`
Quick call. Input: instrument title/subject, intention (from→to), contact (from enrichment), and the purpose (`cancel|pause|return|ask|renew`). "Write as the user. Plain text, ≤90 words, polite, specific, no exclamation marks, no AI phrasing, no placeholders except [Name] if unknown. Return {to:[...] (only addresses you were given), subject, body}". If there is no address, `to` is `[]` and the sheet shows an editable To field.

### 7.7 Cost & latency discipline
`sample` is called only from user gestures (photo picked, chip tapped, hold completed). It is never called on load or from timers. Each flow has a Stop that aborts via `AbortController`.

---

## 8. Platform capabilities

- **sample (images, tools)**: the forge, enrichment, mission planning, verification and drafts.
- **mcp Gmail** (`search_threads`, `get_thread`, `create_draft`): enrichment, forge-from-mail and drafts. Always behind a deliberate tap. Drafts only; nothing is ever sent. **Drive** (`create_file`): "Export bench" creates a Google Doc (`textContent` markdown-ish plain text, `contentMimeType:"text/plain"`, title `Workbench — <date>`).
- **db + user**: private state under `data/users/<uid>/` (§contract). Cross-device.
- **assets**: full-resolution photos (before/after/snap). The id is stored in db, and the image is shown via the returned url or `/_blob/<id>`.
- **room**: optional witnesses. Presence shows who is here and what they are doing ("Alex · on a mission · 4:12"). **Show to someone here** broadcasts an instrument snapshot (thumb only), and peers can open a live read-only mirror that follows your scrubs. Mission start/finish is broadcast so a roommate sees the reveal.
- **downloads**: .ics reminders, the bench export (.md) when Drive is unavailable, and the mission before/after as an image (optional, if time).
- Declared capabilities on publish: `{sample:{images:true}, mcp:{servers:[{server:"Gmail",tools:["search_threads","get_thread","create_draft"]},{server:"Google Drive",tools:["create_file"]}]}, db:{}, user:{}, assets:{}, room:{}, downloads:true}`.

## 9. Graceful degradation & demo mode

- `window.claude` absent, or `sample` null/`not_granted`/`sampling_disabled`: the photo buttons hide and the **example bench** is offered. Every local interaction works: scrubbing, hinge, provenance taps, commit, .ics download (blob anchor fallback), mission timer, after photo and wipe (self-checked), and drafts shown as copyable text.
- `images` not in `sample.limits()`: same as above for photos. Forge from mail still works if Gmail is available.
- Gmail `unavailable`/`server_not_connected`/`needs_reauth`: mail chips hide or show *"Connect Gmail in claude.ai Settings → Connectors"* once, inline. `not_granted`: the chip shows *"Mail stays closed"* and hides for this load. `tool_error`: inline message on that chip. Writes never auto-retry.
- `rate_limited`: *"Claude needs a breather. Try again in a minute."* with a manual retry. `invalid_json` after the re-ask: *"I couldn't make a clean instrument from that. Try a straighter, closer photo."* `refused`: *"I can't work with that photo."* `cancelled`: silent.
- db null: localStorage (the device-only note goes in the `⋯` sheet). assets null: photos are stored as downscaled data URLs inside the instrument doc (§contract budget).
- **Example bench** (`WB.demo`): four instruments with hand-drawn SVG "photos" (ink line illustrations on paper, clearly stamped `EXAMPLE`), so it is honest that they aren't real:
  1. *Takeout* (leak): Golden Wok receipt, TOTAL $31.40 (seen, bbox), 3/week (inferred: "two prior orders on this receipt's loyalty line"), target 1. One past observation.
  2. *Fridge* (spoil): 7 items (half roast chicken $9/1d, baby spinach $4/2d, berries $5/2d, feta $6/4d, yogurt $3/6d, peppers $4/5d, milk $3/7d) with pins; horizon 3 assumed; cookN 2.
  3. *Gym* (perUse, basis month): $49/mo seen, uses 2 assumed, target 6; alt day pass $15. Its "Check my mail" runs a canned enrichment (`WB.demo.enrichPatch`) that animates the search terms and sets uses to 3 seen with a fake-labelled example quote.
  4. *Desk corner* (reset): 5 steps with pins, 7 minutes.
  The demo also has one committed intention (Takeout, check due today) so the since-last-time strip and a breathing tile are visible. Demo state lives only in memory plus `wb:v1:demo` in localStorage, and is never written to db. **Exit example bench** clears it.

## 10. Success after one week
- 5–8 instruments on the bench across at least 3 systems. Each opened instrument's "Measured" ratio rises (most hollow `?` chips set or proven by mail).
- 3+ futures committed, each with one real act done: a takeout pause, a fridge cooked down before it turned ("$23 → $6 lost this week"), a desk reclaimed with a before/after they're proud of, a return filed before the window closed, a calendar check-in.
- The ledger reads something like `STEERED $1,980/yr in play · $64 kept · 3 of 4 promises held`, and every figure is traceable to a photo, an email or the user's own setting.
- Sessions are 3–10 minutes and end on "Bench is set." The 11 pm reach for the phone becomes "let me photograph the fridge", and then the phone goes down because there is a mission to do.

## 11. Non-goals (cut on purpose)
Kiln fusion, desktop tiles, card decks, streaks, XP, notifications, infinite anything, auto-sending email, generic Claude-authored formulas, social likes.
