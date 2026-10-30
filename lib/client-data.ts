/** Document-local cache only: no API keys or personal JSON are persisted to disk. */
export class JsonCache {
  private entries = new Map<string, { value: any; time: number }>();
  private jobs = new Map<string, Promise<any>>();
  private versions = new Map<string, number>();
  peek<T = any>(key: string): T | undefined {
    return this.entries.get(key)?.value;
  }
  put(key: string, value: any) {
    this.entries.set(key, { value, time: Date.now() });
  }
  invalidate(prefixes: string[]) {
    for (const key of new Set([...this.entries.keys(), ...this.jobs.keys()]))
      if (prefixes.some((p) => key.startsWith(p))) {
        const entry = this.entries.get(key);
        if (entry) entry.time = 0;
        this.versions.set(key, (this.versions.get(key) || 0) + 1);
        this.jobs.delete(key);
      }
  }
  remove(key: string) {
    this.invalidate([key]);
    this.entries.delete(key);
  }
  clear() {
    this.invalidate(['']);
    this.entries.clear();
  }
  async read<T = any>(
    key: string,
    loader: () => Promise<T>,
    force = false,
    ttl = 30000,
  ): Promise<T> {
    const entry = this.entries.get(key);
    if (!force && entry && Date.now() - entry.time < ttl) return entry.value;
    const pending = this.jobs.get(key);
    if (pending) return pending;
    const version = this.versions.get(key) || 0;
    const job = loader()
      .then((value) => {
        if (version !== (this.versions.get(key) || 0)) return this.read(key, loader, false, ttl);
        this.put(key, value);
        return value;
      })
      .finally(() => {
        if (this.jobs.get(key) === job) this.jobs.delete(key);
      });
    this.jobs.set(key, job);
    return job;
  }
}
export const clientData = new JsonCache();
let accountScope = '';
export async function readJson<T = any>(path: string, force = false): Promise<T> {
  return clientData.read(
    path,
    async () => {
      const started = typeof performance !== 'undefined' ? performance.now() : 0;
      const r = await fetch(path, { signal: AbortSignal.timeout(20000) });
      const value: any = await r.json();
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) clientData.clear();
        throw Object.assign(Error(value.error || 'Could not load this view.'), {
          status: r.status,
        });
      }
      if (path === '/api/settings' && value.userScope) {
        if (accountScope && accountScope !== value.userScope) {
          clientData.clear();
          if (typeof window !== 'undefined') window.location.reload();
          throw Error('Account changed. Reloading your data.');
        }
        accountScope = value.userScope;
      }
      if (typeof performance !== 'undefined')
        performance.measure('dutch:data:' + path.split('?')[0], {
          start: started,
          end: performance.now(),
        });
      return value;
    },
    force,
  );
}
export function dataChanged(path: string) {
  const prefixes =
    path.startsWith('/api/settings') || path.startsWith('/api/audio-settings')
      ? ['/api/settings', '/api/texts', '/api/words', '/api/sentences', '/api/materials']
      : path.startsWith('/api/texts')
        ? ['/api/texts', '/api/text-library', '/api/materials', '/api/sentences']
        : ['/api/materials', '/api/text-library', '/api/texts', '/api/words', '/api/sentences'];
  prefixes.push('/api/collection-index');
  clientData.invalidate(prefixes);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('dutch-data-changed', { detail: prefixes }));
    if (!path.startsWith('/api/words') && !path.startsWith('/api/sentences'))
      window.dispatchEvent(new CustomEvent('dutch-external-data', { detail: prefixes }));
  }
}
