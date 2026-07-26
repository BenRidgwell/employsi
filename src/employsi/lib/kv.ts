// Minimal structural type for the Cloudflare KV surface this app uses, mirroring
// the D1Like type in jobArchive.ts. Declaring it here keeps the app bundle free
// of @cloudflare/workers-types while still type-checking the call sites: the KV
// binding only exists when running on the Worker, so every reader has to cope
// with it being absent (local SSR, tests) — and that fallback path is exactly
// where an untyped `any` used to hide mistakes.
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Pull a KV binding off the dynamically-imported Workers `env`. Returns null
 * off-Worker (or when the binding isn't configured) so callers degrade rather
 * than throw.
 */
export function kvBinding(env: Record<string, unknown> | undefined, name: string): KVLike | null {
  const b = env?.[name];
  return b && typeof (b as KVLike).get === "function" ? (b as KVLike) : null;
}
