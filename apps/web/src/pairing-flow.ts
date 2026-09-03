export type ScanMode = 'invitation' | 'response';
export type PairingPhase = 'idle' | 'scanning' | 'review' | 'response-qr' | 'complete' | 'error';

export type PairingFlowState = {
  phase: PairingPhase;
  mode?: ScanMode;
  artifact?: string;
  error?: string;
};

type ArtifactKind = 'securevoice-pairing-invitation' | 'securevoice-pairing-response';

export function beginScan(mode: ScanMode): PairingFlowState {
  return { phase: 'scanning', mode };
}

export function cancelScan(): PairingFlowState {
  return { phase: 'idle' };
}

export function acceptScannedArtifact(state: PairingFlowState, artifact: string): PairingFlowState {
  if (state.phase !== 'scanning' || !state.mode) return state;
  if (state.artifact === artifact) return state;

  let kind: ArtifactKind;
  try {
    const parsed = JSON.parse(artifact) as { kind?: unknown };
    if (parsed.kind !== 'securevoice-pairing-invitation' && parsed.kind !== 'securevoice-pairing-response') throw new Error('unsupported pairing artifact');
    kind = parsed.kind;
  } catch {
    return { ...state, phase: 'error', error: 'Malformed pairing QR.' };
  }

  const expectedKind = state.mode === 'invitation' ? 'securevoice-pairing-invitation' : 'securevoice-pairing-response';
  if (kind !== expectedKind) return { ...state, phase: 'error', error: `Scan a ${state.mode} QR in this scanner.` };
  return { phase: state.mode === 'invitation' ? 'review' : 'complete', mode: state.mode, artifact };
}
