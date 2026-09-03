# Phase 2 Walkthrough

## Scope completed

- Added IndexedDB-backed local identity storage for non-extractable signing and agreement key pairs.
- Added public-key-derived device key IDs and contact records with `unverified`, `verified`, and `blocked` states.
- Added signed, ten-minute pairing invitations and signed responses with no account or server directory.
- Added deterministic six-word pairing SAS generation from the pairing transcript.
- Added the responsive identity setup, contacts, QR invitation, invitation import, response review, SAS comparison, verification, block, remove, and key-fingerprint screens.
- Added `fake-indexeddb` tests proving identity persistence and a two-identity invitation/response flow.
- Added an explicit key-replacement flow: the user selects an existing contact, the old key is blocked, and the replacement is saved separately as unverified until the user enters a matching fresh SAS. Automatic recovery from lost keys is not implemented.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Observed: all four commands pass; 12 tests pass across 3 test files. The Phase 2 tests verify non-extractable keys survive IndexedDB reload, two independent identities produce a signed response and six-word SAS, and an explicitly selected old key is blocked before a replacement is saved unverified.

The integrated browser smoke check was attempted, but this environment does not have the Playwright Chromium executable installed. The Vite production build completed successfully; install the project browser binary before performing an interactive browser acceptance run.

## Acceptance checklist

- [x] Local identity is created before pairing and stored in browser IndexedDB.
- [x] Pairing artifacts are signed and expire after ten minutes.
- [x] Contacts begin unverified and require an exact fresh SAS comparison before verification.
- [x] Six-word SAS is shown for trusted-channel comparison.
- [x] Contact key fingerprint, block, remove, and verification controls exist.
- [x] No account, server contact directory, WebRTC, rendezvous, or microphone behavior was added.
- [x] User-directed key replacement blocks the old key and requires fresh SAS verification for the new key.
- [x] Automatic recovery from a lost identity key is explicitly out of scope pending a separate recovery/key-rotation design.
- [ ] Cross-browser QR scanning and full two-device UI walkthrough require a browser runtime with camera/test support.