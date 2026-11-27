import { expect, test } from 'bun:test';
import { reserveLiveEventConnection } from './live-event-limit.js';

test('live updates cap each account and recover when a connection closes', () => {
  const releases = Array.from({ length: 8 }, () => reserveLiveEventConnection('user'));
  try {
    expect(releases.every(Boolean)).toBe(true);
    expect(reserveLiveEventConnection('user')).toBeNull();
    const other = reserveLiveEventConnection('other');
    expect(other).toBeFunction();
    other?.();

    releases.pop()?.();
    const replacement = reserveLiveEventConnection('user');
    expect(replacement).toBeFunction();
    replacement?.();
  } finally {
    for (const release of releases) release?.();
  }
});

test('live updates have a shared connection limit across accounts', () => {
  const releases = Array.from({ length: 256 }, (_, id) => reserveLiveEventConnection(String(id)));
  try {
    expect(releases.every(Boolean)).toBe(true);
    expect(reserveLiveEventConnection('next')).toBeNull();
  } finally {
    for (const release of releases) release?.();
  }
});
