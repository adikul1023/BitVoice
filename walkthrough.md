# Phase 0 Walkthrough

## What was implemented

- Created the npm-workspaces monorepo for SecureVoice.
- Added the planned `apps/` and `packages/` module boundaries.
- Added a minimal React/Vite web shell with no WebRTC behavior.
- Added a minimal Node.js rendezvous-service placeholder with `GET /healthz` only.
- Added root commands for typecheck, lint, unit tests, and production build.
- Added GitHub Actions CI running the same four quality gates.
- Added [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) with direct-mode IP exposure, TURN trade-offs, online-only incoming-call behavior, and explicit non-goals.

## How to verify

From the repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Expected result: all commands exit successfully. `npm run build` creates Vite output for the web app and compiled output for the service.

Observed during Phase 0 verification:

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero ESLint findings.
- `npm test`: passed, 1 test file and 1 test.
- `npm run build`: passed for both Vite and the rendezvous service.
- `GET http://localhost:8787/healthz`: returned `{"service":"rendezvous-service","status":"ok","phase":0}`.
- `npm audit --omit=dev`: reported 0 production vulnerabilities. The earlier critical advisory was in development tooling and does not affect shipped runtime code.
- Full `npm audit` identified the critical advisory at direct dev dependency `vitest@2.1.9` (`node_modules/vitest`), with related vulnerable paths through `node_modules/vitest/node_modules/vite` and `node_modules/vitest/node_modules/esbuild`. npm proposes the major upgrade to Vitest 4; it was not applied blindly in Phase 0.

To verify local startup, run these in separate terminals:

```sh
npm run dev:web
npm run dev:rendezvous
```

Open `http://localhost:5173` for the web shell. Request `http://localhost:8787/healthz`; it should return JSON with service status and the Phase 0 version.

## Acceptance checklist

- [x] New developer setup and local run commands are documented.
- [x] Web and rendezvous applications have separate workspace boundaries.
- [x] CI runs typecheck, lint, unit tests, and production build.
- [x] Architecture documentation states direct-mode IP exposure and TURN trade-offs plainly.
- [x] WebRTC, WireGuard, signaling, identity, and cryptography are not implemented in Phase 0.
- [x] No runtime server state, WebRTC APIs, identity keys, crypto APIs, or TURN configuration exists in Phase 0.
- [x] Production-only dependency audit is clean; the development-only critical advisory is identified above for planned dependency maintenance.
