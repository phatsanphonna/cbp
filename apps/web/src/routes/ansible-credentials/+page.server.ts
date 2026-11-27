import { randomUUID } from 'node:crypto';
import { error, fail } from '@sveltejs/kit';
import { findHost, listHosts } from '@cbp/database/inventory';
import { listAnsibleProfiles, readAnsibleProfile } from '#lib/server/ansible-credentials.js';
import { readAnsibleCredentials } from '#lib/server/ansible-deployment-payload.js';
import {
  deleteSavedCredential,
  readHostCredentialBinding,
  saveCredential,
  savedCredentialsAvailable,
} from '#lib/server/deployment-secrets.js';
import { getDatabase } from '#lib/server/database.js';
import { dateFormatter } from '#lib/server/date-formatter.js';
import { hasTrustedTransport } from '#lib/server/trusted-transport.js';
import { assetViewer, hasPermission } from '#lib/server/access-control.js';
import { setOwnersAction } from '#lib/server/asset-owner-action.js';
import {
  addAssetOwner,
  canAccessAsset,
  listAssetOwners,
  listOwnerOptions,
  removeAssetOwners,
  type AssetKind,
} from '@cbp/database/asset-owners';
import type { Actions, PageServerLoad } from './$types';

const idPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

const canAccess = (locals: App.Locals, kind: AssetKind, id: string) =>
  canAccessAsset(getDatabase(), kind, id, assetViewer(locals.user));

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ 'cache-control': 'no-store' });
  if (!hasPermission(event.locals.user, 'credentials.manage'))
    error(403, 'Credential management permission is required.');
  if (!savedCredentialsAvailable() || !hasTrustedTransport(event))
    return { profiles: [], hosts: [], ownerOptions: null, available: false };
  try {
    const database = getDatabase();
    const viewer = assetViewer(event.locals.user);
    const [profiles, allHosts, ownerOptions] = await Promise.all([
      listAnsibleProfiles(viewer),
      listHosts(database, viewer),
      listOwnerOptions(database),
    ]);
    const owners = await Promise.all(
      profiles.map((profile) => listAssetOwners(database, 'credential', profile.id)),
    );
    // Only Ansible-managed hosts can be bound, so skip the Vault read for the rest.
    const hosts = allHosts.filter((host) => host.ansibleManaged);
    const bindings = profiles.length
      ? await Promise.all(
          hosts.map(async (host) => ({
            id: host.id,
            name: host.name,
            credentialId: await readHostCredentialBinding(host.id),
          })),
        )
      : [];
    const format = dateFormatter(event.cookies.get('cbp-time-zone'));
    return {
      profiles: profiles.map((profile, index) => ({
        ...profile,
        owners: owners[index],
        createdLabel: profile.createdAt ? format.format(new Date(profile.createdAt)) : null,
        boundHosts: bindings
          .filter((binding) => binding.credentialId === profile.id)
          .map(({ id, name }) => ({ id, name })),
      })),
      hosts: hosts.map((host) => ({
        value: host.id,
        label:
          host.hostname && host.hostname !== host.name
            ? `${host.name} (${host.hostname})`
            : host.name,
      })),
      ownerOptions,
      available: true,
    };
  } catch {
    return { profiles: [], hosts: [], ownerOptions: null, available: false };
  }
};

