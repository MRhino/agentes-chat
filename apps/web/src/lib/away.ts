/**
 * A tab nobody is using stops talking to the server: its realtime socket closes and its polls pause, until the
 * person is back. An open socket, or a poll every few seconds, keeps a server that is paid for by the minute (and its
 * database) running for as long as the tab stays open, in front or forgotten behind another window.
 *
 * Away: hidden for `AWAY_HIDDEN_MS`, or in front and untouched for `AWAY_IDLE_MS`, with nothing heard from the
 * workspace in that time either (an agent still answering keeps its tab live, so its reply's sound and notice come).
 * Back: the tab in front again, or any key, click, scroll or pointer move in it.
 */
import { focusManager } from "@tanstack/react-query";

/** Hidden this long, and as long without news, the tab is away. */
export const AWAY_HIDDEN_MS = 3 * 60_000;
/** In front but untouched this long, and as long without news. */
export const AWAY_IDLE_MS = 15 * 60_000;
const LOOK_EVERY_MS = 30_000;

export interface AwayWatch {
  readonly away: boolean;
  /** Told each time the tab goes away (`true`) or comes back. */
  subscribe(listener: (away: boolean) => void): () => void;
  /** The person did something in the tab. */
  touched(): void;
  /** The workspace sent something the tab shows. */
  heard(): void;
  /** The tab went behind (`true`) or came in front. */
  hidden(hidden: boolean): void;
  /** Looks at the clock; the timer calls it. */
  look(): void;
}

export function createAwayWatch(options: {
  now?: () => number;
  hidden?: boolean;
  hiddenMs?: number;
  idleMs?: number;
}): AwayWatch {
  const now = options.now ?? Date.now;
  const hiddenMs = options.hiddenMs ?? AWAY_HIDDEN_MS;
  const idleMs = options.idleMs ?? AWAY_IDLE_MS;
  const listeners = new Set<(away: boolean) => void>();
  let away = false;
  let hiddenAt: number | null = options.hidden ? now() : null;
  let lastSign = now();
  const set = (next: boolean) => {
    if (away === next) return;
    away = next;
    for (const l of [...listeners]) l(next);
  };
  return {
    get away() {
      return away;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    touched() {
      lastSign = now();
      // A key or a click can only land in a tab the person is on.
      set(false);
    },
    heard() {
      // News reaches a tab that is away only after it came back: it never brings it back by itself.
      lastSign = now();
    },
    hidden(hidden) {
      if (hidden) {
        hiddenAt ??= now();
        return;
      }
      hiddenAt = null;
      lastSign = now();
      set(false);
    },
    look() {
      if (away) return;
      const quiet = now() - lastSign;
      if (hiddenAt !== null ? now() - hiddenAt >= hiddenMs && quiet >= hiddenMs : quiet >= idleMs) set(true);
    },
  };
}

/** This tab's watch. */
export const awayWatch = createAwayWatch({
  hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
});

/** Pointer moves come by the hundred: one a second is enough to say the person is here. */
const MOVE_EVERY_MS = 1000;

/**
 * Wires the watch to the page, once: what the person does in it, whether it is in front, and the clock. While away,
 * polls stop too (TanStack Query refetches on an interval only a window it takes as focused).
 */
export function startAwayWatch(watch: AwayWatch = awayWatch) {
  const touched = () => watch.touched();
  let movedAt = 0;
  const moved = () => {
    const at = Date.now();
    if (at - movedAt < MOVE_EVERY_MS) return;
    movedAt = at;
    watch.touched();
  };
  for (const type of ["keydown", "pointerdown", "wheel", "touchstart"]) {
    window.addEventListener(type, touched, { passive: true, capture: true });
  }
  window.addEventListener("pointermove", moved, { passive: true, capture: true });
  window.addEventListener("focus", touched);
  document.addEventListener("visibilitychange", () => watch.hidden(document.visibilityState === "hidden"));
  watch.subscribe((away) => focusManager.setFocused(away ? false : undefined));
  setInterval(() => watch.look(), LOOK_EVERY_MS);
}
