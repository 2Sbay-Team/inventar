# Inventar

Offline-first PWA for inventory management on a single phone. No server, no sync, no accounts.

## Layout

```
/opt/inventar/
├── PROJECT.md / SPEC.md / DATA_MODEL.md / DECISIONS.md
├── NON_GOALS.md / DEPLOY.md / TESTING.md
├── ui_mockups/inventar_first_mockup.html
├── docker-compose.yml          (added in step 17)
├── docker/                     (added in step 17)
└── web/                        React + Vite + TypeScript app
```

The deployable unit is `web/dist/` served by `nginx:alpine`. See `DEPLOY.md`.

For day-to-day operations (deploys, rollbacks, stuck-PWA recovery, e2e + vitest commands, schema migration ops), see `RUNBOOK.md`.

## Development

```bash
cd web
npm install
npm run dev          # vite on http://127.0.0.1:5173
npm run build
npm run preview      # serves dist/ on http://127.0.0.1:4173
npm run lint
npm run typecheck
npm test             # vitest
npm run test:e2e     # playwright
```
