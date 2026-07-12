import { describe, expect, it } from "vitest";
import { groupEvents } from "./grouping";
import type { DamageTakenEvent, CastEvent } from "../fflogs/report";

function hit(timestamp: number, abilityGameID: number, targetID: number, unmitigatedAmount = 50000): DamageTakenEvent {
  return { timestamp, abilityGameID, sourceID: 9, targetID, amount: unmitigatedAmount, unmitigatedAmount, absorbed: 0 };
}

describe("groupEvents", () => {
  it("groups hits of the same ability within the gap window into one instance", () => {
    const hits = [hit(1000, 500, 1), hit(1100, 500, 2), hit(1200, 500, 3)];
    const out = groupEvents(hits, []);
    expect(out).toHaveLength(1);
    expect(out[0].hits).toHaveLength(3);
    expect(out[0].castEnd).toBe(1000);
  });

  it("splits repeated casts separated by more than the gap", () => {
    const hits = [hit(1000, 500, 1), hit(31000, 500, 1)];
    const out = groupEvents(hits, []);
    expect(out).toHaveLength(2);
  });

  it("keeps different abilities separate", () => {
    const hits = [hit(1000, 500, 1), hit(1000, 600, 2)];
    expect(groupEvents(hits, [])).toHaveLength(2);
  });

  it("attaches the closest begincast within 15s as castStart", () => {
    const casts: CastEvent[] = [
      { timestamp: 500, abilityGameID: 500, type: "begincast" },
      { timestamp: 28000, abilityGameID: 500, type: "begincast" },
    ];
    const out = groupEvents([hit(5000, 500, 1), hit(31000, 500, 1)], casts);
    expect(out[0].castStart).toBe(500);
    expect(out[1].castStart).toBe(28000);
  });

  it("falls back to first hit when no begincast is near", () => {
    const out = groupEvents([hit(5000, 500, 1)], []);
    expect(out[0].castStart).toBe(5000);
  });

  it("returns instances sorted by castEnd", () => {
    const hits = [hit(9000, 600, 1), hit(1000, 500, 1)];
    const out = groupEvents(hits, []);
    expect(out.map((i) => i.abilityGameID)).toEqual([500, 600]);
  });
});
