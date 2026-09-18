A web app/PWA is enough for SecureVoice v1: WebRTC audio and data channels are broadly supported, and the browser can keep non-extractable `CryptoKey` objects in IndexedDB. [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API), [Web Crypto / IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)

One important constraint: a web app cannot reliably receive an incoming call while closed without web push, and web push itself uses push-service infrastructure. So v1 should support instant calling when the recipient has SecureVoice open; background ringing is a later, explicitly non-P2P optional feature. [PWA push/background behavior](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)

Below is the plan I would give Antigravity. Treat each phase as a separate task; do not skip the acceptance criteria.

# SecureVoice Web Architecture Plan

## Product decisions locked before implementation

- Build a responsive web app/PWA only. No OS-specific client in v1.
- Use WebRTC for all voice and peer data transport.
- Do not implement WireGuard.
- Default calling mode is direct-first WebRTC: low latency, peer IP may be visible.
- TURN is optional:
  - **Private mode:** force relay-only WebRTC; peer IP is hidden.
  - **Fallback mode:** try direct first, then ask the user before using TURN.
- No permanent user accounts, no phone numbers, no server-side contact directory.
- Use an ephemeral rendezvous service for automatic signaling.
- Keep rendezvous messages for a maximum of 15 minutes; delete after fetch/ack.
- WebRTC audio remains end-to-end encrypted whether direct or relayed.
- Do not claim “anonymous” if using a direct call. Direct peers see each other’s reachable IP.
- Do not implement your own cryptographic primitives.

## Phase 0 — Repository, scope, and non-goals

Create the project skeleton and a short `ARCHITECTURE.md`.

Use this stack unless there is a strong existing preference:

- TypeScript
- React + Vite
- PWA service worker
- Node.js TypeScript backend
- WebSocket plus HTTP fallback for signaling
- Redis or compatible TTL key-value store for ephemeral rendezvous
- Coturn only as an optional deployment component
- Vitest for unit tests
- Playwright for browser-level tests

Create these top-level modules:

```text
apps/
  web/
  rendezvous-service/
packages/
  protocol/
  crypto/
  webrtc/
  ui/
docs/
  ARCHITECTURE.md
  THREAT_MODEL.md
  PROTOCOL.md
  TEST_PLAN.md
```

Write explicit non-goals:

- No global username lookup.
- No offline incoming-call guarantee.
- No “hide IP” promise in direct mode.
- No WireGuard.
- No message history or social graph on the server.
- No custom encryption algorithms.
- No native Bluetooth/NFC/local discovery in v1.

Acceptance criteria:

- A new developer can run web and rendezvous services locally.
- CI runs typecheck, lint, unit tests, and production build.
- `ARCHITECTURE.md` states direct-mode IP exposure and the TURN trade-off plainly.

## Phase 1 — Threat model and protocol contract before UI

Do this before implementing screens.

Create `docs/THREAT_MODEL.md` with these attackers:

- Network attacker can observe, replay, modify, delay, and drop signaling.
- Rendezvous server is honest-but-curious or malicious.
- TURN server sees peer IPs and traffic metadata, but not decrypted media.
- A peer may be malicious.
- A compromised browser origin/XSS can misuse locally held keys.
- Lost device and key rotation.
- Denial of service and signaling spam.

Create `docs/PROTOCOL.md` defining versioned messages. Every protocol payload must contain:

```ts
type EnvelopeHeader = {
  version: 1;
  type: "pairing-offer" | "pairing-answer" | "call-offer" |
        "call-answer" | "ice-candidate" | "call-cancel" | "ack";
  messageId: string;       // 128+ bits random
  callId?: string;         // 128+ bits random
  senderKeyId: string;
  recipientKeyId?: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};
```

Rules:

- Canonically encode before signing.
- Reject unknown versions.
- Reject expired messages.
- Reject replayed `messageId`s.
- Reject messages from an unverified contact unless in pairing flow.
- Never log plaintext SDP, ICE candidates, public keys, mailbox tokens, or decrypted payloads.
- Do not allow protocol parsing to trigger microphone access or a call.

Use a browser-supported Web Crypto baseline:

- P-256 ECDSA/SHA-256 for identity signatures.
- P-256 ECDH for deriving contact-shared secrets.
- HKDF-SHA-256 for per-message symmetric keys.
- AES-GCM for encrypted rendezvous payloads.
- Generate private keys with `extractable: false`.
- Persist `CryptoKey` objects in IndexedDB.

