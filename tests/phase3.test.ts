import { afterEach, describe, expect, it } from 'vitest';
import { createRendezvousServer } from '../apps/rendezvous-service/src/server';
import { RendezvousStore } from '../apps/rendezvous-service/src/store';

const servers: ReturnType<typeof createRendezvousServer>[] = [];

async function startServer(store = new RendezvousStore()) {
  const server = createRendezvousServer({ store });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a TCP port');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

describe('Phase 3 rendezvous service', () => {
  it('moves opaque ciphertext and removes it after acknowledgement', async () => {
    const baseUrl = await startServer();
    const message = { messageId: 'message_opaque_123', ciphertext: 'v=0\r\no=not-server-readable', expiresAt: Date.now() + 60_000 };
    const put = await fetch(`${baseUrl}/v1/mailboxes/opaque-mailbox/messages`, { method: 'PUT', body: JSON.stringify(message) });
    expect(put.status).toBe(202);

    const fetched = await fetch(`${baseUrl}/v1/mailboxes/opaque-mailbox/messages`).then((response) => response.json());
    expect(fetched.messages).toEqual([{ ...message, storedAt: expect.any(Number) }]);

    const ack = await fetch(`${baseUrl}/v1/mailboxes/opaque-mailbox/messages/${message.messageId}/ack`, { method: 'POST' });
    expect(ack.status).toBe(202);
    expect((await fetch(`${baseUrl}/v1/mailboxes/opaque-mailbox/messages`).then((response) => response.json())).messages).toEqual([]);

    const secondMessage = { messageId: 'message_delete_123', ciphertext: 'opaque', expiresAt: Date.now() + 60_000 };
    await fetch(`${baseUrl}/v1/mailboxes/opaque-mailbox/messages`, { method: 'PUT', body: JSON.stringify(secondMessage) });
    const deletion = await fetch(`${baseUrl}/v1/mailboxes/opaque-mailbox/messages/${secondMessage.messageId}`, { method: 'DELETE' });
    expect(deletion.status).toBe(202);
    expect((await fetch(`${baseUrl}/v1/mailboxes/opaque-mailbox/messages`).then((response) => response.json())).messages).toEqual([]);
  });

  it('deduplicates delivery, expires messages, and keeps mailboxes isolated', async () => {
    const store = new RendezvousStore();
    const baseUrl = await startServer(store);
    const message = { messageId: 'same_message_123', ciphertext: 'opaque', expiresAt: Date.now() + 1000 };
    const endpoint = `${baseUrl}/v1/mailboxes/mailbox-a/messages`;
    await fetch(endpoint, { method: 'PUT', body: JSON.stringify(message) });
    await fetch(endpoint, { method: 'PUT', body: JSON.stringify(message) });
    expect((await fetch(endpoint).then((response) => response.json())).messages).toHaveLength(1);
    expect((await fetch(`${baseUrl}/v1/mailboxes/mailbox-b/messages`).then((response) => response.json())).messages).toEqual([]);

    store.purge(Date.now() + 2000);
    expect((await fetch(endpoint).then((response) => response.json())).messages).toEqual([]);
  });

  it('cannot acknowledge or delete a message through another mailbox capability', async () => {
    const baseUrl = await startServer();
    const message = { messageId: 'scoped_message_123', ciphertext: 'opaque', expiresAt: Date.now() + 60_000 };
    await fetch(`${baseUrl}/v1/mailboxes/mailbox-a/messages`, { method: 'PUT', body: JSON.stringify(message) });
    await fetch(`${baseUrl}/v1/mailboxes/mailbox-b/messages`, { method: 'PUT', body: JSON.stringify({ ...message, messageId: 'other_message_123' }) });

    await fetch(`${baseUrl}/v1/mailboxes/mailbox-b/messages/${message.messageId}/ack`, { method: 'POST' });
    await fetch(`${baseUrl}/v1/mailboxes/mailbox-b/messages/${message.messageId}`, { method: 'DELETE' });
    expect((await fetch(`${baseUrl}/v1/mailboxes/mailbox-a/messages`).then((response) => response.json())).messages).toHaveLength(1);
  });

  it('treats mailbox paths as opaque and cancels a pending long poll', async () => {
    const store = new RendezvousStore();
    const baseUrl = await startServer(store);
    const mailboxId = 'opaque%2Fcapability.without-decoding';
    const controller = new AbortController();
    const pending = fetch(`${baseUrl}/v1/mailboxes/${mailboxId}/messages?wait=25`, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 30));
    controller.abort();
    await expect(pending).rejects.toThrow();

    const message = { messageId: 'opaque_path_message', ciphertext: 'opaque', expiresAt: Date.now() + 60_000 };
    const put = await fetch(`${baseUrl}/v1/mailboxes/${mailboxId}/messages`, { method: 'PUT', body: JSON.stringify(message) });
    expect(put.status).toBe(202);
    expect((await fetch(`${baseUrl}/v1/mailboxes/${mailboxId}/messages`).then((response) => response.json())).messages).toHaveLength(1);
  });

  it('rejects malformed, oversized, and overlong messages with generic errors', async () => {
    const baseUrl = await startServer();
    const endpoint = `${baseUrl}/v1/mailboxes/opaque/messages`;
    const invalid = await fetch(endpoint, { method: 'PUT', body: '{not-json' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'invalid-request' });

    const tooLarge = await fetch(endpoint, { method: 'PUT', body: JSON.stringify({ messageId: 'large_message_123', ciphertext: 'x'.repeat(64 * 1024), expiresAt: Date.now() + 60_000 }) });
    expect(tooLarge.status).toBe(400);

    const tooLong = await fetch(endpoint, { method: 'PUT', body: JSON.stringify({ messageId: 'long_message_123', ciphertext: 'opaque', expiresAt: Date.now() + 16 * 60 * 1000 }) });
    expect(tooLong.status).toBe(400);
  });

  it('reports health without exposing mailbox contents', async () => {
    const baseUrl = await startServer();
    const health = await fetch(`${baseUrl}/healthz`).then((response) => response.json());
    expect(health).toEqual({ service: 'rendezvous-service', status: 'ok', phase: 3 });
  });
});
