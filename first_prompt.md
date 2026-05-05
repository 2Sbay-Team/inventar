# first_prompt.md

This is the verbatim prompt to paste into Claude Code at the start of the project. It is calibrated for the agent's behaviour under `--dangerously-skip-permissions`. After Claude Code returns a plan, review it. Approve or amend. Only after approval does Claude Code start writing files.

---

## How to use

```bash
# On the VPS
cd /opt/inventar
tmux new -s inv
claude --dangerously-skip-permissions

# Then paste the contents of the code block below.
```

---

## The prompt

```text
You are Claude Code working on Inventar, an offline-first PWA for inventory management on a single phone. There is no server database, no sync, no accounts. Each install is fully independent. Your task today is to scaffold the codebase, wire the data layer, build the four core MVP screens (Search, Article detail, Add article, Dashboard), produce a complete Playwright E2E suite covering every button on those screens, and make the app deployable as static files behind nginx.

BEFORE WRITING ANY CODE, read these files in order, end-to-end. Do not skim:

  /opt/inventar/PROJECT.md
  /opt/inventar/SPEC.md
  /opt/inventar/DATA_MODEL.md
  /opt/inventar/DECISIONS.md
  /opt/inventar/NON_GOALS.md
  /opt/inventar/DEPLOY.md
  /opt/inventar/TESTING.md

Reference visual brief: /opt/inventar/ui_mockups/inventar_first_mockup.html

After reading, do NOT start coding. Produce a one-page implementation plan in your reply containing exactly the following sections, in this order:

1. Folder structure under /opt/inventar/web/ — every directory and the role it plays.
2. package.json dependencies — exact versions, grouped by purpose, with a sentence justifying any choice that differs from defaults.
3. Dexie database definition — version 1 only, all tables, all indexes, copy-pasteable.
4. i18next bootstrap — locale resource file paths, RTL detection, formatNumber utility.
5. Routes — every URL path the user can hit, with the screen component name.
6. Service worker strategy — which paths use stale-while-revalidate, which use cache-first, what the precache list contains, how /sw.js itself is handled.
7. Component map — for each of the four screens, list the components you will create with one-line responsibilities.
8. The order in which you will create files. Justify the order so that it is testable at every step (i.e. the project compiles and a sensible subset of tests passes after each major commit).
9. The first three Playwright tests you will write, with full assertions. They must be written BEFORE the corresponding implementation. Highest-priority tests: search normalisation across FR/AR/EN, photo persistence after reload, the JSON export/import round-trip.
10. The Dockerfile and nginx.conf you will use, copied verbatim from DEPLOY.md (you must not deviate from these unless you flag the change explicitly with a rationale).

Wait for my approval of this plan before writing a single line of code.

HARD RULES — applied without exception throughout the engagement:

  - There is no server, no API server, no database server, no auth. If you find yourself writing /api/ routes or fetch() calls to a backend, STOP. The architecture is wrong.
  - Never store quantity as a number. Quantities are SUM(movements.delta WHERE deleted_at IS NULL). See ADR-002. The data layer must enforce this — no quantity column on Variant ever.
  - Never delete a row except when the user typed "DELETE" to confirm. Soft delete via deleted_at otherwise. See ADR-004.
  - All money is stored as integer millimes (1 TND = 1000 millimes). See ADR-005. No floats in business logic. Provide formatCurrency and parseCurrency utilities and use them at every UI boundary.
  - All user-facing numbers in the AR locale render as Eastern Arabic numerals via formatNumber(n, locale). SKU codes (SH-XXXX), unit symbols (TND, 4G), and similar identifiers stay LTR/Western in all locales. See ADR-006.
  - Every UI string comes from i18next resource files. Zero hardcoded strings in JSX/TSX components. Reviewer will grep for any literal string in /src/**/*.tsx and reject the PR if non-i18n strings are found.
  - The service worker MUST cache /sw.js, /index.html, and /manifest.webmanifest with no-cache, no-store, must-revalidate. Otherwise updates can never reach users. See DEPLOY.md §4.
  - All photos are compressed to ≤ 200 KB before storage via browser-image-compression. Verified by an explicit test in TESTING.md §3.2.
  - On first launch, call navigator.storage.persist() to lock the data against eviction. See ADR-008. Verified by a Playwright test.
  - Quantities, prices, sizes shown in the size grid use JetBrains Mono with tabular figures (font-feature-settings: 'tnum'). The body uses Funnel Sans, headers Funnel Display. See the visual reference HTML.

STORAGE DISCIPLINE:

  - IndexedDB only. No localStorage, no sessionStorage, no cookies, no fetch caches.
  - Every read goes through Dexie. No raw indexedDB API calls outside /src/db/.
  - Every write produces a deterministic updated_at. The clock is provided by a single `now()` utility that can be mocked in tests.

STYLE DISCIPLINE:

  - TypeScript strict mode. No any. No @ts-ignore unless paired with a comment explaining the third-party type bug being worked around.
  - Functional React components with hooks. No class components.
  - Tailwind CSS for styling. shadcn/ui for primitives where they fit, but do NOT pull a primitive that isn't being used.
  - Components in /web/src/components/, screens in /web/src/screens/, hooks in /web/src/hooks/, utilities in /web/src/utils/, types in /web/src/types/, db code in /web/src/db/, i18n in /web/src/i18n/, query (search) code in /web/src/query/, backup code in /web/src/backup/.
  - File names: kebab-case. Component names: PascalCase. Hook names: useThing.
  - Every utility function has a corresponding unit test in the same folder, named *.test.ts.
  - No file longer than 250 lines. If something is approaching that limit, break it up.

BUILD HYGIENE:

  - npm scripts: dev, build, preview, test (vitest), test:e2e (playwright), lint (eslint), format (prettier), typecheck (tsc --noEmit).
  - Pre-commit hook (husky + lint-staged) runs lint + typecheck. Must pass before commit.
  - CI workflow runs all four: lint, typecheck, test, test:e2e. Pre-merge gate.

APPROVED DEPENDENCIES — do not add others without explicit approval:

  React stack:        react, react-dom, react-router-dom
  Database:           dexie
  i18n:               i18next, react-i18next, i18next-browser-languagedetector
  Build:              vite, @vitejs/plugin-react, vite-plugin-pwa, workbox-window, typescript
  Styling:            tailwindcss, autoprefixer, postcss
  UI primitives:      @radix-ui/react-dialog, @radix-ui/react-radio-group, @radix-ui/react-select  (only what's used)
  Image:              browser-image-compression
  Utils:              uuid, date-fns, zod
  Test:               vitest, @vitest/ui, fake-indexeddb, @playwright/test, @testing-library/react, @testing-library/user-event
  Lint/format:        eslint, eslint-config-prettier, eslint-plugin-react-hooks, prettier, typescript-eslint
  Hooks:              husky, lint-staged

STOP-AND-ASK CONDITIONS:

  Do not guess — stop and ask me a clarifying question if any of the following arise:
    - You discover an ambiguity in SPEC.md whose answer would change the data model.
    - A Playwright test reveals a behaviour the spec does not cover.
    - You're about to introduce a new top-level dependency not on the approved list.
    - A test you wrote first cannot pass with the implementation you're about to write.
    - You consider any networking call from the client beyond the service worker fetching its own static assets. The app makes no API calls; if you think it should, that's a stop-and-ask.

FINAL INSTRUCTION:

  Begin by producing the plan only. Do not write any code yet.
```

---

## After the plan is approved

```text
Plan approved. Proceed in the order you defined. Commit after each numbered step. Run the full test suite at every step boundary. Stop and report if any test fails.
```

---

## What to watch for in Claude Code's plan

Markers of a good plan:

- Dexie schema matches `DATA_MODEL.md` exactly. No "I added a quantity column for performance".
- Service worker config explicitly handles `/sw.js`, `/index.html`, and `/manifest.webmanifest` with no-cache.
- The first three tests it proposes include search normalisation across locales, photo persistence after reload, and JSON export/import round-trip.
- The folder structure lives entirely under `/opt/inventar/web/`. Nothing scattered elsewhere.
- The order of file creation is testable at each step, not "scaffold everything then test at the end".
- Zero references to fetch(), axios, REST, JWT, or any backend concept.

Markers of a plan that needs revision:

- Any mention of a backend, sync, accounts, or login.
- Proposing additional dependencies beyond the approved list without justification.
- Storing quantity on Variant.
- Skipping the i18next setup until "later".
- Building components before the data layer.
- Suggesting "I'll add the Playwright tests after the implementation lands".
- Using localStorage or sessionStorage for anything.

Reject plans with any of those markers and ask for revision.
