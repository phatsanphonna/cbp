import {
  createPrivateKey,
  randomBytes,
  webcrypto,
  X509Certificate as NodeX509Certificate,
} from 'node:crypto';
import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  PemConverter,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from '@peculiar/x509';
import { parseCertificateChain } from './certificate-chain.js';

const dnsName = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const maxNames = 100;
const validityMs = 365 * 24 * 60 * 60_000;
export const selfSignedIssuer = 'CN=Self-signed certificate';
export const selfSignedKeyContext = (id: string) =>
  'cbp/selfsigned/certificate/v1/' + id;

function isGeneratedSelfSigned(fullchain: string) {
  try {
    const certificate = new NodeX509Certificate(fullchain);
    return (
      certificate.subject === certificate.issuer &&
      certificate.issuer.includes('Self-signed certificate')
    );
  } catch {
    return false;
  }
}

function normalizeNames(names: readonly string[]) {
  const normalized = names.map((name) => name.trim().toLowerCase());
  if (
    !normalized.length ||
    normalized.length > maxNames ||
    normalized.some((name) => name.length > 253 || !dnsName.test(name))
  )
    return null;
  return [...new Set(normalized)];
}

export function readSelfSignedNames(value: FormDataEntryValue | null) {
  if (typeof value !== 'string' || value.length > 25_400) return null;
  const entries = value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (entries.length > maxNames) return null;
  const names = normalizeNames(entries);
  if (!names) return null;
  return { domain: names[0], names };
}

export function selfSignedCertificateNames(
  domain: string,
  fullchain: string | null,
) {
  if (!fullchain) return null;
  const parsed = parseCertificateChain(fullchain);
  if (
    'message' in parsed ||
    !isGeneratedSelfSigned(fullchain) ||
    parsed.domain !== domain
  )
    return null;
  const names = normalizeNames(parsed.metadata.sans);
  return names?.join(',') === parsed.metadata.sans.join(',') ? names : null;
}

function serialNumber() {
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  serial[0] ||= 1;
  return serial.toString('hex');
}

function extensions(names: string[]) {
  return [
    new BasicConstraintsExtension(false, undefined, true),
    new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
    new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]),
    new SubjectAlternativeNameExtension(
      names.map((value) => ({ type: 'dns', value })),
    ),
  ];
}

function metadata(fullchain: string) {
  const parsed = parseCertificateChain(fullchain);
  if ('message' in parsed) throw new Error(parsed.message);
  if (!isGeneratedSelfSigned(fullchain))
    throw new Error('Generated certificate is not self-signed');
  return { ...parsed.metadata, issuer: selfSignedIssuer };
}

export async function generateSelfSignedCertificate(inputNames: string[]) {
  const names = normalizeNames(inputNames);
  if (!names) throw new Error('Invalid self-signed certificate names');
  const keys = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const now = Date.now();
  const certificate = await X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: serialNumber(),
      name: selfSignedIssuer,
      notBefore: new Date(now - 60_000),
      notAfter: new Date(now + validityMs),
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      keys,
      extensions: extensions(names),
    },
    webcrypto,
  );
  const fullchain = certificate.toString('pem');
  const key = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return {
    metadata: metadata(fullchain),
    privateKey: PemConverter.encode(key, PemConverter.PrivateKeyTag),
  };
}

export async function renewSelfSignedCertificate(
  names: string[],
  fullchain: string,
  privateKeyPem: string,
) {
  const normalized = normalizeNames(names);
  if (!normalized) throw new Error('Invalid self-signed certificate names');
  const existing = new NodeX509Certificate(fullchain);
  if (
    !isGeneratedSelfSigned(fullchain) ||
    !existing.checkPrivateKey(createPrivateKey(privateKeyPem))
  )
    throw new Error('The self-signed certificate key does not match');

  const keys = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const now = Date.now();
  const certificate = await X509CertificateGenerator.createSelfSigned(
    {
      serialNumber: serialNumber(),
      name: selfSignedIssuer,
      notBefore: new Date(now - 60_000),
      notAfter: new Date(now + validityMs),
      keys,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      extensions: extensions(normalized),
    },
    webcrypto,
  );
  const renewedFullchain = certificate.toString('pem');
  const key = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return {
    metadata: metadata(renewedFullchain),
    privateKey: PemConverter.encode(key, PemConverter.PrivateKeyTag),
  };
}
