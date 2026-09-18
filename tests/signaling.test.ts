/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { createAuthenticatedSignaling, RendezvousClient, SignalingPayload } from '../packages/webrtc/src/signaling';
import { ReplayGuard, encodeBase64Url } from '../packages/protocol/src/index';
import { webcrypto } from 'node:crypto';
const subtle = webcrypto.subtle as unknown;

function randomId(size: number): string {
  return encodeBase64Url(webcrypto.getRandomValues(new Uint8Array(size)));
}

describe('Authenticated Signaling Bridge', () => {
  it('debug X25519', async () => {
    const k1 = await subtle.generateKey({name:'X25519'}, false, ['deriveBits']) as CryptoKeyPair;
    const k2 = await subtle.generateKey({name:'X25519'}, false, ['deriveBits']) as CryptoKeyPair;
    
    // Call deriveBits directly
    await subtle.deriveBits({ name: 'X25519', public: k2.publicKey }, k1.privateKey, 256);

    // Call deriveSharedSecret
    const { deriveSharedSecret } = await import('@securevoice/crypto');
    await deriveSharedSecret(k1.privateKey, k2.publicKey);
  });

  let aliceSigning: CryptoKeyPair;
  let bobSigning: CryptoKeyPair;
  let messageKey: CryptoKey;
  let aliceId: string;
  let bobId: string;
  let aliceStatic: CryptoKeyPair;
  let bobStatic: CryptoKeyPair;

  beforeAll(async () => {
    aliceSigning = await (subtle.generateKey(
      { name: 'Ed25519' },
      false,
      ['sign', 'verify']
    ) as Promise<CryptoKeyPair>);
    bobSigning = await (subtle.generateKey(
      { name: 'Ed25519' },
      false,
      ['sign', 'verify']
    ) as Promise<CryptoKeyPair>);
    messageKey = await subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    aliceId = randomId(16);
    bobId = randomId(16);
    aliceStatic = await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
    bobStatic = await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
  });

  async function createTestSignaling(
    senderSigning: CryptoKeyPair,
    senderKeyId: string,
    recipientKeyId: string,
    recipientPublicKey: CryptoKey,
    rendezvous: RendezvousClient,
    role: 'caller' | 'recipient',
    timeOffset = 0,
    staticKeyPair?: CryptoKeyPair,
    remoteStaticPublicKey?: CryptoKey
  ) {
    const replayGuard = new ReplayGuard();
    const resolveSenderKey = async (keyId: string) => {
      if (keyId === recipientKeyId) return recipientPublicKey;
      return undefined;
    };
    const staticPriv = staticKeyPair || await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair;
    const ephKeyPair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']) as CryptoKeyPair;
    const ephRaw = new Uint8Array(await subtle.exportKey('raw', ephKeyPair.publicKey));
    const remoteStatic = remoteStaticPublicKey || (await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as CryptoKeyPair).publicKey;

    return createAuthenticatedSignaling({
      mailboxId: 'test-mailbox',
      senderKeyId,
      recipientKeyId,
      signingPrivateKey: senderSigning.privateKey,
      role,
      localStaticAgreementPrivateKey: staticPriv.privateKey,
      remoteStaticAgreementPublicKey: remoteStatic,
      localEphemeralKeyPair: ephKeyPair,
      localEphemeralPublicKeyRawBase64: encodeBase64Url(ephRaw),
      resolveSenderKey,
      rendezvous,
      replayGuard,
      now: () => Date.now() + timeOffset,
    });
  }

  it('valid signed offer survives serialize, sign, encrypt, PUT, GET, verify, decrypt, ACK', async () => {
    const rendezvous = { put: vi.fn(async () => {}), get: vi.fn(async () => []), ack: vi.fn(async () => {}) };
    const alice = await createTestSignaling(aliceSigning, aliceId, bobId, bobSigning.publicKey, rendezvous, 'caller', 0, aliceStatic, bobStatic.publicKey);
    const bob = await createTestSignaling(bobSigning, bobId, aliceId, aliceSigning.publicKey, rendezvous, 'recipient', 0, bobStatic, aliceStatic.publicKey);

    const offer = { type: 'offer' as const, sdp: 'v=0\r\no=alice' };
    const messageId = await alice.send({ signal: offer });

    expect(rendezvous.put).toHaveBeenCalledTimes(1);
    const storedMessage = vi.mocked(rendezvous.put).mock.calls[0][1];

    rendezvous.get.mockResolvedValueOnce([storedMessage]);
    const received: unknown[] = [];
    await bob.receive(async (payload) => { received.push(payload); });

    expect(received).toHaveLength(1);
    expect(received[0].signal).toEqual(offer);
    expect(rendezvous.ack).toHaveBeenCalledTimes(1);
    expect(rendezvous.ack).toHaveBeenCalledWith('test-mailbox', messageId);
  });

  it('modified signature is rejected', async () => {
    const rendezvous = { put: vi.fn(async () => {}), get: vi.fn(async () => []), ack: vi.fn(async () => {}) };
    const alice = await createTestSignaling(aliceSigning, aliceId, bobId, bobSigning.publicKey, rendezvous, 'caller', 0, aliceStatic, bobStatic.publicKey);
    const bob = await createTestSignaling(bobSigning, bobId, aliceId, aliceSigning.publicKey, rendezvous, 'recipient', 0, bobStatic, aliceStatic.publicKey);

    await alice.send({ signal: { type: 'offer' as const, sdp: 'offer' } });
    const storedMessage = vi.mocked(rendezvous.put).mock.calls[0][1];

    const envelope = JSON.parse(storedMessage.ciphertext);
    envelope.signature = envelope.signature.slice(0, -1) + (envelope.signature.endsWith('A') ? 'B' : 'A');
    storedMessage.ciphertext = JSON.stringify(envelope);

    rendezvous.get.mockResolvedValueOnce([storedMessage]);
    await expect(bob.receive(async () => {})).rejects.toThrow(/invalid (envelope )?signature/);
    expect(rendezvous.ack).not.toHaveBeenCalled();
  });

  it('modified ciphertext is rejected', async () => {
    const rendezvous = { put: vi.fn(async () => {}), get: vi.fn(async () => []), ack: vi.fn(async () => {}) };
    const alice = await createTestSignaling(aliceSigning, aliceId, bobId, bobSigning.publicKey, rendezvous, 'caller', 0, aliceStatic, bobStatic.publicKey);
    const bob = await createTestSignaling(bobSigning, bobId, aliceId, aliceSigning.publicKey, rendezvous, 'recipient', 0, bobStatic, aliceStatic.publicKey);

    await alice.send({ signal: { type: 'offer' as const, sdp: 'offer' } });
    const storedMessage = vi.mocked(rendezvous.put).mock.calls[0][1];

    const envelope = JSON.parse(storedMessage.ciphertext);
    envelope.ciphertext = envelope.ciphertext.slice(0, -1) + (envelope.ciphertext.endsWith('A') ? 'B' : 'A');
    storedMessage.ciphertext = JSON.stringify(envelope);

    rendezvous.get.mockResolvedValueOnce([storedMessage]);
    await expect(bob.receive(async () => {})).rejects.toThrow(/invalid (envelope )?(signature|ciphertext)/);
    expect(rendezvous.ack).not.toHaveBeenCalled();
  });

  it('expired envelope is rejected', async () => {
    const rendezvous = { put: vi.fn(async () => {}), get: vi.fn(async () => []), ack: vi.fn(async () => {}) };
    const alice = await createTestSignaling(aliceSigning, aliceId, bobId, bobSigning.publicKey, rendezvous, 'caller', -10 * 60 * 1000, aliceStatic, bobStatic.publicKey); // 10 mins ago
    const bob = await createTestSignaling(bobSigning, bobId, aliceId, aliceSigning.publicKey, rendezvous, 'recipient', 0, bobStatic, aliceStatic.publicKey);

    await expect(alice.send({ signal: { type: 'offer' as const, sdp: 'offer' } })).resolves.toBeDefined();
    const storedMessage = vi.mocked(rendezvous.put).mock.calls[0][1];

    rendezvous.get.mockResolvedValueOnce([storedMessage]);
    await expect(bob.receive(async () => {})).rejects.toThrow('expired envelope');
    expect(rendezvous.ack).not.toHaveBeenCalled();
  });

  it('replayed envelope is rejected', async () => {
    const rendezvous = { put: vi.fn(async () => {}), get: vi.fn(async () => []), ack: vi.fn(async () => {}) };
    const alice = await createTestSignaling(aliceSigning, aliceId, bobId, bobSigning.publicKey, rendezvous, 'caller', 0, aliceStatic, bobStatic.publicKey);
    const bob = await createTestSignaling(bobSigning, bobId, aliceId, aliceSigning.publicKey, rendezvous, 'recipient', 0, bobStatic, aliceStatic.publicKey);

    await alice.send({ signal: { type: 'offer' as const, sdp: 'offer' } });
    const storedMessage = vi.mocked(rendezvous.put).mock.calls[0][1];

    rendezvous.get.mockResolvedValueOnce([storedMessage]);
    await bob.receive(async () => {});
    expect(rendezvous.ack).toHaveBeenCalledTimes(1);

    rendezvous.get.mockResolvedValueOnce([storedMessage]);
    await expect(bob.receive(async () => {})).resolves.toBeUndefined();
    expect(rendezvous.ack).toHaveBeenCalledTimes(2);
  });

  it('ACK is skipped if controller delivery throws (deliver-then-ACK)', async () => {
    const rendezvous = { put: vi.fn(async () => {}), get: vi.fn(async () => []), ack: vi.fn(async () => {}) };
    const alice = await createTestSignaling(aliceSigning, aliceId, bobId, bobSigning.publicKey, rendezvous, 'caller', 0, aliceStatic, bobStatic.publicKey);
    const bob = await createTestSignaling(bobSigning, bobId, aliceId, aliceSigning.publicKey, rendezvous, 'recipient', 0, bobStatic, aliceStatic.publicKey);

    await alice.send({ signal: { type: 'offer' as const, sdp: 'offer' } });
    const storedMessage = vi.mocked(rendezvous.put).mock.calls[0][1];

    rendezvous.get.mockResolvedValueOnce([storedMessage]);
    
    // Simulate the controller rejecting the offer during callback
    await expect(bob.receive(async () => {
      throw new Error('controller validation failed');
    })).rejects.toThrow('controller validation failed');

    // ACK must NOT be called if delivery fails
    expect(rendezvous.ack).not.toHaveBeenCalled();
  });

  it('invalid decrypted payload is rejected before delivery and ACK', async () => {
    const rendezvous = { put: vi.fn(async () => {}), get: vi.fn(async () => []), ack: vi.fn(async () => {}) };
    const alice = await createTestSignaling(aliceSigning, aliceId, bobId, bobSigning.publicKey, rendezvous, 'caller', 0, aliceStatic, bobStatic.publicKey);
    const bob = await createTestSignaling(bobSigning, bobId, aliceId, aliceSigning.publicKey, rendezvous, 'recipient', 0, bobStatic, aliceStatic.publicKey);

    const badPayload = { callId: randomId(16), signal: { type: 'unknown_type', sdp: '' } } as unknown as unknown;
    
    const cryptoModule = await import('@securevoice/crypto');
    const originalDecrypt = cryptoModule.decryptEnvelope;
    
    // We mock decryptEnvelope for this specific test
    vi.spyOn(cryptoModule, 'decryptEnvelope').mockImplementation(async (key, ct, header) => {
      // return the bad payload so it passes decryption but fails validation
      return new TextEncoder().encode(JSON.stringify(badPayload));
    });

    await alice.send({ signal: { type: 'offer' as const, sdp: 'offer' } });
    const storedMessage = vi.mocked(rendezvous.put).mock.calls[0][1];

    rendezvous.get.mockResolvedValueOnce([storedMessage]);
    const deliveryMock = vi.fn(async () => {});
    await expect(bob.receive(deliveryMock)).rejects.toThrow('invalid signaling payload');
    
    expect(deliveryMock).not.toHaveBeenCalled();
    expect(rendezvous.ack).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
