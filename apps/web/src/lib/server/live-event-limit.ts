const byUser = new Map<string, number>();
let connections = 0;

export function reserveLiveEventConnection(userId: string) {
  const count = byUser.get(userId) ?? 0;
  if (connections >= 256 || count >= 8) return null;
  connections++;
  byUser.set(userId, count + 1);

  return () => {
    connections--;
    const remaining = (byUser.get(userId) ?? 1) - 1;
    if (remaining === 0) byUser.delete(userId);
    else byUser.set(userId, remaining);
  };
}
