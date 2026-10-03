import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeCanvas } from 'qrcode.react';
import QrScanner from 'qr-scanner';
import {
  acceptResponse, createIdentity, createInvitation, createResponse,
  getPairingPhrase, listContacts, loadIdentity, matchesPendingSas,
  parseInvitation, removeContact, saveContact,
  type Contact, type LocalIdentity, type PairingInvitation,
} from './identity.js';
import { acceptScannedArtifact, beginScan, cancelScan, type PairingFlowState } from './pairing-flow.js';
import './styles.css';

type ScannerResult = { data: string };
type Scanner = { stop: () => void; destroy: () => void; start: () => Promise<void> };
type ScannerConstructor = new (
  video: HTMLVideoElement,
  onDecode: (result: ScannerResult) => void,
  options: { highlightScanRegion: boolean; highlightCodeOutline: boolean; returnDetailedScanResult: true }
) => Scanner;
const ScannerCtor = QrScanner as unknown as ScannerConstructor;

type View = 'identity' | 'contacts' | 'invite' | 'scan' | 'review';

import { PocHarness } from './poc.js';

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return hash;
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function SearchIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const hash = useHash();
  const [identity, setIdentity] = useState<LocalIdentity>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [view, setView] = useState<View>('identity');
  const [invitation, setInvitation] = useState<PairingInvitation>();
  const [artifact, setArtifact] = useState('');
  const [scanMode, setScanMode] = useState<'invitation' | 'response'>('invitation');
  const [pairingFlow, setPairingFlow] = useState<PairingFlowState>({ phase: 'idle' });
  const [replacementId, setReplacementId] = useState('');
  const [pending, setPending] = useState<{ invitation?: PairingInvitation; response: string; phrase: string; responseOnly: boolean }>();
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const refreshContacts = async () => setContacts(await listContacts());

  useEffect(() => {
    loadIdentity()
      .then(async (saved) => {
        if (saved) { setIdentity(saved); await refreshContacts(); setView('contacts'); }
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  async function handleCreateIdentity() {
    try {
      const created = await createIdentity();
      setIdentity(created);
      setView('contacts');
      setMessage('Device identity created and stored locally.');
    } catch (error) { setMessage((error as Error).message); }
  }

  async function handleCreateInvitation() {
    if (!identity) return;
    try {
      const encoded = await createInvitation(identity);
      setArtifact(encoded);
      setInvitation(JSON.parse(encoded));
      setView('invite');
    } catch (error) { setMessage((error as Error).message); }
  }

  async function handleArtifact(encoded: string) {
    try {
      if (!identity) throw new Error('Create this device identity first.');
      const localIdentity = identity;
      const parsed = JSON.parse(encoded) as { kind?: string };
      if (parsed.kind === 'securevoice-pairing-response') {
        const name = window.prompt('Name this contact')?.trim();
        if (!name) return;
        const accepted = await acceptResponse(localIdentity, encoded, name, replacementId || undefined);
        await refreshContacts();
        setView('contacts');
        setMessage(`${accepted.replacedContact ? 'Old key blocked and replaced. ' : ''}Contact saved as unverified. Compare these words: ${accepted.sas}`);
        return;
      }
      const imported = await parseInvitation(encoded);
      const name = window.prompt('Name this contact (the one who invited you)')?.trim();
      if (!name) return;
      const response = await createResponse(localIdentity, imported);
      const phrase = await getPairingPhrase(imported, JSON.parse(response));
      const inviterContact: Contact = {
        contactId: imported.keyId, displayName: name,
        signingPublicJwk: imported.signingPublicJwk,
        agreementPublicJwk: imported.agreementPublicJwk,
        verification: 'unverified', keyChangeState: 'normal',
        pendingSas: phrase, createdAt: Date.now(),
      };
      await saveContact(inviterContact);
      await refreshContacts();
      setPending({ invitation: imported, response, phrase, responseOnly: true });
      setView('review');
    } catch (error) { setMessage((error as Error).message); }
  }

  async function handleScan(encoded: string) {
    const next = acceptScannedArtifact(pairingFlow, encoded);
    setPairingFlow(next);
    if (next.phase === 'error') { setMessage(next.error ?? 'Pairing QR rejected.'); return; }
    setView('contacts');
    await handleArtifact(encoded);
  }

  async function markVerified(contact: Contact, entered: string) {
    if (!matchesPendingSas(contact, entered)) {
      setMessage('SAS did not match. The contact remains unverified.');
      return;
    }
    await saveContact({ ...contact, verification: 'verified', verifiedAt: Date.now(), pendingSas: undefined });
    await refreshContacts();
    setMessage('Contact verified.');
  }

  async function blockContact(contact: Contact) {
    await saveContact({ ...contact, keyChangeState: 'blocked' });
    await refreshContacts();
  }

  async function deleteContact(contact: Contact) {
    await removeContact(contact.contactId);
    await refreshContacts();
  }

  if (hash === '#poc') return <PocHarness />;

  // ── Welcome screen ─────────────────────────────────────────────────
  if (!identity) {
    return (
      <main className="app-shell">
        <Header />
        <section className="panel welcome content">
          <p className="kicker">Your device, your keys</p>
          <h1>Start with a local identity.</h1>
          <p>SecureVoice keeps identity keys in this browser. There is no account and no server directory.</p>
          <button onClick={handleCreateIdentity}>Create device identity</button>
          <Notice message={message} />
        </section>
      </main>
    );
  }

  // ── Main app ───────────────────────────────────────────────────────
  const filteredContacts = contacts.filter(c =>
    c.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.contactId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="app-shell">
      <Header />
      <div className="layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <p className="kicker">Device identity</p>
          <strong>{identity.keyId.slice(0, 12)}…</strong>
          <span className="muted">Created {new Date(identity.createdAt).toLocaleDateString()}</span>
          <nav>
            <button className={view === 'contacts' ? 'active' : ''} onClick={() => setView('contacts')}>
              Contacts
            </button>
            <button onClick={handleCreateInvitation}>My verification QR</button>
            <button onClick={() => { setScanMode('invitation'); setPairingFlow(beginScan('invitation')); setView('scan'); }}>
              Scan invitation QR
            </button>
            <button onClick={() => { setScanMode('response'); setReplacementId(''); setPairingFlow(beginScan('response')); setView('scan'); }}>
              Scan response QR
            </button>
          </nav>
        </aside>

        {/* Content */}
        <section className="content">
          <Notice message={message} />

          {view === 'contacts' && (
            <>
              <div className="section-heading">
                <div>
                  <p className="kicker">Trusted circle</p>
                  <h1>Contacts</h1>
                </div>
                <span className="count">{contacts.length} saved</span>
              </div>

              {contacts.length > 0 && (
                <div className="search-wrap">
                  <SearchIcon />
                  <input
                    id="main-search-input"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search contacts…"
                  />
                </div>
              )}

              {contacts.length === 0 ? (
                <div className="empty">
                  <h2>No contacts yet.</h2>
                  <p>Share your verification QR with someone you trust, or import theirs.</p>
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="empty">
                  <p>No contacts match &ldquo;{searchQuery}&rdquo;</p>
                </div>
              ) : (
                <div className="contact-list">
                  {filteredContacts.map((contact) => (
                    <ContactCard
                      key={contact.contactId}
                      contact={contact}
                      onVerify={markVerified}
                      onBlock={blockContact}
                      onDelete={deleteContact}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {view === 'invite' && invitation && (
            <Invite
              artifact={artifact}
              title={artifact.includes('pairing-response') ? 'Scan this response.' : 'Scan this invitation.'}
            />
          )}

          {view === 'scan' && (
            <Scan
              mode={scanMode}
              onScan={handleScan}
              onCancel={() => { setPairingFlow(cancelScan()); setView('contacts'); }}
            />
          )}

          {view === 'review' && pending && (
            <Review
              pending={pending}
              onAccept={async () => { setArtifact(pending.response); setView('invite'); }}
            />
          )}
        </section>
      </div>
    </main>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header() {
  return (
    <header className="topbar">
      <span className="brand">SecureVoice</span>
      <span className="secure-badge"><ShieldIcon /> End-to-End Encrypted</span>
      <span className="phase">Phase 2 / local pairing</span>
    </header>
  );
}

// ─── Notice ───────────────────────────────────────────────────────────────────
function Notice({ message }: { message: string }) {
  return message ? <p className="notice" role="status">{message}</p> : null;
}

// ─── Contact Card ─────────────────────────────────────────────────────────────
function ContactCard({
  contact, onVerify, onBlock, onDelete,
}: {
  contact: Contact;
  onVerify: (c: Contact, entered: string) => void;
  onBlock: (c: Contact) => void;
  onDelete: (c: Contact) => void;
}) {
  const [sasInput, setSasInput] = useState('');
  const isVerified = contact.verification === 'verified';
  const isBlocked = contact.keyChangeState === 'blocked';

  return (
    <article className="contact">
      <div style={{ flex: 1 }}>
        <h2>{contact.displayName}</h2>
        <p className="fingerprint">{contact.contactId}</p>
        <span className={`badge ${contact.verification}`}>
          {isBlocked ? 'Blocked: key changed' : isVerified ? '✓ Verified' : 'Unverified'}
        </span>

        {contact.verification === 'unverified' && !isBlocked && (
          <div className="pending-sas">
            <p className="kicker">Compare these six words</p>
            <p className="phrase-small">{contact.pendingSas}</p>
            <input
              value={sasInput}
              onChange={e => setSasInput(e.target.value)}
              placeholder="Enter matching words"
              aria-label={`SAS for ${contact.displayName}`}
            />
            <button onClick={() => onVerify(contact, sasInput)}>Confirm verification</button>
          </div>
        )}
      </div>
      <div className="actions">
        {!isBlocked && (
          <button className="quiet" onClick={() => onBlock(contact)}>Block key</button>
        )}
        <button className="quiet" onClick={() => onDelete(contact)}>Remove</button>
      </div>
    </article>
  );
}

// ─── Invite ───────────────────────────────────────────────────────────────────
function Invite({ artifact, title }: { artifact: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(artifact);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="panel pairing">
      <p className="kicker">One-time QR / expires in 10 minutes</p>
      <h1>{title}</h1>
      <QRCodeCanvas value={artifact} size={220} includeMargin bgColor="#ffffff" fgColor="#111111" />
      <div style={{ marginTop: 12, marginBottom: 12 }}>
        <button className="quiet" onClick={handleCopy}>{copied ? 'Copied!' : 'Copy artifact string'}</button>
      </div>
      <p className="muted">The other device scans this QR directly. Both devices must compare the six-word phrase to verify.</p>
    </div>
  );
}

// ─── Scan ─────────────────────────────────────────────────────────────────────
function Scan({ mode, onScan, onCancel }: {
  mode: 'invitation' | 'response';
  onScan: (encoded: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [error, setError] = useState('');
  const [manualPayload, setManualPayload] = useState('');

  useEffect(() => {
    if (!video) return;
    const scanner = new ScannerCtor(video, (result) => {
      scanner.stop();
      void onScan(result.data);
    }, { highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true });
    scanner.start().catch((reason: Error) => setError(`Camera unavailable: ${reason.message}`));
    return () => scanner.destroy();
  }, [video, onScan]);

  return (
    <div className="panel scanner">
      <p className="kicker">Camera scan</p>
      <h1>Scan a {mode} QR.</h1>
      <video ref={setVideo} muted playsInline />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
        <p className="kicker">Or paste artifact string manually</p>
        <textarea
          value={manualPayload}
          onChange={e => setManualPayload(e.target.value)}
          placeholder="Paste artifact here…"
          rows={3}
        />
        <button
          onClick={() => onScan(manualPayload.trim())}
          disabled={!manualPayload.trim()}
          style={{ padding: '10px 20px', background: 'var(--blue)', color: '#fff', borderRadius: 'var(--radius-md)', fontWeight: 600, opacity: manualPayload.trim() ? 1 : 0.4 }}
        >
          Submit artifact
        </button>
      </div>
      <p className="muted" style={{ marginTop: 12 }}>Only a signed SecureVoice pairing artifact is accepted.</p>
      {error && <Notice message={error} />}
      <button className="quiet" style={{ marginTop: 16 }} onClick={onCancel}>Cancel</button>
    </div>
  );
}

// ─── Review ───────────────────────────────────────────────────────────────────
function Review({ pending, onAccept }: {
  pending: { invitation?: PairingInvitation; response: string; phrase: string; responseOnly: boolean };
  onAccept: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(pending.response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="panel">
      <p className="kicker">Signed response ready</p>
      <h1>Compare these six words.</h1>
      <div className="phrase">{pending.phrase}</div>
      <p>Read these words aloud through a trusted channel, then copy the response below and send it to the invitation creator.</p>
      <textarea readOnly value={pending.response} aria-label="Signed pairing response" />
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <button
          onClick={handleCopy}
          style={{ padding: '10px 20px', background: 'var(--blue)', color: '#fff', borderRadius: 'var(--radius-md)', fontWeight: 600 }}
        >
          {copied ? 'Copied!' : 'Copy response string'}
        </button>
        <button className="quiet" onClick={onAccept}>Show response QR instead</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
