import type { Damage, DefenseAttribute } from "../types";

export function combinedReduction(reductions: number[]): number {
  let pass = 1;
  for (const r of reductions) pass *= 1 - r / 100;
  return 1 - pass;
}

export function attributeApplies(attr: DefenseAttribute, damage: Damage): boolean {
  if (attr.needsTarget && !damage.source.targetable) return false;
  if (attr.type === "Shield") return true;
  if (attr.type === "HealingIncrease") return false;
  if (!damage.mitigable) return false;
  if (attr.appliesTo && attr.appliesTo !== damage.type) return false;
  return true;
}

export function mitigatedDamage(raw: number, percentReductions: number[], shield: number): number {
  const afterPercent = raw * (1 - combinedReduction(percentReductions));
  return Math.max(0, Math.round(afterPercent - shield));
}
