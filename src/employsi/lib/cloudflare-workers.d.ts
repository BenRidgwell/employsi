// Minimal ambient type for the Cloudflare Workers runtime module. The real
// `env` (with our KV bindings) is only present when running on the Worker;
// openRolesFn imports it dynamically and degrades gracefully off-Worker.
declare module 'cloudflare:workers' {
  export const env: Record<string, any>;
}
