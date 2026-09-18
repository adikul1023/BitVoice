 
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDirectCall, transitionCall } from '../packages/webrtc/src/index';

class FakeTrack { stopped = false; stop() { this.stopped = true; } }
class FakeStream {
  readonly track = new FakeTrack();
  getAudioTracks() { return [this.track]; }
  getTracks() { return [this.track]; }
}

export class FakePeerConnection {
  config: RTCConfiguration;
  constructor(config?: RTCConfiguration) { this.config = config || {}; }
  connectionState = 'new';
  onicecandidate: ((event: { candidate?: { toJSON: () => RTCIceCandidateInit } }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  readonly dataChannel = { label: 'securevoice-control', readyState: 'open', onopen: null as (() => void) | null, onmessage: null as ((event: { data: unknown }) => void) | null, sent: [] as string[], send: function(message: string) { this.sent.push(message); } };
  readonly addedCandidates: RTCIceCandidateInit[] = [];
  readonly localDescriptions: RTCSessionDescriptionInit[] = [];
  get localDescription() { return this.localDescriptions[this.localDescriptions.length - 1]; }
  remoteDescription?: RTCSessionDescriptionInit;
  closed = false;
  createDataChannel() { return this.dataChannel; }
  addTrack() { return undefined; }
  async createOffer() { return { type: 'offer' as const, sdp: 'offer' }; }
  async createAnswer() { return { type: 'answer' as const, sdp: 'answer' }; }
  async setLocalDescription(description: RTCSessionDescriptionInit) { this.localDescriptions.push(description); }
  async setRemoteDescription(description: RTCSessionDescriptionInit) { this.remoteDescription = description; }
  async addIceCandidate(candidate: RTCIceCandidateInit) { this.addedCandidates.push(candidate); }
  close() { this.closed = true; }
  _connect() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }
}

const originalPeerConnection = globalThis.RTCPeerConnection;
const originalMediaDevices = navigator.mediaDevices;
const fakePeers: FakePeerConnection[] = [];

export function installBrowserFakes() {
  globalThis.RTCPeerConnection = class extends FakePeerConnection {
    constructor(config?: RTCConfiguration) { super(config); fakePeers.push(this); }
  } as unknown as typeof RTCPeerConnection;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => new FakeStream()) } });
}

afterEach(() => {
  globalThis.RTCPeerConnection = originalPeerConnection;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
  fakePeers.length = 0;
  vi.restoreAllMocks();
});

