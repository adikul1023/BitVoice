import { describe, expect, it } from 'vitest';
import { acceptScannedArtifact, beginScan, cancelScan } from '../apps/web/src/pairing-flow';

const invitation = JSON.stringify({ kind: 'securevoice-pairing-invitation' });
const response = JSON.stringify({ kind: 'securevoice-pairing-response' });

describe('Phase 2 QR pairing UI state machine', () => {
  it('moves invitation scan to review so the response QR can be shown', () => {
    expect(acceptScannedArtifact(beginScan('invitation'), invitation)).toEqual({ phase: 'review', mode: 'invitation', artifact: invitation });
  });

  it('rejects malformed QR data', () => {
    expect(acceptScannedArtifact(beginScan('invitation'), 'not-json')).toMatchObject({ phase: 'error', error: 'Malformed pairing QR.' });
  });

  it('ignores a duplicate after the first scan has transitioned state', () => {
    const first = acceptScannedArtifact(beginScan('invitation'), invitation);
    expect(acceptScannedArtifact(first, invitation)).toEqual(first);
  });

  it('cancels without producing an artifact or changing contact state', () => {
    expect(cancelScan()).toEqual({ phase: 'idle' });
  });

  it('rejects response QR in invitation mode and invitation QR in response mode', () => {
    expect(acceptScannedArtifact(beginScan('invitation'), response)).toMatchObject({ phase: 'error' });
    expect(acceptScannedArtifact(beginScan('response'), invitation)).toMatchObject({ phase: 'error' });
  });

  it('accepts a response QR only in response mode', () => {
    expect(acceptScannedArtifact(beginScan('response'), response)).toEqual({ phase: 'complete', mode: 'response', artifact: response });
  });
});