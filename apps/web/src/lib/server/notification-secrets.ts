import { decryptSecret, encryptSecret } from './encrypted-secret.js';

export type NotificationSettings = { secret: string; sender?: string };

const context = 'cbp/notifications/v1';

export function encryptNotificationSettings(settings: NotificationSettings) {
  return encryptSecret(JSON.stringify(settings), context);
}

export function decryptNotificationSettings(value: string): NotificationSettings | null {
  try {
    const settings = decryptSecret(value, context);
    return settings === null ? null : JSON.parse(settings);
  } catch {
    return null;
  }
}
