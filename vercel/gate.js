// Vercel Routing Middleware in front of the web container (vercel.json `builds`). A container takes about 8 s to
// start, and Vercel starts another one for each request that arrives meanwhile: a page that opens with 25 requests
// started 10 to 50 containers, each with its own database connections. This holds every request until one container
// answers its health check, then lets them all through to it (`maxConcurrency` lets one container take them).
// Vercel stops a container after 5 minutes without traffic, so one that answered less than 4 minutes ago is up.

const WARM_MS = 4 * 60_000;
const WAIT_MS = 25_000;
const SKIP = "x-agentes-warm-up";
const BYPASS = "x-vercel-protection-bypass";

let warmUntil = 0;
/** @type {Promise<void> | null} */
let warming = null;

/** Continue to the route the request matched (what `next()` of `@vercel/functions` returns). */
const pass = (heldMs) =>
  new Response(null, { headers: { "x-middleware-next": "1", ...(heldMs ? { "x-agentes-held-ms": String(heldMs) } : {}) } });

async function warm(request) {
  const headers = { [SKIP]: "1" };
  // A deployment behind Vercel's protection: the health check goes in as the request did.
  const bypass = request.headers.get(BYPASS);
  if (bypass) headers[BYPASS] = bypass;
  try {
    await fetch(new URL("/api/health", request.url), { headers, signal: AbortSignal.timeout(WAIT_MS) });
  } catch {
    // Not up in time, or the check failed: the requests go through anyway, as they did before.
  }
  warmUntil = Date.now() + WARM_MS;
}

export default async function gate(request) {
  if (request.headers.get(SKIP) === "1") return pass();
  const now = Date.now();
  if (now < warmUntil) {
    warmUntil = now + WARM_MS;
    return pass();
  }
  warming ??= warm(request).finally(() => {
    warming = null;
  });
  await warming;
  return pass(Date.now() - now);
}
