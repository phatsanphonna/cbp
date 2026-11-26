import { resolve } from '$app/paths';
import {
  findRenewalSource,
  listRenewals,
  setAutoRenew,
} from '@cbp/database/renewals';
import { fail, redirect } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/database.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { renewalAvailable } from '#lib/server/lets-encrypt.js';
import { http01Names, letsEncryptNames } from '#lib/server/renewal-names.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
  const format = dateFormatter(cookies.get('cbp-time-zone'));
  const timestamp = (date: Date) => ({
    iso: date.toISOString(),
    label: format.format(date),
  });
  return {
    renewalAvailable,
    renewals: (await listRenewals(getDatabase())).map((certificate) => ({
      id: certificate.id,
      domain: certificate.domain,
      enabled: certificate.enabled,
      eligible:
        certificate.hasFullchain &&
        Boolean(http01Names(certificate.domain, certificate.sans)),
      expires: timestamp(certificate.validUntil),
      nextAttempt: timestamp(certificate.nextAttempt),
      lastError: certificate.lastError,
    })),
  };
};

async function changeRenewal(
  { request, locals }: RequestEvent,
  enabled: boolean,
) {
  const id = (await request.formData()).get('certificateId');
  if (
    typeof id !== 'string' ||
    !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)
  ) {
    return fail(400, { message: 'Choose a certificate.' });
  }

  const db = getDatabase();
  let fingerprint: string | undefined;
  if (enabled) {
    if (!renewalAvailable)
      return fail(503, {
        message: 'Configure Let’s Encrypt on the server first.',
      });
    const certificate = await findRenewalSource(db, id);
    if (
      !certificate?.fingerprint ||
      !letsEncryptNames(certificate.domain, certificate.fullchain)
    ) {
      return fail(400, {
        message:
          'Upload a Let’s Encrypt fullchain that covers only non-wildcard DNS names.',
      });
    }
    fingerprint = certificate.fingerprint;
  }

  locals.auditTargetId = id;
  const [updated] = await setAutoRenew(db, id, enabled, fingerprint);
  if (!updated)
    return fail(409, {
      message:
        'This certificate or its renewal setting changed. Refresh and try again.',
    });
  redirect(303, resolve('/renewals'));
}

export const actions: Actions = {
  enable: (event) => changeRenewal(event, true),
  disable: (event) => changeRenewal(event, false),
};
