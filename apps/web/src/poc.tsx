import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { SessionManager } from './session.js';
import { loadIdentity, listContacts, type LocalIdentity, type Contact } from './identity.js';
import type { CallState, MediaPreferences } from '@securevoice/webrtc';

declare global {
  interface ImportMeta {
    env: Record<string, string | undefined>;
  }
}

// ─── Design Tokens ────────────────────────────────────────────────────────────
const colors = {
  bg: '#111111',
  bgSurface: 'rgba(255,255,255,0.04)',
  bgSurfaceHover: 'rgba(255,255,255,0.08)',
  bgControl: 'rgba(30,30,30,0.88)',
  bgControlBtn: 'rgba(255,255,255,0.10)',
  bgControlBtnHover: 'rgba(255,255,255,0.18)',
  bgModalOverlay: 'rgba(0,0,0,0.75)',
  bgModal: 'rgba(25,25,25,0.97)',
  borderSubtle: 'rgba(255,255,255,0.08)',
  borderMid: 'rgba(255,255,255,0.14)',
  blue: '#2D8CFF',
  blueHover: '#1a6ce0',
  green: '#34A853',
  greenGlow: 'rgba(52,168,83,0.35)',
  red: '#EA4335',
  redGlow: 'rgba(234,67,53,0.40)',
  textPrimary: '#F2F2F2',
  textSecondary: '#9A9A9A',
  textMuted: '#666666',
} as const;

