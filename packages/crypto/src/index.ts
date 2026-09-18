import {
	decodeBase64Url,
	encodeBase64Url,
	encodeEnvelope,
	parseEncodedEnvelope,
	signingBytes,
	canonicalizeHeader,
	type EnvelopeHeader,
	type SignedEnvelope,
} from '@securevoice/protocol';

// Use globalThis.crypto to avoid Vite browser build errors and work natively in Node 20+.
const subtle = () => globalThis.crypto.subtle as any;
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
		{ name: 'Ed25519' },
		false,
		['sign', 'verify'],
	) as Promise<CryptoKeyPair>;
}

export async function generateAgreementKeyPair(): Promise<CryptoKeyPair> {
	return subtle().generateKey(
		{ name: 'X25519' },
		false,
		['deriveBits'],
	) as Promise<CryptoKeyPair>;
}

export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
	return subtle().exportKey('jwk', key);
}

export async function sign(privateKey: CryptoKey, data: CryptoInput): Promise<ArrayBuffer> {
	return subtle().sign({ name: 'Ed25519' }, privateKey, toArrayBuffer(data));
}

export async function verify(publicKey: CryptoKey, signature: CryptoInput, data: CryptoInput): Promise<boolean> {
	return subtle().verify({ name: 'Ed25519' }, publicKey, toArrayBuffer(signature), toArrayBuffer(data));
}

export async function signEnvelope(privateKey: CryptoKey, envelope: Pick<SignedEnvelope, 'header' | 'ciphertext'>): Promise<string> {
	const signature = await sign(privateKey, signingBytes(envelope));
	return encodeEnvelope({ ...envelope, signature: encodeBase64Url(signature) });
}

export async function encryptEnvelope(key: CryptoKey, plaintext: CryptoInput, header: EnvelopeHeader): Promise<string> {
	const payload = await encrypt(key, plaintext, header);
	const framed = new Uint8Array(12 + payload.ciphertext.byteLength);
	framed.set(payload.iv, 0);
	framed.set(new Uint8Array(payload.ciphertext), 12);
	return encodeBase64Url(framed);
}

export async function decryptEnvelope(key: CryptoKey, ciphertext: string, header: EnvelopeHeader): Promise<ArrayBuffer> {
	const framed = decodeBase64Url(ciphertext);
	if (framed.byteLength <= 12) throw new Error('invalid encrypted envelope payload');
	return decrypt(
		key,
		{ iv: framed.slice(0, 12), ciphertext: framed.slice(12).buffer },
		header,
	);
}

export async function verifyEnvelope(
	encodedEnvelope: string,
	resolveSenderKey: (senderKeyId: string) => Promise<CryptoKey | undefined>,
	replayGuard: { accept(messageId: string, expiresAt: number, now?: number): void },
	now = Date.now(),
): Promise<SignedEnvelope> {
	const envelope = parseEncodedEnvelope(encodedEnvelope, now);
	const publicKey = await resolveSenderKey(envelope.header.senderKeyId);
	if (!publicKey) throw new Error('unknown sender key');
	const valid = await verify(publicKey, decodeBase64Url(envelope.signature), signingBytes(envelope));
	if (!valid) throw new Error('invalid envelope signature');
	replayGuard.accept(envelope.header.messageId, envelope.header.expiresAt, now);
	return envelope;
}

export async function importSigningPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
	return subtle().importKey('jwk', jwk, { name: 'Ed25519' }, true, ['verify']);
}

export async function importAgreementPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
	return subtle().importKey('jwk', jwk, { name: 'X25519' }, true, []);
}

export async function exportAgreementPublicKeyRaw(key: CryptoKey): Promise<ArrayBuffer> {
	return subtle().exportKey('raw', key);
}

export async function importAgreementPublicKeyRaw(raw: CryptoInput): Promise<CryptoKey> {
	return subtle().importKey('raw', toArrayBuffer(raw), { name: 'X25519' }, true, []);
}

export async function digest(data: CryptoInput): Promise<ArrayBuffer> {
	return subtle().digest('SHA-256', toArrayBuffer(data));
}

export async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
	return subtle().deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256);
}

export interface SessionKeys {
	sendingKey: CryptoKey;
	receivingKey: CryptoKey;
}

export async function deriveSessionKeys(
	sharedSecret: CryptoInput,
	callId: string,
	role: 'caller' | 'recipient'
): Promise<SessionKeys> {
	const baseKey = await subtle().importKey('raw', toArrayBuffer(sharedSecret), 'HKDF', false, ['deriveKey']);
	
	const callerInfo = new TextEncoder().encode(`SecureVoice Signaling v2|${callId}|caller`);
	const recipientInfo = new TextEncoder().encode(`SecureVoice Signaling v2|${callId}|recipient`);

	const callerKey = await subtle().deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: toArrayBuffer(callerInfo) },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
	
	const recipientKey = await subtle().deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: toArrayBuffer(recipientInfo) },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);

	if (role === 'caller') {
		return { sendingKey: callerKey, receivingKey: recipientKey };
	} else {
		return { sendingKey: recipientKey, receivingKey: callerKey };
	}
}

function headerAdditionalData(header: EnvelopeHeader): ArrayBuffer {
	return toArrayBuffer(new TextEncoder().encode(canonicalizeHeader(header)));
}

export async function encrypt(key: CryptoKey, plaintext: CryptoInput, header: EnvelopeHeader): Promise<EncryptedPayload> {
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const aad = headerAdditionalData(header);
	const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: aad }, key, toArrayBuffer(plaintext));
	return { iv, ciphertext };
}

export async function decrypt(key: CryptoKey, payload: EncryptedPayload, header: EnvelopeHeader): Promise<ArrayBuffer> {
	const aad = headerAdditionalData(header);
	if (payload.iv.byteLength !== 12) throw new Error('invalid AES-GCM IV');
	return subtle().decrypt({ name: 'AES-GCM', iv: toArrayBuffer(payload.iv), additionalData: aad }, key, payload.ciphertext);
}
