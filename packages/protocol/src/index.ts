export type MessageType =
	| 'pairing-offer'
	| 'pairing-answer'
	| 'call-offer'
	| 'call-answer'
	| 'ice-candidate'
	| 'call-cancel'
	| 'ack';

export type EnvelopeHeader = {
	version: 1;
	type: MessageType;
	messageId: string;
	callId?: string;
	senderKeyId: string;
	recipientKeyId?: string;
	issuedAt: number;
	expiresAt: number;
	nonce: string;
};

export type SignedEnvelope = {
	header: EnvelopeHeader;
	ciphertext: string;
	signature: string;
};

const messageTypes = new Set<MessageType>([
	'pairing-offer',
	'pairing-answer',
	'call-offer',
	'call-answer',
	'ice-candidate',
	'call-cancel',
	'ack',
]);

const maxEnvelopeLifetimeMs = 15 * 60 * 1000;

function isBase64Url(value: unknown, minimumBytes: number): value is string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
		return false;
	}

	const padding = (4 - (value.length % 4)) % 4;
	try {
		const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding));
		return decoded.length >= minimumBytes;
	} catch {
		return false;
	}
}

export function validateEnvelopeHeader(header: unknown, now = Date.now()): EnvelopeHeader {
	if (typeof header !== 'object' || header === null) {
		throw new Error('invalid envelope header');
	}

	const candidate = header as Partial<EnvelopeHeader>;
	if (candidate.version !== 1 || !messageTypes.has(candidate.type as MessageType)) {
		throw new Error('unsupported envelope version or type');
	}
	if (!isBase64Url(candidate.messageId, 16) || !isBase64Url(candidate.senderKeyId, 16)) {
		throw new Error('invalid envelope identifier');
	}
	if (candidate.callId !== undefined && !isBase64Url(candidate.callId, 16)) {
		throw new Error('invalid call identifier');
	}
	if (candidate.recipientKeyId !== undefined && !isBase64Url(candidate.recipientKeyId, 16)) {
		throw new Error('invalid recipient identifier');
	}
	if (!isBase64Url(candidate.nonce, 12)) {
		throw new Error('invalid envelope nonce');
	}
	if (
		typeof candidate.issuedAt !== 'number' ||
		typeof candidate.expiresAt !== 'number' ||
		!Number.isSafeInteger(candidate.issuedAt) ||
		!Number.isSafeInteger(candidate.expiresAt)
	) {
		throw new Error('invalid envelope timestamps');
	}
	const issuedAt = candidate.issuedAt;
	const expiresAt = candidate.expiresAt;
	if (expiresAt <= issuedAt || expiresAt - issuedAt > maxEnvelopeLifetimeMs) {
		throw new Error('invalid envelope lifetime');
	}
	if (expiresAt <= now) {
		throw new Error('expired envelope');
	}

	return candidate as EnvelopeHeader;
}

export function canonicalizeHeader(header: EnvelopeHeader): string {
	validateEnvelopeHeader(header, header.issuedAt);
	return JSON.stringify([
		['version', header.version],
		['type', header.type],
		['messageId', header.messageId],
		['callId', header.callId ?? null],
		['senderKeyId', header.senderKeyId],
		['recipientKeyId', header.recipientKeyId ?? null],
		['issuedAt', header.issuedAt],
		['expiresAt', header.expiresAt],
		['nonce', header.nonce],
	]);
}

export function signingBytes(envelope: Pick<SignedEnvelope, 'header' | 'ciphertext'>): Uint8Array {
	return new TextEncoder().encode(`${canonicalizeHeader(envelope.header)}.${envelope.ciphertext}`);
}

export function parseEnvelope(value: unknown, now = Date.now()): SignedEnvelope {
	if (typeof value !== 'object' || value === null) {
		throw new Error('invalid envelope');
	}

	const candidate = value as Partial<SignedEnvelope>;
	const header = validateEnvelopeHeader(candidate.header, now);
	if (typeof candidate.ciphertext !== 'string' || candidate.ciphertext.length === 0 || candidate.ciphertext.length > 64 * 1024) {
		throw new Error('invalid ciphertext');
	}
	if (!isBase64Url(candidate.signature, 64)) {
		throw new Error('invalid signature');
	}

	return { header, ciphertext: candidate.ciphertext, signature: candidate.signature };
}

export class ReplayGuard {
	private readonly seen = new Map<string, number>();

	accept(messageId: string, expiresAt: number, now = Date.now()): void {
		for (const [seenId, seenExpiry] of this.seen) {
			if (seenExpiry <= now) this.seen.delete(seenId);
		}
		if (this.seen.has(messageId)) {
			throw new Error('replayed message');
		}
		this.seen.set(messageId, expiresAt);
	}
}
