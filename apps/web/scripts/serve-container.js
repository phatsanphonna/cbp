const origin = new URL(Bun.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000');
const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && loopback)) {
  throw new Error('BETTER_AUTH_URL must use HTTPS outside loopback development');
}
const proxyToken = Bun.env.CBP_TRUSTED_PROXY_TOKEN;
if (proxyToken && !/^[A-Za-z0-9_-]{43,128}$/.test(proxyToken)) {
  throw new Error('CBP_TRUSTED_PROXY_TOKEN must be a 43 to 128 character URL-safe token');
}

Bun.env.CBP_BUN_ORIGIN = origin.origin;
// Keep the adapter's client address tied to the socket. CBP verifies forwarded addresses itself.
delete Bun.env.CBP_BUN_ADDRESS_HEADER;
await import('../dist/index.js');
