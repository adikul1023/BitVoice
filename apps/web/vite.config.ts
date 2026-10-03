import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,
    proxy: {
      '/v1': {
        target: 'http://3.110.55.241:8787',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://3.110.55.241:8787',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@securevoice/webrtc/signaling': '/home/m4lwhere/tmp/BitVoice/packages/webrtc/src/signaling.ts',
      '@securevoice/webrtc/turn': '/home/m4lwhere/tmp/BitVoice/packages/webrtc/src/turn.ts',
      '@securevoice/webrtc': '/home/m4lwhere/tmp/BitVoice/packages/webrtc/src/index.ts'
    }
  }
});