const font = `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

// ─── SVG Icons ────────────────────────────────────────────────────────────────
const iconProps = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const MicIcon = () => (
  <svg {...iconProps}>
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);
const MicOffIcon = () => (
  <svg {...iconProps}>
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);
const VideoIcon = () => (
  <svg {...iconProps}>
    <polygon points="23 7 16 12 23 17 23 7" />
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
  </svg>
);
const VideoOffIcon = () => (
  <svg {...iconProps}>
    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
const PhoneIcon = () => (
  <svg {...iconProps}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);
const PhoneOffIcon = () => (
  <svg {...iconProps}>
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
    <line x1="23" y1="1" x2="1" y2="23" />
  </svg>
);
const ShieldIcon = () => (
  <svg {...iconProps} width={14} height={14}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// ─── Reusable sub-components ─────────────────────────────────────────────────

function Avatar({ name, size = 56 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const s: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #2D8CFF 0%, #1a5fc8 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size * 0.38,
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
    boxShadow: `0 4px 16px rgba(45,140,255,0.28)`,
    fontFamily: font,
    letterSpacing: '-0.5px',
  };
  return <div style={s}>{initials}</div>;
}

function SecureBadge() {
  const s: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    background: 'rgba(52,168,83,0.15)',
    border: '1px solid rgba(52,168,83,0.35)',
    color: '#34A853',
    padding: '4px 10px',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    backdropFilter: 'blur(8px)',
    fontFamily: font,
  };
  return <span style={s}><ShieldIcon /> End-to-End Encrypted</span>;
}

interface ControlButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;     // red "disabled" state
  danger?: boolean;     // red end-call button
  id?: string;
}

function ControlButton({ icon, label, onClick, active = false, danger = false, id }: ControlButtonProps) {
  const [hovered, setHovered] = useState(false);

  const iconBg: CSSProperties = danger
    ? { background: hovered ? '#c93428' : colors.red, boxShadow: hovered ? `0 6px 20px ${colors.redGlow}` : `0 4px 14px ${colors.redGlow}`, borderRadius: 18, padding: '14px 20px' }
    : active
    ? { background: 'rgba(234,67,53,0.16)', border: '1px solid rgba(234,67,53,0.35)', color: colors.red, borderRadius: 18, padding: 12 }
    : { background: hovered ? colors.bgControlBtnHover : colors.bgControlBtn, borderRadius: 18, padding: 12 };

  const btn: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    background: 'transparent',
    border: 'none',
    color: active && !danger ? colors.red : colors.textPrimary,
    cursor: 'pointer',
    padding: '4px 8px',
    minWidth: danger ? 80 : 68,
    borderRadius: 12,
    transition: 'transform 0.2s ease',
    transform: hovered ? 'translateY(-2px)' : 'none',
    fontFamily: font,
  };

  const labelStyle: CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: colors.textSecondary,
    letterSpacing: '0.01em',
  };

  return (
    <button id={id} style={btn} onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', ...iconBg }}>
        {icon}
      </div>
      <span style={labelStyle}>{label}</span>
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function PocHarness() {
  const [identity, setIdentity] = useState<LocalIdentity>();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [session, setSession] = useState<SessionManager>();
  const [callState, setCallState] = useState<CallState | 'none'>('none');
  const [incomingCaller, setIncomingCaller] = useState<Contact>();
  const [acceptFn, setAcceptFn] = useState<(media: MediaPreferences) => void>();
  const [rejectFn, setRejectFn] = useState<() => void>();
  const [accepting, setAccepting] = useState(false);

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream>();
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);

  // ── inject Google Fonts once ─────────────────────────────────────
  useEffect(() => {
    const id = 'gfont-inter';
    if (!document.getElementById(id)) {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
      document.head.appendChild(link);
    }
  }, []);

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
      rendezvousUrl: import.meta.env.VITE_RENDEZVOUS_URL || window.location.origin,
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
          setIncomingCaller(undefined);
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
          if (localStream) { localStream.getTracks().forEach(t => t.stop()); setLocalStream(undefined); }
          setRemoteHasVideo(false);
        }
      },
      onLocalStream: (stream) => {
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      },
      onRemoteStream: (stream) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          remoteVideoRef.current.play().catch(e => console.error('play failed:', e));
          const tracks = stream.getVideoTracks();
          setRemoteHasVideo(tracks.length > 0 && tracks[0].enabled);
          stream.addEventListener('addtrack', () => setRemoteHasVideo(stream.getVideoTracks().length > 0));
          stream.addEventListener('removetrack', () => setRemoteHasVideo(stream.getVideoTracks().length > 0));
        }
      },
      onTrace: (event) => console.log(event),
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
    } catch (e) { console.error(e); }
  };

  const handleEndCall = () => session?.endCall();
  const handleToggleMute = () => { const next = !isMuted; setIsMuted(next); session?.toggleAudio(!next); };
  const handleToggleCamera = () => { const next = !isCameraOff; setIsCameraOff(next); session?.toggleVideo(!next); };

  // ─── Styles ─────────────────────────────────────────────────────────────────
  const rootStyle: CSSProperties = {
    position: 'fixed', inset: 0,
    background: colors.bg,
    color: colors.textPrimary,
    fontFamily: font,
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  };

  // ── Active Call View ───────────────────────────────────────────────
  if (callState !== 'none') {
    const isConnecting = callState.includes('connecting') || callState.includes('preparing') || callState.includes('rendezvous');

    return (
      <div style={rootStyle}>
        {/* Header strip */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
          padding: '16px 24px',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.60) 0%, transparent 100%)',
          display: 'flex', alignItems: 'center', gap: 16, pointerEvents: 'none',
        }}>
          <SecureBadge />
          <span style={{ color: colors.textSecondary, fontSize: 14, fontWeight: 500 }}>SecureVoice Meeting</span>
          {callState === 'connected' && (
            <span style={{ marginLeft: 'auto', color: colors.green, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.green, display: 'inline-block', boxShadow: `0 0 8px ${colors.green}` }} />
              Connected
            </span>
          )}
        </div>

        {/* Remote video — full bleed */}
        <div style={{ flex: 1, position: 'relative', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

          {isConnecting && (
            <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                border: `3px solid ${colors.blue}`,
                borderTopColor: 'transparent',
                animation: 'spin 0.9s linear infinite',
              }} />
              <span style={{ color: colors.textSecondary, fontSize: 16, fontWeight: 500 }}>Connecting…</span>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {!isConnecting && !remoteHasVideo && (
            <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(45,140,255,0.12)', border: `2px solid rgba(45,140,255,0.3)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MicIcon />
              </div>
              <span style={{ color: colors.textSecondary, fontSize: 15 }}>Audio Only</span>
            </div>
          )}

          {/* Local PiP */}
          {!isCameraOff && (
            <div style={{
              position: 'absolute', top: 80, right: 24,
              width: 240, aspectRatio: '16/9', borderRadius: 14,
              overflow: 'hidden',
              boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
              border: `2px solid ${colors.borderMid}`,
              background: '#1a1a1a',
            }}>
              <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
              <div style={{ position: 'absolute', bottom: 6, left: 10, fontSize: 11, color: '#ccc', fontWeight: 600, background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: 6, fontFamily: font }}>You</div>
            </div>
          )}
        </div>

        {/* Control Bar */}
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8,
          padding: '18px 32px',
          background: colors.bgControl,
          borderTop: `1px solid ${colors.borderSubtle}`,
          backdropFilter: 'blur(20px)',
        }}>
          <ControlButton id="poc-mute-btn" icon={isMuted ? <MicOffIcon /> : <MicIcon />} label={isMuted ? 'Unmute' : 'Mute'} onClick={handleToggleMute} active={isMuted} />
          <ControlButton id="poc-video-btn" icon={isCameraOff ? <VideoOffIcon /> : <VideoIcon />} label={isCameraOff ? 'Start Video' : 'Stop Video'} onClick={handleToggleCamera} active={isCameraOff} />
          <div style={{ width: 1, height: 40, background: colors.borderSubtle, margin: '0 4px' }} />
          <ControlButton id="poc-end-call-btn" icon={<PhoneOffIcon />} label="End" onClick={handleEndCall} danger />
        </div>
      </div>
    );
  }

  // ── Dashboard / Contact List ───────────────────────────────────────
  return (
    <div style={{ ...rootStyle, overflowY: 'auto' }}>

      {/* Incoming Call Modal */}
      {incomingCaller && (
        <IncomingCallModal
          caller={incomingCaller}
          accepting={accepting}
          onAccept={async () => {
            setAccepting(true);
            setIsMuted(false); setIsCameraOff(false);
            try { await acceptFn?.({ audio: true, video: true }); } catch (e) { console.error(e); }
            setIncomingCaller(undefined);
            setAccepting(false);
          }}
          onReject={() => { rejectFn?.(); setIncomingCaller(undefined); }}
        />
      )}

      {/* Header */}
      <div style={{
        padding: '20px 40px',
        borderBottom: `1px solid ${colors.borderSubtle}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.5px' }}>SecureVoice</span>
          <SecureBadge />
        </div>
        {identity && (
          <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'monospace' }}>
            ID: {identity.keyId.slice(0, 14)}…
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '48px 40px', width: '100%', boxSizing: 'border-box' }}>
        <h1 style={{ fontSize: 34, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-1px' }}>Your Contacts</h1>
        <p style={{ color: colors.textSecondary, fontSize: 15, margin: '0 0 40px' }}>
          Start a secure P2P call. All media is end-to-end encrypted — no data touches our servers.
        </p>

        {contacts.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {contacts.map(c => (
              <ContactRow key={c.contactId} contact={c} onAudio={() => startCall(c, false)} onVideo={() => startCall(c, true)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-view components ──────────────────────────────────────────────────────

function IncomingCallModal({ caller, accepting, onAccept, onReject }: {
  caller: Contact;
  accepting: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 100,
    background: 'rgba(0,0,0,0.78)',
    backdropFilter: 'blur(14px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const modal: CSSProperties = {
    background: colors.bgModal,
    border: `1px solid ${colors.borderMid}`,
    borderRadius: 24,
    padding: '48px 40px',
    textAlign: 'center',
    maxWidth: 400,
    width: '90%',
    boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
    fontFamily: font,
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ marginBottom: 28 }}>
          <Avatar name={caller.displayName} size={96} />
        </div>
        <div style={{ fontSize: 11, color: colors.green, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
          Incoming secure call
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 32, letterSpacing: '-0.5px' }}>{caller.displayName}</div>

        {accepting ? (
          <p style={{ color: colors.green, fontWeight: 600, fontSize: 15, margin: 0 }}>Connecting…</p>
        ) : (
          <div style={{ display: 'flex', gap: 14 }}>
            <ActionButton id="poc-accept-video-btn" color={colors.green} glowColor={colors.greenGlow} onClick={onAccept}>
              <VideoIcon /> Accept
            </ActionButton>
            <ActionButton id="poc-reject-btn" color="rgba(255,255,255,0.1)" glowColor="transparent" onClick={onReject} hoverColor={colors.red}>
              <PhoneOffIcon /> Decline
            </ActionButton>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({ children, onClick, color, glowColor, hoverColor, id }: {
  children: React.ReactNode;
  onClick: () => void;
  color: string;
  glowColor: string;
  hoverColor?: string;
  id?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const s: CSSProperties = {
    flex: 1, padding: '14px 20px',
    background: hovered && hoverColor ? hoverColor : color,
    border: 'none',
    borderRadius: 16,
    color: '#fff',
    fontSize: 15, fontWeight: 600,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    boxShadow: hovered ? `0 8px 24px ${glowColor}` : `0 4px 12px ${glowColor}`,
    transition: 'all 0.2s ease',
    transform: hovered ? 'translateY(-2px)' : 'none',
    fontFamily: font,
  };
  return (
    <button id={id} style={s} onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
    </button>
  );
}

function ContactRow({ contact, onAudio, onVideo }: { contact: Contact; onAudio: () => void; onVideo: () => void }) {
  const [hovered, setHovered] = useState(false);
  const card: CSSProperties = {
    background: hovered ? colors.bgSurfaceHover : colors.bgSurface,
    border: `1px solid ${hovered ? colors.borderMid : colors.borderSubtle}`,
    borderRadius: 18,
    padding: '20px 24px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    transition: 'all 0.25s ease',
    transform: hovered ? 'translateY(-3px)' : 'none',
    boxShadow: hovered ? '0 10px 32px rgba(0,0,0,0.30)' : 'none',
    fontFamily: font,
  };
  const isVerified = contact.verification === 'verified';
  return (
    <div style={card} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <Avatar name={contact.displayName} size={52} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 4 }}>{contact.displayName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
              padding: '3px 10px', borderRadius: 20,
              background: isVerified ? 'rgba(52,168,83,0.15)' : 'rgba(255,193,7,0.12)',
              color: isVerified ? colors.green : '#FFC107',
              border: `1px solid ${isVerified ? 'rgba(52,168,83,0.35)' : 'rgba(255,193,7,0.30)'}`,
            }}>
              {isVerified ? '✓ Verified' : 'Unverified'}
            </span>
            <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: 'monospace' }}>
              {contact.contactId.slice(0, 10)}…
            </span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <CallButton id={`poc-dial-audio-${contact.contactId.slice(0, 8)}`} onClick={onAudio} variant="secondary">
          <PhoneIcon /> Audio
        </CallButton>
        <CallButton id={`poc-dial-video-${contact.contactId.slice(0, 8)}`} onClick={onVideo} variant="primary">
          <VideoIcon /> Video
        </CallButton>
      </div>
    </div>
  );
}

function CallButton({ children, onClick, variant, id }: {
  children: React.ReactNode;
  onClick: () => void;
  variant: 'primary' | 'secondary';
  id?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const s: CSSProperties = {
    padding: '10px 20px',
    border: variant === 'primary' ? 'none' : `1px solid ${colors.borderMid}`,
    borderRadius: 12,
    background: variant === 'primary'
      ? (hovered ? colors.blueHover : colors.blue)
      : (hovered ? colors.bgSurfaceHover : 'transparent'),
    color: '#fff',
    fontSize: 14, fontWeight: 600,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 7,
    boxShadow: variant === 'primary' && hovered ? `0 6px 20px rgba(45,140,255,0.40)` : 'none',
    transition: 'all 0.18s ease',
    transform: hovered ? 'translateY(-1px)' : 'none',
    fontFamily: font,
  };
  return (
    <button id={id} style={s} onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {children}
    </button>
  );
}

function EmptyState() {
  const s: CSSProperties = {
    textAlign: 'center', padding: '72px 40px',
    background: colors.bgSurface,
    borderRadius: 24,
    border: `1px dashed ${colors.borderMid}`,
    fontFamily: font,
  };
  return (
    <div style={s}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
      <h2 style={{ fontSize: 20, margin: '0 0 10px', fontWeight: 600 }}>No contacts yet</h2>
      <p style={{ color: colors.textSecondary, margin: 0, fontSize: 15 }}>
        Go to the <a href="/" style={{ color: colors.blue, textDecoration: 'none', fontWeight: 600 }}>main page</a> to pair your devices first.
      </p>
    </div>
  );
}
