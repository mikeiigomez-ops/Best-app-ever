# The Emmaus Road

A text adventure about how the Old Testament connects to the New.

You walk the seven miles (60 furlongs) from Jerusalem to Emmaus on the first Easter Sunday with Cleopas and a stranger (Luke 24:13-35). Along the way the Stranger opens 14 Old Testament passages, and at each stop you pick the New Testament moment it points to.

- **Three legs**, in the order of Luke 24:44: the Law of Moses, the Prophets, and the Psalms. The finale, Jeremiah's new covenant and the Last Supper, happens at the table in Emmaus.
- **Embers**: 3 for a first-try answer, then 2, then 1. Each wrong answer gets a hint from the Stranger.
- **The Scroll** collects every thread you find, each one tagged as a *promise* (a prophecy fulfilled), a *pattern* (an event that foreshadows a later one), or a *quotation* (the NT quotes the OT directly).
- Every connection is one the New Testament itself makes. Quotations are from the King James Version (public domain).

Play with the buttons, the `1`-`4` keys, or the command line (`look`, `scroll`, `help`, `restart`). Progress is saved in the browser.

## Build

```sh
node apps/emmaus-road/build.mjs   # dist/index.html (open in any browser) and dist/emmaus-road.html (artifact body)
```
