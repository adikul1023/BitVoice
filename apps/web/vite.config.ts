import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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
      '@securevoice/webrtc/signaling': path.resolve(__dirname, '../../packages/webrtc/src/signaling.ts'),
      '@securevoice/webrtc/turn': path.resolve(__dirname, '../../packages/webrtc/src/turn.ts'),
      '@securevoice/webrtc': path.resolve(__dirname, '../../packages/webrtc/src/index.ts')
    }
  }
});
