export const packageName = '@securevoice/webrtc';
export type CallState =
	| 'idle'
	| 'outgoing-preparing'
	| 'outgoing-rendezvous'
	| 'outgoing-connecting'
	| 'ice-connected'
	| 'incoming-offer'
	| 'incoming-review'
	| 'incoming-accepted'
	| 'incoming-connecting'
	| 'connected'
	| 'ending'
	| 'ended';

export type CallEvent =
	| 'prepare-outgoing'
	| 'offer-sent'
	| 'offer-accepted'
	| 'incoming-received'
	| 'review-incoming'
	| 'accept-incoming'
	| 'connection-established'
	| 'finish-confirmed'
	| 'connection-failed'
	| 'end'
	| 'cleanup';

const transitions: Record<CallState, Partial<Record<CallEvent, CallState>>> = {
	idle: { 'prepare-outgoing': 'outgoing-preparing', 'incoming-received': 'incoming-offer' },
	'outgoing-preparing': { 'offer-sent': 'outgoing-rendezvous', end: 'ending' },
	'outgoing-rendezvous': { 'offer-accepted': 'outgoing-connecting', 'incoming-received': 'incoming-offer', end: 'ending' },
	'outgoing-connecting': { 'connection-established': 'ice-connected', 'connection-failed': 'ending', end: 'ending' },
	'incoming-offer': { 'review-incoming': 'incoming-review', end: 'ending' },
	'incoming-review': { 'accept-incoming': 'incoming-accepted', end: 'ending' },
	'incoming-accepted': { 'offer-sent': 'incoming-connecting', end: 'ending' },
	'incoming-connecting': { 'connection-established': 'ice-connected', 'connection-failed': 'ending', end: 'ending' },
	'ice-connected': { 'finish-confirmed': 'connected', end: 'ending' },
	connected: { end: 'ending' },
	ending: { cleanup: 'ended' },
	ended: {},
};

export function transitionCall(state: CallState, event: CallEvent): CallState {
	const next = transitions[state][event];
	if (!next) throw new Error(`illegal call transition: ${state} -> ${event}`);
	return next;
}

export type PrivacyMode = 'direct-preferred' | 'private-relay-only';

export type SignalPayload = {
	signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
	privacyMode?: PrivacyMode;
};

export type DirectCallConfig = {
	localKeyId: string;
	remoteKeyId: string;
	iceServers?: RTCIceServer[];
	privacyMode?: PrivacyMode;
	onSignal: (payload: SignalPayload) => Promise<void>;
	onStateChange?: (state: CallState) => void;
	onRemoteStream?: (stream: MediaStream) => void;
	createFinishMessage?: () => Promise<string>;
	verifyFinishMessage?: (message: string) => Promise<boolean>;
};

export type DirectCall = {
	get state(): CallState;
	get peerConnection(): RTCPeerConnection | undefined;
	startOutgoing(): Promise<RTCSessionDescriptionInit>;
	receiveOffer(payload: SignalPayload): Promise<void>;
	acceptIncoming(): Promise<RTCSessionDescriptionInit>;
	receiveAnswer(payload: SignalPayload): Promise<void>;
	receiveIceCandidate(payload: SignalPayload): Promise<void>;
	restartIce(): Promise<void>;
	end(): Promise<void>;
};

