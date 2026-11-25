import { BETTER_AUTH_SECRET } from "$app/env/private";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export type NotificationSettings = { secret: string; sender?: string };

function notificationKey() {
  if (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
    throw new Error(
      "The server secret is required to store notification credentials.",
    );
  }
  return Buffer.from(
    hkdfSync("sha256", BETTER_AUTH_SECRET, "", "cbp/notifications/v1", 32),
  );
}

export function encryptNotificationSettings(settings: NotificationSettings) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", notificationKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(settings), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptNotificationSettings(
  value: string,
): NotificationSettings | null {
  try {
    const [iv, tag, encrypted] = value
      .split(".")
      .map((part) => Buffer.from(part, "base64url"));
    if (!iv || !tag || !encrypted || iv.length !== 12 || tag.length !== 16)
      return null;
    const decipher = createDecipheriv("aes-256-gcm", notificationKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(),
    );
  } catch {
    return null;
  }
}
