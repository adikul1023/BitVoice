Known issue:
@securevoice/crypto currently imports node:crypto/webcrypto through
packages/crypto/dist/index.js, which is incompatible with the browser
Vite production build.

This predates Phase 4 Slice 3 and was not introduced by Slice 3.
A dedicated crypto/browser-build cleanup is required before a production
web build can be considered a release gate.
