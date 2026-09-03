import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeCanvas } from 'qrcode.react';
import { acceptResponse, createIdentity, createInvitation, createResponse, getPairingPhrase, listContacts, loadIdentity, matchesPendingSas, parseInvitation, removeContact, saveContact, type Contact, type LocalIdentity, type PairingInvitation } from './identity.js';
import './styles.css';

type View = 'identity' | 'contacts' | 'invite' | 'import' | 'review';

function App() {
  const [identity, setIdentity] = useState<LocalIdentity>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [view, setView] = useState<View>('identity');
  const [invitation, setInvitation] = useState<PairingInvitation>();
  const [artifact, setArtifact] = useState('');
  const [replacementId, setReplacementId] = useState('');
  const [pending, setPending] = useState<{ invitation?: PairingInvitation; response: string; phrase: string; responseOnly: boolean }>();
  const [message, setMessage] = useState('');
  const refreshContacts = async () => setContacts(await listContacts());

  useEffect(() => { loadIdentity().then(async (saved) => { if (saved) { setIdentity(saved); await refreshContacts(); setView('contacts'); } }).catch((error: Error) => setMessage(error.message)); }, []);
  async function handleCreateIdentity() { try { const created = await createIdentity(); setIdentity(created); setView('contacts'); setMessage('Device identity created and stored locally.'); } catch (error) { setMessage((error as Error).message); } }
  async function handleCreateInvitation() { if (!identity) return; try { const encoded = await createInvitation(identity); setArtifact(encoded); setInvitation(JSON.parse(encoded)); setView('invite'); } catch (error) { setMessage((error as Error).message); } }
  async function handleImport() {
    try {
      if (!identity) throw new Error('Create this device identity first.');
      const localIdentity = identity;
      const parsed = JSON.parse(artifact.trim()) as { kind?: string };
      if (parsed.kind === 'securevoice-pairing-response') {
        const name = window.prompt('Name this contact')?.trim();
        if (!name) return;
        const accepted = await acceptResponse(localIdentity, artifact.trim(), name, replacementId || undefined);
        await refreshContacts();
        setView('contacts');
        setMessage(`${accepted.replacedContact ? 'Old key blocked and replaced. ' : ''}Contact saved as unverified. Compare these words: ${accepted.sas}`);
        return;
      }
      const imported = await parseInvitation(artifact.trim());
      const response = await createResponse(localIdentity, imported);
      setPending({ invitation: imported, response, phrase: await getPairingPhrase(imported, JSON.parse(response)), responseOnly: true });
      setView('review');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function handleAcceptResponse() { if (!pending) return; setArtifact(pending.response); setView('import'); setMessage('Send this signed response back to the invitation creator.'); }
  async function markVerified(contact: Contact, entered: string) { if (!matchesPendingSas(contact, entered)) { setMessage('SAS did not match. The contact remains unverified.'); return; } await saveContact({ ...contact, verification: 'verified', verifiedAt: Date.now(), pendingSas: undefined }); await refreshContacts(); setMessage('Contact verified.'); }
  async function blockContact(contact: Contact) { await saveContact({ ...contact, keyChangeState: 'blocked' }); await refreshContacts(); }
  async function deleteContact(contact: Contact) { await removeContact(contact.contactId); await refreshContacts(); }

  if (!identity) return <main className="app-shell"><Header /><section className="panel welcome"><p className="kicker">Your device, your keys</p><h1>Start with a local identity.</h1><p>SecureVoice keeps identity keys in this browser. There is no account and no server directory.</p><button onClick={handleCreateIdentity}>Create device identity</button><Notice message={message} /></section></main>;
  return <main className="app-shell"><Header /><div className="layout"><aside className="sidebar"><p className="kicker">Device identity</p><strong>{identity.keyId.slice(0, 12)}...</strong><p className="muted">Created {new Date(identity.createdAt).toLocaleDateString()}</p><nav><button className={view === 'contacts' ? 'active' : ''} onClick={() => setView('contacts')}>Contacts</button><button onClick={handleCreateInvitation}>My verification QR</button><button onClick={() => { setArtifact(''); setReplacementId(''); setView('import'); }}>Scan / import invite</button></nav></aside><section className="content"><Notice message={message} />{view === 'contacts' && <Contacts contacts={contacts} onVerify={markVerified} onBlock={blockContact} onDelete={deleteContact} />}{view === 'invite' && invitation && <Invite invitation={invitation} artifact={artifact} />}{view === 'import' && <Import artifact={artifact} setArtifact={setArtifact} replacementId={replacementId} setReplacementId={setReplacementId} contacts={contacts} onImport={handleImport} />}{view === 'review' && pending && <Review pending={pending} onAccept={handleAcceptResponse} />}</section></div></main>;
}

function Header() { return <header className="topbar"><span className="brand">SecureVoice</span><span className="phase">Phase 2 / local pairing</span></header>; }
function Notice({ message }: { message: string }) { return message ? <p className="notice" role="status">{message}</p> : null; }
function Contacts({ contacts, onVerify, onBlock, onDelete }: { contacts: Contact[]; onVerify: (contact: Contact, entered: string) => void; onBlock: (contact: Contact) => void; onDelete: (contact: Contact) => void }) { const [sasInputs, setSasInputs] = useState<Record<string, string>>({}); return <><div className="section-heading"><div><p className="kicker">Trusted circle</p><h1>Contacts</h1></div><span className="count">{contacts.length} saved</span></div>{contacts.length === 0 ? <div className="empty"><h2>No contacts yet.</h2><p>Share your verification QR with someone you trust, or import theirs.</p></div> : <div className="contact-list">{contacts.map((contact) => <article className="contact" key={contact.contactId}><div><h2>{contact.displayName}</h2><p className="fingerprint">{contact.contactId}</p><span className={`badge ${contact.verification}`}>{contact.keyChangeState === 'blocked' ? 'Blocked: key changed' : contact.verification}</span>{contact.verification === 'unverified' && contact.keyChangeState === 'normal' && <div className="pending-sas"><p className="kicker">Compare these six words</p><p className="phrase-small">{contact.pendingSas}</p><input value={sasInputs[contact.contactId] ?? ''} onChange={(event) => setSasInputs({ ...sasInputs, [contact.contactId]: event.target.value })} placeholder="Enter matching words" aria-label={`SAS for ${contact.displayName}`} /><button onClick={() => onVerify(contact, sasInputs[contact.contactId] ?? '')}>Confirm verification</button></div>}</div><div className="actions">{contact.keyChangeState === 'normal' && <button className="quiet" onClick={() => onBlock(contact)}>Block key</button>}<button className="quiet" onClick={() => onDelete(contact)}>Remove</button></div></article>)}</div>}</>; }
function Invite({ invitation, artifact }: { invitation: PairingInvitation; artifact: string }) { return <div className="panel pairing"><p className="kicker">One-time invitation / expires in 10 minutes</p><h1>Let someone verify you.</h1><QRCodeCanvas value={artifact} size={240} includeMargin /><p className="fingerprint">Key {invitation.keyId}</p><textarea readOnly value={artifact} aria-label="Pairing invitation" /><p className="muted">Send this QR or text through an existing trusted messenger. Opening it does not verify the contact.</p></div>; }
function Import({ artifact, setArtifact, replacementId, setReplacementId, contacts, onImport }: { artifact: string; setArtifact: (value: string) => void; replacementId: string; setReplacementId: (value: string) => void; contacts: Contact[]; onImport: () => void }) { return <div className="panel"><p className="kicker">Pairing</p><h1>Import an invitation or key replacement.</h1><p>Paste a signed artifact. For a changed contact key, explicitly select the old contact. Its key will be blocked and the new contact will need fresh SAS verification.</p><select value={replacementId} onChange={(event) => setReplacementId(event.target.value)} aria-label="Contact to replace"><option value="">New contact</option>{contacts.map((contact) => <option key={contact.contactId} value={contact.contactId}>Replace {contact.displayName} ({contact.contactId.slice(0, 10)}...)</option>)}</select><textarea value={artifact} onChange={(event) => setArtifact(event.target.value)} placeholder="Paste signed invitation or response JSON" aria-label="Pairing artifact JSON" /><button onClick={onImport}>Review artifact</button></div>; }
function Review({ pending, onAccept }: { pending: { invitation?: PairingInvitation; response: string; phrase: string; responseOnly: boolean }; onAccept: () => void }) { return <div className="panel"><p className="kicker">Signed response ready</p><h1>Compare these six words.</h1><div className="phrase">{pending.phrase}</div><p>Read these words aloud through a trusted channel, then send the signed response below back to the invitation creator.</p><textarea readOnly value={pending.response} aria-label="Signed pairing response" /><button onClick={onAccept}>Prepare response to send</button></div>; }

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
