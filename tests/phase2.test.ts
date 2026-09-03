import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  acceptResponse,
  createIdentity,
  createInvitation,
  createResponse,
  listContacts,
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
    expect(accepted.contact.pendingSas).toBe(accepted.sas);
    expect(accepted.sas.split(' ')).toHaveLength(6);
  });

  it('blocks the selected old key before saving a replacement as unverified', async () => {
    const inviter = await createIdentity();
    const firstPeer = await createIdentity();
    const replacementPeer = await createIdentity();
    const firstInvitation = await parseInvitation(await createInvitation(inviter));
    const firstContact = await acceptResponse(inviter, await createResponse(firstPeer, firstInvitation), 'Peer');
    const replacementInvitation = await parseInvitation(await createInvitation(inviter));
    const replacement = await acceptResponse(inviter, await createResponse(replacementPeer, replacementInvitation), 'Peer', firstContact.contact.contactId);
    const saved = await listContacts();

    expect(replacement.replacedContact?.keyChangeState).toBe('normal');
    expect(saved.find((contact) => contact.contactId === firstPeer.keyId)?.keyChangeState).toBe('blocked');
    expect(saved.find((contact) => contact.contactId === replacementPeer.keyId)?.verification).toBe('unverified');
    expect(saved.find((contact) => contact.contactId === replacementPeer.keyId)?.pendingSas).toBe(replacement.sas);
  });
});
