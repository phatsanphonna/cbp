import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';

export function openDatabase(connectionString = Bun.env.DATABASE_URL) {
  const url = connectionString && URL.canParse(connectionString)
    ? new URL(connectionString)
    : undefined;
  if (!url?.hostname || (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }

  return drizzle({ client: new SQL({ url: url.href, idleTimeout: 30, max: 2 }) });
}
