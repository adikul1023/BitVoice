export const packageName = '@securevoice/webrtc';
export type CallState =
	| 'idle'
	| 'outgoing-preparing'
	| 'outgoing-rendezvous'
	| 'outgoing-connecting'
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
	| 'connection-failed'
	| 'end'
	| 'cleanup';

const transitions: Record<CallState, Partial<Record<CallEvent, CallState>>> = {
	idle: { 'prepare-outgoing': 'outgoing-preparing', 'incoming-received': 'incoming-offer' },
	'outgoing-preparing': { 'offer-sent': 'outgoing-rendezvous', end: 'ending' },
	'outgoing-rendezvous': { 'offer-accepted': 'outgoing-connecting', end: 'ending' },
	'outgoing-connecting': { 'connection-established': 'connected', 'connection-failed': 'ending', end: 'ending' },
	'incoming-offer': { 'review-incoming': 'incoming-review', end: 'ending' },
	'incoming-review': { 'accept-incoming': 'incoming-accepted', end: 'ending' },
	'incoming-accepted': { 'offer-sent': 'incoming-connecting', end: 'ending' },
	'incoming-connecting': { 'connection-established': 'connected', 'connection-failed': 'ending', end: 'ending' },
	connected: { end: 'ending' },
	ending: { cleanup: 'ended' },
	ended: {},
};

export function transitionCall(state: CallState, event: CallEvent): CallState {
	const next = transitions[state][event];
	if (!next) throw new Error(`illegal call transition: ${state} -> ${event}`);
	return next;
}

export type DirectCallConfig = {
	iceServers?: RTCIceServer[];
	onSignal: (signal: RTCSessionDescriptionInit | RTCIceCandidateInit) => Promise<void>;
	onStateChange?: (state: CallState) => void;
	onRemoteStream?: (stream: MediaStream) => void;
};

export type DirectCall = {
	get state(): CallState;
	get peerConnection(): RTCPeerConnection | undefined;
	startOutgoing(): Promise<RTCSessionDescriptionInit>;
	receiveOffer(offer: RTCSessionDescriptionInit): Promise<void>;
	acceptIncoming(): Promise<RTCSessionDescriptionInit>;
	receiveAnswer(answer: RTCSessionDescriptionInit): Promise<void>;
	receiveIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
	restartIce(): Promise<void>;
	end(): Promise<void>;
};

export function createDirectCall(config: DirectCallConfig): DirectCall {
	let state: CallState = 'idle';
	let connection: RTCPeerConnection | undefined;
	let localStream: MediaStream | undefined;
	let pendingOffer: RTCSessionDescriptionInit | undefined;
	let iceRestartUsed = false;

	const setState = (next: CallState) => { state = next; config.onStateChange?.(next); };
	const move = (event: CallEvent) => setState(transitionCall(state, event));
	const ensureConnection = () => {
		if (connection) return connection;
		connection = new RTCPeerConnection({
			iceServers: config.iceServers ?? [],
			iceTransportPolicy: 'all',
			bundlePolicy: 'max-bundle',
			rtcpMuxPolicy: 'require',
		});
		connection.onicecandidate = (event) => { if (event.candidate) void config.onSignal(event.candidate.toJSON()); };
		connection.onconnectionstatechange = () => {
			if (connection?.connectionState === 'connected') {
				if (state === 'outgoing-connecting' || state === 'incoming-connecting') move('connection-established');
			} else if (connection && ['failed', 'disconnected'].includes(connection.connectionState) && state === 'outgoing-connecting') {
				move('connection-failed');
			}
		};
		connection.ontrack = (event) => { if (event.streams[0]) config.onRemoteStream?.(event.streams[0]); };
		return connection;
	};
	const requestMicrophone = async () => {
		localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
		for (const track of localStream.getAudioTracks()) ensureConnection().addTrack(track, localStream);
	};

	return {
		get state() { return state; },
		get peerConnection() { return connection; },
		async startOutgoing() {
			move('prepare-outgoing');
			await requestMicrophone();
			const peer = ensureConnection();
			const dataChannel = peer.createDataChannel('securevoice-control', { ordered: true });
			dataChannel.onopen = () => undefined;
			const offer = await peer.createOffer();
			await peer.setLocalDescription(offer);
			move('offer-sent');
			return offer;
		},
		async receiveOffer(offer) {
			move('incoming-received');
			pendingOffer = offer;
			await ensureConnection().setRemoteDescription(offer);
			move('review-incoming');
		},
		async acceptIncoming() {
			if (!pendingOffer) throw new Error('no incoming offer to accept');
			move('accept-incoming');
			await requestMicrophone();
			const answer = await ensureConnection().createAnswer();
			await ensureConnection().setLocalDescription(answer);
			move('offer-sent');
			return answer;
		},
		async receiveAnswer(answer) {
			await ensureConnection().setRemoteDescription(answer);
			if (state !== 'outgoing-connecting') move('offer-accepted');
		},
		async receiveIceCandidate(candidate) {
			await ensureConnection().addIceCandidate(candidate);
		},
		async restartIce() {
			if (iceRestartUsed || !connection || state !== 'outgoing-connecting') throw new Error('ICE restart unavailable');
			iceRestartUsed = true;
			const offer = await connection.createOffer({ iceRestart: true });
			await connection.setLocalDescription(offer);
			await config.onSignal(offer);
		},
		async end() {
			if (state !== 'ending' && state !== 'ended') move('end');
			localStream?.getTracks().forEach((track) => track.stop());
			connection?.close();
			connection = undefined;
			localStream = undefined;
			pendingOffer = undefined;
			if (state === 'ending') move('cleanup');
		},
	};
}
