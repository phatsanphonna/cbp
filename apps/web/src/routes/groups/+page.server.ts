import { addGroupMember, createGroup, listGroupDirectory, removeGroupMember } from '@cbp/database/groups';
import { resolve } from '$app/paths';
import { fail, redirect } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/database.js';
import { parseGroupId } from '#lib/server/group-id.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => listGroupDirectory(getDatabase());

export const actions: Actions = {
  create: async ({ request }) => {
    const value = (await request.formData()).get('name');
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > 80) return fail(400, { message: 'Enter a group name up to 80 characters.' });
    const [group] = await createGroup(getDatabase(), name);
    if (!group) return fail(409, { message: 'A group with this name already exists.' });
    redirect(303, resolve('/groups'));
  },
  addMember: async ({ request }) => {
    const fields = await request.formData();
    const groupId = parseGroupId(fields.get('groupId'));
    const userId = fields.get('userId');
    if (!groupId || typeof userId !== 'string' || !userId) {
      return fail(400, { message: 'Choose a user to add.' });
    }
    if (!(await addGroupMember(getDatabase(), groupId, userId))) {
      return fail(404, { message: 'The group or user could not be found.' });
    }
    redirect(303, resolve('/groups'));
  },
  removeMember: async ({ request }) => {
    const fields = await request.formData();
    const groupId = parseGroupId(fields.get('groupId'));
    const userId = fields.get('userId');
    if (!groupId || typeof userId !== 'string' || !userId) {
      return fail(400, { message: 'Invalid membership.' });
    }
    await removeGroupMember(getDatabase(), groupId, userId);
    redirect(303, resolve('/groups'));
  }
};
