import { resolve } from '$app/paths';
import { fail, redirect } from '@sveltejs/kit';
import { registerCertificate } from '@cbp/database/inventory';
import { groupExists, listGroups } from '@cbp/database/groups';
import { getDatabase } from '#lib/server/database.js';
import { readCertificateChain } from '#lib/server/certificate-chain.js';
import { parseGroupId } from '#lib/server/group-id.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ groups: await listGroups(getDatabase()) });

export const actions: Actions = {
  default: async ({ request }) => {
    const fields = await request.formData();
    const selected = fields.get('groupId');
    const groupId = parseGroupId(selected);
    const database = getDatabase();
    if (selected && (groupId === null || !(await groupExists(database, groupId)))) {
      return fail(400, { message: 'Choose an existing group or leave the certificate unassigned.', groupId: null });
    }

    const chain = await readCertificateChain(fields);
    if ('message' in chain) return fail(400, { message: chain.message, groupId });

    const [saved] = await registerCertificate(database, { ...chain.metadata, domain: chain.domain, groupId });
    if (!saved) return fail(409, { message: 'This certificate is already registered.', groupId });
    redirect(303, resolve('/certificates/[id]', { id: saved.id }));
  }
};
