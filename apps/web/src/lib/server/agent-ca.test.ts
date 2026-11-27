import { expect, test } from 'bun:test';
import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { publicAgentCaPem } from './agent-ca.js';

test('accepts a bundle of public PEM certificates', () => {
  const certificates = rootCertificates.slice(0, 2);
  expect(publicAgentCaPem(certificates.join('\n'))).toBe(
    certificates.map((pem) => new X509Certificate(pem).toString().trim()).join('\n') + '\n',
  );
});

test('rejects key material and oversized bundles', () => {
  const pem = rootCertificates[0];
  expect(
    publicAgentCaPem(`${pem}\n-----BEGIN PRIVATE KEY-----\ninvalid\n-----END PRIVATE KEY-----\n`),
  ).toBeNull();
  expect(publicAgentCaPem(pem.repeat(40))).toBeNull();
});
