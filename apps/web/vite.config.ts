import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { fileURLToPath, URL } from 'node:url';

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
      '@securevoice/webrtc/signaling': fileURLToPath(new URL('../../packages/webrtc/src/signaling.ts', import.meta.url)),
      '@securevoice/webrtc/turn': fileURLToPath(new URL('../../packages/webrtc/src/turn.ts', import.meta.url)),
      '@securevoice/webrtc': fileURLToPath(new URL('../../packages/webrtc/src/index.ts', import.meta.url)),
    },
  },
});