The app must sign the envelope header plus ciphertext. The server stores only ciphertext and opaque routing IDs.

Acceptance criteria:

- Protocol has deterministic test vectors.
- Malformed, expired, altered, and replayed envelopes are rejected.
- A server cannot replace an offer’s WebRTC fingerprint without signature verification failing.
- No private key is exported to JavaScript strings, localStorage, URL parameters, or logs.

## Phase 2 — Local identity and verified contacts

Build identity before calls.

Local data model:

```ts
type LocalIdentity = {
  version: 1;
  signingKeyPair: CryptoKeyPair;      // non-extractable private key
  agreementKeyPair: CryptoKeyPair;    // non-extractable private key
  signingPublicJwk: JsonWebKey;
  agreementPublicJwk: JsonWebKey;
  keyId: string;                      // hash of signing public key
  createdAt: number;
};

type Contact = {
  contactId: string;                  // hash of peer signing key
  displayName: string;
  signingPublicJwk: JsonWebKey;
  agreementPublicJwk: JsonWebKey;
  verification: "unverified" | "verified";
  verifiedAt?: number;
  keyChangeState: "normal" | "blocked";
  createdAt: number;
  lastSeenAt?: number;
};
```

Build these screens:

- Create local identity.
- My verification QR.
- Scan/import invitation.
- Review pending contact.
- Compare six-word verification phrase.
- Contacts list.
- Contact detail with key fingerprint.
- Key-change warning and block/remove actions.

Initial pairing flow:

1. Alice creates a signed one-time pairing invitation with a 10-minute expiry.
2. Alice sends it through QR, link, file, or any existing messenger.
3. Bob opens it and sees Alice as “unverified.”
4. Bob creates a signed response containing Bob’s public keys and fresh nonce.
5. Alice receives that response through QR/link/file.
6. Both derive the same six-word SAS from the pairing transcript.
7. Humans compare the words through a trusted human channel.
8. Both explicitly mark the contact verified.

Do not mark a contact verified merely because someone opened a QR code.

Acceptance criteria:

- Pair two browser profiles without any SecureVoice account.
- Change a saved contact’s key and verify that calling is blocked.
- Delete browser data and verify the device identity disappears.
- Pairing artifacts expire and cannot be imported later.
- A modified QR payload fails verification.

## Phase 3 — Ephemeral rendezvous service

This is the small server that makes later calls convenient.

Its job is only to move encrypted signaling blobs. It must not understand users, contacts, SDP, ICE, or call content.

For existing verified contacts, derive rolling mailbox IDs locally:

```text
contactSharedSecret =
  ECDH(localAgreementPrivateKey, peerAgreementPublicKey)

mailboxId =
  HKDF(contactSharedSecret,
       salt = UTC 10-minute time bucket,
       info = "securevoice/rendezvous/inbound/v1")
```

Use current, previous, and next time bucket to tolerate small clock skew.

The server API should be deliberately small:

```text
PUT  /v1/mailboxes/{opaqueMailboxId}/messages
GET  /v1/mailboxes/{opaqueMailboxId}/messages?wait=25
POST /v1/messages/{messageId}/ack
DELETE /v1/messages/{messageId}
GET  /healthz
```

Server behavior:

- Mailbox IDs are opaque random-looking capabilities.
- Maximum payload size, e.g. 64 KB per message.
- Maximum TTL: 15 minutes.
- Delete after authenticated client acknowledgement.
- Enforce a short per-message retry window.
- Rate-limit by mailbox capability and source network.
- Store minimal timestamp metadata only for operations.
- Disable request-body logs.
- Do not create accounts or a contacts table.
- Run automatic TTL deletion.
- Return generic errors; do not leak whether a mailbox exists.

For active users, use WebSocket delivery after the initial HTTP session. Retain long polling as the compatibility fallback.

Important: this is still infrastructure. It removes manual QR for subsequent calls; it does not make the system “serverless.”

Acceptance criteria:

- An existing verified contact can receive a call offer automatically while the web app is open.
- A server database dump contains only opaque IDs, ciphertext, expiry, and minimal operational metadata.
- Messages disappear after acknowledgement or 15 minutes.
- The client handles service restart, duplicate delivery, delayed delivery, and wrong clock.
- The server cannot decrypt or validate an SDP payload.

