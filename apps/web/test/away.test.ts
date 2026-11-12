import { describe, expect, test } from "bun:test";
import { createAwayWatch } from "../src/lib/away";

const MIN = 60_000;

function watchAt(hidden = false) {
  let at = 0;
  const watch = createAwayWatch({ now: () => at, hidden, hiddenMs: 3 * MIN, idleMs: 15 * MIN });
  const seen: boolean[] = [];
  watch.subscribe((away) => seen.push(away));
  return {
    watch,
    seen,
    pass(ms: number) {
      at += ms;
      watch.look();
    },
  };
}

describe("away watch", () => {
  test("a tab in front and untouched goes away after the idle time, and a key brings it back", () => {
    const { watch, seen, pass } = watchAt();
    pass(14 * MIN);
    expect(watch.away).toBe(false);
    pass(MIN);
    expect(watch.away).toBe(true);
    watch.touched();
    expect(watch.away).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  test("a hidden tab goes away sooner, and comes back when it is in front again", () => {
    const { watch, pass } = watchAt();
    watch.hidden(true);
    pass(2 * MIN);
    expect(watch.away).toBe(false);
    pass(MIN);
    expect(watch.away).toBe(true);
    watch.hidden(false);
    expect(watch.away).toBe(false);
  });

  test("news from the workspace keeps a tab live, hidden or not", () => {
    const { watch, pass } = watchAt();
    watch.hidden(true);
    pass(2 * MIN);
    watch.heard();
    pass(2 * MIN);
    expect(watch.away).toBe(false);
    pass(MIN);
    expect(watch.away).toBe(true);
  });

  test("news never brings back a tab that is away", () => {
    const { watch, pass } = watchAt(true);
    pass(3 * MIN);
    expect(watch.away).toBe(true);
    watch.heard();
    expect(watch.away).toBe(true);
  });
});
