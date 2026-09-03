import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 8787);

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ service: 'rendezvous-service', status: 'ok', phase: 0 }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not-found' }));
});

server.listen(port, () => {
  console.log(`SecureVoice rendezvous service listening on http://localhost:${port}`);
});
