import { createServerFn } from '@tanstack/react-start';
import { buildBhpFeed, type BhpFeed } from '../data/bhpFeed';

// NB: kept out of any `server/` directory — the bundler denies importing paths
// under **/server/**. createServerFn itself provides the client→server RPC
// bridge, so the handler still runs only on the Worker.

// Runs on the Cloudflare Worker: generates BHP's live feed server-side on every
// poll. Kept behind a server function so the (future real) data source + any
// keys stay off the client.
// POST (not GET) so the browser never serves a cached response — each poll must
// return a freshly-generated snapshot for the values to visibly move.
export const getBhpFeed = createServerFn({ method: 'POST' }).handler((): BhpFeed => buildBhpFeed());
