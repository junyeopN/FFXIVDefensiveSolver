import { describe, expect, it } from "vitest";
import { solve } from "./solver";
import { loadSkills } from "../data/skills";
import type { Damage, PartyMember } from "../types";

const party: PartyMember[] = [
  { slot: "T1", job: "pld", role: "tank", maxHp: 160000 },
  { slot: "T2", job: "war", role: "tank", maxHp: 165000 },
  { slot: "H1", job: "whm", role: "healer", maxHp: 115000 },
  { slot: "H2", job: "sch", role: "healer", maxHp: 114000 },
  { slot: "D1", job: "mnk", role: "dps", maxHp: 112000 },
  { slot: "D2", job: "nin", role: "dps", maxHp: 111000 },
  { slot: "D3", job: "brd", role: "dps", maxHp: 110000 },
  { slot: "D4", job: "blm", role: "dps", maxHp: 109000 },
];
const skills = loadSkills();

function raidwide(castEnd: number, amount: number, over: Partial<Damage> = {}): Damage {
  return {
    abilityId: 500, name: "Raidwide", type: "Magic", category: "Raidwide", amount,
    source: { name: "Boss", targetable: true }, castStart: castEnd - 4000, castEnd,
    targets: 8, mitigable: true, ...over,
  };
}
function buster(castEnd: number, amount: number, over: Partial<Damage> = {}): Damage {
  return {
    abilityId: 600, name: "Buster", type: "Physical", category: "Tankbuster", amount,
    source: { name: "Boss", targetable: true }, castStart: castEnd - 4000, castEnd,
    targets: 1, mitigable: true, aggroSlot: "T1", ...over,
  };
}

describe("solve", () => {
  it("assigns party mitigation until a lethal raidwide is survivable", () => {
    // 120000 raw vs min maxHp 109000 => needs mitigation
    const [plan] = solve([raidwide(10000, 120000)], party, skills);
    expect(plan.assignments.length).toBeGreaterThan(0);
    expect(plan.survivable).toBe(true);
    expect(plan.mitigatedAmount).toBeLessThanOrEqual(109000 * 0.8);
  });

  it("assigns nothing for a trivial raidwide", () => {
    const [plan] = solve([raidwide(10000, 30000)], party, skills);
    expect(plan.assignments).toHaveLength(0);
    expect(plan.survivable).toBe(true);
  });

  it("assigns tank personals to the aggro tank on a buster", () => {
    const [plan] = solve([buster(10000, 200000)], party, skills);
    expect(plan.survivable).toBe(true);
    const slots = new Set(plan.assignments.map((a) => a.slot));
    expect(slots.has("T1")).toBe(true); // own personals used
    const t1Skills = plan.assignments.filter((a) => a.slot === "T1").map((a) => a.skillId);
    expect(t1Skills.length).toBeGreaterThan(0);
  });

  it("respects cooldowns across consecutive raidwides", () => {
    // two heavy raidwides 30s apart: 60s+ cooldown skills cannot repeat
    const plans = solve([raidwide(10000, 120000), raidwide(40000, 120000)], party, skills);
    const firstIds = new Set(plans[0].assignments.map((a) => `${a.slot}:${a.skillId}`));
    for (const a of plans[1].assignments) {
      const skill = skills.find((s) => s.id === a.skillId)!;
      if (skill.cooldown >= 60) {
        expect(firstIds.has(`${a.slot}:${a.skillId}`)).toBe(false);
      }
    }
  });

  it("only uses shields against unmitigable dark damage", () => {
    const [plan] = solve([raidwide(10000, 115000, { type: "Dark", mitigable: false })], party, skills);
    expect(plan.assignments.length).toBeGreaterThan(0);
    for (const a of plan.assignments) {
      const skill = skills.find((s) => s.id === a.skillId)!;
      expect(skill.attributes.some((at) => at.type === "Shield")).toBe(true);
    }
  });

  it("does not assign needsTarget mits while the boss is untargetable", () => {
    const [plan] = solve(
      [raidwide(10000, 120000, { source: { name: "Boss", targetable: false } })], party, skills);
    const ids = plan.assignments.map((a) => a.skillId);
    expect(ids).not.toContain("reprisal");
    expect(ids).not.toContain("addle");
    expect(ids).not.toContain("feint");
  });

  it("flags an unsurvivable mechanic instead of failing", () => {
    const [plan] = solve([raidwide(10000, 500000)], party, skills);
    expect(plan.survivable).toBe(false);
    expect(plan.assignments.length).toBeGreaterThan(0); // still assigns what it can
  });

  it("makes no assignments for individual damage", () => {
    const [plan] = solve([raidwide(10000, 80000, { category: "Individual", targets: 3 })], party, skills);
    expect(plan.assignments).toHaveLength(0);
  });
});
