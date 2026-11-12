import type { Config } from "@agenteschat/config";
import type { Logger } from "./logger";

/** A burst of queued work makes one call, not one per message. */
const WAKE_QUIET_MS = 30_000;
const CALL_TIMEOUT_MS = 10_000;

export interface WorkerSwitch {
  /** Work was queued: switch the job runner on. At most one call every `WAKE_QUIET_MS`. */
  wake(): void;
  /** Nothing left to do: switch the job runner off. Resolves to whether the host accepted it. */
  sleep(): Promise<boolean>;
}

/**
 * The switch of a job runner that is off while idle (`WORKER_WAKE_URL`): a process that runs no jobs
 * (`SERVER_ROLE=web`) switches it on when it queues work, and the runner switches itself off when it has none.
 * Both are the same `PUT`, with a body for each. Null without the address or its token.
 */
export function createWorkerSwitch(
  config: Pick<Config, "WORKER_WAKE_URL" | "WORKER_WAKE_TOKEN" | "WORKER_WAKE_BODY" | "WORKER_SLEEP_BODY">,
  log: Logger,
  fetchFn: typeof fetch = fetch,
): WorkerSwitch | null {
  const url = config.WORKER_WAKE_URL;
  const token = config.WORKER_WAKE_TOKEN;
  if (!url || !token) return null;
  const put = async (body: string, what: "wake" | "sleep") => {
    try {
      const res = await fetchFn(url, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      if (!res.ok) log.warn("job runner switch refused", { what, status: res.status });
      else log.info("job runner switch", { what });
      return res.ok;
    } catch (error) {
      log.warn("job runner switch failed", { what, error: String(error) });
      return false;
    }
  };
  let lastWake = 0;
  return {
    wake() {
      const now = Date.now();
      if (now - lastWake < WAKE_QUIET_MS) return;
      lastWake = now;
      void put(config.WORKER_WAKE_BODY, "wake").then((ok) => {
        // A refused call is tried again by the next queued work, not held back by the quiet time.
        if (!ok) lastWake = 0;
      });
    },
    sleep: () => put(config.WORKER_SLEEP_BODY, "sleep"),
  };
}
