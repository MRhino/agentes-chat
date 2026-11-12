/**
 * The entry for Vercel's Bun runtime, which looks for `server.ts` at the project root and for the `Bun.serve`
 * call in it. The app, its API and its sockets, and no jobs (`SERVER_ROLE=web`): a function lives only while a
 * request is in flight, so the jobs run in a daemon on the same database (`vercel.json`).
 */
const env = process.env;
env.SERVER_ROLE ??= "web";
// Neon's integration names the direct address apart from the pooled one. LISTEN/NOTIFY, the migrations' lock and
// prepared statements all need the direct one.
env.DATABASE_URL ??= env.NEON_DATABASE_URL_UNPOOLED;
// A deploy migrates in its build; a function that migrated at each cold start would hold every first request.
env.RUN_MIGRATIONS_ON_BOOT ??= "false";
// Several instances may run at once, each with a pool of its own.
env.DATABASE_POOL_MAX ??= "5";
env.WEB_DIR ??= `${import.meta.dir}/apps/web/dist`;
env.NODE_ENV ??= "production";

const { startServer } = await import("./apps/server/src/start");
await startServer({
  edition: "selfhost",
  serve: ((options: Parameters<typeof Bun.serve>[0]) => Bun.serve(options)) as typeof Bun.serve,
});
