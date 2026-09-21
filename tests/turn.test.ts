 
import { afterEach, describe, expect, it } from 'vitest';
import { createRendezvousServer } from '../apps/rendezvous-service/src/server';
import { createHmac } from 'node:crypto';

const servers: ReturnType<typeof createRendezvousServer>[] = [];

async function startServer(options: unknown = {}) {
  const server = createRendezvousServer({
    turnSecret: 'fake-secret',
    turnUrls: ['turn:test.local:3478'],
    turnAuthToken: 'valid-token',
    ...options
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe('TURN credential endpoint', () => {
  it('rejects unauthenticated requests', async () => {
    const baseUrl = await startServer();
    const res = await fetch(`${baseUrl}/v1/turn`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with incorrect token', async () => {
    const baseUrl = await startServer();
    const res = await fetch(`${baseUrl}/v1/turn`, { 
      method: 'POST',
      headers: { 'Authorization': 'Bearer wrong-token' }
    });
    expect(res.status).toBe(401);
  });

  it('generates valid ephemeral HMAC credentials when authenticated', async () => {
    const baseUrl = await startServer();
    const res = await fetch(`${baseUrl}/v1/turn`, { 
      method: 'POST',
      headers: { 'Authorization': 'Bearer valid-token' }
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(body.iceServers).toHaveLength(1);
    
    const server = body.iceServers[0];
    expect(server.urls).toEqual(['turn:test.local:3478']);
    expect(server.username).toBeDefined();
    expect(server.credential).toBeDefined();

    // Verify HMAC
    const expectedCredential = createHmac('sha1', 'fake-secret').update(server.username).digest('base64');
    expect(server.credential).toBe(expectedCredential);
  });

  it('fails to start if TURN config is missing', () => {
    expect(() => createRendezvousServer({ turnSecret: '' })).toThrow('Missing TURN configuration');
    expect(() => createRendezvousServer({ turnUrls: undefined })).toThrow('Missing TURN configuration');
    expect(() => createRendezvousServer({ turnAuthToken: '' })).toThrow('Missing TURN configuration');
  });

  it('enforces 5 requests per minute rate limit per IP', async () => {
    // We override 'now' so we can control time
    let currentTime = 1000000;
    const baseUrl = await startServer({ now: () => currentTime });
    
    // Send 5 successful requests from IP 1
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/v1/turn`, { 
        method: 'POST',
        headers: { 'Authorization': 'Bearer valid-token', 'X-Forwarded-For': '192.168.1.1' }
      });
      expect(res.status).toBe(200);
    }
    
    // 6th request fails with 429
    const res6 = await fetch(`${baseUrl}/v1/turn`, { 
      method: 'POST',
      headers: { 'Authorization': 'Bearer valid-token', 'X-Forwarded-For': '192.168.1.1' }
    });
    expect(res6.status).toBe(429);
    expect(res6.headers.get('retry-after')).toBe('60');

    // A different IP is still allowed
    const resOther = await fetch(`${baseUrl}/v1/turn`, { 
      method: 'POST',
      headers: { 'Authorization': 'Bearer valid-token', 'X-Forwarded-For': '192.168.1.2' }
    });
    expect(resOther.status).toBe(200);

    // After 60 seconds (60000ms), the first IP is allowed again
    currentTime += 60001;
    const resReset = await fetch(`${baseUrl}/v1/turn`, { 
      method: 'POST',
      headers: { 'Authorization': 'Bearer valid-token', 'X-Forwarded-For': '192.168.1.1' }
    });
    expect(resReset.status).toBe(200);
  });
});
