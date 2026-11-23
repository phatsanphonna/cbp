import { resolve, sep } from 'node:path';
import { server as app } from '../dist/app.js';

const clientDirectory = resolve(import.meta.dir, '../dist/client');
const serverDirectory = resolve(import.meta.dir, '../dist/server');
const origin = new URL(Bun.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000');

await app.init({ env: Bun.env, read: (file) => Bun.file(resolve(serverDirectory, file)).stream() });

Bun.serve({
  hostname: '0.0.0.0',
  port: 3000,
  idleTimeout: 30,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (request.method === 'GET' || request.method === 'HEAD') {
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return new Response(null, { status: 400 });
      }
      const filename = resolve(clientDirectory, `.${path}`);
      if (filename.startsWith(clientDirectory + sep)) {
        const file = Bun.file(filename);
        if (await file.exists()) {
          const headers = new Headers({ 'content-type': file.type, 'content-length': String(file.size) });
          if (path.startsWith('/_app/immutable/')) headers.set('cache-control', 'public, max-age=31536000, immutable');
          return new Response(request.method === 'HEAD' ? null : file, { headers });
        }
      }
    }

    // Use the configured public origin behind a TLS-terminating proxy.
    url.protocol = origin.protocol;
    url.hostname = origin.hostname;
    url.port = origin.port;
    return app.respond(new Request(url, request), { getClientAddress: () => server.requestIP(request)?.address ?? '' });
  }
});
