import {
  decodeBase64Url,
  encodeBase64Url,
} from '@securevoice/protocol';
import {
  exportPublicKey,
  generateAgreementKeyPair,
  generateSigningKeyPair,
  importSigningPublicKey,
  sign,
  verify,
  digest,
} from '@securevoice/crypto';

const databaseName = 'securevoice-local-v1';
const databaseVersion = 1;
const wordList = ['amber', 'birch', 'cedar', 'dawn', 'ember', 'fern', 'harbor', 'iris', 'juniper', 'kestrel', 'linen', 'maple', 'north', 'olive', 'pebble', 'quartz', 'raven', 'spruce', 'thistle', 'umber', 'violet', 'willow', 'xenon', 'yarrow', 'zephyr', 'acorn', 'breeze', 'canyon', 'dahlia', 'echo', 'frost', 'glade', 'honey', 'ivory', 'jasper', 'lotus', 'meadow', 'nectar', 'opal', 'poppy', 'reed', 'sable', 'tulip', 'valley', 'wren', 'yucca', 'zinnia', 'anchor', 'brook', 'clover', 'drift', 'elm', 'flint', 'grove', 'heather', 'island', 'jade', 'lark', 'moss', 'nova', 'orchid', 'pine', 'rain', 'stone'];

export type LocalIdentity = {
  version: 1;
  signingKeyPair: CryptoKeyPair;
  agreementKeyPair: CryptoKeyPair;
  signingPublicJwk: JsonWebKey;
  agreementPublicJwk: JsonWebKey;
  keyId: string;
  createdAt: number;
};

export type Contact = {
  contactId: string;
  displayName: string;
  signingPublicJwk: JsonWebKey;
  agreementPublicJwk: JsonWebKey;
  verification: 'unverified' | 'verified';
  verifiedAt?: number;
  keyChangeState: 'normal' | 'blocked';
  pendingSas?: string;
  createdAt: number;
  lastSeenAt?: number;
};

export type PairingInvitation = {
  kind: 'securevoice-pairing-invitation';
  version: 1;
  expiresAt: number;
  nonce: string;
  keyId: string;
  signingPublicJwk: JsonWebKey;
  agreementPublicJwk: JsonWebKey;
  signature: string;
};

export type PairingResponse = {
  kind: 'securevoice-pairing-response';
  version: 1;
  invitationNonce: string;
  inviterKeyId: string;
  expiresAt: number;
  keyId: string;
  signingPublicJwk: JsonWebKey;
  agreementPublicJwk: JsonWebKey;
  signature: string;
};

type StoredRecord = { id: string; value: unknown };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('records', { keyPath: 'id' });
      request.result.createObjectStore('contacts', { keyPath: 'contactId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('unable to open local identity storage'));
  });
}

function transaction<T>(storeName: 'records' | 'contacts', mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const request = action(database.transaction(storeName, mode).objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('local storage operation failed'));
  }));
}

async function saveIdentity(identity: LocalIdentity): Promise<void> {
  await transaction('records', 'readwrite', (store) => store.put({ id: 'identity', value: identity }));
}

export async function loadIdentity(): Promise<LocalIdentity | undefined> {
  const record = await transaction<StoredRecord | undefined>('records', 'readonly', (store) => store.get('identity'));
  return record?.value as LocalIdentity | undefined;
}

export async function createIdentity(): Promise<LocalIdentity> {
  const signingKeyPair = await generateSigningKeyPair();
  const agreementKeyPair = await generateAgreementKeyPair();
  const signingPublicJwk = await exportPublicKey(signingKeyPair.publicKey);
  const agreementPublicJwk = await exportPublicKey(agreementKeyPair.publicKey);
  const keyId = await publicKeyId(signingPublicJwk);
  const identity: LocalIdentity = { version: 1, signingKeyPair, agreementKeyPair, signingPublicJwk, agreementPublicJwk, keyId, createdAt: Date.now() };
  await saveIdentity(identity);
  return identity;
}

export async function listContacts(): Promise<Contact[]> {
  const contacts = await transaction<Contact[]>('contacts', 'readonly', (store) => store.getAll());
  return contacts ?? [];
}

export async function saveContact(contact: Contact): Promise<void> {
  await transaction('contacts', 'readwrite', (store) => store.put(contact));
}

export async function removeContact(contactId: string): Promise<void> {
  await transaction('contacts', 'readwrite', (store) => store.delete(contactId));
}

export async function clearIdentity(): Promise<void> {
  await transaction('records', 'readwrite', (store) => store.delete('identity'));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

async function publicKeyId(publicKey: JsonWebKey): Promise<string> {
  return encodeBase64Url(await digest(new TextEncoder().encode(canonicalJson(publicKey))));
}

function randomBytes(size: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(size));
}

