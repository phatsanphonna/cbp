import { resolve } from '$app/paths';
import { fail, redirect } from '@sveltejs/kit';
import { registerCertificate } from '@cbp/database/inventory';
import { getDatabase } from '#lib/server/database.js';
import { readCertificateChain } from '#lib/server/certificate-chain.js';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const fields = await request.formData();
    const chain = await readCertificateChain(fields);
    if ('message' in chain) return fail(400, { message: chain.message });

    const [saved] = await registerCertificate(getDatabase(), { ...chain.metadata, domain: chain.domain });
    if (!saved) return fail(409, { message: 'This certificate is already registered.' });
    locals.auditTargetId = saved.id;
    redirect(303, resolve('/certificates/[id]', { id: saved.id }));
  }
};
