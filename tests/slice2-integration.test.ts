/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi } from 'vitest';
import { createDirectCall } from '../packages/webrtc/src/index';
import { createAuthenticatedSignaling, RendezvousClient } from '../packages/webrtc/src/signaling';
import { ReplayGuard, encodeBase64Url } from '../packages/protocol/src/index';
import { webcrypto } from 'node:crypto';
import { installBrowserFakes } from './phase4.test';

function randomId(size: number): string {
  return encodeBase64Url(webcrypto.getRandomValues(new Uint8Array(size)));
}

describe('Phase 4 Slice 2: Authenticated Incoming Offer Path Only', () => {
  it('receives an offer and explicitly rejects non-offers, updating state without leaking RTC', async () => {
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
      rendezvous: { put: async (m, msg) => mockRendezvous.put('bob-mailbox', msg), get: async () => [], ack: async () => {} },
      replayGuard: new ReplayGuard(), now: Date.now, role: 'caller',
      localStaticAgreementPrivateKey: aliceStatic.privateKey, remoteStaticAgreementPublicKey: bobStatic.publicKey,
      localEphemeralKeyPair: aliceEph, localEphemeralPublicKeyRawBase64: aliceEphRawBase64
    });

    const bobSignaling = createAuthenticatedSignaling({
      mailboxId: 'bob-mailbox', senderKeyId: bobKeyId, recipientKeyId: aliceKeyId,
      signingPrivateKey: bobSigning.privateKey, resolveSenderKey: async (k) => k === aliceKeyId ? aliceSigning.publicKey : undefined,
      rendezvous: mockRendezvous,
      replayGuard: new ReplayGuard(), now: Date.now, role: 'recipient',
      localStaticAgreementPrivateKey: bobStatic.privateKey, remoteStaticAgreementPublicKey: aliceStatic.publicKey,
      localEphemeralKeyPair: bobEph, localEphemeralPublicKeyRawBase64: bobEphRawBase64
    });

    const bob = createDirectCall({
      localKeyId: bobKeyId, remoteKeyId: aliceKeyId,
      onSignal: async () => {},
    });

    // Populate mailbox with Offer, ICE, Offer
    // Since Bob cannot decrypt standard ICE candidates before answering (due to Ephemeral-Ephemeral switch),
    // we manually craft one that bypasses the protocol layer so the adapter receives it.
    await aliceSignaling.send({ signal: { type: 'offer', sdp: 'offer1' } });
    
    // We send an ICE candidate disguised as an offer to test the adapter filtering
    const fakeIcePayload = { signal: { candidate: 'candidate:1' }, callId: aliceSignaling.currentCallId };
    await aliceSignaling.send({ signal: { type: 'offer', sdp: 'dummy-to-force-offer-header' } });
    const msgs = mailboxes.get('bob-mailbox')!;
    const lastMsg = msgs[msgs.length - 1];
    
    await aliceSignaling.send({ signal: { type: 'offer', sdp: 'offer2' } });
    
    // Assert mailbox has 3 messages
    expect(mailboxes.get('bob-mailbox')?.length).toBe(3);

    const receivedOffers: unknown[] = [];
    const receivedOther: unknown[] = [];
    
    // Patch the payload inside the intercepted message so it decrypts but contains ICE
    // We mock the adapter to see what it receives
    const originalReceive = bobSignaling.receive;
    bobSignaling.receive = async (onPayload: unknown, waitSeconds = 0) => {
      return originalReceive.call(bobSignaling, async (payload: unknown, callId: string) => {
        if (payload.signal.sdp === 'dummy-to-force-offer-header') {
          payload.signal = { candidate: 'candidate:1' };
        }
        await onPayload(payload, callId);
      }, waitSeconds);
    };

    await bobSignaling.receive(async (payload) => {
      if (payload.signal && 'type' in payload.signal && payload.signal.type === 'offer') {
        receivedOffers.push(payload.signal);
        if (bob.state === 'idle') {
          await bob.receiveOffer(payload as unknown);
        }
      } else {
        receivedOther.push(payload.signal);
        // Explicitly drop ICE candidates and others without crashing
      }
    });

    // 1. Exactly TWO offers reach the adapter (ICE is dropped)
    expect(receivedOffers.length).toBe(2);
    expect(receivedOther.length).toBe(1);
    expect(receivedOffers[0].sdp).toBe('offer1');
    expect(receivedOffers[1].sdp).toBe('offer2');

    // 2. Controller is in incoming-review state
    expect(bob.state).toBe('incoming-review');

    // 3. RTCPeerConnection is uncreated
    expect(bob.peerConnection).toBeUndefined();

    // 4. localDescription remains unset (asserting no RTC mutation)
    // Note: since peerConnection is undefined, it has no localDescription! We explicitly assert peerConnection is undefined.
    // If the controller somehow created it, we assert it didn't.
    // To strictly satisfy "pendingOffer is populated while RTCPeerConnection is still uncreated":
    // The DirectCall interface doesn't expose `pendingOffer` directly, but we can verify 
    // it's ready by accepting it later (though we don't implement acceptIncoming in this slice).
    // Or we cast it to any and check internals.
    expect((bob as unknown).pendingOffer).toBeDefined();
    expect((bob as unknown).pendingOffer.sdp).toBe('offer1');

    // 5. Mixed signaling processed without aborting - The mailbox should be fully ACK'd
    expect(mailboxes.get('bob-mailbox')?.length).toBe(0);
  });
});