export function createDirectCall(config: DirectCallConfig): DirectCall {
	let state: CallState = 'idle';
	let connection: RTCPeerConnection | undefined;
	let localStream: MediaStream | undefined;
	let pendingOffer: RTCSessionDescriptionInit | undefined;
	let pendingCandidates: RTCIceCandidateInit[] = [];
	let controlChannel: RTCDataChannel | undefined;
	let finishSent = false;
	let iceRestartUsed = false;

	const setState = (next: CallState) => { state = next; config.onStateChange?.(next); };
	const move = (event: CallEvent) => setState(transitionCall(state, event));
	const ensureConnection = () => {
		if (connection) return connection;
		connection = new RTCPeerConnection({
			iceServers: config.iceServers ?? [],
			iceTransportPolicy: config.privacyMode === 'private-relay-only' ? 'relay' : 'all',
			bundlePolicy: 'max-bundle',
			rtcpMuxPolicy: 'require',
		});
		connection.onicecandidate = (event) => { if (event.candidate) void config.onSignal({ signal: event.candidate.toJSON(), privacyMode: config.privacyMode }); };
		connection.onconnectionstatechange = () => {
			if (connection?.connectionState === 'connected') {
				if (state === 'outgoing-connecting' || state === 'incoming-connecting') {
					move('connection-established');
					void sendFinish();
				}
			} else if (connection && ['failed', 'disconnected'].includes(connection.connectionState) && state === 'outgoing-connecting') {
				move('connection-failed');
			}
		};
		connection.ondatachannel = (event) => { controlChannel = event.channel; configureControlChannel(controlChannel); };
		connection.ontrack = (event) => { if (event.streams[0]) config.onRemoteStream?.(event.streams[0]); };
		return connection;
	};
	const sendFinish = async () => {
		if (finishSent || !controlChannel || controlChannel.readyState !== 'open' || !config.createFinishMessage) return;
		finishSent = true;
		controlChannel.send(await config.createFinishMessage());
	};
	const configureControlChannel = (channel: RTCDataChannel) => {
		channel.onopen = () => { void sendFinish(); };
		channel.onmessage = (event) => {
			if (state !== 'ice-connected' || typeof event.data !== 'string' || !config.verifyFinishMessage) return;
			void config.verifyFinishMessage(event.data).then((valid) => { if (valid) move('finish-confirmed'); });
		};
	};
	const requestMicrophone = async () => {
		localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
		for (const track of localStream.getAudioTracks()) ensureConnection().addTrack(track, localStream);
	};

	return {
		get state() { return state; },
		get peerConnection() { return connection; },
		get pendingOffer() { return pendingOffer; },
		async startOutgoing() {
			move('prepare-outgoing');
			await requestMicrophone();
			const peer = ensureConnection();
			controlChannel = peer.createDataChannel('securevoice-control', { ordered: true });
			configureControlChannel(controlChannel);
			const offer = await peer.createOffer();
			await peer.setLocalDescription(offer);
			move('offer-sent');
			await config.onSignal({ signal: offer, privacyMode: config.privacyMode });
			return offer;
		},
		async receiveOffer(payload) {
			if (payload.privacyMode === 'private-relay-only' && config.privacyMode !== 'private-relay-only') {
				throw new Error('Peer requested private-relay-only mode, but local config is direct-preferred');
			}
			if (config.privacyMode === 'private-relay-only' && payload.privacyMode !== 'private-relay-only') {
				throw new Error('Local requires private-relay-only mode, but peer requested direct-preferred');
			}
			if (state === 'outgoing-rendezvous') {
				const polite = config.localKeyId < config.remoteKeyId;
				if (!polite) {
					return;
				}
				if (connection) {
					connection.close();
					connection = undefined;
					controlChannel = undefined;
				}
				if (localStream) {
					for (const track of localStream.getTracks()) track.stop();
					localStream = undefined;
				}
				iceRestartUsed = false;
				finishSent = false;
				pendingCandidates = [];
			}
			move('incoming-received');
			pendingOffer = payload.signal as RTCSessionDescriptionInit;
			move('review-incoming');
		},
		async acceptIncoming() {
			if (!pendingOffer) throw new Error('no incoming offer to accept');
			move('accept-incoming');
			await ensureConnection().setRemoteDescription(pendingOffer);
			await requestMicrophone();
			const answer = await ensureConnection().createAnswer();
			await ensureConnection().setLocalDescription(answer);
			move('offer-sent');
			for (const candidate of pendingCandidates) {
				await ensureConnection().addIceCandidate(candidate).catch(() => {});
			}
			pendingCandidates = [];
			return answer;
		},
		async receiveAnswer(payload) {
			if (payload.privacyMode === 'private-relay-only' && config.privacyMode !== 'private-relay-only') {
				throw new Error('Peer requested private-relay-only mode, but local config is direct-preferred');
			}
			if (config.privacyMode === 'private-relay-only' && payload.privacyMode !== 'private-relay-only') {
				throw new Error('Local requires private-relay-only mode, but peer requested direct-preferred');
			}
			move('offer-accepted');
			await ensureConnection().setRemoteDescription(payload.signal as RTCSessionDescriptionInit);
		},
		async receiveIceCandidate(payload) {
			if (state === 'incoming-review') {
				if (pendingCandidates.length < 64) pendingCandidates.push(payload.signal as RTCIceCandidateInit);
				return;
			}
			if (state !== 'outgoing-connecting' && state !== 'incoming-connecting' && state !== 'ice-connected') {
				throw new Error('ICE candidate not expected in current call state');
			}
			await ensureConnection().addIceCandidate(payload.signal as RTCIceCandidateInit);
		},
		async restartIce() {
			if (iceRestartUsed || !connection || state !== 'outgoing-connecting') throw new Error('ICE restart unavailable');
			iceRestartUsed = true;
			const offer = await connection.createOffer({ iceRestart: true });
			await connection.setLocalDescription(offer);
			await config.onSignal({ signal: offer, privacyMode: config.privacyMode });
		},
		async end() {
			if (state !== 'ending' && state !== 'ended') move('end');
			localStream?.getTracks().forEach((track) => track.stop());
			connection?.close();
			connection = undefined;
			localStream = undefined;
			pendingOffer = undefined;
			pendingCandidates = [];
			controlChannel = undefined;
			finishSent = false;
			if (state === 'ending') move('cleanup');
		},
	};
}
