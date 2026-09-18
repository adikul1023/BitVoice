 
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const requiredModules = [
  ['apps/web', '@securevoice/web'],
  ['apps/rendezvous-service', '@securevoice/rendezvous-service'],
  ['packages/protocol', '@securevoice/protocol'],
  ['packages/crypto', '@securevoice/crypto'],
  ['packages/webrtc', '@securevoice/webrtc'],
  ['packages/ui', '@securevoice/ui'],
] as const;

describe('Phase 0 repository shape', () => {
  it('contains every planned workspace and its expected manifest', () => {
    for (const [modulePath, packageName] of requiredModules) {
      const workspacePath = resolve(process.cwd(), modulePath);
      const manifestPath = resolve(workspacePath, 'package.json');

      expect(existsSync(workspacePath), `${modulePath} directory`).toBe(true);
      expect(existsSync(manifestPath), `${modulePath}/package.json`).toBe(true);
      expect(JSON.parse(readFileSync(manifestPath, 'utf8')).name).toBe(packageName);
    }
  });
});
