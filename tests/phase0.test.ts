import { describe, expect, it } from 'vitest';

const requiredModules = [
  'apps/web',
  'apps/rendezvous-service',
  'packages/protocol',
  'packages/crypto',
  'packages/webrtc',
  'packages/ui',
];

describe('Phase 0 repository shape', () => {
  it('defines every planned top-level module', () => {
    expect(requiredModules).toHaveLength(6);
  });
});
