import { expect, test } from 'bun:test';
import { http01Names, readIssuanceNames } from './renewal-names.js';

test('HTTP-01 preserves every DNS name in a multi-name certificate', () => {
  expect(
    http01Names('WWW.example.com', ['api.example.com', 'www.example.com']),
  ).toEqual(['api.example.com', 'www.example.com']);
});

test('HTTP-01 renewal rejects a certificate if it cannot renew every identifier', () => {
  for (const unsupported of [
    '*.example.com',
    '192.0.2.1',
    '2001:db8::1',
    'localhost',
    'bad_name.example.com',
  ]) {
    expect(
      http01Names('www.example.com', ['www.example.com', unsupported]),
    ).toBeNull();
  }
  expect(http01Names('www.example.com', ['api.example.com'])).toBeNull();
});

test('issuance keeps the first hostname as the primary and requests distinct names', () => {
  expect(
    readIssuanceNames(' WWW.example.com\r\n\r\nexample.com\nwww.example.com '),
  ).toEqual({
    domain: 'www.example.com',
    names: ['example.com', 'www.example.com'],
  });
});

test('issuance rejects invalid and oversized hostname lists', () => {
  for (const value of [
    null,
    new File(['example.com'], 'hosts.txt'),
    '',
    'example.com\n*.example.com',
    'https://example.com',
    'example.com\n192.0.2.1',
    Array.from({ length: 101 }, (_, i) => i + '.example.com').join('\n'),
  ]) {
    expect(readIssuanceNames(value)).toBeNull();
  }
});
