import { X509Certificate } from 'node:crypto';

const dnsName = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const publicPem = /-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----/g;
const maxPemSize = 32_768;

export function certificatePemBlocks(pem: string) {
  const blocks = pem.match(publicPem);
  return blocks?.length && !pem.replace(publicPem, '').trim() ? blocks : null;
}

export async function readCertificateChain(fields: FormData) {
  const pasted = fields.get('pem');
  const upload = fields.get('certificateFile');
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  if (file && typeof pasted === 'string' && pasted.trim()) {
    return { message: 'Choose a PEM file or paste its contents.' } as const;
  }
  if ((file?.size ?? 0) > maxPemSize || (typeof pasted === 'string' && pasted.length > maxPemSize)) {
    return { message: 'Use a PEM certificate or chain up to 32 KB.' } as const;
  }

  return parseCertificateChain(file ? await file.text() : typeof pasted === 'string' ? pasted : '');
}

export function parseCertificateChain(pem: string) {
  if (pem.length > maxPemSize) return { message: 'Use a PEM certificate or chain up to 32 KB.' } as const;
  const blocks = certificatePemBlocks(pem);
  if (!blocks) {
    return { message: 'Provide a public PEM certificate or fullchain.pem containing only certificates.' } as const;
  }

  let leaf: X509Certificate;
  try {
    [leaf] = blocks.map((block) => new X509Certificate(block));
  } catch {
    return { message: 'The PEM contains an unreadable certificate.' } as const;
  }

  const validFrom = new Date(leaf.validFrom);
  const validUntil = new Date(leaf.validTo);
  if (!Number.isFinite(validFrom.getTime()) || !Number.isFinite(validUntil.getTime()) || validFrom >= validUntil) {
    return { message: 'The certificate has invalid validity dates.' } as const;
  }

  // Quoted SAN values can contain commas. Keep them intact while extracting DNS and IP names.
  const names = leaf.subjectAltName?.match(/(?:"(?:\\.|[^"\\])*"|[^",])+/g).map((name) => name.trim()) ?? [];
  const dnsEntries = names.filter((name) => name.startsWith('DNS:'));
  const dnsNames = dnsEntries.map((name) => name.slice(4).toLowerCase()).filter(isDnsName);
  const commonName = leaf.toLegacyObject().subject?.CN;
  if (!dnsEntries.length && typeof commonName === 'string' && isDnsName(commonName)) {
    dnsNames.push(commonName.toLowerCase());
  }
  const [domain] = dnsNames;
  if (!domain) return { message: 'The leaf certificate has no usable DNS hostname.' } as const;

  const sans = names.flatMap((name) => {
    const match = /^(?:DNS|IP Address):([a-z\d.*:-]+)$/i.exec(name);
    return match ? [match[1]] : [];
  });

  return {
    domain,
    covers(hostname: string) {
      return hostname.startsWith('*.')
        ? dnsNames.includes(hostname.toLowerCase())
        : Boolean(leaf.checkHost(hostname, { partialWildcards: false }));
    },
    metadata: {
      issuer: leaf.issuer,
      serial: leaf.serialNumber,
      fingerprint: leaf.fingerprint256,
      fullchain: blocks.join('\n') + '\n',
      validFrom,
      validUntil,
      sans: [...new Set(sans)]
    }
  };
}

function isDnsName(value: string) {
  return value.length <= 253 && dnsName.test(value);
}
