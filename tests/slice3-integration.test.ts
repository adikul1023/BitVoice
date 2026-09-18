 
import { describe, expect, it, vi } from 'vitest';
import { createDirectCall, SignalPayload } from '../packages/webrtc/src/index';
import { createAuthenticatedSignaling, RendezvousClient } from '../packages/webrtc/src/signaling';
import { ReplayGuard, encodeBase64Url } from '../packages/protocol/src/index';
import { webcrypto } from 'node:crypto';
import { installBrowserFakes } from './phase4.test';

function randomId(size: number): string {
  return encodeBase64Url(webcrypto.getRandomValues(new Uint8Array(size)));
}

describe('Phase 4 Slice 3: Authenticated Answer Path Only', () => {
  it('implements authenticated answer flow safely without racing', async () => {
    installBrowserFakes();
    const subtle = webcrypto.subtle;
    
    // Setup identities
    const aliceSigning = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair;
    const aliceKeyId = randomId(16);
    
    const bobSigning = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair;
    const bobKeyId = randomId(16);

    const aliceStatic = await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
    const bobStatic = await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
    
    const aliceEph = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
    const aliceEphRawBase64 = encodeBase64Url(new Uint8Array(await subtle.exportKey('raw', aliceEph.publicKey)));

    const bobEph = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
    const bobEphRawBase64 = encodeBase64Url(new Uint8Array(await subtle.exportKey('raw', bobEph.publicKey)));

    const mailboxes = new Map<string, unknown[]>();
    const mockRendezvous: RendezvousClient = {
      put: async (m, msg) => { const ms = mailboxes.get(m) || []; ms.push(msg); mailboxes.set(m, ms); },
      get: async (m) => mailboxes.get(m) || [],
      ack: async (m, id) => { const ms = mailboxes.get(m) || []; mailboxes.set(m, ms.filter(x => x.messageId !== id)); },
    };

    const aliceSignaling = createAuthenticatedSignaling({
      mailboxId: 'alice-mailbox', senderKeyId: aliceKeyId, recipientKeyId: bobKeyId,
      signingPrivateKey: aliceSigning.privateKey, resolveSenderKey: async (k) => k === bobKeyId ? bobSigning.publicKey : undefined,
      rendezvous: { put: async (m, msg) => mockRendezvous.put('bob-mailbox', msg), get: async () => mailboxes.get('alice-mailbox') || [], ack: async (m, id) => mockRendezvous.ack('alice-mailbox', id) },
      replayGuard: new ReplayGuard(), now: Date.now, role: 'caller',
      localStaticAgreementPrivateKey: aliceStatic.privateKey, remoteStaticAgreementPublicKey: bobStatic.publicKey,
      localEphemeralKeyPair: aliceEph, localEphemeralPublicKeyRawBase64: aliceEphRawBase64
    });

    const bobSignaling = createAuthenticatedSignaling({
      mailboxId: 'bob-mailbox', senderKeyId: bobKeyId, recipientKeyId: aliceKeyId,
      signingPrivateKey: bobSigning.privateKey, resolveSenderKey: async (k) => k === aliceKeyId ? aliceSigning.publicKey : undefined,
      rendezvous: { put: async (m, msg) => mockRendezvous.put('alice-mailbox', msg), get: async () => mailboxes.get('bob-mailbox') || [], ack: async (m, id) => mockRendezvous.ack('bob-mailbox', id) },
      replayGuard: new ReplayGuard(), now: Date.now, role: 'recipient',
      localStaticAgreementPrivateKey: bobStatic.privateKey, remoteStaticAgreementPublicKey: aliceStatic.publicKey,
      localEphemeralKeyPair: bobEph, localEphemeralPublicKeyRawBase64: bobEphRawBase64
    });

    let bobOnSignalCount = 0;
    const bob = createDirectCall({
      localKeyId: bobKeyId, remoteKeyId: aliceKeyId,
      onSignal: async (payload) => {
        bobOnSignalCount++;
        if ('type' in payload.signal && payload.signal.type === 'answer') {
          await bobSignaling.send(payload);
        }
      },
      createFinishMessage: async () => 'BOB_FINISH',
      verifyFinishMessage: async () => true,
    });

    // 8. Calling acceptIncoming() without a pending offer fails safely
    await expect(bob.acceptIncoming()).rejects.toThrow('no incoming offer to accept');

    // Alice sends an offer
    await aliceSignaling.send({ signal: { type: 'offer', sdp: 'alice-offer-sdp' } });

    // Bob's adapter receives the offer
    await bobSignaling.receive(async (payload) => {
      if (payload.signal && 'type' in payload.signal && payload.signal.type === 'offer') {
        if (bob.state === 'idle') {
          await bob.receiveOffer(payload as SignalPayload);
        }
      }
    });

    expect(bob.state).toBe('incoming-review');
    
    // 3. The cached pendingOffer becomes the remote description
    expect(bob.pendingOffer).toBeDefined();
    expect(bob.pendingOffer!.sdp).toBe('alice-offer-sdp');
    expect(bob.peerConnection).toBeUndefined();

    // Setup spies for peer connection behaviors
    const FakePeerConnection = (globalThis as unknown as { RTCPeerConnection: typeof RTCPeerConnection }).RTCPeerConnection;
    const originalSetRemote = FakePeerConnection.prototype.setRemoteDescription;
    const originalSetLocal = FakePeerConnection.prototype.setLocalDescription;
    const originalCreateAnswer = FakePeerConnection.prototype.createAnswer;
    const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia');
    
    let remoteDescriptionSet = false;
    let localDescriptionSet = false;
    let answerCreated = false;
    
    FakePeerConnection.prototype.setRemoteDescription = vi.fn(async function(this: RTCPeerConnection, desc) {
      remoteDescriptionSet = true;
      return originalSetRemote.call(this, desc);
    });
    FakePeerConnection.prototype.setLocalDescription = vi.fn(async function(this: RTCPeerConnection, desc) {
      localDescriptionSet = true;
      return originalSetLocal.call(this, desc);
    });
    FakePeerConnection.prototype.createAnswer = vi.fn(async function(this: RTCPeerConnection) {
      answerCreated = true;
      return originalCreateAnswer.call(this);
    });

    // 4, 9. Calling acceptIncoming() twice cannot create two peers or send two answers
    // 10. Invalid state transitions remain rejected.
    const first = bob.acceptIncoming();
    const second = bob.acceptIncoming();

    const results = await Promise.allSettled([first, second]);
    
    // One should fulfill, one should reject
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    
    expect(fulfilled.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('no incoming offer to accept');
    
    // 5. Pending offer is consumed
    expect(bob.pendingOffer).toBeUndefined();
    await expect(bob.acceptIncoming()).rejects.toThrow('no incoming offer to accept');

    // 1. exactly one RTCPeerConnection (tested indirectly by ensuring only one acceptIncoming succeeds, and PC exists)
    expect(bob.peerConnection).toBeDefined();
    expect(bob.state).toBe('incoming-connecting');
    
    // 2. Microphone permission is requested only after explicit acceptance
    expect(getUserMediaSpy).toHaveBeenCalledTimes(1);
    
    // Assert specific WebRTC sequence happened
    expect(remoteDescriptionSet).toBe(true);
    expect(answerCreated).toBe(true);
    expect(localDescriptionSet).toBe(true);
    
    // 5. Exactly one answer reaches onSignal
    expect(bobOnSignalCount).toBe(1);
    
    // 6. The answer is passed through AuthenticatedSignaling.send() and becomes an encrypted rendezvous message
    const aliceMailbox = mailboxes.get('alice-mailbox') || [];
    expect(aliceMailbox.length).toBe(1);
    
    const aliceReceivedEnvelope = aliceMailbox[0];
    
    // 7. Raw SDP is not present in the rendezvous payload
    expect(JSON.stringify(aliceReceivedEnvelope)).not.toContain('fake-answer-sdp');
    
    // Let Alice receive it to prove it's a valid answer
    const aliceReceivedAnswers: RTCSessionDescriptionInit[] = [];
    await aliceSignaling.receive(async (payload) => {
      if (payload.signal && 'type' in payload.signal && payload.signal.type === 'answer') {
        aliceReceivedAnswers.push(payload.signal);
      }
    });
    
    expect(aliceReceivedAnswers.length).toBe(1);
    expect(aliceReceivedAnswers[0].type).toBe('answer');

    // Cleanup
    FakePeerConnection.prototype.setRemoteDescription = originalSetRemote;
    FakePeerConnection.prototype.setLocalDescription = originalSetLocal;
    FakePeerConnection.prototype.createAnswer = originalCreateAnswer;
    getUserMediaSpy.mockRestore();
  });
  
  it('does not emit an answer if WebRTC steps fail', async () => {
    installBrowserFakes();
    const bobOnSignalSpy = vi.fn();
    const bob = createDirectCall({
      localKeyId: 'bob', remoteKeyId: 'alice',
      onSignal: bobOnSignalSpy,
      createFinishMessage: async () => 'BOB_FINISH',
      verifyFinishMessage: async () => true,
    });
    
    // Mock Bob to have received an offer
    await bob.receiveOffer({ signal: { type: 'offer', sdp: 'test' } });
    
    // 3. Failure must not emit an answer
    const getUserMediaSpy = vi.spyOn(navigator.mediaDevices, 'getUserMedia');
    getUserMediaSpy.mockRejectedValueOnce(new Error('Permission denied'));
    
    await expect(bob.acceptIncoming()).rejects.toThrow('Permission denied');
    
    // Ensure zero onSignal calls
    expect(bobOnSignalSpy).not.toHaveBeenCalled();
    
    // State is left broken, pendingOffer is cleared (preventing retries)
    expect(bob.pendingOffer).toBeUndefined();
    
    // 4. Assert cleanup
    expect(bob.peerConnection).toBeUndefined();
    expect(bob.state).toBe('ended'); // end() transitions to ended
    
    getUserMediaSpy.mockRestore();
  });
});
