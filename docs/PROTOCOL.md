# SecureVoice Protocol v1

## Envelope

Every protocol message is a JSON object containing `header`, `ciphertext`, and `signature`. The header is:

```ts
type EnvelopeHeader = {
  version: 1;
  type: "pairing-offer" | "pairing-answer" | "call-offer" |
        "call-answer" | "ice-candidate" | "call-cancel" | "ack";
  messageId: string;
  callId?: string;
  senderKeyId: string;
  recipientKeyId?: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};
```

`messageId`, `callId`, key IDs, nonce, ciphertext, and signature use unpadded canonical base64url. Message IDs and call IDs contain at least 128 random bits. Nonces contain at least 96 random bits. An envelope lifetime is at most 15 minutes. P-256 ECDSA signatures are exactly 64 raw bytes.

Encrypted envelope ciphertext is encoded as one base64url value containing `12-byte random IV || AES-GCM ciphertext and authentication tag`. The canonical header is used as AES-GCM additional authenticated data. The same ciphertext string is then included in the signed envelope.

## Canonical signing

The header is represented in this fixed field order:

```text
[["version",version],["type",type],["messageId",messageId],
 ["callId",callId-or-null],["senderKeyId",senderKeyId],
 ["recipientKeyId",recipientKeyId-or-null],["issuedAt",issuedAt],
 ["expiresAt",expiresAt],["nonce",nonce]]
```

The signing input is UTF-8 bytes of `canonicalHeader + "." + ciphertext`. The signature uses P-256 ECDSA with SHA-256. The server never receives plaintext protocol payloads and must not interpret SDP, ICE, keys, or contact identity.

## Validation order

1. Parse and validate structure and time.
2. Resolve the sender key from `senderKeyId`.
3. Verify the signature.
4. Record replay state.
5. Decrypt with the canonical header as AES-GCM additional authenticated data.
6. Validate the message-specific payload.

Structural validation includes rejecting unknown versions and message types, non-canonical base64url, invalid identifiers, oversized payloads, and lifetimes over 15 minutes. Unverified senders are allowed only by a future pairing flow. A failed signature must never consume replay state.

Parsing and validation must never request microphone permission, create a peer connection, or start a call.

## Cryptographic baseline

- Identity signatures: P-256 ECDSA/SHA-256.
- Contact agreement: P-256 ECDH.
- Key derivation: HKDF-SHA-256 with explicit context info.
- Rendezvous payload encryption: AES-GCM.
- Private `CryptoKey` objects: generated with `extractable: false` and persisted only in IndexedDB in the identity phase.

## Test vectors and rejection cases

The deterministic header vector and canonical bytes are asserted in `tests/phase1.test.ts`. Tests cover unknown versions, expiry, future timestamps, empty and oversized ciphertext, non-canonical ciphertext, 65-byte signatures, replayed IDs, altered signed data, private-key export failure, and complete encrypt/sign/verify/decrypt round trips.
