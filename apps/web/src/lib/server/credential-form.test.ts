import { expect, test } from 'bun:test';
import { readCredentialForm } from './credential-form.js';

const signInUrl = 'https://example.test/signin';

test('reads a normal sign-in form', async () => {
  const request = new Request(signInUrl, {
    method: 'POST',
    body: new URLSearchParams({
      identifier: 'operator',
      password: 'test-password',
    }),
  });
  const result = await readCredentialForm(request);
  expect('fields' in result && result.fields.get('identifier')).toBe('operator');
});

test('rejects oversized bodies without relying on Content-Length', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4096));
      controller.enqueue(new Uint8Array(4097));
      controller.close();
    },
  });
  const request = new Request(signInUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  expect(request.headers.has('content-length')).toBe(false);
  expect(await readCredentialForm(request)).toEqual({ status: 413 });
});
