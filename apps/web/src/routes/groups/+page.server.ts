import {
  createAccessGroup,
  listAccessGroups,
  listAccessUsers,
  removeAccessGroup,
  renameAccessGroup,
  setAccessGroupMembers,
  setAccessGroupPermissions,
} from '@cbp/database/access-control';
import { fail } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/database.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import {
  accessPermissions,
  canChangeGroupMembership,
  canChangeSudoGrant,
  hasPermission,
} from '#lib/server/access-control.js';
import type { Actions, PageServerLoad } from './$types';

const membershipError = 'You can only change membership of groups whose permissions you hold.';

async function findGroup(id: number) {
  return (await listAccessGroups(getDatabase())).find((group) => group.id === id);
}

const allowedPermissions = new Set<string>(accessPermissions.map(({ key }) => key));

function readId(value: FormDataEntryValue | null) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647 ? id : undefined;
}

function readName(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return error instanceof Error && error.cause !== error && uniqueConflict(error.cause);
}

export const load: PageServerLoad = async ({ locals }) => {
  const db = getDatabase();
  const [groups, users] = await Promise.all([listAccessGroups(db), listAccessUsers(db)]);
  const canManagePermissions = hasPermission(locals.user, 'permissions.manage');
  return {
    groups,
    users,
    permissions: accessPermissions,
    canManageGroups: hasPermission(locals.user, 'groups.manage'),
    canManagePermissions,
  };
};

export const actions: Actions = {
  create: async (event) => {
    if (!hasTrustedTransport(event))
      return fail(403, { message: 'Use the trusted HTTPS address to manage groups.' });
    const name = readName((await event.request.formData()).get('name'));
    if (!name || name.length > 80 || /[\p{Cc}]/u.test(name))
      return fail(400, { message: 'Enter a group name of up to 80 characters.' });
    const id = await createAccessGroup(getDatabase(), name);
    if (!id) return fail(409, { message: 'A group with that name already exists.' });
    event.locals.auditTargetId = String(id);
    return { success: 'Group created.' };
  },
  rename: async (event) => {
    if (!hasTrustedTransport(event))
      return fail(403, { message: 'Use the trusted HTTPS address to manage groups.' });
    const fields = await event.request.formData();
    const id = readId(fields.get('id'));
    const name = readName(fields.get('name'));
    if (!id || !name || name.length > 80 || /[\p{Cc}]/u.test(name))
      return fail(400, { message: 'Enter a valid group name.' });
    event.locals.auditTargetId = String(id);
    try {
      if (!(await renameAccessGroup(getDatabase(), id, name)))
        return fail(404, { message: 'That group no longer exists.' });
    } catch (error) {
      if (uniqueConflict(error))
        return fail(409, { message: 'A group with that name already exists.' });
      throw error;
    }
    return { success: 'Group renamed.' };
  },
  members: async (event) => {
    if (!hasTrustedTransport(event))
      return fail(403, { message: 'Use the trusted HTTPS address to manage groups.' });
    const fields = await event.request.formData();
    const id = readId(fields.get('id'));
    const submitted = fields.getAll('userId');
    if (!id || !submitted.every((value): value is string => typeof value === 'string')) {
      return fail(400, { message: 'Choose a valid group and user list.' });
    }
    const userIds = [...new Set(submitted)];
    event.locals.auditTargetId = String(id);
    const group = await findGroup(id);
    if (group && !canChangeGroupMembership(event.locals.user, [group]))
      return fail(403, { message: membershipError });
    const result = await setAccessGroupMembers(getDatabase(), id, userIds);
    if (result === 'missing') return fail(404, { message: 'That group no longer exists.' });
    if (result === 'invalid-users')
      return fail(400, { message: 'One or more selected users no longer exist.' });
    return { success: 'Group members updated.' };
  },
  savePermissions: async (event) => {
    if (!hasTrustedTransport(event))
      return fail(403, { message: 'Use the trusted HTTPS address to manage permissions.' });
    const fields = await event.request.formData();
    const groupId = readId(fields.get('groupId'));
    const submitted = fields.getAll('permission');
    if (
      !groupId ||
      !submitted.every(
        (value): value is string => typeof value === 'string' && allowedPermissions.has(value),
      )
    ) {
      return fail(400, { message: 'Choose a valid group and permission list.' });
    }
    event.locals.auditTargetId = String(groupId);
    const permissions = submitted.includes('sudo') ? ['sudo'] : [...new Set(submitted)];
    const group = await findGroup(groupId);
    if (group && !canChangeSudoGrant(event.locals.user, group.permissions, permissions))
      return fail(403, { message: 'Only a sudo user can grant or revoke sudo.' });
    const saved = await setAccessGroupPermissions(getDatabase(), groupId, permissions);
    if (!saved) return fail(404, { message: 'That group no longer exists.' });
    return { success: 'Group permissions updated.' };
  },
  remove: async (event) => {
    if (!hasTrustedTransport(event))
      return fail(403, { message: 'Use the trusted HTTPS address to manage groups.' });
    const id = readId((await event.request.formData()).get('id'));
    if (!id) return fail(400, { message: 'Choose a valid group.' });
    event.locals.auditTargetId = String(id);
    const group = await findGroup(id);
    // Removing a group revokes its permissions from every member.
    if (group?.members.length && !canChangeGroupMembership(event.locals.user, [group]))
      return fail(403, { message: membershipError });
    if (!(await removeAccessGroup(getDatabase(), id)))
      return fail(404, { message: 'That group no longer exists.' });
    return { success: 'Group removed.' };
  },
};
