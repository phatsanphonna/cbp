export const accessPermissions = [
  {
    key: 'agents.manage',
    label: 'Manage agents',
    description: 'Enroll agents and download agent credentials.',
  },
  {
    key: 'alerts.manage',
    label: 'Manage alerts',
    description: 'Clear alerts and configure notification channels.',
  },
  {
    key: 'certificates.manage',
    label: 'Manage certificates',
    description: 'Register, update, and remove certificates.',
  },
  {
    key: 'credentials.manage',
    label: 'Manage credentials',
    description: 'Store and assign Ansible and deployment credentials.',
  },
  {
    key: 'deployments.manage',
    label: 'Manage deployments',
    description: 'Start, update, recover, and cancel deployments.',
  },
  {
    key: 'groups.manage',
    label: 'Manage groups',
    description: 'Create groups and assign users to them.',
  },
  {
    key: 'hosts.manage',
    label: 'Manage hosts',
    description: 'Register, update, and remove hosts.',
  },
  {
    key: 'permissions.manage',
    label: 'Manage permissions',
    description: 'Grant permissions to groups and individual users.',
  },
  {
    key: 'renewals.manage',
    label: 'Manage renewals',
    description: 'Renew certificates and manage automatic renewal.',
  },
  { key: 'sudo', label: 'Sudo', description: 'Full administrator access to all CBP features.' },
  { key: 'users.manage', label: 'Manage users', description: 'Create and remove user accounts.' },
] as const;

export type AccessPermission = (typeof accessPermissions)[number]['key'];

type AccessUser = {
  isAdmin: boolean;
  permissions: string[];
} | null;

export function hasPermission(user: AccessUser | undefined, permission: AccessPermission) {
  return Boolean(
    user?.isAdmin || user?.permissions.includes('sudo') || user?.permissions.includes(permission),
  );
}

// Without sudo, an actor may only add or remove members of groups whose permissions they already hold.
export function canChangeGroupMembership(
  actor: AccessUser | undefined,
  groups: { permissions: string[] }[],
) {
  return (
    hasPermission(actor, 'sudo') ||
    groups.every(({ permissions }) =>
      permissions.every((permission) => actor?.permissions.includes(permission)),
    )
  );
}

// Granting or revoking sudo directly requires sudo.
export function canChangeSudoGrant(
  actor: AccessUser | undefined,
  before: string[],
  after: string[],
) {
  return hasPermission(actor, 'sudo') || before.includes('sudo') === after.includes('sudo');
}

export function requiredWritePermission(
  route: string,
  action: string,
): AccessPermission | null | undefined {
  if (['/signin', '/signout', '/account/password'].includes(route)) return null;
  if (route === '/users') {
    if (action === 'assignGroups') return 'groups.manage';
    if (action === 'assignPermissions') return 'permissions.manage';
  }
  if (['/users', '/users/new'].includes(route)) return 'users.manage';
  if (route === '/groups')
    return action === 'savePermissions' ? 'permissions.manage' : 'groups.manage';
  if (['/hosts', '/hosts/new'].includes(route)) return 'hosts.manage';
  if (route === '/hosts/[id]') {
    if (['linkDeployment', 'updateEndpoint', 'removeDeployment'].includes(action))
      return 'deployments.manage';
    if (action === 'bindCredential') return 'credentials.manage';
    if (['inviteAgent', 'resetAgent'].includes(action)) return 'agents.manage';
    return 'hosts.manage';
  }
  if (['/certificates', '/certificates/new'].includes(route)) return 'certificates.manage';
  if (route === '/certificates/[id]') {
    if (
      ['deploy', 'deployAnsible', 'deployMixed', 'enableAutoDeploy', 'disableAutoDeploy'].includes(
        action,
      )
    )
      return 'deployments.manage';
    if (['enableRenewal', 'disableRenewal', 'renewNow'].includes(action)) return 'renewals.manage';
    if (action === 'deleteCredential') return 'credentials.manage';
    return 'certificates.manage';
  }
  if (route === '/certificates/[id]/deploy') return 'deployments.manage';
  if (route === '/deployments/[id]') return 'deployments.manage';
  if (['/alerts', '/alerts/channels'].includes(route)) return 'alerts.manage';
  if (route === '/ansible-credentials') return 'credentials.manage';
  if (['/api/agent-ca', '/api/agent-download/[arch]'].includes(route)) return 'agents.manage';
}

export function canWriteRouteAction(user: AccessUser | undefined, route: string, action: string) {
  const permission = requiredWritePermission(route, action);
  if (permission === null) return true;
  if (permission) return hasPermission(user, permission);
  return Boolean(user?.isAdmin || user?.permissions.includes('sudo'));
}
