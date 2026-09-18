import { useState, useEffect, useRef } from 'react';
import { SessionManager } from './session.js';
import { loadIdentity, listContacts, type LocalIdentity, type Contact } from './identity.js';
import type { CallState, MediaPreferences } from '@securevoice/webrtc';

declare global {
  interface ImportMeta {
    env: Record<string, string | undefined>;
  }
}

export function PocHarness() {
  const [identity, setIdentity] = useState<LocalIdentity>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [session, setSession] = useState<SessionManager>();
  const [traces, setTraces] = useState<string[]>([]);
  const [callState, setCallState] = useState<CallState | 'none'>('none');
  const [incomingCaller, setIncomingCaller] = useState<Contact>();
  const [acceptFn, setAcceptFn] = useState<(media: MediaPreferences) => void>();
  const [rejectFn, setRejectFn] = useState<() => void>();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  useEffect(() => {
    loadIdentity().then(id => {
      setIdentity(id);
      listContacts().then(c => setContacts(c));
    });
  }, []);

  useEffect(() => {
    if (!identity) return;

    const mgr = new SessionManager({
      identity,
      rendezvousUrl: import.meta.env.VITE_RENDEZVOUS_URL || 'http://localhost:8787',
      turnAuthToken: import.meta.env.VITE_TURN_AUTH_TOKEN,
      onIncomingCall: (caller, accept, reject) => {
        setIncomingCaller(caller);
        setAcceptFn(() => accept);
        setRejectFn(() => reject);
      },
      onCallStateChange: (state) => {
        setCallState(state);
        if (state === 'ended' || state === 'idle') {
          setCallState('none');
          setIncomingCaller(undefined); // clear ringing banner if hung up
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
          if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            setLocalStream(undefined);
          }
        }
      },
      onLocalStream: (stream) => {
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      },
      onRemoteStream: (stream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(e => console.error('Audio/Video play failed:', e));
        }
      },
      onTrace: (event) => setTraces(t => [...t, event]),
      resolveContact: async (keyId) => {
        const c = await listContacts();
        return c.find(contact => contact.contactId === keyId);
      }
    });

    setSession(mgr);
    return () => mgr.stop();
  }, [identity]);

  const startCall = async (contact: Contact, video: boolean) => {
    try {
      setIsMuted(false);
      setIsCameraOff(!video);
      await session?.dial(contact, 'direct-preferred', { audio: true, video });
    } catch (e) {
      console.error(e);
      setTraces(t => [...t, `dial failed: ${e}`]);
    }
  };

  const [accepting, setAccepting] = useState(false);

  return (
    <div style={{ fontFamily: 'monospace', padding: 20, maxWidth: 700 }}>
      <h1>🔐 SecureVoice POC</h1>
      {identity && <p style={{ color: '#888' }}>Identity: <code>{identity.keyId.slice(0, 16)}...</code></p>}

      {/* ── INCOMING CALL BANNER ─────────────────────────────────────── */}
      {incomingCaller && (
        <div style={{ background: '#1a1a2e', color: '#fff', border: '3px solid #e94560', borderRadius: 8, padding: 20, margin: '16px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📞</div>
          <h2 style={{ margin: '0 0 8px' }}>Incoming call</h2>
          <p style={{ margin: '0 0 16px', fontSize: 18, color: '#e94560' }}><strong>{incomingCaller.displayName}</strong></p>
          <p style={{ margin: '0 0 16px', color: '#aaa', fontSize: 13 }}>
            Click Accept — the browser will ask for microphone permission. Allow it.
          </p>
          {accepting ? (
            <p style={{ color: '#4caf50' }}>⏳ Connecting… (grant mic permission if prompted)</p>
          ) : (
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                id="poc-accept-audio-btn"
                style={{ background: '#4caf50', color: '#fff', border: 'none', borderRadius: 6, padding: '12px 24px', fontSize: 16, cursor: 'pointer' }}
                onClick={async () => {
                  setAccepting(true);
                  setIsMuted(false);
                  setIsCameraOff(true);
                  try { await acceptFn?.({ audio: true, video: false }); } catch (e) { console.error(e); }
                  setIncomingCaller(undefined);
                  setAccepting(false);
                }}
              >📞 Accept Audio</button>
              <button
                id="poc-accept-video-btn"
                style={{ background: '#2196f3', color: '#fff', border: 'none', borderRadius: 6, padding: '12px 24px', fontSize: 16, cursor: 'pointer' }}
                onClick={async () => {
                  setAccepting(true);
                  setIsMuted(false);
                  setIsCameraOff(false);
                  try { await acceptFn?.({ audio: true, video: true }); } catch (e) { console.error(e); }
                  setIncomingCaller(undefined);
                  setAccepting(false);
                }}
              >📹 Accept Video</button>
              <button
                id="poc-reject-btn"
                style={{ background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, padding: '12px 24px', fontSize: 16, cursor: 'pointer' }}
                onClick={() => { rejectFn?.(); setIncomingCaller(undefined); }}
              >❌ Reject</button>
            </div>
          )}
        </div>
      )}

      {/* ── ACTIVE CALL / DIAL ───────────────────────────────────────── */}
      {callState !== 'none' ? (
        <div style={{ background: '#0d2137', color: '#fff', border: '1px solid #4caf50', borderRadius: 8, padding: 16, margin: '16px 0' }}>
          <h2 style={{ margin: '0 0 8px' }}>📡 Call active</h2>
          <p style={{ margin: '0 0 12px', color: '#4caf50', fontSize: 20 }}>Status: <strong>{callState}</strong></p>
          <p style={{ color: '#aaa', fontSize: 13, margin: '0 0 12px' }}>
            {callState === 'outgoing-preparing' || callState === 'outgoing-rendezvous' ? 'Calling…' : ''}
            {callState === 'outgoing-connecting' || callState === 'incoming-connecting' ? 'ICE connecting, please wait…' : ''}
            {callState === 'connected' ? '🟢 Connected! Media should be live.' : ''}
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <button
              onClick={() => {
                const next = !isMuted;
                setIsMuted(next);
                session?.toggleAudio(!next);
              }}
              style={{ padding: '8px 16px', borderRadius: 4 }}
            >
              {isMuted ? 'Unmute Mic' : 'Mute Mic'}
            </button>
            <button
              onClick={() => {
                const next = !isCameraOff;
                setIsCameraOff(next);
                session?.toggleVideo(!next);
              }}
              style={{ padding: '8px 16px', borderRadius: 4 }}
            >
              {isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
            </button>
          </div>
          <button
            id="poc-end-call-btn"
            style={{ background: '#e94560', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', fontSize: 16, cursor: 'pointer' }}
            onClick={() => session?.endCall()}
          >🔴 End Call</button>
        </div>
      ) : (
        <div style={{ background: '#f5f5f5', borderRadius: 8, padding: 16, margin: '16px 0' }}>
          <h3 style={{ margin: '0 0 12px' }}>Dial a contact</h3>
          {contacts.length === 0
            ? <p style={{ color: '#888' }}>No contacts yet. Go to <a href="/">localhost:5173</a> to pair first.</p>
            : contacts.map(c => (
              <div key={c.contactId} style={{ marginBottom: 8 }}>
                <span style={{ marginRight: 12 }}>{c.displayName}</span>
                <button
                  id={`poc-dial-audio-${c.contactId.slice(0, 8)}`}
                  style={{ background: '#4caf50', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, cursor: 'pointer', marginRight: 8 }}
                  onClick={() => startCall(c, false)}
                >📞 Audio Call</button>
                <button
                  id={`poc-dial-video-${c.contactId.slice(0, 8)}`}
                  style={{ background: '#2196f3', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}
                  onClick={() => startCall(c, true)}
                >📹 Video Call</button>
              </div>
            ))}
        </div>
      )}

      {/* ── TRACE LOG ────────────────────────────────────────────────── */}
      <div>
        <h3 style={{ margin: '16px 0 8px' }}>Trace log</h3>
        <pre style={{ background: '#1a1a1a', color: '#0f0', padding: 12, borderRadius: 6, height: 220, overflow: 'auto', fontSize: 12, margin: 0 }}>
          {traces.length === 0 ? '(waiting for events…)' : traces.join('\n')}
        </pre>
        <button style={{ marginTop: 6, fontSize: 12, padding: '2px 8px' }} onClick={() => setTraces([])}>Clear</button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: '0 0 8px' }}>Remote</h4>
          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', background: '#000', borderRadius: 8, minHeight: 200 }} />
        </div>
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: '0 0 8px' }}>Local</h4>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', background: '#000', borderRadius: 8, minHeight: 200 }} />
        </div>
      </div>
    </div>
  );
}
