/** Minimal KV used for idempotency / replay protection. */
export interface Store {
  get(key: string): Promise<string | null>;
  /** Set only if absent. Returns true when this call created the key. */
  setNX(key: string, value: string): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export class MemoryStore implements Store {
  m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async setNX(k: string, v: string) { if (this.m.has(k)) return false; this.m.set(k, v); return true; }
  async set(k: string, v: string) { this.m.set(k, v); }
  async del(k: string) { this.m.delete(k); }
}

/** Upstash / Vercel KV REST client (no SDK dependency). */
export class RestStore implements Store {
  constructor(private url: string, private token: string, private f: typeof fetch = fetch) {}
  private async cmd(args: (string | number)[]): Promise<unknown> {
    const r = await this.f(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`store ${r.status}`);
    const j = (await r.json()) as { result?: unknown; error?: string };
    if (j.error) throw new Error(`store: ${j.error}`);
    return j.result;
  }
  async get(k: string) { return ((await this.cmd(["GET", k])) as string | null) ?? null; }
  async setNX(k: string, v: string) { return (await this.cmd(["SET", k, v, "NX"])) === "OK"; }
  async set(k: string, v: string) { await this.cmd(["SET", k, v]); }
  async del(k: string) { await this.cmd(["DEL", k]); }
}

export function storeFromEnv(e: Record<string, string | undefined> = process.env): Store | null {
  const url = e.UPSTASH_REDIS_REST_URL || e.KV_REST_API_URL;
  const token = e.UPSTASH_REDIS_REST_TOKEN || e.KV_REST_API_TOKEN;
  if (url && token) return new RestStore(url, token);
  // In-memory is only safe for a single long-lived process (local dev).
  if (e.ALLOW_MEMORY_STORE === "true") return new MemoryStore();
  return null;
}
