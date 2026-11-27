import postgres from 'postgres';

export async function listenForLiveUpdates(
  url: string | undefined,
  notify: (message: string) => void,
  reconnect: () => void,
) {
  // postgres() without a URL silently falls back to PG* defaults.
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = postgres(url, { max: 1 });
  let connected = false;
  try {
    await db.listen('cbp_deployment_updates', notify, () => {
      if (connected) reconnect();
      connected = true;
    });
  } catch (error) {
    await db.end({ timeout: 0 });
    throw error;
  }
  return () => db.end({ timeout: 0 });
}