## Phase 4 — WebRTC call establishment, no TURN yet

Implement a clean call state machine before audio polish.

```text
idle
  -> outgoing-preparing
  -> outgoing-rendezvous
  -> outgoing-connecting
  -> connected
  -> ending
  -> ended

idle
  -> incoming-offer
  -> incoming-review
  -> incoming-accepted
  -> incoming-connecting
  -> connected
  -> ending
  -> ended
```

Call flow:

1. Caller selects a verified contact.
2. App creates a fresh `callId`, `RTCPeerConnection`, and data channel.
3. App requests microphone permission only after user presses Call.
4. App creates and signs a WebRTC offer.
5. App sends the encrypted, signed offer through rendezvous.
6. Recipient verifies signer, expiry, `callId`, and fingerprint before showing Accept.
7. Recipient accepts, grants microphone permission, creates a signed answer.
8. Both exchange signed ICE-candidate messages.
9. On connection, use the WebRTC data channel to exchange a `CALL_FINISH` message bound to the signed transcript.
10. Only after `CALL_FINISH` succeeds, show “Verified secure call.”

WebRTC configuration initially:

```ts
const rtcConfig: RTCConfiguration = {
  iceServers: configuredStunServers,
  iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};
```

Direct mode requirements:

- Clearly show “Direct call: your IP may be visible to this contact.”
- Display selected candidate type in an advanced diagnostics panel.
- Never send audio until the user accepts.
- Offer an ICE restart once after failure.
- End cleanly if direct ICE still fails.

The browser WebRTC layer encrypts `RTCDataChannel` traffic with DTLS; use it for transcript confirmation and small control messages, not as a replacement for initial signaling. [RTCDataChannel security](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels)

Acceptance criteria:

- Two independent browser profiles complete an audio call on the same network.
- Two profiles complete a call across different networks when direct ICE succeeds.
- A modified offer, answer, or ICE message never reaches connection setup.
- Declining an incoming call does not enable microphone access.
- Closing a tab ends media, destroys the peer connection, and clears active call state.
- Call state has no illegal transitions.

## Phase 5 — TURN as a user-controlled optional feature

Do not add TURN until direct calling is observable and tested.

Support two modes:

```ts
type PrivacyMode =
  | "direct-preferred"
  | "private-relay-only";
```

Configuration:

```ts
const directPreferred: RTCConfiguration = {
  iceServers: [stun, optionalTurn],
  iceTransportPolicy: "all",
};

const privateRelayOnly: RTCConfiguration = {
  iceServers: [turn],
  iceTransportPolicy: "relay",
};
```

