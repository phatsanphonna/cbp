const maxEntries = 500;
const lifetimeMs = 10 * 60_000;
const secrets = new Map<string, { value: string; expiresAt: number }>();

function prune(now = Date.now()) {
  for (const [id, secret] of secrets) {
    if (secret.expiresAt <= now) secrets.delete(id);
  }
  while (secrets.size >= maxEntries) {
    const oldest = secrets.keys().next().value;
    if (!oldest) break;
    secrets.delete(oldest);
  }
}

export function keepDeploymentSecret(id: string, value: string) {
  prune();
  secrets.set(id, { value, expiresAt: Date.now() + lifetimeMs });
}

export function takeDeploymentSecret(id: string) {
  const secret = secrets.get(id);
  secrets.delete(id);
  return secret && secret.expiresAt > Date.now() ? secret.value : null;
}

export function discardDeploymentSecret(id: string) {
  secrets.delete(id);
}
