import { describe, expect, it } from "vitest";
import { applyOverrides, type FightOverride } from "./overrides";
import type { Damage } from "../types";

function damage(over: Partial<Damage>): Damage {
  return {
    abilityId: 500, name: "Test", type: "Magic", category: "Raidwide", amount: 60000,
    source: { name: "Boss", targetable: true }, castStart: 1000, castEnd: 5000,
    targets: 8, mitigable: true, ...over,
  };
}

describe("applyOverrides", () => {
  it("returns damages unchanged without an override", () => {
    const input = [damage({})];
    expect(applyOverrides(input, undefined)).toEqual(input);
  });

  it("overrides category, type, mitigable, and name by ability id", () => {
    const override: FightOverride = {
      abilities: { "500": { category: "Tankbuster", type: "Dark", mitigable: true, name: "Renamed" } },
    };
    const [out] = applyOverrides([damage({})], override);
    expect(out.category).toBe("Tankbuster");
    expect(out.type).toBe("Dark");
    expect(out.mitigable).toBe(true);
    expect(out.name).toBe("Renamed");
  });

  it("marks sources untargetable inside untargetable windows", () => {
    const override: FightOverride = { untargetable: [[4000, 6000]] };
    const [inside] = applyOverrides([damage({ castEnd: 5000 })], override);
    const [outside] = applyOverrides([damage({ castEnd: 7000 })], override);
    expect(inside.source.targetable).toBe(false);
    expect(outside.source.targetable).toBe(true);
  });
});
