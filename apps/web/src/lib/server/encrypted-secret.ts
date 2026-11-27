import { BETTER_AUTH_SECRET } from '$app/env/private';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

function key(context: string) {
  if (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
    throw new Error('The server secret is required to store credentials.');
  }
  return Buffer.from(hkdfSync('sha256', BETTER_AUTH_SECRET, '', context, 32));
}

export function encryptSecret(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(context), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptSecret(value: string, context: string) {
  try {
    const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !encrypted || iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(context), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
