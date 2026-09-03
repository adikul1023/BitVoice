# Phase 1 Walkthrough

## Scope completed

- Added `docs/THREAT_MODEL.md` covering network attackers, malicious rendezvous/TURN services, malicious peers, XSS, lost devices, key rotation, and denial of service.
- Added `docs/PROTOCOL.md` defining the versioned envelope, canonical signing bytes, validation order, cryptographic baseline, and rejection cases.
- Implemented strict envelope header validation, 15-minute maximum lifetime, base64url identifier checks, payload limits, canonical encoding, signing input construction, and an in-memory replay guard in `packages/protocol`.
- Implemented P-256 ECDSA, P-256 ECDH, HKDF-SHA-256, and AES-GCM wrappers in `packages/crypto` using non-extractable private keys.
- Added deterministic protocol vectors and cryptographic rejection/round-trip tests.
- Final correction pass: envelope verification now resolves the sender key from `senderKeyId`, records replay state only after signature verification, and rejects unknown sender keys.
- Final correction pass: AES-GCM derives AAD from the canonical envelope header, and envelope ciphertext is required to be canonical base64url.
- Final correction pass: P-256 signatures are required to decode to exactly 64 raw bytes.
- Final correction pass: `encryptEnvelope` frames `iv || ciphertext+tag` into the envelope ciphertext, and `decryptEnvelope` reverses that framing after authenticated verification.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The focused Phase 1 tests cover both-sided ECDH agreement and wrong-peer separation; sender-key resolution; fully encoded envelope verification; complete encrypt/sign/verify/decrypt round trips; exact 64-byte signature enforcement including rejection of a validly encoded 65-byte signature; altered header, ciphertext, signature, and IV rejection; future-dated and expired envelopes; replay only after successful verification; canonical base64url padding and unused-bit rejection; private-key export failure; and canonical-header AAD plus generated-IV AES-GCM authentication. No UI, microphone access, rendezvous transport, WebRTC, TURN, or identity persistence was added.

## Acceptance checklist

- [x] Protocol has deterministic test vectors.
- [x] Malformed, expired, altered, and replayed inputs are rejected.
- [x] Private signing keys are generated non-extractable and export attempts fail.
- [x] The server-facing protocol surface contains only opaque ciphertext and routing-independent envelope data.
- [x] Protocol parsing has no microphone or call-start side effects.
- [x] AES-GCM requires non-empty AAD and generates a fresh 96-bit IV internally.
- [x] Invalid signatures cannot consume replay state.
- [x] Verification resolves `senderKeyId` before signature verification and rejects unknown keys.
- [x] AES-GCM authentication is bound to the canonical envelope header.
- [x] P-256 signatures are exactly 64 raw bytes after base64url decoding.
- [x] Encrypted payloads use one framed base64url ciphertext suitable for signing and verification.
- [ ] Contact verification and WebRTC fingerprint binding remain for later phases.
