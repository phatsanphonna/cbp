import { expect, test } from 'bun:test';
import { getTrustedClientAddress, hasTrustedTransport, type Connection } from './trusted-transport.js';

test('the Bun adapter uses forwarded transport and IP only from the trusted proxy', () => {
  const key = 'CBP_TRUSTED_PROXY_TOKEN';
  const original = process.env[key];
  const token = 'x'.repeat(64);
  process.env[key] = token;
  try {
    const url = new URL('https://example.test');
    const request = new Request(url, { headers: { 'x-forwarded-proto': 'https', 'x-cbp-client-ip': '192.0.2.2' } });
    const platform = { server: {} } as Connection['platform'];
    const connection = { url, request, platform, getClientAddress: () => '192.0.2.1' };
    expect(hasTrustedTransport(connection)).toBe(false);
    expect(getTrustedClientAddress(connection)).toBe('192.0.2.1');
    request.headers.set('x-cbp-proxy-token', token);
    expect(hasTrustedTransport(connection)).toBe(true);
    expect(getTrustedClientAddress(connection)).toBe('192.0.2.2');
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

test('HTTP development requires a loopback host and peer', () => {
  const url = new URL('http://localhost');
  const request = new Request(url);
  expect(hasTrustedTransport({ url, request, getClientAddress: () => '127.0.0.1' })).toBe(true);
  expect(hasTrustedTransport({ url, request, getClientAddress: () => '192.0.2.1' })).toBe(false);
});

test('native HTTPS trusts the TLS listener and keeps the socket client IP', () => {
  const original = process.env.CBP_TRUSTED_PROXY_TOKEN;
  const token = 'x'.repeat(64);
  process.env.CBP_TRUSTED_PROXY_TOKEN = token;
  try {
    const url = new URL('https://cbp.example.test');
    const platform = { server: { url } } as Connection['platform'];
    const request = new Request(url);
    const connection = { url, request, platform, getClientAddress: () => '192.0.2.1' };
    expect(hasTrustedTransport(connection)).toBe(true);

    request.headers.set('x-forwarded-proto', 'https');
    request.headers.set('x-cbp-proxy-token', token);
    request.headers.set('x-cbp-client-ip', '192.0.2.2');
    expect(getTrustedClientAddress(connection)).toBe('192.0.2.1');
  } finally {
    if (original === undefined) delete process.env.CBP_TRUSTED_PROXY_TOKEN;
    else process.env.CBP_TRUSTED_PROXY_TOKEN = original;
  }
});
