import {
	decodeBase64Url,
	encodeBase64Url,
	encodeEnvelope,
	parseEncodedEnvelope,
	signingBytes,
	type SignedEnvelope,
} from '@securevoice/protocol';

const subtle = () => globalThis.crypto.subtle;
type CryptoInput = ArrayBuffer | Uint8Array<ArrayBufferLike>;

function toArrayBuffer(input: CryptoInput): ArrayBuffer {
	return input instanceof ArrayBuffer ? input : Uint8Array.from(input).buffer;
}

export type EncryptedPayload = {
	iv: Uint8Array;
	ciphertext: ArrayBuffer;
};

export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
	return subtle().generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign', 'verify'],
	) as Promise<CryptoKeyPair>;
}

export async function generateAgreementKeyPair(): Promise<CryptoKeyPair> {
	return subtle().generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits'],
	) as Promise<CryptoKeyPair>;
}

export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
	return subtle().exportKey('jwk', key);
}

export async function sign(privateKey: CryptoKey, data: CryptoInput): Promise<ArrayBuffer> {
	return subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, toArrayBuffer(data));
}

export async function verify(publicKey: CryptoKey, signature: CryptoInput, data: CryptoInput): Promise<boolean> {
	return subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, toArrayBuffer(signature), toArrayBuffer(data));
}

export async function signEnvelope(privateKey: CryptoKey, envelope: Pick<SignedEnvelope, 'header' | 'ciphertext'>): Promise<string> {
	const signature = await sign(privateKey, signingBytes(envelope));
	return encodeEnvelope({ ...envelope, signature: encodeBase64Url(signature) });
}

export async function verifyEnvelope(
	encodedEnvelope: string,
	publicKey: CryptoKey,
	replayGuard: { accept(messageId: string, expiresAt: number, now?: number): void },
	now = Date.now(),
): Promise<SignedEnvelope> {
	const envelope = parseEncodedEnvelope(encodedEnvelope, now);
	const valid = await verify(publicKey, decodeBase64Url(envelope.signature), signingBytes(envelope));
	if (!valid) throw new Error('invalid envelope signature');
	replayGuard.accept(envelope.header.messageId, envelope.header.expiresAt, now);
	return envelope;
}

export async function importSigningPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
	return subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
}

export async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
	return subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
}

export async function deriveMessageKey(sharedSecret: CryptoInput, salt: CryptoInput, info: CryptoInput): Promise<CryptoKey> {
	const baseKey = await subtle().importKey('raw', toArrayBuffer(sharedSecret), 'HKDF', false, ['deriveKey']);
	return subtle().deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(salt), info: toArrayBuffer(info) },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

function requireAdditionalData(additionalData: CryptoInput | undefined): ArrayBuffer {
	if (!additionalData || ArrayBuffer.isView(additionalData) && additionalData.byteLength === 0 || additionalData instanceof ArrayBuffer && additionalData.byteLength === 0) {
		throw new Error('AES-GCM additional data is required');
	}
	return toArrayBuffer(additionalData);
}

export async function encrypt(key: CryptoKey, plaintext: CryptoInput, additionalData: CryptoInput): Promise<EncryptedPayload> {
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const aad = requireAdditionalData(additionalData);
	const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: aad }, key, toArrayBuffer(plaintext));
	return { iv, ciphertext };
}

export async function decrypt(key: CryptoKey, payload: EncryptedPayload, additionalData: CryptoInput): Promise<ArrayBuffer> {
	const aad = requireAdditionalData(additionalData);
	if (payload.iv.byteLength !== 12) throw new Error('invalid AES-GCM IV');
	return subtle().decrypt({ name: 'AES-GCM', iv: toArrayBuffer(payload.iv), additionalData: aad }, key, payload.ciphertext);
}
