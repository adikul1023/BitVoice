 
/* eslint-disable prefer-const */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDirectCall } from '../packages/webrtc/src/index.js';
import { createRendezvousTurnProvider } from '../packages/webrtc/src/turn.js';
import { installBrowserFakes } from './phase4.test.js';

describe('Slice 6: TURN / Relay Integration', () => {
	let fetchMock: unknown;
	
	beforeEach(() => {
		fetchMock = vi.fn();
		globalThis.fetch = fetchMock;
		installBrowserFakes();
	});

	it('1. Direct mode uses iceTransportPolicy === "all" and includes TURN if available', async () => {
		const turnProvider = vi.fn().mockResolvedValue([{ urls: ['turn:test'] }]);
		const call = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'direct-preferred',
			turnProvider,
			onSignal: async () => {}
		});
		await call.startOutgoing();
		const config = (call.peerConnection as unknown)?.config;
		expect(config.iceTransportPolicy).toBe('all');
		expect(config.iceServers).toEqual([{ urls: ['turn:test'] }]);
		expect(turnProvider).toHaveBeenCalled();
	});

	it('1b. private-relay-only fails if turnProvider is undefined', async () => {
		const call = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'private-relay-only',
			turnProvider: undefined, // Explicitly missing
			onSignal: async () => {}
		});
		await expect(call.startOutgoing()).rejects.toThrow('private-relay-only mode requires a turnProvider');
		expect(call.peerConnection).toBeUndefined();
	});

	it('2. Relay-only mode uses iceTransportPolicy === "relay"', async () => {
		const call = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'private-relay-only',
			turnProvider: async () => [{ urls: 'turn:test' }],
			onSignal: async () => {}
		});
		await call.startOutgoing();
		expect((call.peerConnection as unknown)?.config.iceTransportPolicy).toBe('relay');
	});

	it('3. Relay credential success configures RTCPeerConnection', async () => {
		const turnProvider = vi.fn().mockResolvedValue([{ urls: ['turn:test'], username: 'u', credential: 'c' }]);
		const call = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'private-relay-only',
			turnProvider,
			onSignal: async () => {}
		});
		await call.startOutgoing();
		expect(turnProvider).toHaveBeenCalled();
		const config = (call.peerConnection as unknown)?.config;
		expect(config?.iceServers).toEqual([{ urls: ['turn:test'], username: 'u', credential: 'c' }]);
	});

	it('4. Relay credential failure aborts with no direct fallback', async () => {
		const turnProvider = vi.fn().mockRejectedValue(new Error('Fetch failed'));
		const call = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'private-relay-only',
			turnProvider,
			onSignal: async () => {}
		});
		await expect(call.startOutgoing()).rejects.toThrow('Failed to obtain TURN credentials for private-relay-only mode');
		expect(call.peerConnection).toBeUndefined(); // no connection created, so no leak
	});

	it('5. Direct mode TURN failure proceeds with empty iceServers', async () => {
		const turnProvider = vi.fn().mockRejectedValue(new Error('Fetch failed'));
		const call = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'direct-preferred',
			turnProvider,
			onSignal: async () => {}
		});
		await call.startOutgoing();
		const config = (call.peerConnection as unknown)?.config;
		expect(config?.iceServers).toEqual([]); // empty servers but proceeds
		expect(config?.iceTransportPolicy).toBe('all');
	});

	it('6. Credential response validation', async () => {
		const provider = createRendezvousTurnProvider('http://test', 'token');
		
		// Malformed response tests
		const testCases = [
			{ payload: null, error: 'Invalid JSON response from TURN endpoint' },
			{ payload: {}, error: 'Missing or invalid iceServers array in response' },
			{ payload: { iceServers: [{ urls: 'not-array' }] }, error: 'ICE server urls must be an array' },
			{ payload: { iceServers: [{ urls: ['http:wrong-scheme'] }] }, error: 'Invalid ICE server url scheme: http:wrong-scheme' },
			{ payload: { iceServers: [{ urls: ['turn:ok'], username: 123, credential: 'c' }] }, error: 'Invalid or missing ICE server username' },
			{ payload: { iceServers: [{ urls: ['turn:ok'], username: 'u', credential: 123 }] }, error: 'Invalid or missing ICE server credential' },
			{ payload: { iceServers: [{ urls: ['turn:ok'], username: 'u'.repeat(300), credential: 'c' }] }, error: 'Invalid or missing ICE server username' },
			{ payload: { iceServers: [{ urls: ['turn:ok'], username: 'u', credential: 'c'.repeat(300) }] }, error: 'Invalid or missing ICE server credential' },
			{ payload: { iceServers: [{ urls: ['stun:ok'], username: 'u', credential: 'c' }] }, error: 'Invalid ICE server url scheme: stun:ok' },
		];

		for (const tc of testCases) {
			if (tc.payload === null) {
				fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.reject(new Error('syntax')) });
			} else {
				fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(tc.payload) });
			}
			await expect(provider()).rejects.toThrow(tc.error);
		}
	});

	it('7. Credential freshness (fetched immediately per call)', async () => {
		const turnProvider = vi.fn().mockResolvedValue([{ urls: ['turn:test'] }]);
		const call = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'private-relay-only',
			turnProvider,
			onSignal: async () => {}
		});
		await call.startOutgoing();
		expect(turnProvider).toHaveBeenCalledTimes(1);
		
		// If another call starts (not practically possible on the same instance normally, but just to simulate)
		// we test that acceptIncoming also fetches.
		const call2 = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'private-relay-only',
			turnProvider,
			onSignal: async () => {}
		});
		await call2.receiveOffer({ signal: { type: 'offer', sdp: '' } as RTCSessionDescriptionInit, privacyMode: 'private-relay-only' });
		await call2.acceptIncoming();
		expect(turnProvider).toHaveBeenCalledTimes(2);
	});

	it('9. Local privacy policy (remote privacyMode cannot override local iceTransportPolicy)', async () => {
		const call = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'private-relay-only',
			turnProvider: async () => [{ urls: ['turn:test'] }],
			onSignal: async () => {}
		});
		
		// If remote sends direct-preferred, it is rejected to prevent downgrade
		await expect(call.receiveOffer({ signal: { type: 'offer', sdp: 'fake' } as RTCSessionDescriptionInit, privacyMode: 'direct-preferred' }))
			.rejects.toThrow('Local requires private-relay-only mode, but peer requested direct-preferred');
		
		// The local transport policy remains strictly relay, never overridden
		await call.startOutgoing();
		const config = (call.peerConnection as unknown)?.config;
		expect(config?.iceTransportPolicy).toBe('relay');
	});

	it('10. Phase 4 regression: CALL_FINISH still establishes connected after relay ICE', async () => {
		let onStateChange = vi.fn();
		const call = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'private-relay-only',
			turnProvider: async () => [{ urls: ['turn:test'] }],
			onSignal: async () => {},
			onStateChange,
			createChallenge: async () => 'challenge123',
			createFinish: async () => 'finish123',
			verifyFinish: async () => true,
		});
		
		await call.startOutgoing();
		await call.receiveAnswer({ signal: { type: 'answer', sdp: 'fake' } as RTCSessionDescriptionInit, privacyMode: 'private-relay-only' });
		
		// Simulate ICE connected
		(call.peerConnection as unknown)?._connect();
		
		// Since we mocked verifyFinish, it should move to connected
		// Wait for promises to resolve
		await new Promise(r => setTimeout(r, 10));
		
		// Simulate DataChannel open to trigger challenge flow
		const dc = (call.peerConnection as unknown)?.dataChannel;
		(call.peerConnection as unknown)?.ondatachannel?.({ channel: dc });
		dc.onopen?.(new Event('open'));

		await new Promise(r => setTimeout(r, 10));

		// Simulate receiving challenge and responding
		dc.onmessage?.({ data: JSON.stringify({ type: 'CALL_FINISH_CHALLENGE' }) });
		await new Promise(r => setTimeout(r, 10));
		dc.onmessage?.({ data: JSON.stringify({ type: 'CALL_FINISH', signature: 'signed-finish' }) });
		await new Promise(r => setTimeout(r, 10));

		expect(onStateChange).toHaveBeenCalledWith('connected');
	});

	it('11. Sequential relay -> direct calls do not retain old ICE configuration', async () => {
		// Call 1: Relay
		const turnProvider1 = vi.fn().mockResolvedValue([{ urls: ['turn:relay1'] }]);
		const call1 = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'private-relay-only',
			turnProvider: turnProvider1,
			onSignal: async () => {}
		});
		await call1.startOutgoing();
		const config1 = (call1.peerConnection as unknown)?.config;
		expect(config1.iceTransportPolicy).toBe('relay');
		expect(config1.iceServers).toEqual([{ urls: ['turn:relay1'] }]);
		await call1.end();

		// Call 2: Direct
		const turnProvider2 = vi.fn().mockResolvedValue([{ urls: ['turn:fallback1'] }]);
		const call2 = createDirectCall({
			localKeyId: 'a', remoteKeyId: 'b',
			privacyMode: 'direct-preferred',
			turnProvider: turnProvider2,
			stunServers: ['stun:google'],
			onSignal: async () => {}
		});
		await call2.startOutgoing();
		const config2 = (call2.peerConnection as unknown)?.config;
		expect(config2.iceTransportPolicy).toBe('all');
		expect(config2.iceServers).toEqual([{ urls: ['turn:fallback1'] }, { urls: ['stun:google'] }]);
		await call2.end();
	});
});
