import { type Database, rowsOf, sql } from "@agenteschat/db";
import type { Logger } from "./logger";
import type { WorkerSwitch } from "./worker-switch";

const CHECK_MS = 30_000;

/** A job being run or due now, or a run that hasn't ended: what a job runner is awake for. */
export async function hasWorkNow(db: Database): Promise<boolean> {
  const result = await db.execute<{ busy: boolean }>(sql`
    select (
      exists (select 1 from outbox where status = 'processing')
      or exists (select 1 from outbox where status = 'pending' and next_attempt_at <= now())
      or exists (select 1 from agent_runs where status in ('queued', 'running'))
    ) as busy`);
  return rowsOf<{ busy: boolean }>(result)[0]?.busy === true;
}

/**
 * A job runner that switches itself off (`WORKER_WAKE_URL` with `WORKER_SLEEP_BODY`) once it has had no work for
 * `idleMs`. A process that runs no jobs switches it back on when work is queued (`WorkerDeps.onWake`) or found
 * waiting (`watchForWaitingWork`). A failed look counts as work: it never sleeps on a database it can't read.
 */
export function sleepWhenIdle(deps: { db: Database; log: Logger; switch: WorkerSwitch; idleMs: number }) {
  let lastWork = Date.now();
  let asked = false;
  const timer = setInterval(async () => {
    if (asked) return;
    try {
      if (await hasWorkNow(deps.db)) {
        lastWork = Date.now();
        return;
      }
    } catch (error) {
      lastWork = Date.now();
      deps.log.warn("idle check failed", { error: String(error) });
      return;
    }
    if (Date.now() - lastWork < deps.idleMs) return;
    asked = true;
    deps.log.info("no work: switching the job runner off", { idleSeconds: Math.round(deps.idleMs / 1000) });
    // The host stops this process (SIGTERM). Refused: look again after another quiet stretch.
    if (!(await deps.switch.sleep())) {
      asked = false;
      lastWork = Date.now();
    }
  }, CHECK_MS);
  return () => clearInterval(timer);
}

/**
 * In a process that runs no jobs: work left waiting (queued as the runner switched itself off, or due later than
 * when it was queued) switches the runner back on. Runs only while this process is alive, so a host that stops idle
 * processes needs a timed call of its own for work due while nobody is here.
 */
export function watchForWaitingWork(deps: { db: Database; log: Logger; switch: WorkerSwitch }) {
  const timer = setInterval(async () => {
    try {
      if (await hasWorkNow(deps.db)) deps.switch.wake();
    } catch (error) {
      deps.log.debug("waiting-work check failed", { error: String(error) });
    }
  }, CHECK_MS);
  return () => clearInterval(timer);
}