Relay-only forces only relay candidates, which prevents the communicating peer from receiving direct ICE addresses. [W3C WebRTC candidate privacy](https://www.w3.org/TR/webrtc/)

User experience:

- Before a direct call: “Direct mode may share your IP address with this contact.”
- Before relay-only: “Private mode hides your IP from this contact, but routes encrypted audio through a relay and may add delay.”
- On direct connection failure: “Direct connection failed. Try Private Relay?” Never silently switch modes.
- In the call screen, display:
  - Direct
  - Relayed / private
  - Connecting
  - Failed

TURN deployment requirements:

- Use Coturn or another proven TURN implementation; do not build TURN.
- Use short-lived, server-generated TURN credentials.
- Support TURN over UDP and TLS/TCP.
- Rate-limit allocations and bandwidth.
- Keep privacy-mode media end-to-end encrypted by WebRTC, despite traversal through TURN.

Acceptance criteria:

- Relay-only call does not expose host or server-reflexive candidates to the peer.
- Direct mode still works with TURN configured.
- TURN failure yields a clear error without falling back to an undisclosed direct route.
- Tests verify the selected candidate type through `getStats()`.

## Phase 6 — PWA, offline behavior, and honest incoming-call UX

Make it installable, but do not pretend it is a native dialer.

Implement:

- Web app manifest.
- Service worker for application-shell caching.
- Offline contact viewing.
- Offline QR pairing display.
- Clear state when the rendezvous service is unreachable.
- “Recipient must have SecureVoice open” message in v1.
- A share target for importing pairing/call invitation files or links.

Do not implement web push in this phase.

Reason: push needs application-server involvement and a browser push service. It is valid later, but it changes the product’s infrastructure/privacy story. [Web Push architecture](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)

Acceptance criteria:

- App installs on supported desktop and mobile browsers.
- Existing contacts remain available offline.
- Opening an expired invite gives a safe, clear error.
- Closing the recipient’s browser means calls are not presented as deliverable.

## Phase 7 — Security hardening

This is not optional before public use.

Web-specific security requirements:

- HTTPS only.
- Strict Content Security Policy; no unsafe inline scripts.
- No third-party analytics scripts on call/pairing pages.
- Subresource integrity for any unavoidable third-party static asset.
- Trusted Types where practical.
- Dependency lockfiles and automated dependency scanning.
- No identity or signaling secrets in URLs after import.
- Clear imported link fragments immediately from browser history where possible.
- Encrypt local metadata at rest only where the browser/platform offers a meaningful mechanism; do not overclaim protection from a compromised browser profile.
- Treat XSS as a key-compromise event: non-extractable keys cannot be exported, but malicious same-origin code may still use them.

Protocol hardening:

- Fuzz decoder and envelope parser.
- Enforce strict message/payload limits.
- Rate-limit incoming pairing and call attempts.
- Require user acceptance before media activation.
- Key continuity and blocked state on key changes.
- Contact revoke/block list.
- Rotation/recovery design before launch.

Acceptance criteria:

- Security review of CSP, storage, logs, dependencies, and protocol parser.
- Automated tests for replay, expiry, altered ciphertext, key substitution, oversized message, duplicate answer, and stale ICE candidates.
- No high-severity findings in dependency/security scan.
- Threat model updated with every meaningful architecture change.

## Phase 8 — Observability without betraying privacy

Collect only opt-in, aggregate operational telemetry.

Allowed examples:

- Call attempt started/succeeded/failed.
- Failure category: signaling unavailable, microphone denied, ICE timeout, relay unavailable.
- Selected path class: direct or relay.
- Approximate setup duration bucket.
- Browser family/version.

Never collect by default:

- Contact identities.
- Raw IP addresses.
- SDP.
- ICE candidates.
- Audio metadata.
- Public keys.
- Message payloads.
- Fine-grained timestamps that create a contact graph.

Give users an “Export diagnostics” action that produces a local file they can choose to share for support.

Acceptance criteria:

- Telemetry schema is reviewed against `THREAT_MODEL.md`.
- Disabling telemetry produces no analytics requests.
- Local diagnostic export redacts identifiers and candidates.

## Phase 9 — Test matrix and release gates

Build a reproducible test matrix:

- Chrome, Firefox, Safari, Edge.
- Desktop and mobile-browser cases.
- Same LAN.
- Different home networks.
- IPv4-only.
- IPv6-capable.
- Mobile hotspot.
- Corporate/UDP-restricted network.
- Direct mode.
- Relay-only mode.
- Expired invite.
- Recipient closed.
- Recipient online but declines.
- Key changed.
- Rendezvous restart during setup.
- TURN unavailable.
- ICE restart.

Release gates:

- Direct calls work where ICE finds a direct path.
- Relay-only calls work through supported TURN deployment.
- IP-visibility mode is shown accurately.
- Key substitution/replay tests pass.
- No automated call proceeds after a key-change warning.
- No signaling record survives its TTL.
- Documentation never says “fully serverless,” “anonymous,” or “IP hidden” without qualifying the chosen mode.

## Suggested task sequence for Antigravity

Give it one phase at a time, in this exact order:

1. “Create the monorepo and Phase 0 documentation only. Do not add WebRTC.”
2. “Implement Phase 1 protocol and crypto package with test vectors only.”
3. “Implement Phase 2 local identity and pairing UI using browser storage only.”
4. “Implement Phase 3 ephemeral rendezvous service and integration tests.”
5. “Implement Phase 4 direct WebRTC calling and the call state machine.”
6. “Implement Phase 5 optional TURN-only private mode.”
7. “Implement Phase 6 PWA behavior and explicit online-only v1 UX.”
8. “Perform Phase 7 hardening and Phase 9 test matrix before public release.”

The key discipline is simple: every phase must leave behind tests, protocol documentation, and a visible acceptance checklist. That keeps the AI from silently inventing architecture while it builds.