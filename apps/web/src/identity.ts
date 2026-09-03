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
const databaseVersion = 2;
const pairingArtifactMaxBytes = 16 * 1024;
const pairingExpiryWindowMs = 10 * 60 * 1000;
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
type PendingInvitation = { nonce: string; expiresAt: number; inviterKeyId: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('records')) database.createObjectStore('records', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('contacts')) database.createObjectStore('contacts', { keyPath: 'contactId' });
      if (!database.objectStoreNames.contains('invitations')) database.createObjectStore('invitations', { keyPath: 'nonce' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('unable to open local identity storage'));
  });
}

function transaction<T>(storeName: 'records' | 'contacts' | 'invitations', mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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

function parseArtifact(encoded: string): unknown {
  if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).byteLength > pairingArtifactMaxBytes) throw new Error('pairing artifact is too large');
  try { return JSON.parse(encoded); } catch { throw new Error('invalid pairing artifact'); }
}

function isJsonWebKey(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.kty === 'string' && typeof candidate.crv === 'string' && typeof candidate.x === 'string';
}

function isBase64(value: unknown, minimumBytes: number): value is string {
  try { decodeBase64Url(value, minimumBytes); return true; } catch { return false; }
}

function validatePairingFields(value: unknown, kind: PairingInvitation['kind'] | PairingResponse['kind']): void {
  if (!value || typeof value !== 'object') throw new Error('invalid pairing artifact');
  const candidate = value as Record<string, unknown>;
  const now = Date.now();
  if (candidate.kind !== kind || candidate.version !== 1 || typeof candidate.expiresAt !== 'number' || !Number.isSafeInteger(candidate.expiresAt) || candidate.expiresAt <= now || candidate.expiresAt > now + pairingExpiryWindowMs || typeof candidate.keyId !== 'string' || typeof candidate.signature !== 'string' || !isJsonWebKey(candidate.signingPublicJwk) || !isJsonWebKey(candidate.agreementPublicJwk)) throw new Error('invalid or expired pairing artifact');
  if (!isBase64(candidate.keyId, 32) || decodeBase64Url(candidate.signature).byteLength !== 64) throw new Error('invalid pairing artifact encoding');
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
  await transaction('invitations', 'readwrite', (store) => store.put({ nonce: invitation.nonce, expiresAt: invitation.expiresAt, inviterKeyId: identity.keyId }));
  return JSON.stringify({ ...invitation, signature: encodeBase64Url(signature) });
}

export async function parseInvitation(encoded: string): Promise<PairingInvitation> {
  const invitation = parseArtifact(encoded) as PairingInvitation;
  validatePairingFields(invitation, 'securevoice-pairing-invitation');
  if (!isBase64(invitation.nonce, 16)) throw new Error('invalid invitation nonce');
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
  const response = parseArtifact(responseEncoded) as PairingResponse;
  validatePairingFields(response, 'securevoice-pairing-response');
  if (typeof response.invitationNonce !== 'string' || !isBase64(response.invitationNonce, 16) || response.inviterKeyId !== identity.keyId) throw new Error('invalid pairing response');
  const expectedKeyId = await publicKeyId(response.signingPublicJwk);
  if (expectedKeyId !== response.keyId) throw new Error('response key id mismatch');
  const publicKey = await importSigningPublicKey(response.signingPublicJwk);
  const { signature, ...unsigned } = response;
  if (!await verify(publicKey, signatureBytes(signature), new TextEncoder().encode(canonicalJson(unsigned)))) throw new Error('invalid response signature');
  const replacedContact = replaceContactId ? (await listContacts()).find((contact) => contact.contactId === replaceContactId) : undefined;
  if (replaceContactId && !replacedContact) throw new Error('contact selected for replacement was not found');
  const sas = await pairingPhrase({ nonce: response.invitationNonce, keyId: response.inviterKeyId }, response);
  const contact: Contact = { contactId: response.keyId, displayName, signingPublicJwk: response.signingPublicJwk, agreementPublicJwk: response.agreementPublicJwk, verification: 'unverified', keyChangeState: 'normal', pendingSas: sas, createdAt: Date.now() };
  await consumeInvitationAndSaveContact(response.invitationNonce, identity.keyId, contact, replacedContact, Date.now());
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

export function matchesPendingSas(contact: Contact, entered: string): boolean {
  return contact.verification === 'unverified' && typeof contact.pendingSas === 'string' && entered.trim().toLowerCase() === contact.pendingSas;
}

function consumeInvitationAndSaveContact(nonce: string, inviterKeyId: string, contact: Contact, replacedContact: Contact | undefined, now: number): Promise<void> {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const databaseTransaction = database.transaction(['invitations', 'contacts'], 'readwrite');
    const invitationStore = databaseTransaction.objectStore('invitations');
    const request = invitationStore.get(nonce);
    request.onsuccess = () => {
      const pending = request.result as PendingInvitation | undefined;
      if (!pending || pending.inviterKeyId !== inviterKeyId || pending.expiresAt <= now) {
        databaseTransaction.abort();
        reject(new Error(!pending ? 'no matching pending invitation' : 'pending invitation is invalid or expired'));
        return;
      }
      invitationStore.delete(nonce);
      if (replacedContact) databaseTransaction.objectStore('contacts').put({ ...replacedContact, keyChangeState: 'blocked' });
      databaseTransaction.objectStore('contacts').put(contact);
    };
    request.onerror = () => { databaseTransaction.abort(); reject(request.error ?? new Error('unable to consume invitation')); };
    databaseTransaction.oncomplete = () => resolve();
    databaseTransaction.onerror = () => reject(databaseTransaction.error ?? new Error('unable to save paired contact'));
    databaseTransaction.onabort = () => reject(databaseTransaction.error ?? new Error('unable to consume invitation'));
  }));
}