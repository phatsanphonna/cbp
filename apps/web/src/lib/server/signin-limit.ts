const minute = 60_000;
// shortcut: counters are per web process, so share them across replicas if the web app scales out.
const clients = new Map<string, { expiresAt: number; attempts: number; logins: Map<string, { attempts: number; nextAt: number }> }>();
let sweepAt = 0;
type AccountAttempts = { expiresAt: number; attempts: number };
const accounts = new Map<string, AccountAttempts>();
const unknownLogins = new Map<string, AccountAttempts>();
let accountSweepAt = 0;
let credentialChecks = 0;

export function reserveCredentialCheck() {
  if (credentialChecks >= 4) return null;
  credentialChecks++;
  return () => { credentialChecks--; };
}

export function allowAccountSignIn(accountId: string | undefined, login: string, now = Date.now()) {
  if (now >= accountSweepAt) {
    for (const attempts of [accounts, unknownLogins]) {
      for (const [key, bucket] of attempts) {
        if (now >= bucket.expiresAt) attempts.delete(key);
      }
    }
    accountSweepAt = now + minute;
  }

  const attempts = accountId ? accounts : unknownLogins;
  const key = accountId ?? login;
  let bucket = attempts.get(key);
  if (!bucket || now >= bucket.expiresAt) {
    if (!bucket && attempts.size >= 10_000) return null;
    bucket = { expiresAt: now + minute, attempts: 0 };
    attempts.set(key, bucket);
  }
  if (bucket.attempts >= 8) return null;
  bucket.attempts++;
  return () => {
    if (attempts.get(key) === bucket) attempts.delete(key);
  };
}

export function allowSignIn(address: string, now = Date.now()) {
  if (now >= sweepAt) {
    for (const [ip, client] of clients) {
      if (now >= client.expiresAt) clients.delete(ip);
    }
    sweepAt = now + minute;
  }

  let client = clients.get(address);
  if (!client || now >= client.expiresAt) {
    if (!client && clients.size >= 10_000) return null;
    client = { expiresAt: now + minute, attempts: 0, logins: new Map() };
    clients.set(address, client);
  }
  if (client.attempts >= 20) return null;
  client.attempts++;

  const { logins } = client;
  return (login: string) => {
    const previous = logins.get(login);
    if (previous && now < previous.nextAt) return false;
    const attempts = (previous?.attempts ?? 0) + 1;
    const delay = attempts < 3 ? 0 : Math.min(2 ** (attempts - 3), 16) * 1000;
    logins.set(login, { attempts, nextAt: now + delay });
    return true;
  };
}
