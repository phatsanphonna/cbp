import { CBP_VAULT_ADDR, CBP_VAULT_TOKEN } from '$app/env/private';
import createVault from 'node-vault';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const lifetimeMs = 10 * 60_000;
const secrets = new Map<string, { value: string; expiresAt: number }>();
const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

// node-vault otherwise sends localhost requests through inherited proxy settings.
const directRequest = {
  defaults:
    () =>
    (options: {
      uri: string;
      method: string;
      headers: Record<string, string>;
      json?: unknown;
      timeout?: number;
    }) =>
      new Promise((resolve, reject) => {
        const url = new URL(options.uri);
        const payload = options.json === undefined ? undefined : JSON.stringify(options.json);
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
          url,
          {
            method: options.method,
            headers: {
              ...options.headers,
              ...(payload ? { 'content-type': 'application/json' } : {}),
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 1024 * 1024) response.destroy(new Error('Vault response too large'));
              else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => {
              try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve({
                  statusCode: response.statusCode,
                  request: { path: url.pathname },
                  body: text ? JSON.parse(text) : null,
                });
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        request.setTimeout(options.timeout ?? 5000, () =>
          request.destroy(new Error('Vault request timed out')),
        );
        request.on('error', reject);
        request.end(payload);
      }),
};

function vault() {
  if (!CBP_VAULT_ADDR && !CBP_VAULT_TOKEN) return null;
  if (!CBP_VAULT_ADDR || !CBP_VAULT_TOKEN) throw new Error('Vault configuration is incomplete');
  const address = new URL(CBP_VAULT_ADDR);
  if (
    address.username ||
    address.password ||
    (address.protocol !== 'https:' &&
      !(
        address.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)
      ))
  )
    throw new Error('Vault requires HTTPS or a loopback HTTP address');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname);
  return createVault({
    endpoint: CBP_VAULT_ADDR,
    token: CBP_VAULT_TOKEN,
    debug: () => {},
    requestOptions: { timeout: 5000 },
    ...(loopback ? { 'request-promise': directRequest } : {}),
  });
}

function path(id: string) {
  if (!idPattern.test(id)) throw new Error('Invalid deployment secret ID');
  return `cbp/data/deployments/${id}`;
}

type SavedKind = 'certificate' | 'ansible' | 'ansible-profile' | 'host-binding';

function savedPath(kind: SavedKind, id: string, section: 'data' | 'metadata') {
  if (!idPattern.test(id)) throw new Error('Invalid certificate ID');
  return `cbp/${section}/credentials/${kind}/${id}`;
}

export function savedCredentialsAvailable() {
  return Boolean(CBP_VAULT_ADDR && CBP_VAULT_TOKEN);
}

export async function hasSavedCredential(kind: SavedKind, id: string) {
  const client = vault();
  if (!client) return false;
  try {
    const metadata = await client.read(savedPath(kind, id, 'metadata'));
    return Number(metadata?.data?.current_version) > 0;
  } catch (error) {
    if ((error as { response?: { statusCode?: number } }).response?.statusCode === 404)
      return false;
    throw error;
  }
}

export async function saveCredential(kind: SavedKind, id: string, value: string) {
  const client = vault();
  if (!client) throw new Error('Vault is required');
  await client.write(savedPath(kind, id, 'metadata'), { max_versions: 1 });
  await client.write(savedPath(kind, id, 'data'), { data: { value } });
}

export async function readSavedCredentialRecord(kind: SavedKind, id: string) {
  const client = vault();
  if (!client) throw new Error('Vault is required');
  const result = await client.read(savedPath(kind, id, 'data'));
  const value: unknown = result?.data?.data?.value;
  if (typeof value !== 'string') throw new Error('Invalid saved credential');
  const created = result?.data?.metadata?.created_time;
  const createdAt =
    typeof created === 'string' && Number.isFinite(Date.parse(created))
      ? new Date(created).toISOString()
      : null;
  return { value, createdAt };
}

export async function readSavedCredential(kind: SavedKind, id: string) {
  return (await readSavedCredentialRecord(kind, id)).value;
}

export async function deleteSavedCredential(kind: SavedKind, id: string) {
  const client = vault();
  if (!client) throw new Error('Vault is required');
  await client.delete(savedPath(kind, id, 'metadata'));
}

export async function listAnsibleCredentialIds() {
  const client = vault();
  if (!client) throw new Error('Vault is required');
  try {
    const listing = await client.list('cbp/metadata/credentials/ansible-profile');
    const keys: unknown = listing?.data?.keys;
    if (!Array.isArray(keys) || !keys.every((id) => typeof id === 'string' && idPattern.test(id)))
      throw new Error('Invalid credential listing');
    return keys as string[];
  } catch (error) {
    if ((error as { response?: { statusCode?: number } }).response?.statusCode === 404) return [];
    throw error;
  }
}

export async function readHostCredentialBinding(hostId: string) {
  try {
    const id = await readSavedCredential('host-binding', hostId);
    if (!idPattern.test(id)) throw new Error('Invalid credential binding');
    return id;
  } catch (error) {
    if ((error as { response?: { statusCode?: number } }).response?.statusCode === 404) return null;
    throw error;
  }
}

export async function keepDeploymentSecret(id: string, value: string) {
  const client = vault();
  if (client) {
    await client.write(path(id), { data: { value } });
    return;
  }
  const now = Date.now();
  for (const [key, secret] of secrets) if (secret.expiresAt <= now) secrets.delete(key);
  if (secrets.size >= 500) throw new Error('Deployment secret capacity reached');
  secrets.set(id, { value, expiresAt: now + lifetimeMs });
}

export async function takeDeploymentSecret(id: string) {
  const client = vault();
  if (client) {
    const result = await client.read(path(id));
    const value: unknown = result?.data?.data?.value;
    if (typeof value !== 'string') throw new Error('Invalid deployment secret');
    await discardDeploymentSecret(id);
    return value;
  }
  const secret = secrets.get(id);
  secrets.delete(id);
  return secret && secret.expiresAt > Date.now() ? secret.value : null;
}

export async function discardDeploymentSecret(id: string) {
  const client = vault();
  if (client) {
    path(id);
    await client.delete(`cbp/metadata/deployments/${id}`);
  } else {
    secrets.delete(id);
  }
}

export async function cleanupDeploymentSecrets() {
  const client = vault();
  if (!client) return;
  let listing;
  try {
    listing = await client.list('cbp/metadata/deployments');
  } catch (error) {
    if ((error as { response?: { statusCode?: number } }).response?.statusCode === 404) return;
    throw error;
  }
  const ids: unknown = listing?.data?.keys;
  if (!Array.isArray(ids)) throw new Error('Invalid Vault secret listing');
  for (const id of ids) {
    if (typeof id !== 'string' || !idPattern.test(id)) continue;
    let metadata;
    try {
      metadata = await client.read(`cbp/metadata/deployments/${id}`);
    } catch (error) {
      if ((error as { response?: { statusCode?: number } }).response?.statusCode === 404) continue;
      throw error;
    }
    const created = Date.parse(metadata?.data?.created_time);
    // Jobs expire within 15 minutes; allow extra time for interrupted requests.
    if (Number.isFinite(created) && created < Date.now() - 60 * 60_000)
      await discardDeploymentSecret(id);
  }
}
