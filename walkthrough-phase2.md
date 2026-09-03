# Phase 2 Walkthrough

## Scope completed

- Added IndexedDB-backed local identity storage for non-extractable signing and agreement key pairs.
- Added public-key-derived device key IDs and contact records with `unverified`, `verified`, and `blocked` states.
- Added signed, ten-minute pairing invitations and signed responses with no account or server directory.
- Added deterministic six-word pairing SAS generation from the pairing transcript.
- Added the responsive identity setup, contacts, QR invitation, invitation import, response review, SAS comparison, verification, block, remove, and key-fingerprint screens.
- Added `fake-indexeddb` tests proving identity persistence and a two-identity invitation/response flow.
- Added an explicit key-replacement flow: the user selects an existing contact, the old key is blocked, and the replacement is saved separately as unverified until the user enters a matching fresh SAS. Automatic recovery from lost keys is not implemented.
- Replaced the text/file response round-trip with scan-to-scan pairing: Alice displays an invitation QR, Bob scans it and immediately displays a response QR, and Alice scans the response QR.
- Added QR pairing UI-state tests for invitation-to-response transition, malformed and duplicate scans, cancellation, mode mismatches, and response acceptance.
- Verified `qr-scanner` cleanup behavior against its installed documentation: unmount calls `destroy()`, which stops the camera stream, worker, and event listeners.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Observed: all four commands pass; 21 tests pass across 4 test files. The Phase 2 tests verify non-extractable keys survive IndexedDB reload, two independent identities produce a signed response and six-word SAS, an explicitly selected old key is blocked before a replacement is saved unverified, SAS matching rejects incorrect input, unsolicited/mismatched/replayed response nonces are rejected, oversized/future-dated artifacts are rejected before signature work, and the QR pairing state machine covers scan transitions, malformed/duplicate/mismatched inputs, and cancellation.

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
- [x] Every created invitation nonce is persisted, must match an exact pending local invitation, and is consumed atomically with contact storage.
- [x] Pairing artifacts have a 16 KiB input cap, strict field checks, exact 64-byte signatures, and a ten-minute future expiry bound.
- [x] QR scanner cleanup calls `destroy()` on unmount, and camera scanning is mounted only after an explicit scan-mode button action.
- [ ] Cross-browser QR scanning and full two-device UI walkthrough require a browser runtime with camera/test support.

## Important changed snippets

The UI now chooses separate scanner modes for the two signed artifact roles:

```tsx
<button onClick={() => { setScanMode('invitation'); setView('scan'); }}>
	Scan invitation QR
</button>
<button onClick={() => { setScanMode('response'); setView('scan'); }}>
	Scan response QR
</button>
```

After Bob scans Alice's invitation, the signed response is displayed directly as a QR artifact:

```tsx
const response = await createResponse(localIdentity, imported);
setPending({ invitation: imported, response, phrase: await getPairingPhrase(imported, JSON.parse(response)) });
setView('review');
```

The camera result is passed into the same artifact validation and pending-invitation acceptance path used by the tests:

```tsx
const scanner = new ScannerConstructor(video, (result) => {
	scanner.stop();
	void onScan(result.data);
}, { highlightScanRegion: true, highlightCodeOutline: true });
```

No protocol security property changed: the scanner only supplies the encoded input; signatures, expiry, nonce matching/consumption, SAS confirmation, and contact states remain enforced by `identity.ts`.

The QR state machine rejects a response in invitation mode and an invitation in response mode before identity persistence is reached:

```ts
expect(acceptScannedArtifact(beginScan('invitation'), response)).toMatchObject({ phase: 'error' });
expect(acceptScannedArtifact(beginScan('response'), invitation)).toMatchObject({ phase: 'error' });
```

Camera permission is requested by `scanner.start()` inside `Scan`'s effect. `Scan` is rendered only for the `scan` view, which is entered by the explicit `Scan invitation QR` or `Scan response QR` button; page-load identity hydration never constructs a scanner.

## Important implementation snippets

The responder now displays its signed response artifact directly as a QR value:

```tsx
function Invite({ artifact, title }: { artifact: string; title: string }) {
	return <div className="panel pairing">
		<h1>{title}</h1>
		<QRCodeCanvas value={artifact} size={240} includeMargin />
	</div>;
}
```

The scanner accepts only the decoded signed artifact; the existing parser, signature checks, pending nonce lookup, and SAS flow remain authoritative:

```tsx
const scanner = new QrScanner(video, (result) => {
	scanner.stop();
	void onScan(result.data);
}, { highlightScanRegion: true, highlightCodeOutline: true });
```

The Phase 2 test suite still verifies the security properties independently of camera availability: identity persistence, signed pairing, nonce binding/consumption, bounded artifacts, replacement blocking, and SAS matching.