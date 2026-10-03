# SecureVoice (BitVoice)

SecureVoice is a privacy-conscious peer-to-peer voice calling web application. It features end-to-end encrypted signaling, out-of-band contact verification via SAS (Short Authentication String) fingerprints, and automatic WebRTC direct P2P connection with dynamic  STUN/TURN relay fallback.

---

## 🏗️ Architecture Overview

```
                          ┌──────────────────────────────────────────────┐
                          │          Rendezvous Service (AWS EC2)        │
                          │   - Port 8787 (node:http)                    │
                          │   - End-to-end encrypted signaling mailboxes │
                          │   - 15-min HMAC-SHA1 TURN credential broker  │
                          └──────────────┬───────────────────────────────┘
                                         │
                         1. Exchange SDP │ 2. Request short-lived TURN ticket
                                         │
             ┌───────────────────────────┴───────────────────────────┐
             │                                                       │
             ▼                                                       ▼
      [Peer A Browser]                                        [Peer B Browser]
      (Web App Frontend)                                      (Web App Frontend)
             │                                                       │
             │ 3. Direct P2P (or Relay if blocked by NAT/Firewall)   │
             └───────────────────────────► ◄─────────────────────────┘
                                         │
                          ┌──────────────┴───────────────────────────────┐
                          │          STUN / TURN Server (coturn)         │
                          │   - Port 3478 UDP/TCP (STUN & TURN)          │
                          │   - Ports 49152-65535 UDP (Media Relay)      │
                          │   - Long-term credential mechanism (RFC 5766)│
                          └──────────────────────────────────────────────┘
```

---

## 🚀 Infrastructure & Deployment Progress

### 1. Backend Service (`apps/rendezvous-service`)
- **Hosting:** AWS EC2 (Ubuntu 24.04 LTS).
- **Process Management:** PM2 daemon (`pm2 start`) with auto-start on system reboot (`pm2 startup`).
- **Endpoints:**
  - `GET /healthz` — Service healthcheck
  - `POST /v1/turn` — Authenticated dynamic TURN credential generator
  - `PUT /v1/mailboxes/:id/messages` — Encrypted signal delivery
  - `GET /v1/mailboxes/:id/messages` — Signal retrieval with long-polling (up to 25s)
  - `POST /v1/mailboxes/:id/messages/:msgId/ack` — Message acknowledgment

### 2. STUN & TURN Infrastructure (`coturn`)
- **Self-Hosted coTURN:** Configured and running on AWS EC2 alongside the rendezvous service.
- **Port 3478 (TCP/UDP):** STUN public IP discovery & TURN authentication.
- **Ports 49152-65535 (UDP):** Dynamic real-time media relay allocation for symmetric NAT and firewall traversal.
- **Security:** HMAC-SHA1 shared authentication secret (`lt-cred-mech`), restricted loopback/multicast peers.

### 3. Automated CI/CD Pipeline (`.github/workflows/ci.yml`)
- **Continuous Integration:** Runs `npm ci`, `typecheck`, `lint` (zero warnings), `test` (111 unit & integration tests), and workspace `build` on every PR and push.
- **Continuous Deployment:** On pushes to `main`, triggers an environment-protected deployment (`production` environment with required reviewers) that SSHs into the live EC2 instance, pulls updates, runs `npm ci`, and reloads PM2 with zero downtime.

---

## 🛠️ Prerequisites

- **Node.js:** `22.14.0` (or `>= 22.14.0`)
- **npm:** `11.12.1` (or `>= 11.0.0`)

---

## 💻 Local Development

Install dependencies, then run the services in separate terminals:

```sh
npm ci
npm run dev:web
npm run dev:rendezvous
```

The web app runs at `http://localhost:5173`. The rendezvous service runs at `http://localhost:8787` and exposes `GET /healthz`.

### Environment Configuration

**Backend (`apps/rendezvous-service/.env`):**
```env
TURN_SECRET=my_secret_bitvoice_key
TURN_URLS=turn:localhost:3478?transport=udp,turn:localhost:3478?transport=tcp
TURN_AUTH_TOKEN=local-dev-token
PORT=8787
```

**Frontend (`apps/web/.env`):**
```env
# Leave VITE_RENDEZVOUS_URL empty to use Vite's automatic proxy
VITE_RENDEZVOUS_URL=
VITE_TURN_AUTH_TOKEN=local-dev-token
```

---

## 🌐 Testing Over the Internet (ngrok / Live EC2)

To test P2P calling features between different networks (e.g. laptop to phone on cellular):

1. **Start Vite Frontend:** `npm run dev:web`
2. **Start ngrok Tunnel:** `ngrok http 5173 --url https://your-custom-ngrok-domain.ngrok-free.dev`
3. **Open Tunnel URL:** Open `https://your-custom-ngrok-domain.ngrok-free.dev` on both devices and click **"Visit Site"**.
   - *Vite's built-in proxy in `vite.config.ts` automatically forwards all `/v1` signaling requests seamlessly to your live EC2 backend without browser Mixed-Content blocks.*

---

## 🧪 Verification & Testing

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the current scope and [walkthrough.md](walkthrough.md) for Phase 0 evidence.
