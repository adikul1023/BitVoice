import { describe, expect, it } from 'vitest';
import {
  ReplayGuard,
  canonicalizeHeader,
  parseEnvelope,
  signingBytes,
  type EnvelopeHeader,
} from '../packages/protocol/src/index';
import {
  decrypt,
  deriveMessageKey,
  encrypt,
  generateSigningKeyPair,
  sign,
  verify,
} from '../packages/crypto/src/index';

const header: EnvelopeHeader = {
  version: 1,
  type: 'pairing-offer',
  messageId: 'AAAAAAAAAAAAAAAAAAAAAA',
  senderKeyId: 'AgICAgICAgICAgICAgICAg',
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
      '[["version",1],["type","pairing-offer"],["messageId","AAAAAAAAAAAAAAAAAAAAAA"],["callId",null],["senderKeyId","AgICAgICAgICAgICAgICAg"],["recipientKeyId",null],["issuedAt",1700000000000],["expiresAt",1700000600000],["nonce","AQEBAQEBAQEBAQEBAQEB"]]',
    );
  });

  it('rejects expired, malformed, and oversized envelopes', () => {
    expect(() => parseEnvelope({ ...envelope, header: { ...header, expiresAt: header.issuedAt + 1 } }, header.expiresAt)).toThrow('expired envelope');
    expect(() => parseEnvelope({ ...envelope, header: { ...header, version: 2 } }, header.issuedAt)).toThrow('unsupported envelope version');
    expect(() => parseEnvelope({ ...envelope, ciphertext: '' }, header.issuedAt)).toThrow('invalid ciphertext');
    expect(() => parseEnvelope({ ...envelope, ciphertext: 'x'.repeat(64 * 1024 + 1) }, header.issuedAt)).toThrow('invalid ciphertext');
  });

  it('rejects a replayed message id', () => {
    const guard = new ReplayGuard();
    guard.accept(header.messageId, header.expiresAt, header.issuedAt);
    expect(() => guard.accept(header.messageId, header.expiresAt, header.issuedAt)).toThrow('replayed message');
  });
});

describe('Phase 1 Web Crypto baseline', () => {
  it('signs and encrypts without exporting private material', async () => {
    const keyPair = await generateSigningKeyPair();
    const data = signingBytes({ header, ciphertext: envelope.ciphertext });
    const signature = await sign(keyPair.privateKey, data);

    expect(keyPair.privateKey.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('jwk', keyPair.privateKey)).rejects.toThrow();
    await expect(verify(keyPair.publicKey, signature, data)).resolves.toBe(true);
    await expect(verify(keyPair.publicKey, signature, new TextEncoder().encode('altered'))).resolves.toBe(false);

    const messageKey = await deriveMessageKey(new Uint8Array(32), new Uint8Array(16), new TextEncoder().encode('securevoice/test/v1'));
    const iv = new Uint8Array(12);
    const plaintext = new TextEncoder().encode('deterministic test payload');
    const ciphertext = await encrypt(messageKey, plaintext, iv);
    const decrypted = await decrypt(messageKey, ciphertext, iv);

    expect(new TextDecoder().decode(decrypted)).toBe('deterministic test payload');
    await expect(decrypt(messageKey, ciphertext, new Uint8Array(12).fill(1))).rejects.toThrow();
  });
});
