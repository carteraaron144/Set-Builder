# Set Builder

A browser-based environment modeling app for game blockouts: a React + Three.js (WebGPU) web app in `web/` and a Kotlin + Spring Boot server in `server/`. See README.md for running and controls.

## Design doc

The design doc is a Claude Doc and the source of truth for design: https://claude.ai/code/artifact/6c15080f-9693-489e-89ed-54e596c066b9. Read it only with the docs tools, never a web fetch, and read just the section you need. Milestone plans live in `docs/plans/`.

## Keep token use low

- **No subagents** unless the user asks for one. Do the work in the current session. The one standing exception is the single whole-branch review at the end of a milestone.
- **Read only what the task needs:** the files a task touches, a section of a file, a section of the design doc. Don't re-read files you just edited.
- **On a return visit, read only what changed:** `{kind: "view", sinceRev: <rev from your last read>}`.
- **Write block ids in full.** A read prints later ids of a session short as `.N`; prefix them with the session of the nearest full id printed above, e.g. `m33ea4t3xzc.2813`.
- **Keep command output short:** run filtered tests (`npm test -- <filter>`) and look at the summary lines; use `-q` for Gradle; pipe long logs through `tail` or `grep`.
- **Keep browser checks to one short pass** per visual change; prefer a screenshot of the one thing being checked.
- **Keep reports short:** what changed, the test totals, and what wasn't verified.
- **Keep designs concise:** 

## Tests as you go

- **Test first:** every change to logic gets a failing unit test, then the code, then a passing run.
- **Write risks as unit tests when they come up.** A plan's Review Focus item, a bug found in review or playtesting, or an edge case you notice becomes a unit test in the same commit as the code it covers, not a note for later. Only things a unit test truly can't reach (look and feel, frame rate, Blender import) stay as manual checks, and the report says so.
- **Where tests live:**
  - **Web:** Vitest, next to the code as `*.test.ts(x)` (jsdom; `fake-indexeddb` for storage). Run with `cd web && npm test`.
  - **Server:** JUnit in `server/src/test/kotlin`. Run with `cd server && ./gradlew test -PskipWeb` (needs `JAVA_HOME=/opt/homebrew/opt/openjdk@21`).
- **Before calling work done,** both suites pass.

## Git

- Commit locally on `main` after each plan task, with a descriptive message. Don't push or add a remote unless the user asks.
