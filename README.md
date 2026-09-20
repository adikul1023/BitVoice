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

### Testing over the internet (ngrok)
To test the P2P calling features between different networks (e.g. laptop to phone on cellular), you can use ngrok to tunnel the local servers:
1. Start ngrok for the rendezvous service: `ngrok http 8787`
2. Copy the resulting ngrok URL and update `VITE_RENDEZVOUS_URL` in `apps/web/.env`
3. Start the servers: `npm run dev:rendezvous` and `npm run dev:web`
4. Start ngrok for the web app: `ngrok http 5173`
5. Open the web app ngrok URL on your testing devices.
## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the current scope and [walkthrough.md](walkthrough.md) for Phase 0 evidence.
