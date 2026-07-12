import { describe, expect, it } from "vitest";
import { combinedReduction, attributeApplies, mitigatedDamage } from "./mitigation";
import type { Damage, DefenseAttribute } from "../types";

const baseDamage: Damage = {
  abilityId: 1,
  name: "Test Raidwide",
  type: "Magic",
  category: "Raidwide",
  amount: 100000,
  source: { name: "Boss", targetable: true },
  castStart: 0,
  castEnd: 5000,
  targets: 8,
  mitigable: true,
};

function attr(over: Partial<DefenseAttribute>): DefenseAttribute {
  return { type: "DamageReduction", needsTarget: false, amount: 10, duration: 15, ...over };
}

describe("combinedReduction", () => {
  it("stacks multiplicatively", () => {
    // 10% + 10% => 1 - 0.9*0.9 = 0.19
    expect(combinedReduction([10, 10])).toBeCloseTo(0.19);
  });

  it("returns 0 for no mits", () => {
    expect(combinedReduction([])).toBe(0);
  });
});

describe("attributeApplies", () => {
  it("applies type-agnostic reduction to magic damage", () => {
    expect(attributeApplies(attr({}), baseDamage)).toBe(true);
  });

  it("does not apply physical-only reduction to magic damage", () => {
    expect(attributeApplies(attr({ appliesTo: "Physical" }), baseDamage)).toBe(false);
  });

  it("does not apply percent reduction to unmitigable (Dark) damage", () => {
    const dark: Damage = { ...baseDamage, type: "Dark", mitigable: false };
    expect(attributeApplies(attr({}), dark)).toBe(false);
  });

  it("applies shields to unmitigable damage", () => {
    const dark: Damage = { ...baseDamage, type: "Dark", mitigable: false };
    expect(attributeApplies(attr({ type: "Shield", amount: 8000 }), dark)).toBe(true);
  });

  it("never counts HealingIncrease as damage reduction", () => {
    expect(attributeApplies(attr({ type: "HealingIncrease" }), baseDamage)).toBe(false);
  });

  it("blocks needsTarget attributes while the source is untargetable", () => {
    const untargetable: Damage = { ...baseDamage, source: { name: "Boss", targetable: false } };
    expect(attributeApplies(attr({ needsTarget: true }), untargetable)).toBe(false);
  });
});

describe("mitigatedDamage", () => {
  it("applies percent then shields", () => {
    // 100000 * 0.9 * 0.9 = 81000; minus 10000 shield = 71000
    expect(mitigatedDamage(100000, [10, 10], 10000)).toBe(71000);
  });

  it("never goes below zero", () => {
    expect(mitigatedDamage(1000, [], 5000)).toBe(0);
  });
});
