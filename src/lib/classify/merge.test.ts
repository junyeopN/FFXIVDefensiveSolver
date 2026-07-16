import { describe, expect, it } from "vitest";
import { mergeConsecutive } from "./merge";
import type { Damage } from "../types";

function damage(name: string, castEnd: number, over: Partial<Damage> = {}): Damage {
  return {
    abilityId: 500, name, type: "Magic", category: "Raidwide", amount: 200000,
    source: { name: "Boss", targetable: true }, castStart: castEnd - 3000, castEnd,
    targets: 8, mitigable: true, ...over,
  };
}
function buster(name: string, castEnd: number, over: Partial<Damage> = {}): Damage {
  return damage(name, castEnd, { category: "Tankbuster", targets: 1, aggroSlot: "T1", amount: 600000, ...over });
}

describe("mergeConsecutive", () => {
  it("merges same-name raidwides within the window into one xN row", () => {
    const out = mergeConsecutive([
      damage("Flagrant Fire III", 10000, { amount: 200000 }),
      damage("Flagrant Fire III", 13000, { amount: 250000, abilityId: 501 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Flagrant Fire III x2");
    expect(out[0].amount).toBe(250000); // heaviest hit
    expect(out[0].castEnd).toBe(10000); // anchored to the first hit
    expect(out[0].castStart).toBe(7000);
  });

  it("chains: three raidwide hits each within 5s of the previous merge into x3", () => {
    const out = mergeConsecutive([
      damage("Ultima Blaster", 10000),
      damage("Ultima Blaster", 14000),
      damage("Ultima Blaster", 18000),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Ultima Blaster x3");
  });

  it("keeps tankbuster pairs separate", () => {
    const out = mergeConsecutive([
      buster("Revolting Ruin III", 16000),
      buster("Revolting Ruin III", 19000),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.name)).toEqual(["Revolting Ruin III", "Revolting Ruin III"]);
  });

  it("keeps tankbuster triples separate", () => {
    const out = mergeConsecutive([
      buster("Ultimate Embrace", 10000),
      buster("Ultimate Embrace", 13000),
      buster("Ultimate Embrace", 16000),
    ]);
    expect(out).toHaveLength(3);
  });

  it("merges tankbuster chains longer than three", () => {
    const out = mergeConsecutive([
      buster("Auto Chain", 10000),
      buster("Auto Chain", 13000),
      buster("Auto Chain", 16000),
      buster("Auto Chain", 19000),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Auto Chain x4");
  });

  it("does not merge when the gap exceeds the window", () => {
    const out = mergeConsecutive([
      damage("Gravitas", 10000),
      damage("Gravitas", 16000),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("Gravitas");
  });

  it("does not merge different names", () => {
    const out = mergeConsecutive([
      damage("Gravitas", 10000),
      damage("Flagrant Fire III", 13000),
    ]);
    expect(out).toHaveLength(2);
  });

  it("takes category and targets from the heaviest hit when merging", () => {
    const out = mergeConsecutive([
      damage("Wave Cannon", 10000, { amount: 100000, category: "Individual", targets: 3 }),
      damage("Wave Cannon", 12000, { amount: 900000, category: "Raidwide", targets: 8 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("Raidwide");
    expect(out[0].targets).toBe(8);
  });

  it("keeps unrelated mechanics in chronological order", () => {
    const out = mergeConsecutive([
      damage("A", 10000),
      damage("B", 12000),
      damage("A", 30000),
    ]);
    expect(out.map((d) => d.name)).toEqual(["A", "B", "A"]);
  });
});
