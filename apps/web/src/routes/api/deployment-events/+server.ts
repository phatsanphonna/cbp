import { DATABASE_URL } from '$app/env/private';
import { controllerHeartbeatRemaining } from '@cbp/database/controller-status';
import { listenForLiveUpdates } from '@cbp/database/deployment-events';
import { getControllerToken } from '#lib/server/controller-config.js';
import { getDatabase } from '#lib/server/database.js';
import { reserveLiveEventConnection } from '#lib/server/live-event-limit.js';
import type { RequestHandler } from './$types';

const encoder = new TextEncoder();
const changed = encoder.encode('event: deployment\ndata: changed\n\n');
const heartbeat = encoder.encode(': keep-alive\n\n');
const headers = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-store, no-transform',
  'x-accel-buffering': 'no',
};
const clients = new Set<(frame: Uint8Array) => void>();
let listener: ReturnType<typeof listenForLiveUpdates> | undefined;
let controllerUpdate: Promise<Uint8Array> | undefined;

function broadcast(frame: Uint8Array) {
  for (const send of clients) send(frame);
}

async function readControllerStatus() {
  if (!getControllerToken()) return { status: 'not-configured' };
  try {
    const remaining = await controllerHeartbeatRemaining(getDatabase());
    return remaining > 0 ? { status: 'online', remaining } : { status: 'offline' };
  } catch {
    return { status: 'unavailable' };
  }
}

function controllerFrame() {
  return (controllerUpdate ??= readControllerStatus()
    .then((status) => encoder.encode(`event: controller\ndata: ${JSON.stringify(status)}\n\n`))
    .finally(() => {
      controllerUpdate = undefined;
    }));
}

function updateController() {
  if (clients.size) void controllerFrame().then(broadcast);
}

function listen() {
  return (listener ??= listenForLiveUpdates(
    DATABASE_URL,
    (message) => {
      if (message === 'controller') updateController();
      else if (!message) broadcast(changed);
    },
    () => {
      broadcast(changed);
      updateController();
    },
  ).catch((error) => {
    listener = undefined;
    console.error('Could not listen for live updates');
    throw error;
  }));
}

import.meta.hot?.dispose(() => {
  void listener?.then((stop) => stop()).catch(() => {});
});

export const HEAD: RequestHandler = () => new Response(null, { headers });

export const GET: RequestHandler = ({ request, locals }) => {
  const userId = locals.auditActor?.id;
  if (!userId) return new Response(null, { status: 401 });
  const release = reserveLiveEventConnection(userId);
  // A short event stream lets EventSource retry automatically when capacity frees up.
  if (!release) return new Response('retry: 15000\n\n', { headers });

  let cleanup: () => void;
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let open = true;
        const stop = () => {
          if (!open) return;
          cleanup();
          controller.close();
        };
        const send = (chunk: Uint8Array) => {
          if (!open) return;
          if ((controller.desiredSize ?? 0) <= 0) return stop();
          controller.enqueue(chunk);
        };
        const timer = setInterval(() => send(heartbeat), 15_000);
        const deadline = setTimeout(stop, 60_000);
        cleanup = () => {
          if (!open) return;
          open = false;
          clearInterval(timer);
          clearTimeout(deadline);
          clients.delete(send);
          request.signal.removeEventListener('abort', stop);
          release();
        };
        if (request.signal.aborted) return stop();
        request.signal.addEventListener('abort', stop, { once: true });
        clients.add(send);
        void listen().then(
          async () => {
            send(changed);
            if (open) send(await controllerFrame());
          },
          () => {
            if (open) stop();
          },
        );
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: 8 },
  );

  return new Response(stream, { headers });
};