function invitationPayload(invitation: Omit<PairingInvitation, 'signature'>): Uint8Array {
  return new TextEncoder().encode(canonicalJson(invitation));
}

export async function createInvitation(identity: LocalIdentity): Promise<string> {
  const invitation: Omit<PairingInvitation, 'signature'> = {
    kind: 'securevoice-pairing-invitation',
    version: 1,
    expiresAt: Date.now() + 10 * 60 * 1000,
    nonce: encodeBase64Url(randomBytes(16)),
    keyId: identity.keyId,
    signingPublicJwk: identity.signingPublicJwk,
    agreementPublicJwk: identity.agreementPublicJwk,
  };
  const signature = await sign(identity.signingKeyPair.privateKey, invitationPayload(invitation));
  return JSON.stringify({ ...invitation, signature: encodeBase64Url(signature) });
}

export async function parseInvitation(encoded: string): Promise<PairingInvitation> {
  const invitation = JSON.parse(encoded) as PairingInvitation;
  if (invitation.kind !== 'securevoice-pairing-invitation' || invitation.version !== 1 || invitation.expiresAt <= Date.now()) throw new Error('expired or invalid invitation');
  const expectedKeyId = await publicKeyId(invitation.signingPublicJwk);
  if (expectedKeyId !== invitation.keyId) throw new Error('invitation key id mismatch');
  const publicKey = await importSigningPublicKey(invitation.signingPublicJwk);
  const { signature, ...unsigned } = invitation;
  if (!await verify(publicKey, decodeBase64Url(signature), invitationPayload(unsigned))) throw new Error('invalid invitation signature');
  return invitation;
}

export async function createResponse(identity: LocalIdentity, invitation: PairingInvitation): Promise<string> {
  const response: Omit<PairingResponse, 'signature'> = {
    kind: 'securevoice-pairing-response',
    version: 1,
    invitationNonce: invitation.nonce,
    inviterKeyId: invitation.keyId,
    expiresAt: Math.min(invitation.expiresAt, Date.now() + 10 * 60 * 1000),
    keyId: identity.keyId,
    signingPublicJwk: identity.signingPublicJwk,
    agreementPublicJwk: identity.agreementPublicJwk,
  };
  const signature = await sign(identity.signingKeyPair.privateKey, new TextEncoder().encode(canonicalJson(response)));
  return JSON.stringify({ ...response, signature: encodeBase64Url(signature) });
}

export async function acceptResponse(identity: LocalIdentity, responseEncoded: string, displayName: string, replaceContactId?: string): Promise<{ contact: Contact; sas: string; replacedContact?: Contact }> {
  const response = JSON.parse(responseEncoded) as PairingResponse;
  if (response.kind !== 'securevoice-pairing-response' || response.version !== 1 || response.inviterKeyId !== identity.keyId || response.expiresAt <= Date.now()) throw new Error('expired or invalid pairing response');
  const expectedKeyId = await publicKeyId(response.signingPublicJwk);
  if (expectedKeyId !== response.keyId) throw new Error('response key id mismatch');
  const publicKey = await importSigningPublicKey(response.signingPublicJwk);
  const { signature, ...unsigned } = response;
  if (!await verify(publicKey, signatureBytes(signature), new TextEncoder().encode(canonicalJson(unsigned)))) throw new Error('invalid response signature');
  const replacedContact = replaceContactId ? (await listContacts()).find((contact) => contact.contactId === replaceContactId) : undefined;
  if (replaceContactId && !replacedContact) throw new Error('contact selected for replacement was not found');
  if (replacedContact) await saveContact({ ...replacedContact, keyChangeState: 'blocked' });
  const sas = await pairingPhrase({ nonce: response.invitationNonce, keyId: response.inviterKeyId }, response);
  const contact: Contact = { contactId: response.keyId, displayName, signingPublicJwk: response.signingPublicJwk, agreementPublicJwk: response.agreementPublicJwk, verification: 'unverified', keyChangeState: 'normal', pendingSas: sas, createdAt: Date.now() };
  await saveContact(contact);
  return { contact, replacedContact, sas };
}

function signatureBytes(signature: string): Uint8Array {
  return decodeBase64Url(signature);
}

async function pairingPhrase(invitation: Pick<PairingInvitation, 'nonce' | 'keyId'>, response: PairingResponse): Promise<string> {
  const transcript = new TextEncoder().encode(canonicalJson({ invitationNonce: invitation.nonce, inviterKeyId: invitation.keyId, responderKeyId: response.keyId }));
  const bytes = new Uint8Array(await digest(transcript));
  return Array.from({ length: 6 }, (_, index) => wordList[bytes[index] % wordList.length]).join(' ');
}

export async function getPairingPhrase(invitation: PairingInvitation, response: PairingResponse): Promise<string> {
  return pairingPhrase(invitation, response);
}