# SecureVoice

SecureVoice is a privacy-conscious peer-to-peer voice calling web app. Phase 0 establishes the repository and deployment boundaries; product behavior is added in later phases.

## Prerequisites

- Node.js 22.14.0
- npm 11.12.1

## Local development

Install dependencies, then run the services in separate terminals:

```sh
npm ci
npm run dev:web
npm run dev:rendezvous
```

The web app runs at `http://localhost:5173`. The rendezvous service runs at `http://localhost:8787` and exposes `GET /healthz`.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the current scope and [walkthrough.md](walkthrough.md) for Phase 0 evidence.
