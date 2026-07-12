import { describe, expect, it } from "vitest";
import { CooldownTracker } from "./constraints";

describe("CooldownTracker", () => {
  it("is ready when never used", () => {
    const t = new CooldownTracker();
    expect(t.isReady("T1", "rampart", 0, 90)).toBe(true);
  });

  it("blocks reuse within the cooldown and allows it after", () => {
    const t = new CooldownTracker();
    t.use("T1", "rampart", 10000);
    expect(t.isReady("T1", "rampart", 60000, 90)).toBe(false);
    expect(t.isReady("T1", "rampart", 100000, 90)).toBe(true);
  });

  it("tracks per slot independently", () => {
    const t = new CooldownTracker();
    t.use("T1", "rampart", 10000);
    expect(t.isReady("T2", "rampart", 10000, 90)).toBe(true);
  });
});
