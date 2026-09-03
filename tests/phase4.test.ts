import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDirectCall, transitionCall } from '../packages/webrtc/src/index';

class FakeTrack { stopped = false; stop() { this.stopped = true; } }
class FakeStream {
  readonly track = new FakeTrack();
  getAudioTracks() { return [this.track]; }
  getTracks() { return [this.track]; }
}

class FakePeerConnection {
  connectionState = 'new';
  onicecandidate: ((event: { candidate?: { toJSON: () => RTCIceCandidateInit } }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  readonly dataChannel = { readyState: 'open', onopen: null as (() => void) | null, onmessage: null as ((event: { data: unknown }) => void) | null, sent: [] as string[], send: (message: string) => { this.dataChannel.sent.push(message); } };
  readonly addedCandidates: RTCIceCandidateInit[] = [];
  readonly localDescriptions: RTCSessionDescriptionInit[] = [];
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
}

const originalPeerConnection = globalThis.RTCPeerConnection;
const originalMediaDevices = navigator.mediaDevices;
const fakePeers: FakePeerConnection[] = [];

function installBrowserFakes() {
  globalThis.RTCPeerConnection = class extends FakePeerConnection {
    constructor() { super(); fakePeers.push(this); }
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
    const outgoing = createDirectCall({ onSignal: async (signal) => { signals.push(signal); } });
    expect(getUserMedia).not.toHaveBeenCalled();
    const offer = await outgoing.startOutgoing();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(offer.type).toBe('offer');
    expect(outgoing.state).toBe('outgoing-rendezvous');
    expect(fakePeers[0].dataChannel).toBeDefined();
    fakePeers[0].onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'candidate:generated' }) } });
    expect(signals).toEqual([{ candidate: 'candidate:generated' }]);

    await outgoing.receiveAnswer({ type: 'answer', sdp: 'answer' });
    expect(outgoing.state).toBe('outgoing-connecting');
    await outgoing.receiveIceCandidate({ candidate: 'candidate:1' });
    expect(fakePeers[0].addedCandidates).toEqual([{ candidate: 'candidate:1' }]);
    await outgoing.end();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(fakePeers[0].closed).toBe(true);

    const incoming = createDirectCall({ onSignal: async (signal) => { signals.push(signal); } });
    await incoming.receiveOffer({ type: 'offer', sdp: 'offer' });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(fakePeers).toHaveLength(1);
    expect(incoming.state).toBe('incoming-review');
    await expect(incoming.receiveIceCandidate({ candidate: 'early-candidate' })).rejects.toThrow('not expected');
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
      createFinishMessage: async () => 'signed-finish',
      verifyFinishMessage: async (message) => message === 'signed-finish',
    });
    await call.startOutgoing();
    await call.receiveAnswer({ type: 'answer', sdp: 'answer' });
    fakePeers[0].connectionState = 'connected';
    fakePeers[0].onconnectionstatechange?.();
    expect(call.state).toBe('ice-connected');
    fakePeers[0].dataChannel.onopen?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakePeers[0].dataChannel.sent).toEqual(['signed-finish']);
    fakePeers[0].dataChannel.onmessage?.({ data: 'not-signed' });
    expect(call.state).toBe('ice-connected');
    fakePeers[0].dataChannel.onmessage?.({ data: 'signed-finish' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(call.state).toBe('connected');
  });
});
