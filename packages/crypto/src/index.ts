const subtle = () => globalThis.crypto.subtle;

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

export async function sign(privateKey: CryptoKey, data: BufferSource): Promise<ArrayBuffer> {
	return subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
}

export async function verify(publicKey: CryptoKey, signature: BufferSource, data: BufferSource): Promise<boolean> {
	return subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, data);
}

export async function importSigningPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
	return subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
}

export async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
	return subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
}

export async function deriveMessageKey(sharedSecret: BufferSource, salt: BufferSource, info: BufferSource): Promise<CryptoKey> {
	const baseKey = await subtle().importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
	return subtle().deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt, info },
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

export async function encrypt(key: CryptoKey, plaintext: BufferSource, iv: BufferSource): Promise<ArrayBuffer> {
	return subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);
}

export async function decrypt(key: CryptoKey, ciphertext: BufferSource, iv: BufferSource): Promise<ArrayBuffer> {
	return subtle().decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}
