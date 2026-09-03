# SecureVoice Architecture

## Phase 0 scope

SecureVoice v1 is a responsive web app/PWA backed by a small Node.js TypeScript service. This phase creates the monorepo boundaries, local development commands, documentation baseline, and CI quality gates only. WebRTC, signaling, identity, cryptography, and TURN are intentionally not implemented yet.

## Planned topology

- `apps/web`: React + Vite browser application.
- `apps/rendezvous-service`: Node.js service reserved for ephemeral signaling transport.
- `packages/protocol`: versioned wire-contract types and codecs.
- `packages/crypto`: browser Web Crypto integrations.
- `packages/webrtc`: call lifecycle and transport integration.
- `packages/ui`: shared browser UI components.

## Locked product constraints

- Direct-first WebRTC is the default calling mode. In direct mode, the peer may see the other peer's reachable IP address.
- Private mode will force TURN relay-only transport. It hides the peer IP from the other caller but adds relay dependency, latency, and operational cost.
- The v1 web app cannot guarantee incoming calls while closed. The recipient must have SecureVoice open; background ringing is a later, explicitly optional push feature.
- There are no permanent user accounts, phone numbers, global username lookup, or server-side contact directory.
- The rendezvous service will move encrypted signaling blobs only. It will not understand contacts, SDP, ICE, or call content.

## Phase 3 status

The current rendezvous implementation is an intentionally small in-memory HTTP transport. It supports opaque mailbox PUT, GET with cancellable long-poll fallback, mailbox-capability-scoped acknowledgement and deletion, duplicate suppression, and automatic TTL expiry. It is suitable for local integration and protocol work; Redis-compatible persistence, WebSocket delivery, and production rate limiting remain deployment work and are not implied by the current Phase 3 implementation.

## Explicit non-goals

- No global username lookup.
- No offline incoming-call guarantee.
- No claim that direct mode hides IP addresses.
- No WireGuard.
- No message history or social graph on the server.
- No custom encryption algorithms.
- No native Bluetooth, NFC, or local discovery in v1.

## Development contract

Use npm workspaces, TypeScript project references, Vitest, ESLint, and Vite. Every phase must leave behind tests, protocol documentation where relevant, and a visible acceptance checklist. Changes beyond the current phase require an explicit phase task.
