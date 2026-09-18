 
import { describe, expect, it } from 'vitest';
import { transitionCall, CallState, CallEvent } from '../packages/webrtc/src/index';

describe('Call State Machine Validation', () => {
  it('enforces strictly defined state transitions', () => {
    const allStates: CallState[] = [
      'idle', 'outgoing-preparing', 'outgoing-rendezvous', 'outgoing-connecting',
      'ice-connected', 'incoming-offer', 'incoming-review', 'incoming-accepted',
      'incoming-connecting', 'connected', 'ending', 'ended'
    ];

    const allEvents: CallEvent[] = [
      'prepare-outgoing', 'offer-sent', 'offer-accepted', 'incoming-received',
      'review-incoming', 'accept-incoming', 'connection-established',
      'finish-confirmed', 'connection-failed', 'end', 'cleanup'
    ];

    // Map of expected valid transitions
    const expected: Record<CallState, Partial<Record<CallEvent, CallState>>> = {
      idle: { 'prepare-outgoing': 'outgoing-preparing', 'incoming-received': 'incoming-offer' },
      'outgoing-preparing': { 'offer-sent': 'outgoing-rendezvous', end: 'ending' },
      'outgoing-rendezvous': { 'offer-accepted': 'outgoing-connecting', 'incoming-received': 'incoming-offer', end: 'ending' },
      'outgoing-connecting': { 'connection-established': 'ice-connected', 'connection-failed': 'ending', end: 'ending' },
      'incoming-offer': { 'review-incoming': 'incoming-review', end: 'ending' },
      'incoming-review': { 'accept-incoming': 'incoming-accepted', end: 'ending' },
      'incoming-accepted': { 'offer-sent': 'incoming-connecting', end: 'ending' },
      'incoming-connecting': { 'connection-established': 'ice-connected', 'connection-failed': 'ending', end: 'ending' },
      'ice-connected': { 'finish-confirmed': 'connected', 'connection-failed': 'ending', end: 'ending' },
      connected: { end: 'ending' },
      ending: { cleanup: 'ended' },
      ended: {},
    };

    let validCount = 0;
    let invalidCount = 0;

    for (const state of allStates) {
      for (const event of allEvents) {
        const nextState = expected[state][event];
        if (nextState) {
          expect(transitionCall(state, event)).toBe(nextState);
          validCount++;
        } else {
          expect(() => transitionCall(state, event)).toThrow('illegal call transition');
          invalidCount++;
        }
      }
    }

    // Ensure we tested all combinations
    expect(validCount + invalidCount).toBe(allStates.length * allEvents.length);
  });
});