describe('Phase 4 call state machine', () => {
  it('allows the planned outgoing and incoming paths and rejects illegal transitions', () => {
    expect(transitionCall('idle', 'prepare-outgoing')).toBe('outgoing-preparing');
    expect(transitionCall('outgoing-preparing', 'offer-sent')).toBe('outgoing-rendezvous');
    expect(transitionCall('outgoing-rendezvous', 'offer-accepted')).toBe('outgoing-connecting');
    expect(transitionCall('outgoing-connecting', 'connection-established')).toBe('ice-connected');
    expect(transitionCall('ice-connected', 'finish-confirmed')).toBe('connected');
    expect(transitionCall('idle', 'incoming-received')).toBe('incoming-offer');
    expect(transitionCall('incoming-offer', 'review-incoming')).toBe('incoming-review');
    expect(transitionCall('incoming-review', 'accept-incoming')).toBe('incoming-accepted');
    expect(() => transitionCall('idle', 'connection-established')).toThrow('illegal call transition');
  });

  it('requests the microphone only when an explicit call or accept action runs', async () => {
    installBrowserFakes();
    const getUserMedia = navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
    const signals: unknown[] = [];
    const outgoing = createDirectCall({ onSignal: async (payload) => { signals.push(payload.signal); } });
    expect(getUserMedia).not.toHaveBeenCalled();
    const offer = await outgoing.startOutgoing();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(offer.type).toBe('offer');
    expect(outgoing.state).toBe('outgoing-rendezvous');
    expect(fakePeers[0].dataChannel).toBeDefined();
    fakePeers[0].onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'candidate:generated' }) } });
    expect(signals).toEqual([offer, { candidate: 'candidate:generated' }]);

    await outgoing.receiveAnswer({ signal: { type: 'answer', sdp: 'answer' } });
    expect(outgoing.state).toBe('outgoing-connecting');
    await outgoing.receiveIceCandidate({ signal: { candidate: 'candidate:1' } });
    expect(fakePeers[0].addedCandidates).toEqual([{ candidate: 'candidate:1' }]);
    await outgoing.end();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(fakePeers[0].closed).toBe(true);

    const incoming = createDirectCall({ onSignal: async (payload) => { signals.push(payload.signal); } });
    await incoming.receiveOffer({ signal: { type: 'offer', sdp: 'offer' } });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(fakePeers).toHaveLength(1);
    expect(incoming.state).toBe('incoming-review');
    await expect(incoming.receiveIceCandidate({ signal: { candidate: 'early-candidate' } })).resolves.toBeUndefined();
    expect(fakePeers).toHaveLength(1);
    await incoming.acceptIncoming();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(incoming.state).toBe('incoming-connecting');
    expect(fakePeers[1].remoteDescription).toEqual({ type: 'offer', sdp: 'offer' });
  });

  it('does not report verified until the signed finish transcript is confirmed', async () => {
    installBrowserFakes();
    const call = createDirectCall({
      onSignal: async () => undefined,
      createChallenge: async () => ({ type: 'CALL_FINISH_CHALLENGE', challenge: 'local-challenge' }),
      createFinish: async () => ({ type: 'CALL_FINISH', signature: 'signed-finish' }),
      verifyFinish: async (message) => message.signature === 'signed-finish',
    });
    await call.startOutgoing();
    await call.receiveAnswer({ signal: { type: 'answer', sdp: 'answer' } });
    fakePeers[0].connectionState = 'connected';
    fakePeers[0].onconnectionstatechange?.();
    expect(call.state).toBe('ice-connected');
    fakePeers[0].dataChannel.onopen?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakePeers[0].dataChannel.sent).toEqual([JSON.stringify({ type: 'CALL_FINISH_CHALLENGE', challenge: 'local-challenge' })]);
    
    // Remote sends challenge
    fakePeers[0].dataChannel.onmessage?.({ data: JSON.stringify({ type: 'CALL_FINISH_CHALLENGE', challenge: 'remote-challenge' }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakePeers[0].dataChannel.sent[1]).toEqual(JSON.stringify({ type: 'CALL_FINISH', signature: 'signed-finish' }));
    
    fakePeers[0].dataChannel.onmessage?.({ data: JSON.stringify({ type: 'CALL_FINISH', signature: 'not-signed' }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(call.state).toBe('ice-connected');
    
    fakePeers[0].dataChannel.onmessage?.({ data: JSON.stringify({ type: 'CALL_FINISH', signature: 'signed-finish' }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(call.state).toBe('connected');
  });

  it('enforces PrivacyMode relay and prevents downgrades', async () => {
    installBrowserFakes();
    
    // Caller is relay-only
    const caller = createDirectCall({
      privacyMode: 'private-relay-only',
      turnProvider: async () => [],
      onSignal: async () => undefined,
    });
    await caller.startOutgoing();
    
    // Check that iceTransportPolicy is set to relay
    expect(fakePeers[0].config.iceTransportPolicy).toBe('relay');
    
    // Receiver is direct-preferred (default)
    const receiver = createDirectCall({
      onSignal: async () => undefined,
    });
    
    // Caller's offer should specify private-relay-only
    const payload = { signal: { type: 'offer', sdp: 'fake' } as RTCSessionDescriptionInit, privacyMode: 'private-relay-only' as const };
    
    // Receiver should reject the offer because it's direct-preferred
    await expect(receiver.receiveOffer(payload)).rejects.toThrow('Peer requested private-relay-only mode');
    
    // Caller receives an answer from someone who didn't respect privacyMode (just in case they hacked it)
    await expect(caller.receiveAnswer({ signal: { type: 'answer', sdp: 'fake' }, privacyMode: 'direct-preferred' })).rejects.toThrow('Local requires private-relay-only mode');
  });
});
