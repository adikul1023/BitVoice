import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { RendezvousStore } from './store.js';

const maxBodyBytes = 64 * 1024;
type ServerOptions = { store?: RendezvousStore; now?: () => number };

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) throw new Error('body too large');
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('invalid body'); }
}

function route(pathname: string): string[] {
  return pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
}

export function createRendezvousServer(options: ServerOptions = {}): Server {
  const store = options.store ?? new RendezvousStore();
  const now = options.now ?? Date.now;

  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://localhost');

      const parts = route(requestUrl.pathname);
      if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
        writeJson(response, 200, { service: 'rendezvous-service', status: 'ok', phase: 3 });
        return;
      }

      if (parts.length === 4 && parts[0] === 'v1' && parts[1] === 'mailboxes' && parts[3] === 'messages') {
        const mailboxId = parts[2];
        if (request.method === 'PUT') {
          const body = await readBody(request) as { messageId?: unknown; ciphertext?: unknown; expiresAt?: unknown };
          if (typeof body.messageId !== 'string' || typeof body.ciphertext !== 'string' || typeof body.expiresAt !== 'number') throw new Error('invalid message');
          store.put(mailboxId, { messageId: body.messageId, ciphertext: body.ciphertext, expiresAt: body.expiresAt }, now());
          writeJson(response, 202, { accepted: true });
          return;
        }
        if (request.method === 'GET') {
          const waitSeconds = Math.min(Number(requestUrl.searchParams.get('wait') ?? 0) || 0, 25);
          const deadline = now() + waitSeconds * 1000;
          let messages = store.get(mailboxId, now());
          while (!messages.length && waitSeconds > 0 && now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            messages = store.get(mailboxId, now());
          }
          writeJson(response, 200, { messages });
          return;
        }
      }

      if (parts.length === 4 && parts[0] === 'v1' && parts[1] === 'messages' && parts[3] === 'ack' && request.method === 'POST') {
        store.ack(parts[2], now());
        writeJson(response, 202, { accepted: true });
        return;
      }
      if (parts.length === 3 && parts[0] === 'v1' && parts[1] === 'messages' && request.method === 'DELETE') {
        store.delete(parts[2], now());
        writeJson(response, 202, { accepted: true });
        return;
      }
      writeJson(response, 404, { error: 'not-found' });
    } catch {
      writeJson(response, 400, { error: 'invalid-request' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  createRendezvousServer().listen(port, () => {
    console.log(`SecureVoice rendezvous service listening on http://localhost:${port}`);
  });
}
