# Phase 4 Walkthrough

## Scope completed

- Added a pure legal-transition call state machine in `packages/webrtc` for outgoing and incoming call paths.
- Added a direct-first `RTCPeerConnection` controller with `iceTransportPolicy: "all"`, max-bundle, required RTCP mux, an ordered control data channel, remote track delivery, and caller-provided signaling hooks.
- Microphone access is requested only by explicit `startOutgoing()` or `acceptIncoming()` calls; receiving an offer only moves to incoming review.
- Added signed signaling integration points for offer, answer, and ICE exchange without implementing rendezvous wiring, TURN, or call encryption policy changes.
- Added one ICE restart attempt after the controller reaches outgoing connecting state.
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

The state transition table rejects illegal call paths centrally:

```ts
export function transitionCall(state: CallState, event: CallEvent): CallState {
  const next = transitions[state][event];
  if (!next) throw new Error(`illegal call transition: ${state} -> ${event}`);
  return next;
}
```

## Acceptance checklist

- [x] State machine supports the planned outgoing and incoming paths.
- [x] Microphone is not requested while merely receiving/reviewing an offer.
- [x] Outgoing call creates a peer connection and ordered control data channel.
- [x] Offer, answer, and ICE signaling are exposed through caller-provided hooks.
- [x] One ICE restart is available after direct connection failure setup.
- [x] Ending stops local media and closes the peer connection.
- [ ] Real browser-to-browser direct audio and CALL_FINISH transcript verification remain the next integration step.
- [ ] TURN and rendezvous integration remain later phases/features.