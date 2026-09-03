# Phase 3 Walkthrough

## Scope completed

- Replaced the health-only rendezvous placeholder with an in-memory ephemeral transport for encrypted signaling blobs.
- Added `PUT /v1/mailboxes/{opaqueMailboxId}/messages` for bounded opaque message submission.
- Added `GET /v1/mailboxes/{opaqueMailboxId}/messages?wait=25` with long-poll fallback.
- Added mailbox-capability-scoped `POST /v1/mailboxes/{opaqueMailboxId}/messages/{messageId}/ack` and `DELETE /v1/mailboxes/{opaqueMailboxId}/messages/{messageId}` removal endpoints. Possession of the opaque mailbox capability is the authentication mechanism; there are no accounts or identities at the service.
- Added automatic expiry purging, 15-minute maximum TTL, 64 KiB payload/body limits, duplicate suppression, mailbox isolation, no-store responses, and generic request errors.
- Kept the service protocol-blind: it does not parse, validate, log, or decrypt SDP, ICE, public keys, or ciphertext contents.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Observed: the focused Phase 3 integration suite passes 7 tests. The complete repository gates pass with 28 tests across 5 files, including a simulated Alice PUT -> Bob GET -> ACK -> empty GET exchange, transport, TTL, acknowledgement, capability-scoped deletion, duplicate, isolation, opaque paths, cancellable long polling, malformed-request, and health checks.

## Important implementation snippets

The server stores and returns only the opaque message fields supplied by the client:

```ts
store.put(mailboxId, {
  messageId: body.messageId,
  ciphertext: body.ciphertext,
  expiresAt: body.expiresAt,
}, now());
```

Messages are removed only by acknowledgement, explicit deletion, or expiry:

```ts
store.ack(parts[2], parts[4], now());
writeJson(response, 202, { accepted: true });
```

ACK and DELETE carry the mailbox capability in the route, so a message ID alone cannot remove a message from another mailbox:

```text
POST   /v1/mailboxes/{opaqueMailboxId}/messages/{messageId}/ack
DELETE /v1/mailboxes/{opaqueMailboxId}/messages/{messageId}
```

The service starts only when run directly, so importing it for integration tests does not open a listener:

```ts
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createRendezvousServer().listen(port);
}
```

## Acceptance checklist

- [x] Opaque mailbox message transport works over HTTP.
- [x] Backend integration simulates Alice PUT offer, Bob GET offer, ACK, and empty follow-up GET.
- [x] Messages disappear after acknowledgement or expiry.
- [x] Duplicate delivery is suppressed and mailboxes are isolated.
- [x] ACK and DELETE are scoped by the opaque mailbox capability.
- [x] Mailbox path values are treated as opaque strings without decoding or regex validation.
- [x] Long-poll cancellation clears its timer and request listener.
- [x] Service restart creates a fresh in-memory store with no retained message state.
- [x] Payload and TTL limits reject oversized or overlong requests.
- [x] Server does not understand or decrypt SDP, ICE, keys, or signaling payloads.
- [ ] Redis-compatible persistence, WebSocket delivery, and production rate limiting remain deployment follow-ups.