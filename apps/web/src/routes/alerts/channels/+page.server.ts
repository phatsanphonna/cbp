import {
  addChannel,
  bindChannelToCertificate,
  findChannel,
  listCertificateOptions,
  listChannels,
  removeChannel,
  setChannelEnabled,
  updateChannel,
} from '@cbp/database/inventory';
import { fail } from '@sveltejs/kit';
import { getDatabase } from '#lib/server/database.js';
import {
  channelSettings,
  notificationConfig,
  testAlertNotification,
  validNotificationDestination,
  validNotificationSettings,
} from '#lib/server/alert-notifications.js';
import type { Provider } from '#lib/server/alert-notifications.js';
import {
  encryptNotificationSettings,
  type NotificationSettings,
} from '#lib/server/notification-secrets.js';
import { isPublicWebhook } from '#lib/server/notification-webhook.js';
import { displayCertificateDomain } from '../../certificates/display-domain.js';
import type { Actions, PageServerLoad } from './$types';
import { assetViewer, hasPermission } from '#lib/server/access-control.js';
import { canAccessAsset, type Viewer } from '@cbp/database/asset-owners';

const providers = [
  'Slack',
  'LINE',
  'Telegram',
  'Email',
  'Webhook',
  'Microsoft Teams',
  'Discord',
] as const;
const severities = ['Info', 'Warning', 'High', 'Critical'] as const;

function textField(fields: FormData, name: string) {
  const value = fields.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

async function readCertificateScope(
  db: ReturnType<typeof getDatabase>,
  fields: FormData,
  viewer: Viewer,
  current: string[] | null = null,
) {
  if (!fields.has('certificateIds')) return current;
  const submitted = fields.getAll('certificateIds').filter((id) => id !== '');
  if (
    !submitted.every(
      (id): id is string =>
        typeof id === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id),
    )
  )
    return undefined;
  const ids = [...new Set(submitted.map((id) => id.toLowerCase()))];
  const added = ids.filter((id) => !current?.includes(id));
  if (added.length && (await listCertificateOptions(db, added, viewer)).length !== added.length) {
    return undefined;
  }
  return ids.length ? ids : null;
}

async function credentialError(provider: Provider, settings: NotificationSettings) {
  if (provider === 'Discord') {
    return validNotificationSettings(provider, settings)
      ? undefined
      : 'Enter a Discord channel webhook URL from discord.com.';
  }
  if (provider === 'Webhook' || provider === 'Microsoft Teams') {
    if (!validNotificationSettings(provider, settings)) return 'Enter a valid HTTPS webhook URL.';
    if (!(await isPublicWebhook(settings.secret, provider === 'Microsoft Teams'))) {
      return provider === 'Microsoft Teams'
        ? 'The server could not resolve a public IPv4 address for this URL. If you use a proxy, paste the Microsoft Teams Workflows URL.'
        : 'The server could not resolve a public IPv4 address for this webhook URL.';
    }
  } else if (!validNotificationSettings(provider, settings)) {
    return `Enter valid credentials for ${provider}.`;
  }
}

function isDuplicateDestination(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (('code' in error && error.code === '23505') || ('errno' in error && error.errno === '23505'))
    return true;
  return error instanceof Error && error.cause !== error && isDuplicateDestination(error.cause);
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const config = notificationConfig();
  const db = getDatabase();
  const [channels, certificates] = await Promise.all([
    listChannels(db),
    listCertificateOptions(db, undefined, assetViewer(locals.user)),
  ]);
  const certificateId = url.searchParams.get('certificate');
  return {
    canManageAlerts: hasPermission(locals.user, 'alerts.manage'),
    certificateId: certificates.find(({ id }) => id === certificateId)?.id ?? null,
    certificates: certificates.map(({ id, domain, sans, serial }) => ({
      value: id,
      label: displayCertificateDomain(domain, sans),
      serial,
    })),
    channels: channels.map((channel) => ({
      id: channel.id,
      provider: channel.provider,
      destination: channel.destination,
      severity: channel.severity,
      certificateIds: channel.certificateIds,
      enabled: channel.enabled,
      ready: Boolean(channelSettings(config, channel)),
    })),
  };
};

