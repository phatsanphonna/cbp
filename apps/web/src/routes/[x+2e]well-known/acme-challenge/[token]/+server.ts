import { findAcmeChallenge } from '@cbp/database/renewals';
import { getDatabase } from '#lib/server/database.js';
import { acmeToken, renewalAvailable } from '#lib/server/lets-encrypt.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const authorization =
    renewalAvailable && acmeToken.test(params.token)
      ? await findAcmeChallenge(getDatabase(), params.token)
      : undefined;
  return new Response(authorization ?? null, {
    status: authorization ? 200 : 404,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    },
  });
};
