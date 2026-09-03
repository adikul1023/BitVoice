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

`messageId`, `callId`, key IDs, and `nonce` use unpadded base64url. Message IDs and call IDs contain at least 128 random bits. Nonces contain at least 96 random bits. An envelope lifetime is at most 15 minutes.

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

1. Parse the envelope shape and reject non-objects.
2. Reject unknown versions and message types.
3. Validate base64url identifiers, nonce, timestamps, payload size, and maximum lifetime.
4. Reject expired messages.
5. Reject a previously accepted `messageId`.
6. Verify the sender signature against a known key. Unverified senders are allowed only by a future pairing flow.
7. Decrypt and validate the message-specific payload.

Parsing and validation must never request microphone permission, create a peer connection, or start a call.

## Cryptographic baseline

- Identity signatures: P-256 ECDSA/SHA-256.
- Contact agreement: P-256 ECDH.
- Key derivation: HKDF-SHA-256 with explicit context info.
- Rendezvous payload encryption: AES-GCM.
- Private `CryptoKey` objects: generated with `extractable: false` and persisted only in IndexedDB in the identity phase.

## Test vectors and rejection cases

The deterministic header vector and canonical bytes are asserted in `tests/phase1.test.ts`. Tests cover unknown versions, expiry, empty and oversized ciphertext, replayed IDs, altered signed data, private-key export failure, and AES-GCM authentication failure.
