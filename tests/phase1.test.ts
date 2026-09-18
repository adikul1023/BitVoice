/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it } from 'vitest';
import {
  ReplayGuard,
  canonicalizeHeader,
  decodeBase64Url,
  encodeBase64Url,
  parseEnvelope,
  signingBytes,
  type EnvelopeHeader,
} from '../packages/protocol/src/index';
import {
  decrypt,
  decryptEnvelope,
  deriveSharedSecret,
  deriveMessageKey,
  encrypt,
  encryptEnvelope,
  generateAgreementKeyPair,
  generateSigningKeyPair,
  signEnvelope,
  verify,
  verifyEnvelope,
} from '../packages/crypto/src/index';

const header: EnvelopeHeader = {
  version: 2 as const,
  type: 'pairing-offer' as const,
  messageId: 'AAAAAAAAAAAAAAAAAAAAAA',
  senderKeyId: 'AgICAgICAgICAgICAgICAg',
  ephemeralPublicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  issuedAt: 1_700_000_000_000,
  expiresAt: 1_700_000_600_000,
  nonce: 'AQEBAQEBAQEBAQEBAQEB',
};

const envelope = {
  header,
  ciphertext: 'Y2lwaGVydGV4dA',
  signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

describe('Phase 1 protocol contract', () => {
  it('has a deterministic canonical header vector', () => {
    expect(canonicalizeHeader(header)).toBe(
      '[["version",2],["type","pairing-offer"],["messageId","AAAAAAAAAAAAAAAAAAAAAA"],["callId",null],["senderKeyId","AgICAgICAgICAgICAgICAg"],["recipientKeyId",null],["ephemeralPublicKey","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],["issuedAt",1700000000000],["expiresAt",1700000600000],["nonce","AQEBAQEBAQEBAQEBAQEB"]]',
    );
  });

  it('rejects expired, malformed, and oversized envelopes', () => {
    expect(() => parseEnvelope({ ...envelope, header: { ...header, expiresAt: header.issuedAt + 1 } }, header.expiresAt)).toThrow('expired envelope');
    expect(() => parseEnvelope({ ...envelope, header: { ...header, version: 3 as unknown } }, header.issuedAt)).toThrow('unsupported envelope version');
    expect(() => parseEnvelope({ ...envelope, ciphertext: '' }, header.issuedAt)).toThrow('invalid ciphertext');
    expect(() => parseEnvelope({ ...envelope, ciphertext: 'x'.repeat(64 * 1024 + 1) }, header.issuedAt)).toThrow('invalid ciphertext');
  });

  it('rejects a replayed message id', () => {
    const guard = new ReplayGuard();
    guard.accept(header.messageId, header.expiresAt, header.issuedAt);
    expect(() => guard.accept(header.messageId, header.expiresAt, header.issuedAt)).toThrow('replayed message');
  });

  it('rejects future-dated envelopes and non-canonical base64url', () => {
    expect(() => parseEnvelope({ ...envelope, header: { ...header, issuedAt: 1_700_001_000_000, expiresAt: 1_700_001_600_000 } }, header.issuedAt)).toThrow('future-dated envelope');
    expect(() => decodeBase64Url('AA==')).toThrow('invalid base64url');
    expect(() => decodeBase64Url('AB')).toThrow('invalid base64url');
  });
});

describe('Phase 1 Web Crypto baseline', () => {
  it('derives the same ECDH secret on both sides', async () => {
    const first = await generateAgreementKeyPair();
    const second = await generateAgreementKeyPair();
    const wrongPeer = await generateAgreementKeyPair();
    const firstSecret = await deriveSharedSecret(first.privateKey, second.publicKey);
    const secondSecret = await deriveSharedSecret(second.privateKey, first.publicKey);
    const wrongSecret = await deriveSharedSecret(first.privateKey, wrongPeer.publicKey);

    expect(new Uint8Array(firstSecret)).toEqual(new Uint8Array(secondSecret));
    expect(new Uint8Array(firstSecret)).not.toEqual(new Uint8Array(wrongSecret));
  });

  it('verifies an encoded envelope before consuming replay state', async () => {
    const keyPair = await generateSigningKeyPair();
    const encoded = await signEnvelope(keyPair.privateKey, { header, ciphertext: envelope.ciphertext });
    const replayGuard = new ReplayGuard();
    const decoded = JSON.parse(encoded) as typeof envelope;
    const resolveSenderKey = async (senderKeyId: string) => senderKeyId === header.senderKeyId ? keyPair.publicKey : undefined;

    expect(await verifyEnvelope(encoded, resolveSenderKey, replayGuard, header.issuedAt)).toEqual(decoded);
    await expect(verifyEnvelope(encoded, resolveSenderKey, replayGuard, header.issuedAt)).rejects.toThrow('replayed message');
    await expect(verifyEnvelope(encoded, async () => undefined, new ReplayGuard(), header.issuedAt)).rejects.toThrow('unknown sender key');

    const alteredSignatureBytes = decodeBase64Url(decoded.signature);
    alteredSignatureBytes[0] ^= 1;
    const alteredSignature = JSON.stringify({ ...decoded, signature: encodeBase64Url(alteredSignatureBytes) });
    const invalidPacketGuard = new ReplayGuard();
    await expect(verifyEnvelope(alteredSignature, resolveSenderKey, invalidPacketGuard, header.issuedAt)).rejects.toThrow('invalid envelope signature');
    await expect(verifyEnvelope(encoded, resolveSenderKey, invalidPacketGuard, header.issuedAt)).resolves.toEqual(decoded);
    await expect(verifyEnvelope(encoded, resolveSenderKey, new ReplayGuard(), header.expiresAt)).rejects.toThrow('expired envelope');
  });

  it('encrypts, signs, verifies, and decrypts one envelope payload', async () => {
    const signingKeyPair = await generateSigningKeyPair();
    const { deriveSessionKeys } = await import('@securevoice/crypto');
    const { sendingKey } = await deriveSessionKeys(new Uint8Array(32).buffer, 'test-call', 'caller');
    const messageKey = sendingKey;
    const plaintext = new TextEncoder().encode('complete envelope round trip');
    const ciphertext = await encryptEnvelope(messageKey, plaintext, header);
    const encoded = await signEnvelope(signingKeyPair.privateKey, { header, ciphertext });
    const verified = await verifyEnvelope(
      encoded,
      async (senderKeyId) => senderKeyId === header.senderKeyId ? signingKeyPair.publicKey : undefined,
      new ReplayGuard(),
      header.issuedAt,
    );

    await expect(decryptEnvelope(messageKey, verified.ciphertext, verified.header)).resolves.toEqual(plaintext.buffer);
  });

  it('rejects altered header, ciphertext, signature, and IV', async () => {
    const keyPair = await generateSigningKeyPair();
    const encoded = await signEnvelope(keyPair.privateKey, { header, ciphertext: envelope.ciphertext });
    const decoded = JSON.parse(encoded) as typeof envelope;
    const resolveSenderKey = async () => keyPair.publicKey;
    const alter = (value: typeof envelope) => verifyEnvelope(JSON.stringify(value), resolveSenderKey, new ReplayGuard(), header.issuedAt);
    const alteredSignatureBytes = decodeBase64Url(decoded.signature);
    alteredSignatureBytes[0] ^= 1;

    await expect(alter({ ...decoded, header: { ...decoded.header, type: 'ack' } })).rejects.toThrow('invalid envelope signature');
    await expect(alter({ ...decoded, ciphertext: 'YWx0ZXJlZA' })).rejects.toThrow('invalid envelope signature');
    await expect(alter({ ...decoded, signature: encodeBase64Url(alteredSignatureBytes) })).rejects.toThrow('invalid envelope signature');
    expect(() => parseEnvelope({ ...decoded, signature: encodeBase64Url(new Uint8Array(65)) }, header.issuedAt)).toThrow('invalid signature');

    expect(keyPair.privateKey.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('jwk', keyPair.privateKey)).rejects.toThrow();
    await expect(verify(keyPair.publicKey, new Uint8Array(64), signingBytes({ header, ciphertext: envelope.ciphertext }))).resolves.toBe(false);

    const { deriveSessionKeys } = await import('@securevoice/crypto');
    const { sendingKey } = await deriveSessionKeys(new Uint8Array(32).buffer, 'test-call', 'caller');
    const messageKey = sendingKey;
    const plaintext = new TextEncoder().encode('deterministic test payload');
    const ciphertext = await encrypt(messageKey, plaintext, header);
    const decrypted = await decrypt(messageKey, ciphertext, header);

    expect(new TextDecoder().decode(decrypted)).toBe('deterministic test payload');
    await expect(decrypt(messageKey, { ...ciphertext, iv: new Uint8Array(12).fill(1) }, header)).rejects.toThrow();
    await expect(decrypt(messageKey, ciphertext, { ...header, type: 'ack' })).rejects.toThrow();
  });
});
