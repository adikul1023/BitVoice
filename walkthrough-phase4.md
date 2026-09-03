# Phase 4 Walkthrough

## Scope completed

- Added a pure legal-transition call state machine in `packages/webrtc` for outgoing and incoming call paths.
- Added a direct-first `RTCPeerConnection` controller with `iceTransportPolicy: "all"`, max-bundle, required RTCP mux, an ordered control data channel, remote track delivery, and caller-provided signaling hooks.
- Added explicit `ice-connected` and verified `connected` states; the latter requires a valid signed `CALL_FINISH` transcript on the control data channel.
- Microphone access is requested only by explicit `startOutgoing()` or `acceptIncoming()` calls; receiving an offer only moves to incoming review.
- Incoming offers and ICE candidates are held outside WebRTC until explicit acceptance; no local peer, remote description, or candidate signaling is created during review.
- Added signed signaling integration points for offer, answer, and ICE exchange without implementing rendezvous wiring, TURN, or call encryption policy changes.
- Added one ICE restart attempt after the controller reaches outgoing connecting state.
- Added idempotent `CALL_FINISH` sending to avoid duplicate transcript messages when data-channel-open and ICE-connected callbacks race.
- Added cleanup that stops local tracks, closes the peer connection, clears active call state, and prevents stale resources after ending.
- Added fake-browser tests for legal/illegal transitions, microphone gating, offer/answer setup, data-channel creation, ICE forwarding, incoming review, one-time cleanup, and explicit accept behavior.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Observed: all four gates pass; 30 tests pass across 6 test files. The Phase 4 suite passes without a real network or microphone by using a fake `RTCPeerConnection` and `getUserMedia`, while exercising the controller's browser API calls and state transitions.

## Important implementation snippets

Microphone access is behind explicit user actions:

```ts
async startOutgoing() {
  move('prepare-outgoing');
  await requestMicrophone();
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  move('offer-sent');
  return offer;
}
```

Incoming offers stop at review and do not request media:

```ts
async receiveOffer(offer) {
  move('incoming-received');
  pendingOffer = offer;
  await ensureConnection().setRemoteDescription(offer);
  move('review-incoming');
}
```

Incoming ICE is also rejected before acceptance, so a remote offer cannot cause local candidate handling during review:

```ts
if (state !== 'outgoing-connecting' && state !== 'incoming-connecting' && state !== 'ice-connected') {
  throw new Error('ICE candidate not expected in current call state');
}
```

The data channel does not become a verified call by itself. A valid signed transcript must be produced and accepted first:

```ts
if (valid) move('finish-confirmed');
```

The state transition table rejects illegal call paths centrally:

```ts
export function transitionCall(state: CallState, event: CallEvent): CallState {
  const next = transitions[state][event];
  if (!next) throw new Error(`illegal call transition: ${state} -> ${event}`);
  return next;
}
```

## Acceptance checklist

- [x] State machine supports the planned outgoing and incoming paths, with ICE connectivity separated from verified call state.
- [x] Microphone is not requested while merely receiving/reviewing an offer.
- [x] No peer connection, remote description, or local ICE signaling is created before incoming-call acceptance.
- [x] Outgoing call creates a peer connection and ordered control data channel.
- [x] Offer, answer, and ICE signaling are exposed through caller-provided hooks.
- [x] One ICE restart is available after direct connection failure setup.
- [x] Ending stops local media and closes the peer connection.
- [ ] Real browser-to-browser direct audio and CALL_FINISH transcript verification remain the next integration step.
- [ ] Authenticated encrypt/sign/decrypt rendezvous wiring for SDP and the cross-browser matrix remain integration work.
- [ ] TURN and rendezvous integration remain later phases/features.