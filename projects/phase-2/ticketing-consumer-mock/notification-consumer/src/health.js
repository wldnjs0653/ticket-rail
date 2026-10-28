import { createServer } from 'node:http';

export function startHealthServer({ port, isReady }) {
  const server = createServer((request, response) => {
    if (request.url === '/health/live') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'UP' }));
      return;
    }
    if (request.url === '/health/ready') {
      const ready = isReady();
      response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: ready ? 'READY' : 'NOT_READY' }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code: 'NOT_FOUND' }));
  });
  server.listen(port, '0.0.0.0');
  return server;
}
