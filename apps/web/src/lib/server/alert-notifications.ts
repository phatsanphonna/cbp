import {
  claimAlertDeliveries,
  markAlertDelivered,
  type AlertDelivery,
} from "@cbp/database/alerts";
import { listChannels } from "@cbp/database/inventory";
import type { getDatabase } from "./database.js";
import {
  decryptNotificationSettings,
  type NotificationSettings,
} from "./notification-secrets.js";
import {
  notificationProxy,
  parseWebhookUrl,
  postPublicWebhook,
} from "./notification-webhook.js";

type Channel = Awaited<ReturnType<typeof listChannels>>[number];
export type Provider = Channel["provider"];
type Config = ReturnType<typeof notificationConfig>;

export function notificationConfig() {
  const webhooks = new Map<string, string>();
  try {
    const entries: unknown = JSON.parse(Bun.env.CBP_ALERT_WEBHOOKS || "{}");
    if (entries && typeof entries === "object" && !Array.isArray(entries)) {
      for (const [name, value] of Object.entries(entries)) {
        if (typeof value !== "string") continue;
        if (parseWebhookUrl(value)) webhooks.set(name, value);
      }
    }
  } catch {
    console.error(
      "CBP_ALERT_WEBHOOKS must contain a JSON object of HTTPS destinations.",
    );
  }

  return {
    slack: Bun.env.CBP_ALERT_SLACK_TOKEN?.trim(),
    line: Bun.env.CBP_ALERT_LINE_TOKEN?.trim(),
    telegram: Bun.env.CBP_ALERT_TELEGRAM_TOKEN?.trim(),
    email: Bun.env.CBP_ALERT_RESEND_API_KEY?.trim(),
    emailFrom: Bun.env.CBP_ALERT_EMAIL_FROM?.trim(),
    webhooks,
  };
}

const destinationPatterns = {
  Slack: /^[CGD][A-Z0-9]{8,}$/,
  LINE: /^[UCR][a-f0-9]{32}$/i,
  Telegram: /^(?:-?\d+|@[A-Za-z0-9_]{5,})$/,
  Email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  Webhook: /^[^\p{Cc}]+$/u,
  "Microsoft Teams": /^[^\p{Cc}]+$/u,
  Discord: /^[^\p{Cc}]+$/u,
} satisfies Record<Provider, RegExp>;

function discordWebhookUrl(value: string) {
  const url = parseWebhookUrl(value);
  if (
    url?.hostname !== "discord.com" ||
    !/^\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
  )
    return null;
  return url;
}

export function validNotificationDestination(
  provider: Provider,
  destination: string,
) {
  return (
    destination.length <= 120 &&
    destinationPatterns[provider]?.test(destination) === true
  );
}

export function validNotificationSettings(
  provider: Provider,
  { secret, sender }: NotificationSettings,
) {
  if (!secret || secret.length > 2048 || /[\s\p{Cc}]/u.test(secret))
    return false;
  switch (provider) {
    case "Telegram":
      return /^\d+:[A-Za-z0-9_-]+$/.test(secret);
    case "Email":
      return (
        typeof sender === "string" &&
        validNotificationDestination("Email", sender)
      );
    case "Discord":
      return Boolean(discordWebhookUrl(secret));
    case "Webhook":
    case "Microsoft Teams":
      return Boolean(parseWebhookUrl(secret));
    default:
      return true;
  }
}

export function channelSettings(
  config: Config,
  { provider, destination, encryptedSettings }: Channel,
) {
  if (!validNotificationDestination(provider, destination)) return null;
  if (encryptedSettings) {
    const settings = decryptNotificationSettings(encryptedSettings);
    return settings && validNotificationSettings(provider, settings)
      ? settings
      : null;
  }
  const legacySecrets = {
    Slack: config.slack,
    LINE: config.line,
    Telegram: config.telegram,
    Email: config.email,
    Webhook: config.webhooks.get(destination),
    "Microsoft Teams": undefined,
    Discord: undefined,
  };
  const secret = legacySecrets[provider];
  const settings = { secret: secret ?? "", sender: config.emailFrom };
  return validNotificationSettings(provider, settings) ? settings : null;
}

const severityStyle = {
  Info: { emoji: "🔵", color: "accent" },
  Warning: { emoji: "🟡", color: "warning" },
  High: { emoji: "🟠", color: "warning" },
  Critical: { emoji: "🔴", color: "attention" },
} as const satisfies Record<
  AlertDelivery["severity"],
  { emoji: string; color: string }
>;

