import { resolve } from '$app/paths';

let source: EventSource | undefined;
let subscribers = 0;

export function subscribeToLiveEvents(
  event: 'controller' | 'deployment',
  update: EventListener,
  disconnected?: () => void,
) {
  const stream = (source ??= new EventSource(resolve('/api/deployment-events')));
  subscribers++;
  stream.addEventListener(event, update);
  if (disconnected) stream.addEventListener('error', disconnected);

  return () => {
    stream.removeEventListener(event, update);
    if (disconnected) stream.removeEventListener('error', disconnected);
    if (--subscribers === 0) {
      stream.close();
      source = undefined;
    }
  };
}
