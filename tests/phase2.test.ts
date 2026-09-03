import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  acceptResponse,
  createIdentity,
  createInvitation,
  createResponse,
  loadIdentity,
  parseInvitation,
} from '../apps/web/src/identity';

describe('Phase 2 local identity and pairing', () => {
  it('persists non-extractable identity keys in IndexedDB', async () => {
    const identity = await createIdentity();
    const loaded = await loadIdentity();

    expect(loaded?.keyId).toBe(identity.keyId);
    expect(loaded?.signingKeyPair.privateKey.extractable).toBe(false);
    expect(loaded?.agreementKeyPair.privateKey.extractable).toBe(false);
  });

  it('creates and verifies an invitation and response without accounts', async () => {
    const inviter = await createIdentity();
    const responder = await createIdentity();
    const invitation = await parseInvitation(await createInvitation(inviter));
    const response = await createResponse(responder, invitation);
    const accepted = await acceptResponse(inviter, response, 'Responder');

    expect(accepted.contact.contactId).toBe(responder.keyId);
    expect(accepted.contact.verification).toBe('unverified');
    expect(accepted.sas.split(' ')).toHaveLength(6);
  });
});
