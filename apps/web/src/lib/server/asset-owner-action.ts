import { type AssetKind, setAssetOwners } from '@cbp/database/asset-owners';
import { fail } from '@sveltejs/kit';
import { assetViewer, keepsOwnerAccess } from './access-control.js';
import { getDatabase } from './database.js';

export function readOwnerFields(fields: FormData) {
  const userIds = fields.getAll('ownerUserId');
  const groupIds = fields.getAll('ownerGroupId');
  if (
    !userIds.every((value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)) ||
    !groupIds.every((value) => typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value))
  )
    return null;
  const groups = groupIds.map(Number);
  if (!groups.every((id) => id <= 2_147_483_647)) return null;
  return { userIds: userIds as string[], groupIds: groups };
}

// The caller has already checked that the viewer can access the asset and holds its manage permission.
export async function setOwnersAction(
  locals: App.Locals,
  kind: AssetKind,
  id: string,
  fields: FormData,
) {
  const owners = readOwnerFields(fields);
  if (!owners) return fail(400, { ownersError: 'Choose valid owners.' });
  if (!keepsOwnerAccess(assetViewer(locals.user), owners.userIds, owners.groupIds))
    return fail(400, {
      ownersError: 'Keep yourself or one of your groups as an owner, or remove every owner.',
    });
  locals.auditTargetId = id;
  const result = await setAssetOwners(getDatabase(), kind, id, owners.userIds, owners.groupIds);
  if (result === 'missing') return fail(404, { ownersError: 'This item no longer exists.' });
  if (result === 'invalid-owners')
    return fail(400, { ownersError: 'One or more selected owners no longer exist.' });
  return { ownersMessage: 'Owners updated.' };
}
