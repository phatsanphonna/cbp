import { addChannel, listChannels, setChannelEnabled } from '@cbp/database/inventory';
import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getDatabase } from '#lib/server/database.js';
import type { Actions, PageServerLoad } from './$types';

const providers = ['Slack', 'LINE', 'Telegram', 'Email', 'Webhook'] as const;
const severities = ['Info', 'Warning', 'High', 'Critical'] as const;

export const load: PageServerLoad = async () => ({ channels: await listChannels(getDatabase()) });

export const actions: Actions = {
  add: async ({ request }) => {
    const fields = await request.formData();
    const provider = providers.find((value) => value === fields.get('provider'));
    const severity = severities.find((value) => value === fields.get('severity'));
    const rawDestination = fields.get('destination');
    const destination = typeof rawDestination === 'string' ? rawDestination.trim() : '';
    if (!provider || !severity || !destination || destination.length > 120) {
      return fail(400, { message: 'Choose a provider and severity and enter a destination.' });
    }
    if (provider === 'Email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
      return fail(400, { message: 'Enter a valid email address.' });
    }

    const [channel] = await addChannel(getDatabase(), { provider, severity, destination });
    if (!channel) return fail(409, { message: 'This destination already exists for that provider.' });
    redirect(303, resolve('/alerts/channels'));
  },
  setEnabled: async ({ request }) => {
    const fields = await request.formData();
    const id = Number(fields.get('id'));
    const enabled = fields.get('enabled');
    if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647 || (enabled !== 'true' && enabled !== 'false')) {
      return fail(400, { message: 'Invalid channel update.' });
    }
    const [channel] = await setChannelEnabled(getDatabase(), id, enabled === 'true');
    if (!channel) return fail(404, { message: 'Notification channel not found.' });
    redirect(303, resolve('/alerts/channels'));
  }
};
