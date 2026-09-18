 
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createDirectCall } from '../packages/webrtc/src/index';
import { installBrowserFakes, FakePeerConnection } from './phase4.test';

function createMockCall(onSignal = vi.fn()) {
  return createDirectCall({
    localKeyId: 'alice',
    remoteKeyId: 'bob',
    onSignal,
    createFinishMessage: async () => 'FINISH',
    verifyFinishMessage: async () => true,
  });
}

describe('Phase 4 Slice 4: ICE Integration Only', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installBrowserFakes();
  });

  it('validates candidate limits and types', async () => {
    const call = createMockCall();
    
    // Too large candidate
    await expect(call.receiveIceCandidate({ signal: { candidate: 'a'.repeat(2049) } as unknown as RTCIceCandidateInit }))
      .rejects.toThrow('ICE candidate exceeds maximum allowed length');
      
    // Missing string candidate
    await expect(call.receiveIceCandidate({ signal: { candidate: 123 } as unknown as RTCIceCandidateInit }))
      .rejects.toThrow('Invalid ICE candidate payload');
      
    // Invalid sdpMid
    await expect(call.receiveIceCandidate({ signal: { candidate: 'fake', sdpMid: 123 } as unknown as RTCIceCandidateInit }))
      .rejects.toThrow('Invalid sdpMid');
      
    // Valid candidate passes
    await call.receiveOffer({ signal: { type: 'offer', sdp: 'offer' } });
    await expect(call.receiveIceCandidate({ signal: { candidate: 'valid', sdpMid: 'audio', sdpMLineIndex: 0 } })).resolves.not.toThrow();
  });

  it('buffers up to 64 candidates and drops the rest', async () => {
    const call = createMockCall();
    await call.receiveOffer({ signal: { type: 'offer', sdp: 'offer' } });
    
    // Send 70 candidates
    for (let i = 0; i < 70; i++) {
      await call.receiveIceCandidate({ signal: { candidate: `candidate-${i}` } });
    }
    
    const addIceCandidateSpy = vi.spyOn(FakePeerConnection.prototype, 'addIceCandidate');
    
    await call.acceptIncoming();
    
    // Should have flushed exactly 64
    expect(addIceCandidateSpy).toHaveBeenCalledTimes(64);
    expect(addIceCandidateSpy.mock.calls[0][0].candidate).toBe('candidate-0');
    expect(addIceCandidateSpy.mock.calls[63][0].candidate).toBe('candidate-63');
  });

  it('clears buffered candidates if terminated before acceptance', async () => {
    const call = createMockCall();
    await call.receiveOffer({ signal: { type: 'offer', sdp: 'offer' } });
    
    await call.receiveIceCandidate({ signal: { candidate: 'cand1' } });
    await call.receiveIceCandidate({ signal: { candidate: 'cand2' } });
    
    await call.end();
    
    const addIceCandidateSpy = vi.spyOn(FakePeerConnection.prototype, 'addIceCandidate');
    
    // acceptIncoming should fail since offer is cleared on end
    await expect(call.acceptIncoming()).rejects.toThrow('no incoming offer to accept');
    
    // No candidates should be added
    expect(addIceCandidateSpy).not.toHaveBeenCalled();
  });

  it('ignores candidates if ended or ending', async () => {
    const call = createMockCall();
    await call.receiveOffer({ signal: { type: 'offer', sdp: 'offer' } });
    await call.end();
    
    // Should resolve immediately without error or buffering
    await expect(call.receiveIceCandidate({ signal: { candidate: 'cand' } })).resolves.not.toThrow();
  });

  it('handles null candidate gracefully without error or buffering', async () => {
    const call = createMockCall();
    await call.receiveOffer({ signal: { type: 'offer', sdp: 'offer' } });
    
    await expect(call.receiveIceCandidate({ signal: null as unknown as RTCIceCandidateInit })).resolves.not.toThrow();
  });
  
  it('flushes candidates wrapped in catch after setRemoteDescription', async () => {
    const call = createMockCall();
    await call.receiveOffer({ signal: { type: 'offer', sdp: 'offer' } });
    
    await call.receiveIceCandidate({ signal: { candidate: 'cand1' } });
    await call.receiveIceCandidate({ signal: { candidate: 'cand2' } });
    await call.receiveIceCandidate({ signal: { candidate: 'cand3' } });
    
    let addCallCount = 0;
    
    vi.spyOn(FakePeerConnection.prototype, 'setRemoteDescription').mockImplementation(async () => {
      // At this point, addIceCandidate should NOT have been called yet
      expect(addCallCount).toBe(0);
    });
    
    vi.spyOn(FakePeerConnection.prototype, 'addIceCandidate').mockImplementation(async (cand: RTCIceCandidateInit) => {
      addCallCount++;
      if (cand.candidate === 'cand2') throw new Error('Bad candidate');
    });
    
    await call.acceptIncoming();
    
    // All 3 should be processed despite cand2 throwing an error (isolated by catch)
    expect(addCallCount).toBe(3);
  });
});