export const actions: Actions = {
  unbind: async (event) => {
    if (!hasPermission(event.locals.user, 'credentials.manage') || !hasTrustedTransport(event))
      error(403, 'Credential management permission and a trusted connection are required.');
    const fields = await event.request.formData();
    const id = fields.get('id');
    const hostId = fields.get('hostId');
    if (
      typeof id !== 'string' ||
      !idPattern.test(id) ||
      typeof hostId !== 'string' ||
      !idPattern.test(hostId)
    )
      return fail(400, { message: 'Choose a valid credential and host.' });
    const host =
      (await canAccess(event.locals, 'credential', id)) &&
      (await canAccess(event.locals, 'host', hostId))
        ? await findHost(getDatabase(), hostId)
        : null;
    if (!host) return fail(404, { message: 'This host no longer exists.' });
    try {
      if ((await readHostCredentialBinding(host.id)) !== id)
        return fail(409, { message: 'The host credential changed. Refresh and try again.' });
      await deleteSavedCredential('host-binding', host.id);
    } catch {
      return fail(503, { message: 'Could not unbind the credential. Check Vault availability.' });
    }
    event.locals.auditTargetId = host.id;
    return { success: 'Credential unbound.' };
  },
  bind: async (event) => {
    if (!hasPermission(event.locals.user, 'credentials.manage') || !hasTrustedTransport(event))
      error(403, 'Credential management permission and a trusted connection are required.');
    const fields = await event.request.formData();
    const id = fields.get('id');
    const hostId = fields.get('hostId');
    if (
      typeof id !== 'string' ||
      !idPattern.test(id) ||
      typeof hostId !== 'string' ||
      !idPattern.test(hostId)
    )
      return fail(400, { message: 'Choose a valid credential and host.' });
    if (
      !(await canAccess(event.locals, 'credential', id)) ||
      !(await canAccess(event.locals, 'host', hostId))
    )
      return fail(404, { message: 'Choose a valid credential and host.' });
    const host = await findHost(getDatabase(), hostId);
    if (!host || !host.ansibleManaged)
      return fail(409, { message: 'This host is no longer managed by Ansible.' });
    try {
      await readAnsibleProfile(id);
      await saveCredential('host-binding', host.id, id);
    } catch {
      return fail(503, { message: 'Could not bind the credential. Check Vault availability.' });
    }
    event.locals.auditTargetId = host.id;
    return { bindMessage: 'Credential bound.' };
  },
  create: async (event) => {
    if (!hasPermission(event.locals.user, 'credentials.manage') || !hasTrustedTransport(event))
      error(403, 'Credential management permission and a trusted connection are required.');
    const fields = await event.request.formData();
    const name = fields.get('name');
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 100 ||
      /[\p{Cc}]/u.test(name)
    )
      return fail(400, { message: 'Enter a name of up to 100 characters.' });
    const result = readAnsibleCredentials(fields);
    if (result.message) return fail(400, { message: result.message });
    const id = randomUUID();
    try {
      await saveCredential(
        'ansible-profile',
        id,
        JSON.stringify({ name: name.trim(), credentials: result.credentials }),
      );
    } catch {
      await Promise.allSettled([deleteSavedCredential('ansible-profile', id)]);
      return fail(503, { message: 'Could not save the credential in Vault.' });
    }
    await addAssetOwner(getDatabase(), 'credential', id, event.locals.user!.id);
    event.locals.auditTargetId = id;
    return { success: 'Credential created.' };
  },
  remove: async (event) => {
    if (!hasPermission(event.locals.user, 'credentials.manage') || !hasTrustedTransport(event))
      error(403, 'Credential management permission and a trusted connection are required.');
    const id = (await event.request.formData()).get('id');
    if (typeof id !== 'string' || !idPattern.test(id))
      return fail(400, { message: 'Choose a valid credential.' });
    if (!(await canAccess(event.locals, 'credential', id)))
      return fail(404, { message: 'Choose a valid credential.' });
    try {
      // Unfiltered on purpose: a binding on any host, visible or not, blocks deletion.
      const hosts = await listHosts(getDatabase());
      const bindings = await Promise.all(hosts.map((host) => readHostCredentialBinding(host.id)));
      if (bindings.includes(id))
        return fail(409, { message: 'Unbind this credential from its hosts before deleting it.' });
      await deleteSavedCredential('ansible-profile', id);
    } catch {
      return fail(503, { message: 'Could not delete the credential. Check Vault availability.' });
    }
    await removeAssetOwners(getDatabase(), 'credential', id);
    event.locals.auditTargetId = id;
    return { success: 'Credential deleted.' };
  },
  setOwners: async (event) => {
    if (!hasPermission(event.locals.user, 'credentials.manage') || !hasTrustedTransport(event))
      error(403, 'Credential management permission and a trusted connection are required.');
    const fields = await event.request.formData();
    const id = fields.get('id');
    if (
      typeof id !== 'string' ||
      !idPattern.test(id) ||
      !(await canAccess(event.locals, 'credential', id))
    )
      return fail(404, { ownersError: 'Choose a valid credential.' });
    return setOwnersAction(event.locals, 'credential', id, fields);
  },
};
