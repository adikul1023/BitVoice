# SecureVoice Protocol Specification v2

This document serves as the canonical reference for the SecureVoice P2P communication protocol (Version 2). It outlines the architecture, cryptographic flows, and state machines that power the platform.

## 1. Trust & Threat Model

**Assumptions**:
- **Untrusted Mailboxes**: The centralized Rendezvous service (mailboxes) is entirely untrusted. It can drop, delay, replay, or inspect metadata (envelope sizes and timestamps), but it cannot decrypt payloads or forge signatures.
- **Untrusted Relays (TURN)**: TURN servers are used for NAT traversal. They only see encrypted SRTP traffic and cannot decrypt media or control channels.
- **Trusted Local Devices**: The device running the browser is trusted. Non-extractable WebCrypto keys prevent malware from exporting private keys.
- **Ephemeral Sessions**: Long-term identity keys are strictly used for authentication. All media and signaling is encrypted using ephemeral keys providing forward secrecy.

## 2. Identity Lifecycle

### Key Generation
Identities are backed by a long-term **Ed25519** keypair generated via Native WebCrypto.
- `privateKey`: Marked as `extractable: false`, isolating it in the browser's keystore.
- `publicKey`: Used to derive a unique `keyId` (Base64Url encoded SHA-256 hash of the SPKI representation).

### Pairing
To establish trust, devices exchange public keys out-of-band via QR codes.
The pairing process binds the keys visually with a **6-word Short Authentication String (SAS)** derived from the SHA-256 hash of both concatenated public keys. The pairing requires explicit user verification.

## 3. Cryptographic Flows

The protocol utilizes an authenticated key exchange during the signaling phase.

### WebCrypto Algorithms
- **Authentication**: Ed25519 signatures.
- **Key Exchange**: Ephemeral X25519 (ECDH).
- **Session Keys**: HKDF (SHA-256).
- **Symmetric Encryption**: AES-GCM (256-bit).

### Session Key Derivation (HKDF)
When a call is initiated, both peers generate ephemeral **X25519** keypairs.
The caller sends their `ephemeralPublicKey` in the signaling envelope header.
Once both ephemeral keys are known, ECDH derives a shared secret.

HKDF derives independent sending and receiving keys to prevent reflection attacks:
```text
HKDF(
    sharedSecret,
    info: "SecureVoice Signaling v2|{callId}|caller",
    salt: 32-byte zero vector
) -> callerKey

HKDF(
    sharedSecret,
    info: "SecureVoice Signaling v2|{callId}|recipient",
    salt: 32-byte zero vector
) -> recipientKey
```

## 4. Message Formats

Signaling envelopes are serialized in JSON and strictly validated.

### Envelope Structure
```json
{
  "header": {
    "version": 2,
    "type": "pairing-offer" | "pairing-response" | "call-signal",
    "messageId": "<Base64Url>",
    "callId": "<Base64Url>",
    "senderKeyId": "<Base64Url>",
    "recipientKeyId": "<Base64Url>",
    "ephemeralPublicKey": "<Base64Url>",
    "issuedAt": 1700000000000,
    "expiresAt": 1700000600000,
    "nonce": "<Base64Url>"
  },
  "ciphertext": "<Base64Url>",
  "signature": "<Base64Url>"
}
```

### Authentication & Canonicalization
The envelope signature is an Ed25519 signature over a strictly ordered, canonicalized JSON representation of the `header` + `ciphertext`.
The recipient enforces a canonical base64url representation check to prevent padding mutability attacks.

## 5. Call State Machine

The WebRTC state machine enforces strict linear progression and rejects illegal transitions.

**States**:
- `idle`
- `outgoing-preparing` -> `outgoing-rendezvous` -> `outgoing-connecting`
- `incoming-offer` -> `incoming-review` -> `incoming-accepted` -> `incoming-connecting`
- `ice-connected` -> `connected`
- `ending` -> `ended`

### Glare Handling
If both peers attempt to call each other simultaneously (Glare), the system deterministically resolves the conflict using their `keyId`s.
- **Polite Peer (Smaller `keyId`)**: Yields their outgoing attempt, cleans up their ICE candidates, closes their local RTCPeerConnection, and transitions to `incoming-offer`.
- **Impolite Peer (Larger `keyId`)**: Ignores the incoming collision and continues dialing.

## 6. TURN & Privacy Mode

To obscure IP addresses from untrusted peers, the protocol supports `private-relay-only` mode.
- If a user configures `private-relay-only`, the WebRTC `iceTransportPolicy` is strictly set to `relay`.
- The privacy mode preference is transmitted securely in the signaling payload.
- If the peers' privacy modes do not align (e.g., one requires relay, the other enforces direct), the connection is rejected explicitly with a fatal error. It never silently downgrades to direct connectivity.

## 7. Replay Protection

The system mitigates replay attacks using a deterministic cache bound to `messageId`.
- **Expiry Envelope Window**: Envelopes specify `issuedAt` and `expiresAt` (max 10 minutes).
- **Time Sync Checks**: Envelopes from the future or past are rejected.
- **Nonce/Message ID Tracking**: Processed `messageId`s are cached in IndexedDB. Any duplicate presentation throws a fatal Replay error, forcing the signaling layer to gracefully drop the packet.

## 8. WebRTC DataChannel Authentication (CALL_FINISH)

To prove that the active WebRTC `securevoice-control` DataChannel is authentically connected to the expected peer (and not a MITM or relayer), peers exchange a cryptographic challenge-response after the channel opens.

### Transcript and Encoding
The protocol mandates a canonical UTF-8 string encoding for the signature transcript to prevent serialization ambiguity:
```text
SecureVoice CALL_FINISH v2|<callId>|<signerRole>|<challenge>
```
Where:
- `<callId>` is the Base64Url-encoded call identifier.
- `<signerRole>` is literally `caller` or `recipient` representing the local signer's role.
- `<challenge>` is the Base64Url-encoded 32-byte random cryptographic nonce generated by the *remote* peer.

The resulting Ed25519 signature must be Base64Url-encoded in the final payload. The string literal `v2` enforces protocol versioning for the handshake.

### Handshake Flow
1. **Challenge Generation & Timing:** Exactly upon reaching the `ice-connected` state, the local peer starts a 10-second `CALL_FINISH_TIMEOUT_MS` watchdog. As soon as the `securevoice-control` DataChannel is open (or immediately if already open), the peer generates a fresh 32-byte random `challenge` and sends:
   ```json
   { "type": "CALL_FINISH_CHALLENGE", "challenge": "<Base64Url>" }
   ```
2. **Response:** Upon receiving a challenge, the peer signs the canonical transcript and responds:
   ```json
   {
     "type": "CALL_FINISH",
     "signature": "<Base64Url>"
   }
   ```
3. **Verification:** Upon receiving the `CALL_FINISH` response, the peer verifies the signature using the remote peer's public identity key, the known `callId`, the remote peer's expected role, and the exact locally generated `challenge`.
4. **Transition:** Only a successful cryptographic verification can trigger the state machine transition to `connected`. Mere receipt of a message or opening of the DataChannel is insufficient.
5. **Timeouts & Duplicates:** If the handshake does not complete within 10 seconds of reaching `ice-connected`, the call strictly transitions to `connection-failed` and tears down. Duplicate challenges or late messages arriving after termination must be silently dropped without resetting timers or resurrecting state.
