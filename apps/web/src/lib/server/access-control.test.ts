import { expect, test } from 'bun:test';
import {
  assetViewer,
  canChangeGroupMembership,
  canChangeSudoGrant,
  keepsOwnerAccess,
  requiredWritePermission,
} from './access-control.js';

test('admins and sudo bypass ownership; others cannot remove their own access', () => {
  const member = { id: 'u1', groupIds: [7], isAdmin: false, permissions: ['hosts.manage'] };
  expect(assetViewer({ ...member, isAdmin: true })).toBeNull();
  expect(assetViewer({ ...member, permissions: ['sudo'] })).toBeNull();
  const viewer = assetViewer(member);
  expect(viewer).toEqual({ userId: 'u1', groupIds: [7] });

  expect(keepsOwnerAccess(viewer, [], [])).toBe(true);
  expect(keepsOwnerAccess(viewer, ['u1'], [])).toBe(true);
  expect(keepsOwnerAccess(viewer, ['u2'], [7])).toBe(true);
  expect(keepsOwnerAccess(viewer, ['u2'], [8])).toBe(false);
  expect(keepsOwnerAccess(null, ['u2'], [])).toBe(true);
});

test('each write action requires its permission', () => {
  const cases: [string, string, string | null | undefined][] = [
    ['/signin', 'default', null],
    ['/account/password', 'default', null],
    ['/users', 'remove', 'users.manage'],
    ['/users', 'assignGroups', 'groups.manage'],
    ['/users', 'assignPermissions', 'permissions.manage'],
    ['/users/new', 'default', 'users.manage'],
    ['/groups', 'members', 'groups.manage'],
    ['/groups', 'savePermissions', 'permissions.manage'],
    ['/hosts/[id]', 'linkDeployment', 'deployments.manage'],
    ['/hosts/[id]', 'bindCredential', 'credentials.manage'],
    ['/hosts/[id]', 'inviteAgent', 'agents.manage'],
    ['/hosts/[id]', 'remove', 'hosts.manage'],
    ['/certificates/[id]', 'deploy', 'deployments.manage'],
    ['/certificates/[id]', 'enableAutoDeploy', 'deployments.manage'],
    ['/certificates/[id]', 'renewNow', 'renewals.manage'],
    ['/certificates/[id]', 'deleteCredential', 'credentials.manage'],
    ['/certificates/[id]', 'remove', 'certificates.manage'],
    ['/certificates/[id]', 'setOwners', 'certificates.manage'],
    ['/hosts/[id]', 'setOwners', 'hosts.manage'],
    ['/ansible-credentials', 'setOwners', 'credentials.manage'],
    ['/deployments/[id]', 'cancel', 'deployments.manage'],
    ['/ansible-credentials', 'create', 'credentials.manage'],
    ['/not-a-route', 'default', undefined],
  ];
  for (const [route, action, permission] of cases)
    expect([route, action, requiredWritePermission(route, action)]).toEqual([
      route,
      action,
      permission,
    ]);
});

test('only sudo users change sudo or groups above their own permissions', () => {
  const manager = { isAdmin: false, permissions: ['groups.manage', 'hosts.manage'] };
  const sudo = { isAdmin: false, permissions: ['sudo'] };
  const admin = { isAdmin: true, permissions: [] };

  expect(canChangeSudoGrant(manager, [], ['hosts.manage'])).toBe(true);
  expect(canChangeSudoGrant(manager, [], ['sudo'])).toBe(false);
  expect(canChangeSudoGrant(manager, ['sudo'], [])).toBe(false);
  expect(canChangeSudoGrant(sudo, [], ['sudo'])).toBe(true);
  expect(canChangeSudoGrant(admin, ['sudo'], [])).toBe(true);

  expect(canChangeGroupMembership(manager, [{ permissions: ['hosts.manage'] }])).toBe(true);
  expect(canChangeGroupMembership(manager, [{ permissions: ['sudo'] }])).toBe(false);
  expect(canChangeGroupMembership(manager, [{ permissions: ['permissions.manage'] }])).toBe(false);
  expect(canChangeGroupMembership(manager, [])).toBe(true);
  expect(canChangeGroupMembership(sudo, [{ permissions: ['sudo'] }])).toBe(true);
});
