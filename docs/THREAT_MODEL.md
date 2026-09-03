# SecureVoice Threat Model

## Scope

This threat model covers Phase 1 protocol and browser cryptography. It does not claim protection from a compromised browser origin, operating system, or device.

## Attackers and risks

- **Network attacker:** can observe, replay, modify, delay, or drop signaling. Signed canonical envelopes, expiry, replay tracking, and authenticated ciphertext are intended to detect modification and replay; availability is not guaranteed.
- **Rendezvous service:** may be honest-but-curious or malicious. It receives opaque routing identifiers and encrypted blobs only. It must not be trusted to authenticate peers or preserve protocol fields.
- **TURN service:** will see peer addresses and traffic metadata when introduced. WebRTC/DTLS media remains encrypted end to end, but relay metadata and availability remain exposed to the relay.
- **Malicious peer:** may send malformed, expired, oversized, replayed, or correctly signed but unwanted messages. Parsing must not grant microphone access or start a call.
- **Compromised origin or XSS:** malicious same-origin code can use locally held keys even when private keys are non-extractable. CSP, Trusted Types where practical, dependency review, and no third-party analytics on call pages reduce exposure but do not make a compromised origin safe.
- **Lost device and key rotation:** browser storage loss removes the local identity; a changed contact key must be treated as a continuity failure and blocked until explicitly resolved in a later phase.
- **Denial of service and signaling spam:** size limits, expiry, replay rejection, and later service-side rate limits reduce resource abuse but cannot prevent all network-level denial of service.

## Security properties in Phase 1

- Envelope headers are versioned and canonically encoded before signing.
- Unknown versions, invalid identifiers, malformed fields, expired messages, and lifetimes over 15 minutes are rejected.
- A message ID can be accepted only once within its expiry window.
- P-256 ECDSA/SHA-256 authenticates the header plus ciphertext.
- P-256 ECDH, HKDF-SHA-256, and AES-GCM are used through Web Crypto; private keys are generated non-extractable.
- No private key is exported to JavaScript strings, localStorage, URL parameters, or logs.

## Residual risks

Phase 1 does not yet implement contact verification, key continuity, rendezvous transport, WebRTC fingerprint binding, TURN, CSP headers, or operational rate limiting. Those controls are release blockers for later phases and public use.
