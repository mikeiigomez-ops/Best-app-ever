WORKBENCH BUILD CONTRACT v1 (binding for all five builders; nothing here is optional)

=== 0. Layout ===
apps/workbench/
  build.mjs                      (Ives)
  src/index.html                 (Ives) BODY FRAGMENT ONLY: no doctype/html/head/body tags
  src/css/tokens.css base.css    (Ives)
  src/css/bench.css              (Zhuo)
  src/css/instrument.css         (Victor)
  src/css/actions.css            (Raskin)
  src/js/core.js app.js          (Ives)
  src/js/ai.js molds.js forge.js (Lu)
  src/js/store.js demo.js bench.js (Zhuo)
  src/js/charts.js instrument.js (Victor)
  src/js/actions.js mission.js room.js (Raskin)
  dist/workbench.html  (artifact page: <title>Workbench</title>, <meta name="description">, Google Fonts <link>s, <style>, body fragment, <script>)
  dist/index.html      (standalone: doctype, <meta charset>, viewport "width=device-width, initial-scale=1, viewport-fit=cover", theme-color #F3EFE6, then the same content)
Nobody edits another builder's files. No external JS libraries (vanilla only). No inline <script> in index.html.

=== 1. Build (build.mjs, node, no deps) ===
CSS order: tokens.css, base.css, bench.css, instrument.css, actions.css (concatenated into ONE <style>).
JS order: core.js, ai.js, molds.js, store.js, demo.js, forge.js, charts.js, instrument.js, actions.js, mission.js, room.js, bench.js, app.js. Each is prefixed with a "/* ---- path ---- */" comment, concatenated into ONE <script>, and every "</script" is replaced with "<\/script". The last line of the bundle (appended by build.mjs, not by any file) is: WB.app.boot();
Fonts link: https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400..700&family=IBM+Plex+Mono:wght@400;500;600&display=swap (plus preconnects to fonts.googleapis.com and fonts.gstatic.com).
Run: node apps/workbench/build.mjs. It prints the sizes. Target bundle under 400 KB.
Publish capabilities: {sample:{images:true}, mcp:{servers:[{server:"Gmail",tools:["search_threads","get_thread","create_draft"]},{server:"Google Drive",tools:["create_file"]}]}, db:{}, user:{}, assets:{}, room:{}, downloads:true}

=== 2. Module pattern ===
Every JS file is: (function(){ "use strict"; const WB = window.WB; ... WB.<name> = {...}; })();
core.js alone does: window.WB = window.WB || {}; and defines WB.bus, WB.util, WB.router, WB.ui.
Files register functions only. NO top-level calls into other modules, and no DOM work at top level. Views register in an init function: each module exposes WB.<name>.init() (optional). WB.app.boot() calls, in order: WB.store.init?.(), WB.instrument.init?.(), WB.actions.init?.(), WB.mission.init?.(), WB.room.init?.() (after caps), WB.bench.init?.(). Every init must be idempotent and must not await network.
Global namespace (only these keys may exist on WB): bus, util, router, ui, app, ai, molds, forge, store, demo, bench, charts, instrument, actions, mission, room.

=== 3. Event bus (core.js) ===
WB.bus.on(name, fn) -> unsubscribe(); WB.bus.once(name, fn); WB.bus.off(name, fn); WB.bus.emit(name, payload). It is synchronous, a listener error is caught and console.error'd, and the payload is always ONE plain object.
Events (emitter -> payload):
- app:ready (Ives) {caps: Caps, mode:'cloud'|'local'|'demo', firstRun:boolean}
- caps:changed (Lu) {caps: Caps}
- view:enter / view:leave (Ives router) {view:string, params:object}
- theme:changed (Ives) {theme:'auto'|'light'|'dark'}
- forge:start (Lu) {jobId, kind:'photo'|'snap'|'enrich'|'mail'|'verify'|'plan'|'draft', instrumentId:string|null}
- forge:progress (Lu) {jobId, kind, stage:'reading'|'measuring'|'hinge'|'checking'|'retrying'|'searching'|'reading-mail'|'writing'|'comparing', label:string /* UI-ready ticker copy, uppercase */, detail:string|null /* e.g. the Gmail query */}
- forge:done (Lu) {jobId, kind, instrumentId:string|null, isNew:boolean, snapped:boolean, summary:string|null}
- forge:error (Lu) {jobId, kind, code:ErrCode, message:string /* UI-ready */, why?:string, try?:string}
- store:loaded (Zhuo) {mode:'cloud'|'local'|'demo', count:number}
- instrument:saved (Zhuo, from upsert) {instrument:Instrument, isNew:boolean}
- instrument:updated (Zhuo, from update) {id, instrument:Instrument, source:'scrub'|'set'|'enrich'|'snap'|'intention'|'action'|'mission'|'system'}
- instrument:melted (Zhuo) {id, mold, kind, title}
- instrument:open (Victor) {id}
- instrument:scrub (Victor, ≤30/s during drag, NOT persisted) {id, varId, value:number}
- instrument:set (Victor, drag end) {id, varId, value:number, origin:'set'|'lever'}
- instrument:commit (Victor, hold complete on a lever) {id, varId, value:number, primary:number, baseline:number}
- intention:created (Raskin) {id, intention:Intention}
- action:done (Raskin) {id, action:Action}
- mission:start (Raskin) {id, mission:Mission}
- mission:done (Raskin) {id, mission:Mission}
- session:set (Zhuo) {forged:number, committed:number, closed:number, steeredUSD:number}
- room:peers (Raskin) {peers:[{key, name, initials, view, instrumentId, mission:{title, endsAt}|null, self:boolean}]}

=== 4. Shared types ===
ErrCode = 'unavailable'|'not_granted'|'rate_limited'|'invalid_json'|'cancelled'|'refused'|'timeout'|'tool_error'|'needs_reauth'|'server_not_connected'|'no_fit'|'not_same_spot'|'unknown'
Caps = {sample:boolean, images:boolean, gmail:'granted'|'prompt'|'denied'|'unavailable', drive:same, db:boolean, user:boolean, assets:boolean, room:boolean, downloads:boolean}
PhotoRef = {src:string /* usable in <img> */, assetId:string|null, thumb:string /* data:image/jpeg ≤480px q0.7, ≤40KB */, w:number, h:number, at:number /* ms */, role:'hero'|'snap'|'before'|'after'}
Evidence = {id:string, type:'photo'|'email', bbox?:[x,y,w,h] /* 0..1 of hero photo */, text?:string, photoIndex?:number, threadId?:string, quote?:string, date?:string /* YYYY-MM-DD */, subject?:string, sender?:string}
Var = {id, kind:'fact'|'lever', label:string, unit:string, format:'usd'|'num'|'int'|'days'|'pct'|'day'|'min'|'times', value:number, min:number, max:number, step:number, origin:'seen'|'inferred'|'assumed'|'set'|'lever', evidenceId:string|null, reason:string|null}
Item = {id, name, value:number, days:number, origin, pin:[x,y]|null, cooked?:boolean}
Step = {id, n:number, text, minutes:number, pin:[x,y]|null, done?:boolean}
Intention = {varId, value, baseline:number, target:number, outputId:string, committedAt:number, checkAt:number, status:'open'|'held'|'missed', actionId:string|null}
Observation = {t:number, value:number /* primary output */, facts:{[varId]:number}, source:'photo'|'email'|'mission'|'manual', note:string|null}
Action = {id, type:'draft'|'ics'|'drive'|'mission'|'remember'|'download', status:'prepared'|'done'|'declined', at:number, payload:object, result:object|null /* draft: {id, threadId, viewUrl} */}
Mission = {id, instrumentId, title, minutes, steps:Step[], beforePhoto:PhotoRef|null, startedAt:number|null, endsAt:number|null, afterPhoto:PhotoRef|null, verified:{done:string[], notDone:string[], reclaimed:number, by:'claude'|'self'}|null, fieldNote:string|null}
Instrument = {
  id:'ins_'+8 base36, v:1, demo:boolean, mold:'leak'|'spoil'|'perUse'|'dial'|'countdown'|'reset', kind:string, system:'Food'|'Money'|'Energy'|'Things'|'Space'|'Health', title:string,
  createdAt, updatedAt, photo:PhotoRef|null, photos:PhotoRef[] /* ≤6, newest last */, words:{subject?, period?, basis?, stepUnit?, currency:'$'},
  vars:{[varId]:Var}, items:Item[], steps:Step[], evidence:Evidence[], fieldNote:string|null, nextPhotos:string[], mailQuery:string|null,
  act:{type, to:string|null, why:string|null}|null, contact:{to:string|null, threadId:string|null, messageId:string|null}|null,
  intention:Intention|null, observations:Observation[] /* ≤60 */, actions:Action[] /* ≤20 */, mission:Mission|null, enriched:{at, summary}|null }
Derived values (outputs, hinge, confidence, ghost) are NEVER stored. They are always computed via WB.molds.

=== 5. State & persistence (store.js, Zhuo) ===
WB.store.state = {bench:Bench, instruments:{[id]:Instrument}}
Bench = {v:1, profile:{createdAt, firstRunDone:boolean, lastOpenAt:number, prevOpenAt:number, gmailAsked:boolean, theme:'auto'|'light'|'dark'}, order:string[], melted:[{mold, kind, title, at}] /* ≤50 */, sessions:[{at, forged, committed, closed}] /* ≤30 */, updatedAt:number}
db (when WB.ai.db() and WB.ai.userId() are non-null): collection "data/users/<uid>" documents: "bench" (Bench) and "<instrumentId>" (Instrument). A demo instrument is never written to db.
localStorage (always written too, as a cache; every access in try/catch): "wb:v1:bench", "wb:v1:ins:<id>", "wb:v1:demo" ("1" while the example bench is active; demo instruments then live only in memory), "wb:v1:ui" (per-device: {coach:{drag,origins,hold}:boolean, theme}).
Load: read localStorage synchronously → emit store:loaded {mode:'local'} → then, if db is available, fetch bench+docs, merge by updatedAt (newer wins per doc), and re-emit store:loaded {mode:'cloud'}.
Writes: per-doc debounce 500 ms; one in-flight write per doc. Doc budget ≤200 KB: if JSON > 200 KB, drop the src of the oldest non-hero photos first (keeping their thumb), then observations beyond 30.
Photos: WB.store.putPhoto(file|Blob, role) -> Promise<PhotoRef>. It calls WB.ai.prepImage, then WB.ai.upload(blob). If that succeeds, src = upload url, assetId = id. Otherwise src = a data URL re-encoded at ≤900 px q0.65.
Store API: load():Promise<state>; all():Instrument[] (bench.order); get(id); upsert(inst):Promise /* add or replace; emits instrument:saved */; update(id, fn(inst)=>void, source):Instrument /* mutates a clone, sets updatedAt, persists, emits instrument:updated */; melt(id); melted(); addObservation(id, obs); setIntention(id, intention); addAction(id, action) /* returns action with id */; saveBench(); mode():'cloud'|'local'|'demo'; enterDemo(); exitDemo(); session():{forged,committed,closed,ended:boolean}; ledger():{inPlayUSD, keptUSD, held, total}.
Session = everything since boot. ledger.inPlayUSD = Σ over open intentions of |baseline−target| (when the primary format is usd); keptUSD = Σ over held/verified results; held/total = intention counts.

=== 6. AI wrapper (ai.js, Lu — the ONLY code allowed to reference window.claude) ===
WB.ai.cap(name):Promise<ns|null>  memoized claude.use(name); null if window.claude is absent or after 10 s.
WB.ai.caps():Promise<Caps>  (uses permissions.state for "mcp:Gmail"/"mcp:Google Drive" when available; sample.limits().images for images). Emits caps:changed when values change.
WB.ai.ask(input, {tier='quick', signal, onText, images}):Promise<string>
WB.ai.json(input, {tier='quick', signal, onText, images, tools, validate /* (obj)=>string[] errors */, retries=1}):Promise<object>. On validation errors it re-asks once at tier 'default' with "Your previous JSON had these problems: …". Rejects {code:ErrCode, message}.
WB.ai.mcp(server, tool, input):Promise<payload>  (callTool → result.payload). Rejects {code}.
WB.ai.gmail.search(query, pageSize=15):Promise<[{threadId, subject, sender, date, snippet}]>
WB.ai.gmail.thread(threadId):Promise<{subject, sender, date, text, messageIds:string[]}>
WB.ai.gmail.draft({to:string[], subject, body, replyToMessageId?}):Promise<{id, threadId, viewUrl}>   (write: only from a user hold; never retried)
WB.ai.drive.create({title, text}):Promise<object>   (create_file {title, textContent:text, contentMimeType:"text/plain"})
WB.ai.download(filename, data, mime):Promise<'saved'|'declined'|'fallback'>  (downloads.save, else an <a download> blob link)
WB.ai.upload(blob):Promise<{id, url}|null>
WB.ai.userId():Promise<string|null>; WB.ai.db():Promise<db|null>; WB.ai.room():Promise<room|null>
WB.ai.prepImage(file|Blob):Promise<{blob /* jpeg ≤1600px q0.82 */, thumb /* dataURL ≤480px q0.7 */, w, h}>
WB.ai.blobFromSrc(src):Promise<Blob>
sample is called ONLY from user gestures. No timers, no load-time calls.

=== 7. Molds & forge (Lu) ===
WB.molds.list():MoldDef[]; get(id):MoldDef. MoldDef = {id, name, chart:'costOverTime'|'timeline'|'stackedBar'|'gauge', vars:{[id]:{kind,label,unit,format,min,max,step,default}}, outputs:{[id]:{label,format}}, primary:string, better:'lower'|'higher', template:string, acts:string[], checkDays:number|null, needsItems:boolean, needsSteps:boolean, promptGuide:string}
compute(inst, overrides? /* {varId:value} */):{outputs:{[id]:number}, primary:number, series:Series}  pure, <1 ms, safe to call per pointermove.
Series = {type:'costOverTime', unit, months:12, lines:[{id:'now'|'target', label, values:number[12] /* cumulative */}]}
       | {type:'timeline', unit:'days', span:number, marks:[{id, label, day:number, value:number|null, state:'safe'|'risk'|'saved'|'today'|'actBy'|'deadline'}], cursor:{varId, day}|null}
       | {type:'stackedBar', unit:'usd', bars:[{id:'now'|'dial', label, parts:[{id:'fixed'|'usage', label, value}]}]}
       | {type:'gauge', unit, value, min, max, threshold:number|null, label}
hinge(inst):{varId, impact, isLever:boolean, note:string}
confidence(inst):{measured, total, ratio}
ghost(inst):{baseline, target, start, end, points:[{t, v}], status:'none'|'open'|'held'|'missed', due:boolean}
sentence(inst):Array<{t:'text', text} | {t:'var', id} | {t:'out', id}>  (words are already substituted and escaped)
format(value, format, inst?):string   e.g. usd "$4,898" (cents only under $100: "$31.40"), times "3×", days "4 days"/"1 day", day "Sat 18 Oct", min "7 min", pct "85%".
primaryOf(inst):{id, value, formatted, label}
validate(spec):string[]; build(spec, photoRef|null):Instrument; applyPatch(inst, patch):Instrument (enrichment).
WB.forge.fromPhoto(file, {intent:'new'|'snap', instrumentId?, signal}):Promise<{id, isNew, snapped}>  Stores the photo, calls the forge, builds or merges, then WB.store.upsert/update. On snap it adds an Observation.
WB.forge.enrich(id, {signal}):Promise<{id, summary}>
WB.forge.fromMail({signal}):Promise<{ids:string[], summary}>
WB.forge.planMission(id):Promise<Mission>
WB.forge.verifyMission(mission, afterFile):Promise<Mission /* with afterPhoto, verified, fieldNote */>  rejects not_same_spot.
WB.forge.writeDraft(id, {purpose:'cancel'|'pause'|'return'|'ask'|'renew'}):Promise<{to:string[], subject, body, replyToMessageId:string|null}>
WB.forge.cancel(jobId)
Demo instruments (inst.demo) never call sample; forge uses WB.demo.enrichPatch / verifyFallback / draftFallback.

=== 8. Router & views (core.js, Ives) ===
WB.router.register(name, {enter(el, params), leave?(el)}); go(name, params={}, {replace=false}); back(); current():{name, params}. Hash format: #/<name>/<param id?>, e.g. #/instrument/ins_ab12cd34. Views are toggled via the [hidden] attribute plus the class wb-view--active, and the router scrolls to top on enter.
View owners: front, forging = Ives; bench, end = Zhuo; instrument = Victor; mission, mirror = Raskin.
Params: instrument {id, develop?:boolean}; mission {id}; forging {jobId, kind, photoSrc}; end {}; mirror {peerKey}.
WB.app.capture({intent:'new'|'snap', instrumentId?, source?:'camera'|'library'|'ask'}):Promise<void>  ('ask' opens a sheet with Take a photo / Choose from photos / Look in my mail). WB.app.caps → the last Caps.

=== 9. DOM mount points (src/index.html, Ives) — exact ids ===
<div id="wb-app" class="wb-app">
  <main id="wb-views">
    <section id="view-front" class="wb-view" data-view="front" hidden></section>
    <section id="view-forging" class="wb-view" data-view="forging" hidden></section>
    <section id="view-bench" class="wb-view" data-view="bench" hidden></section>
    <section id="view-instrument" class="wb-view" data-view="instrument" hidden></section>
    <section id="view-mission" class="wb-view" data-view="mission" hidden></section>
    <section id="view-mirror" class="wb-view" data-view="mirror" hidden></section>
    <section id="view-end" class="wb-view" data-view="end" hidden></section>
  </main>
  <div id="wb-peers" class="wb-peers" aria-live="polite"></div>          (Raskin fills; bench.css positions it inside the bench bar via the bn-bar slot it renders: Zhuo renders <div class="bn-bar__peers" data-slot="peers"></div> and Raskin moves/updates #wb-peers content into any [data-slot=peers] present)
  <div id="wb-sheet-root"></div>      (WB.ui.sheet only)
  <div id="wb-toast-root" aria-live="polite"></div>  (WB.ui.toast only)
  <div id="wb-coach-root"></div>      (WB.ui.coach only)
  <input id="wb-file-camera" type="file" accept="image/*" capture="environment" hidden>
  <input id="wb-file-library" type="file" accept="image/*" hidden>
</div>
Each view owner renders ALL inner markup of its own section; nobody writes into another owner's section.

=== 10. UI primitives (core.js, Ives) ===
WB.ui.sheet({title, body:Node|string, actions:[{label, kind:'primary'|'quiet'|'danger', hold?:boolean, onTap(close)}], onClose}):{el, close()}  (bottom sheet, 18px radius, scrim, Esc/scrim/drag-down closes)
WB.ui.toast(text, {action?:{label, onTap}, ms=3200})
WB.ui.hold(el, {ms=700, onProgress(p 0..1), onDone(), onCancel()}):dispose()  (pointer-based; cancels on >10px move; adds class wb-holding and the CSS var --hold:0..1 to el)
WB.ui.pickPhoto({source:'camera'|'library'}):Promise<File|null>
WB.ui.icon(name):string SVG (24px, stroke currentColor 1.5). Names: camera, library, mail, back, more, close, check, clock, calendar, drive, flame, pin, spark, wipe, people, export
WB.ui.coach(targetEl, text, {key, placement:'above'|'below'}):dispose()  (shown once per key, recorded in wb:v1:ui)
WB.ui.setTheme('auto'|'light'|'dark')  sets document.documentElement.dataset.theme (absent for auto).
WB.util: el(tag, attrs, ...children) (attrs: class, text, html, on:{evt:fn}, dataset, style, aria-*); $(sel, root); $$(sel, root); uid(prefix); clamp; lerp; debounce; throttle; fmtUSD(n); fmtNum(n); fmtDate(ms); fmtDay(ms) "Sat 18 Oct"; dayNum(ms) (epoch days, local); fromDayNum(d); haptic(ms) (navigator.vibrate guarded); reducedMotion(); escapeHTML; sleep(ms); now().
User-provided and Claude-provided text is ALWAYS inserted with textContent or escapeHTML. Never use innerHTML with model or mail text.

=== 11. CSS tokens (tokens.css, Ives) — use ONLY these; no raw hex outside tokens.css ===
:root { --paper:#F3EFE6; --paper-2:#EAE4D7; --paper-3:#DDD5C4; --ink:#1A1916; --ink-2:#4A463E; --ink-3:#8A8476; --rule:#CFC6B3; --signal:#FF4D1A; --signal-soft:rgba(255,77,26,.16); --mine:#2741E6; --good:#1F8A5B; --warn:#B97900; --danger:#C2361B; --line:#FFF6DC; --halo:rgba(10,8,4,.55); --scrim:rgba(20,16,8,.38);
 --font-serif:"Instrument Serif", "Iowan Old Style", Georgia, serif; --font-sans:"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif; --font-mono:"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
 --t-hero:40px; --t-sentence:28px; --t-title:20px; --t-body:16px; --t-small:14px; --t-micro:11px; --lh-tight:1.12; --lh-body:1.45; --track-micro:.08em;
 --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --gutter:16px;
 --r-chip:6px; --r-card:10px; --r-sheet:18px; --hair:1px;
 --lift:0 1px 0 rgba(0,0,0,.04), 0 10px 28px -14px rgba(40,28,0,.35);
 --ease-out:cubic-bezier(.2,.8,.2,1); --ease-spring:cubic-bezier(.34,1.56,.64,1); --d-fast:120ms; --d-base:240ms; --d-slow:420ms; --d-develop:900ms; --d-breath:2.4s;
 --bar-h:76px; --safe-b:env(safe-area-inset-bottom,0px); --safe-t:env(safe-area-inset-top,0px);
 --z-overlay:10; --z-bar:20; --z-sheet:40; --z-toast:50; --z-coach:60; }
Dark values (Darkroom) are set under BOTH @media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){…} } AND :root[data-theme="dark"]{…}: --paper:#12110E; --paper-2:#1C1A16; --paper-3:#27241E; --ink:#EEE8DA; --ink-2:#B9B2A2; --ink-3:#7C7566; --rule:#3A362E; --signal:#FF6A3D; --signal-soft:rgba(255,106,61,.20); --mine:#8796FF; --good:#4CC38A; --warn:#E7B33A; --danger:#FF6B57; --halo:rgba(0,0,0,.7); --scrim:rgba(0,0,0,.55).
body { background:var(--paper); color:var(--ink); font-family:var(--font-sans); } Numbers always use font-family:var(--font-mono) and font-variant-numeric:tabular-nums.
@media (prefers-reduced-motion: reduce): every module disables pulses, sweeps and count tweens (check WB.util.reducedMotion() in JS).
Class prefixes (BEM-ish block__elem--mod): wb- = Ives (shell, buttons, sheet, toast, coach, typography helpers wb-serif, wb-mono, wb-micro, wb-btn, wb-btn--primary, wb-btn--quiet, wb-btn--danger, wb-iconbtn, wb-view, wb-bar); bn- = Zhuo; ins- and ch- = Victor; act-, msn- and rm- = Raskin. A CSS file may only define selectors with its owner's prefixes (plus element selectors inside them). Shared state classes: is-active, is-due, is-hinge, is-disabled. Origin modifier classes on chips (Victor defines them; others may reuse): ins-chip--seen, --inferred, --assumed, --set, --lever, --derived.
Layout: phone-first 360–430px, max content width 560px centered, 16px gutters, no horizontal scroll, fixed bars padded with var(--safe-b), tap targets ≥44px, visible :focus-visible ring 2px var(--signal).

=== 12. Room protocol (room.js, Raskin; via WB.ai.room()) ===
presence: {v:1, name:'' /* filled from user.me() at runtime, never stored */, view, instrumentId:null|string, mission:{title, endsAt}|null}
topics: "wb.share" {from, snapshot:Instrument /* photos reduced to thumb only, observations ≤10 */}; "wb.scrub" {from, id, varId, value}; "wb.mission" {from, state:'start'|'done', title, endsAt, fieldNote, reclaimed}. Send absolute state; ignore messages from self; treat everything heard as untrusted (render with textContent). Without room, everything is hidden and nothing breaks.

=== 13. Behavioral invariants ===
- Never send email. Gmail/Drive writes only after a WB.ui.hold on a confirm button. Never auto-retry writes.
- Never embed real user data in source. Demo data is clearly labelled EXAMPLE.
- Every number on screen has an origin class or is a derived output.
- No sample calls on load/timers. Every AI flow has a Stop (AbortController) and per-ErrCode copy.
- The app must fully work with window.claude undefined (demo bench, local math, .ics via blob link, after-photo wipe self-checked).
- The first action:done or mission:done in a session routes to 'end' (Zhuo listens and calls WB.router.go('end')); later ones only toast.