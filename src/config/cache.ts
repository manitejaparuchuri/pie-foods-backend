/**
 * Lightweight in-memory TTL cache to keep Firestore reads down on hot catalog endpoints.
 * Data lives only in the running Node process — fine for a single-instance Railway deploy.
 * Invalidate via `bumpCacheVersion(prefix)` after admin writes.
 */

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
  version: string;
}

const store = new Map<string, CacheEntry<unknown>>();
const versions = new Map<string, number>();

function getVersion(prefix: string): string {
  return String(versions.get(prefix) || 1);
}

export function bumpCacheVersion(prefix: string): void {
  versions.set(prefix, (versions.get(prefix) || 1) + 1);
}

export async function withCache<T>(
  cacheKey: string,
  ttlMs: number,
  loader: () => Promise<T>,
  versionPrefix?: string
): Promise<T> {
  const prefix = versionPrefix || cacheKey.split(":")[0];
  const expectedVersion = getVersion(prefix);
  const cached = store.get(cacheKey) as CacheEntry<T> | undefined;
  const now = Date.now();

  if (cached && cached.expiresAt > now && cached.version === expectedVersion) {
    return cached.value;
  }

  const value = await loader();
  store.set(cacheKey, { value, expiresAt: now + ttlMs, version: expectedVersion });
  return value;
}

export function clearCache(): void {
  store.clear();
}