export const actions: Actions = {
  add: async ({ request, locals }) => {
    const fields = await request.formData();
    const provider = providers.find((value) => value === fields.get('provider'));
    const severity = severities.find((value) => value === fields.get('severity'));
    const destination = textField(fields, 'destination');
    if (!provider || !severity) {
      return fail(400, {
        message: 'Choose a provider and severity and enter a destination.',
      });
    }
    if (!validNotificationDestination(provider, destination)) {
      return fail(400, { message: `Enter a valid ${provider} destination.` });
    }

    const db = getDatabase();
    const certificateIds = await readCertificateScope(db, fields, assetViewer(locals.user));
    if (certificateIds === undefined)
      return fail(400, { message: 'Choose certificates from the inventory.' });
    const settings = {
      secret: textField(fields, 'secret'),
      sender: provider === 'Email' ? textField(fields, 'sender') : undefined,
    };
    const message = await credentialError(provider, settings);
    if (message) return fail(400, { message });
    const encryptedSettings = encryptNotificationSettings(settings);
    const [channel] = await addChannel(db, {
      provider,
      severity,
      destination,
      encryptedSettings,
      certificateIds,
    });
    if (!channel)
      return fail(409, {
        message: 'This destination already exists for that provider.',
      });
    locals.auditTargetId = String(channel.id);
    return { success: 'Notification channel added.' };
  },
  edit: async ({ request, locals }) => {
    const fields = await request.formData();
    const id = Number(fields.get('id'));
    if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) {
      return fail(400, { message: 'Invalid channel.' });
    }
    locals.auditTargetId = String(id);
    const db = getDatabase();
    const channel = await findChannel(db, id);
    if (!channel) return fail(404, { message: 'Notification channel not found.' });

    const { provider } = channel;
    const destination = textField(fields, 'destination');
    const severity = severities.find((value) => value === fields.get('severity'));
    if (!severity || !validNotificationDestination(provider, destination)) {
      return fail(400, {
        message: 'Enter a valid destination and minimum severity.',
      });
    }
    const certificateIds = await readCertificateScope(
      db,
      fields,
      assetViewer(locals.user),
      channel.certificateIds,
    );
    if (certificateIds === undefined)
      return fail(400, { message: 'Choose certificates from the inventory.' });
    const secret = textField(fields, 'secret');
    const sender = provider === 'Email' ? textField(fields, 'sender') : '';
    let encryptedSettings: string | undefined;
    if (secret || sender) {
      const current = channelSettings(notificationConfig(), channel);
      const settings = {
        secret: secret || current?.secret || '',
        sender: sender || current?.sender,
      };
      const message = await credentialError(provider, settings);
      if (message) return fail(400, { message });
      encryptedSettings = encryptNotificationSettings(settings);
    } else if (
      !channel.encryptedSettings &&
      provider === 'Webhook' &&
      destination !== channel.destination
    ) {
      const current = channelSettings(notificationConfig(), channel);
      if (current) encryptedSettings = encryptNotificationSettings(current);
    }

    try {
      const [updated] = await updateChannel(db, id, {
        destination,
        severity,
        encryptedSettings,
        certificateIds,
      });
      if (!updated) return fail(404, { message: 'Notification channel not found.' });
    } catch (error) {
      if (!isDuplicateDestination(error)) throw error;
      return fail(409, {
        message: 'This destination already exists for that provider.',
      });
    }
    return { success: 'Notification channel updated.' };
  },
  bindCertificate: async ({ request, locals }) => {
    const fields = await request.formData();
    const id = Number(fields.get('id'));
    const certificateId = textField(fields, 'certificateId');
    if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647 || !certificateId) {
      return fail(400, { message: 'Choose a channel and certificate.' });
    }
    locals.auditTargetId = String(id);
    if (
      !(await canAccessAsset(
        getDatabase(),
        'certificate',
        certificateId,
        assetViewer(locals.user),
      )) ||
      !(await bindChannelToCertificate(getDatabase(), id, certificateId))
    ) {
      return fail(404, {
        message: 'The channel or certificate no longer exists.',
      });
    }
    return { success: 'Notification channel bound to the certificate.' };
  },
  setEnabled: async ({ request, locals }) => {
    const fields = await request.formData();
    const id = Number(fields.get('id'));
    const enabled = fields.get('enabled');
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      id > 2_147_483_647 ||
      (enabled !== 'true' && enabled !== 'false')
    ) {
      return fail(400, { message: 'Invalid channel update.' });
    }
    locals.auditTargetId = String(id);
    const [channel] = await setChannelEnabled(getDatabase(), id, enabled === 'true');
    if (!channel) return fail(404, { message: 'Notification channel not found.' });
    return {
      success:
        enabled === 'true' ? 'Notification channel enabled.' : 'Notification channel paused.',
    };
  },
  remove: async ({ request, locals }) => {
    const fields = await request.formData();
    const id = Number(fields.get('id'));
    if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) {
      return fail(400, { message: 'Invalid channel.' });
    }
    locals.auditTargetId = String(id);
    const [channel] = await removeChannel(getDatabase(), id);
    if (!channel) return fail(404, { message: 'Notification channel not found.' });
    return { success: 'Notification channel removed.' };
  },
  test: async ({ request, locals }) => {
    const fields = await request.formData();
    const id = Number(fields.get('id'));
    if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) {
      return fail(400, { message: 'Invalid channel.' });
    }
    locals.auditTargetId = String(id);
    const channel = await findChannel(getDatabase(), id);
    if (!channel) return fail(404, { message: 'Notification channel not found.' });

    const result = await testAlertNotification(channel);
    if (result === 'setup-required') {
      return fail(400, {
        message: 'Configure this channel before sending a test.',
      });
    }
    if (typeof result === 'object') {
      return fail(502, {
        message: `Could not send a test to ${channel.destination}. ${result.error}`,
      });
    }
    return {
      success: `The provider accepted the test for ${channel.destination}.`,
    };
  },
};
