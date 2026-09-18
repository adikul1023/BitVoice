 
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createDirectCall, CallFinishChallenge, CallFinish } from '../packages/webrtc/src/index';
import { installBrowserFakes, FakePeerConnection, FakeDataChannel } from './phase4.test';

function createMockCall(configOpts: unknown = {}) {
  return createDirectCall({
    localKeyId: 'alice',
    remoteKeyId: 'bob',
    onSignal: vi.fn(),
    createChallenge: async () => ({ type: 'CALL_FINISH_CHALLENGE', challenge: 'local-challenge' }),
    createFinish: async () => ({ type: 'CALL_FINISH', signature: 'local-signature' }),
    verifyFinish: async () => true,
    ...configOpts
  });
}

describe('Phase 4 Slice 5: CALL_FINISH DataChannel Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
    installBrowserFakes();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const getChannel = (call: unknown): FakeDataChannel => (call.peerConnection as unknown).dataChannel;
  const setConnected = (call: unknown) => {
    const pc = call.peerConnection as unknown;
    pc.connectionState = 'connected';
    pc.onconnectionstatechange();
  };

  it('generates challenge and transitions to connected on valid handshake', async () => {
    const call = createMockCall();
    await call.startOutgoing();
    await call.receiveAnswer({ signal: { type: 'answer', sdp: 'answer' } });
    
    // Simulate connection establishing
    setConnected(call);
    expect(call.state).toBe('ice-connected');
    
    // Open DataChannel
    const channel = getChannel(call);
    const sendSpy = vi.spyOn(channel, 'send');
    channel.onopen();
    
    // Should send challenge
    await Promise.resolve(); // wait for async
    expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'CALL_FINISH_CHALLENGE', challenge: 'local-challenge' }));
    
    // Receive remote challenge
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH_CHALLENGE', challenge: 'remote-challenge' }) } as unknown);
    await Promise.resolve(); // wait for createFinish
    expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'CALL_FINISH', signature: 'local-signature' }));
    
    // Receive remote finish
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH', signature: 'remote-signature' }) } as unknown);
    await Promise.resolve(); // wait for verifyFinish
    
    expect(call.state).toBe('connected');
  });

  it('timeouts and transitions to connection-failed if no valid finish received', async () => {
    const call = createMockCall();
    await call.startOutgoing();
    await call.receiveAnswer({ signal: { type: 'answer', sdp: 'answer' } });
    
    setConnected(call);
    expect(call.state).toBe('ice-connected');
    
    // Wait 10 seconds (no datachannel open or finish received)
    vi.advanceTimersByTime(10000);
    
    expect(call.state).toBe('ending'); // move('connection-failed') causes ending
  });

  it('cancels timeout if handshake completes in time', async () => {
    const call = createMockCall();
    await call.startOutgoing();
    await call.receiveAnswer({ signal: { type: 'answer', sdp: 'answer' } });
    
    setConnected(call);
    expect(call.state).toBe('ice-connected');
    
    // Wait 9 seconds
    vi.advanceTimersByTime(9000);
    
    const channel = getChannel(call);
    channel.onopen();
    await Promise.resolve();
    
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH_CHALLENGE', challenge: 'remote-challenge' }) } as unknown);
    await Promise.resolve();
    
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH', signature: 'remote-signature' }) } as unknown);
    await Promise.resolve();
    
    expect(call.state).toBe('connected');
    
    // Advance past 10 seconds, should not fail
    vi.advanceTimersByTime(2000);
    expect(call.state).toBe('connected');
  });

  it('safely ignores duplicates and late messages after termination', async () => {
    const call = createMockCall();
    await call.startOutgoing();
    await call.receiveAnswer({ signal: { type: 'answer', sdp: 'answer' } });
    setConnected(call);
    
    const channel = getChannel(call);
    channel.onopen();
    await Promise.resolve();
    
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH_CHALLENGE', challenge: 'remote-challenge' }) } as unknown);
    await Promise.resolve();
    
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH', signature: 'remote-signature' }) } as unknown);
    await Promise.resolve();
    
    expect(call.state).toBe('connected');
    
    const sendSpy = vi.spyOn(channel, 'send');
    
    // Duplicate challenge should not send finish again
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH_CHALLENGE', challenge: 'remote-challenge' }) } as unknown);
    await Promise.resolve();
    expect(sendSpy).not.toHaveBeenCalled();
    
    // End call
    await call.end();
    expect(call.state).toBe('ended');
    
    // Late message should not resurrect
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH_CHALLENGE', challenge: 'remote-challenge' }) } as unknown);
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH', signature: 'remote-signature' }) } as unknown);
    await Promise.resolve();
    expect(call.state).toBe('ended');
  });

  it('rejects invalid signature or wrong challenge', async () => {
    const verifyFinish = vi.fn().mockResolvedValue(false);
    const call = createMockCall({ verifyFinish });
    await call.startOutgoing();
    await call.receiveAnswer({ signal: { type: 'answer', sdp: 'answer' } });
    setConnected(call);
    
    const channel = getChannel(call);
    channel.onopen();
    await Promise.resolve();
    
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH', signature: 'bad-signature' }) } as unknown);
    await Promise.resolve();
    
    // Verify was called but failed
    expect(verifyFinish).toHaveBeenCalled();
    expect(call.state).toBe('ice-connected'); // remains unconnected
  });

  it('supports simultaneous challenges without dropping', async () => {
    const call = createMockCall();
    await call.startOutgoing();
    await call.receiveAnswer({ signal: { type: 'answer', sdp: 'answer' } });
    setConnected(call);
    
    const channel = getChannel(call);
    
    // Remote sends challenge before our onopen completes
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH_CHALLENGE', challenge: 'remote-challenge' }) } as unknown);
    
    // Our channel opens, we send challenge
    channel.onopen();
    await Promise.resolve(); // Wait for microtasks
    
    channel.onmessage({ data: JSON.stringify({ type: 'CALL_FINISH', signature: 'remote-signature' }) } as unknown);
    await Promise.resolve();
    
    expect(call.state).toBe('connected');
  });
});
