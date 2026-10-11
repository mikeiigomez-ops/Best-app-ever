# Upscroll

**A feed that gives back.** Upscroll keeps the vertical swipe feed that makes TikTok so easy to pick up, but every card leaves you with something: a fact you'll still remember next month, a real-world task done, a thought out of your head and into a list.

## What's in the feed

| Card | What it does for you |
| --- | --- |
| **Mind snack** | A short, surprising, fact-checked idea followed by a one-tap question. 180 cards across space, science, earth, nature, body, history, money, mind, tech and culture. |
| **Memory check** | Spaced repetition (Leitner boxes: 10 min → 1 d → 3 d → 7 d → 16 d → 35 d …). What you learn comes back right before you'd forget it. |
| **Calibrate** | Guess a number on a log slider (how far is the Moon? how many people did X?). Trains numeracy and calibration, and is scored by how close you got. |
| **Word** | Useful vocabulary with examples and etymology, also reviewed later. |
| **Real-world quest** | 10-second to 3-minute things you can do right now: move, tidy, reach out to someone (with a message you can copy), focus. |
| **Breathe** | Guided box breathing, physiological sigh, 4-7-8. |
| **Capture / Journal** | Gets to-dos, ideas, questions and reflections out of your head. They live in the **Vault** and come back in the feed: to-dos until they're done, ideas a few days later, journal lines as **time capsules**. |
| **Today's one thing** | Set it in the morning brief and the feed keeps checking in until it's done. |
| **Math sprint** | 30 seconds of mental arithmetic that gets harder as you go. |
| **Bonus** | Every 9 to 14 cards: XP, a legendary card, double XP, or a streak freeze. |
| **Session receipt** | What the last stretch of scrolling actually got you. |

You also get XP, levels (Spark → Universe), a daily goal ring, streaks with freezes, three daily quests, combo multipliers, and **Your Sky**: every card you learn becomes a star. Stars brighten as you remember them, and mastered stars in one subject link up into constellations.

## Inside Claude it goes further

When Upscroll is opened as a Claude artifact, it uses Claude through the artifact runtime:

- **Rabbit holes**: name any topic and Claude writes an endless, progressively deeper course on it, mixed into the feed with memory checks.
- **Go deeper**: open a streamed explanation and follow-up chat on any card.
- **Untangle**: paste a messy brain dump and get it sorted into to-dos (each with a first tiny step), ideas and questions.
- **Answers and next steps**: for questions and ideas saved in the Vault.
- **Sync**: progress is saved to your Claude account, so it follows you across devices.

Outside Claude, all of these are hidden and everything else works offline from local storage.

## Run it

No dependencies. Build the single-file pages, then open or serve them:

```sh
node build.mjs          # writes dist/index.html (standalone PWA) and dist/upscroll.html (artifact body)
npx http-server dist    # or any static server
```

`dist/index.html` can be added to your phone's home screen and works offline (it ships a service worker and a manifest).

Keyboard: `↓`/`J`/`Space` next, `↑`/`K` back, `1`–`4` or `A`–`D` to answer.

## Layout

```
src/
  body.html        app shell markup
  styles.css       all styles (single night theme, per-card hue tint)
  content/         fact-checked card library (facts, estimates, words, quests, prompts)
  js/
    util.js        helpers, sound synth, haptics
    store.js       state, XP/levels/streaks/quests, spaced repetition, local + cloud persistence
    ai.js          Claude features (rabbit holes, deeper, untangle) with graceful absence
    engine.js      the feed mixer, tuned to your goals, interests and what you lean into
    cards.js       one renderer per card kind
    ui.js          feed, HUD, sheets, effects, rabbit holes
    sky.js         the star map + stats + settings
    vault.js       to-dos, ideas, questions, journal, saved
    app.js         onboarding + boot
public/            PWA manifest, service worker, icons
build.mjs          inlines everything into dist/
```