async function sendAlert(
  settings: NotificationSettings,
  channel: Channel,
  alert: Pick<AlertDelivery, "alertId" | "severity" | "message" | "target">,
  test = false,
) {
  const { provider, destination } = channel;
  const { alertId, severity, message, target } = alert;
  const { emoji, color } = test
    ? { emoji: "🧪", color: "accent" }
    : severityStyle[severity];
  const title = test
    ? `${emoji} CBP test notification`
    : `${emoji} CBP alert · ${severity}`;
  const text = `${title}\n${message}`;
  const deliveryId = `${alertId}:${channel.id}:${severity}`;
  const headers = new Headers({ "content-type": "application/json" });
  let url: string | URL;
  let payload: object;

  switch (provider) {
    case "Slack":
      url = "https://slack.com/api/chat.postMessage";
      headers.set("authorization", `Bearer ${settings.secret}`);
      payload = {
        channel: destination,
        text,
        mrkdwn: false,
        unfurl_links: false,
        unfurl_media: false,
      };
      break;
    case "LINE":
      url = "https://api.line.me/v2/bot/message/push";
      headers.set("authorization", `Bearer ${settings.secret}`);
      payload = { to: destination, messages: [{ type: "text", text }] };
      break;
    case "Telegram":
      url = `https://api.telegram.org/bot${settings.secret}/sendMessage`;
      payload = {
        chat_id: destination,
        text,
        link_preview_options: { is_disabled: true },
      };
      break;
    case "Email":
      url = "https://api.resend.com/emails";
      headers.set("authorization", `Bearer ${settings.secret}`);
      headers.set("idempotency-key", deliveryId);
      payload = {
        from: settings.sender,
        to: [destination],
        subject: title,
        text,
      };
      break;
    case "Discord": {
      const webhook = discordWebhookUrl(settings.secret);
      if (!webhook) return false;
      webhook.searchParams.set("wait", "true");
      url = webhook;
      payload = { content: text, allowed_mentions: { parse: [] } };
      break;
    }
    case "Webhook": {
      const webhook = parseWebhookUrl(settings.secret);
      return webhook
        ? postPublicWebhook(
            webhook,
            {
              event: test ? "alert.test" : "alert.open",
              alertId,
              severity,
              message,
              target,
            },
            deliveryId,
          )
        : false;
    }
    case "Microsoft Teams": {
      const webhook = parseWebhookUrl(settings.secret);
      return webhook
        ? postPublicWebhook(
            webhook,
            {
              type: "message",
              attachments: [
                {
                  contentType: "application/vnd.microsoft.card.adaptive",
                  contentUrl: null,
                  content: {
                    $schema:
                      "http://adaptivecards.io/schemas/adaptive-card.json",
                    type: "AdaptiveCard",
                    version: "1.2",
                    body: [
                      {
                        type: "TextBlock",
                        text: title,
                        color,
                        size: "medium",
                        weight: "Bolder",
                        wrap: true,
                      },
                      { type: "TextBlock", text: message, wrap: true },
                    ],
                  },
                },
              ],
            },
            deliveryId,
            true,
          )
        : false;
    }
  }

  const endpoint = new URL(url);
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    proxy: notificationProxy(endpoint),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok && provider === "Slack") {
    const body = (await response.json()) as { ok?: boolean };
    return body?.ok === true;
  }
  await response.body?.cancel().catch(() => {});
  return response.ok;
}

export async function testAlertNotification(channel: Channel) {
  const settings = channelSettings(notificationConfig(), channel);
  if (!settings) return "setup-required";
  const sent = await sendAlert(
    settings,
    channel,
    {
      alertId: crypto.randomUUID(),
      severity: channel.severity,
      message: "This is a test from CBP. No alert requires your attention.",
      target: "CBP",
    },
    true,
  ).catch(() => false);
  return sent ? "sent" : "failed";
}

export async function deliverAlertNotifications(
  db: ReturnType<typeof getDatabase>,
) {
  const config = notificationConfig();
  const channels = new Map<
    number,
    { channel: Channel; settings: NotificationSettings }
  >();
  for (const channel of await listChannels(db)) {
    if (!channel.enabled) continue;
    const settings = channelSettings(config, channel);
    if (settings) channels.set(channel.id, { channel, settings });
  }
  const deliveries = await claimAlertDeliveries(db, [...channels.keys()]);
  await Promise.all(
    deliveries.map(async (delivery) => {
      const entry = channels.get(delivery.channelId);
      if (!entry) return;
      const { channel, settings } = entry;
      const sent = await sendAlert(settings, channel, delivery).catch(
        () => false,
      );
      if (sent) {
        await markAlertDelivered(db, delivery);
      } else {
        console.warn("Alert notification failed", {
          channelId: channel.id,
          provider: channel.provider,
          alertId: delivery.alertId,
          attempt: delivery.attempts,
        });
      }
    }),
  );
}
