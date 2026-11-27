import { listAnsibleCredentialIds, readHostCredentialBinding, readSavedCredentialRecord } from './deployment-secrets.js';
import { readAnsibleCredentials } from './ansible-deployment-payload.js';

export async function readAnsibleProfile(id: string) {
  const record = await readSavedCredentialRecord('ansible-profile', id);
  const value: unknown = JSON.parse(record.value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid credential');
  const profile = value as Record<string, unknown>;
  if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 100 || !profile.credentials || typeof profile.credentials !== 'object' || Array.isArray(profile.credentials))
    throw new Error('Invalid credential');
  const fields = new FormData();
  for (const field of ['sshUsername', 'sshPassword', 'becomeMethod', 'suPassword']) {
    const item = (profile.credentials as Record<string, unknown>)[field];
    if (typeof item === 'string') fields.set(field, item);
  }
  const result = readAnsibleCredentials(fields);
  if (result.message) throw new Error('Invalid credential');
  return { name: profile.name, credentials: result.credentials, createdAt: record.createdAt };
}

export async function listAnsibleProfiles() {
  const ids = await listAnsibleCredentialIds();
  const profiles = await Promise.all(ids.map(async (id) => { const profile = await readAnsibleProfile(id); return { id, name: profile.name, createdAt: profile.createdAt }; }));
  return profiles.sort((a, b) => a.name.localeCompare(b.name));
}

export async function boundAnsibleCredential(hostId: string) {
  const id = await readHostCredentialBinding(hostId);
  if (!id) return null;
  return { id, ...(await readAnsibleProfile(id)) };
}
