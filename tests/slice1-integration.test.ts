import { describe, expect, it, vi } from 'vitest';
import { createDirectCall } from '../packages/webrtc/src/index';
import { createAuthenticatedSignaling, RendezvousClient } from '../packages/webrtc/src/signaling';
import { ReplayGuard, encodeBase64Url } from '../packages/protocol/src/index';
import { webcrypto } from 'node:crypto';
import { installBrowserFakes } from './phase4.test';

function randomId(size: number): string {
  return encodeBase64Url(webcrypto.getRandomValues(new Uint8Array(size)));
}

describe('Phase 4 Slice 1: Authenticated Offer Path Only', () => {
  it('startOutgoing produces exactly one encrypted mailbox PUT without leaking SDP', async () => {
    installBrowserFakes();
    const subtle = webcrypto.subtle;
    
    // Setup cryptographic identities
    const aliceSigning = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair;
    const aliceKeyId = randomId(16);
    
    const bobSigning = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']) as CryptoKeyPair;
    const bobKeyId = randomId(16);

    const aliceStatic = await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
    const bobStatic = await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
    
    const aliceEph = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
    const aliceEphRawBase64 = encodeBase64Url(new Uint8Array(await subtle.exportKey('raw', aliceEph.publicKey)));

    // Mock rendezvous transport
    const mockRendezvous: RendezvousClient = {
      put: vi.fn(async () => {}),
      get: vi.fn(async () => []),
      ack: vi.fn(async () => {}),
    };

    const resolveKey = async (keyId: string) => keyId === bobKeyId ? bobSigning.publicKey : undefined;

    // Create Authenticated Signaling Bridge
    const aliceSignaling = createAuthenticatedSignaling({
      mailboxId: 'alice-mailbox',
      senderKeyId: aliceKeyId,
      recipientKeyId: bobKeyId,
      signingPrivateKey: aliceSigning.privateKey,
      resolveSenderKey: resolveKey,
      rendezvous: mockRendezvous, // Using the mocked rendezvous here
      replayGuard: new ReplayGuard(),
      now: Date.now,
      role: 'caller',
      localStaticAgreementPrivateKey: aliceStatic.privateKey,
      remoteStaticAgreementPublicKey: bobStatic.publicKey,
      localEphemeralKeyPair: aliceEph,
      localEphemeralPublicKeyRawBase64: aliceEphRawBase64
    });

    // Wire WebRTC Controller
    let iceCandidateCount = 0;
    let offerSignalCount = 0;
    const alice = createDirectCall({
      localKeyId: aliceKeyId,
      remoteKeyId: bobKeyId,
      onSignal: async (payload) => {
        if ('type' in payload.signal && payload.signal.type === 'offer') {
          offerSignalCount++;
          // Wrap with the bridge
          await aliceSignaling.send(payload);
        } else if ('candidate' in payload.signal) {
          iceCandidateCount++;
        }
      },
    });

    // Action: Start Outgoing
    await alice.startOutgoing();
    
    // Verification:
    
    // 1. Local description is set
    expect(alice.peerConnection?.localDescription).toBeDefined();
    expect(alice.peerConnection?.localDescription?.type).toBe('offer');

    // 2. Exactly one mailbox PUT occurred (the offer)
    expect(offerSignalCount).toBe(1);
    expect(mockRendezvous.put).toHaveBeenCalledTimes(1);

    // 3. The payload is opaque ciphertext and contains no SDP strings
    const putCall = vi.mocked(mockRendezvous.put).mock.calls[0];
    const storedMessage = putCall[1];
    
    expect(storedMessage.messageId).toBeDefined();
    expect(storedMessage.ciphertext).toBeDefined();
    
    const ciphertextStr = storedMessage.ciphertext;
    expect(ciphertextStr).not.toContain('v=0');
    expect(ciphertextStr).not.toContain('a=candidate');
    
    const envelope = JSON.parse(ciphertextStr);
    expect(envelope.header.type).toBe('call-offer');
    expect(envelope.ciphertext).toBeDefined();

    // 4. ICE candidates are generated but dropped by our adapter (not sent to bridge yet)
    // Wait a tick for candidates
    (alice.peerConnection as any).onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'fake-ice' }) } });
    await new Promise(r => setTimeout(r, 0));
    expect(iceCandidateCount).toBe(1);
    expect(mockRendezvous.put).toHaveBeenCalledTimes(1); // Still exactly 1 PUT (the offer)

    // 5. Corrupting ciphertext breaks it
    envelope.ciphertext = envelope.ciphertext.slice(0, -1) + (envelope.ciphertext.endsWith('A') ? 'B' : 'A');
    storedMessage.ciphertext = JSON.stringify(envelope);
    
    const bobSignaling = createAuthenticatedSignaling({
      mailboxId: 'bob-mailbox',
      senderKeyId: bobKeyId,
      recipientKeyId: aliceKeyId,
      signingPrivateKey: bobSigning.privateKey,
      resolveSenderKey: async (k) => k === aliceKeyId ? aliceSigning.publicKey : undefined,
      rendezvous: {
        put: vi.fn(async () => {}),
        get: vi.fn(async () => [storedMessage]),
        ack: vi.fn(async () => {})
      },
      replayGuard: new ReplayGuard(),
      now: Date.now,
      role: 'recipient',
      localStaticAgreementPrivateKey: bobStatic.privateKey,
      remoteStaticAgreementPublicKey: aliceStatic.publicKey,
      localEphemeralKeyPair: await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair,
      localEphemeralPublicKeyRawBase64: 'fake'
    });

    await expect(bobSignaling.receive(async () => {})).rejects.toThrow(/invalid (envelope )?(signature|ciphertext)/);
  });
});
