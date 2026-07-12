import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Damage, DamageCategory, DamageType } from "../types";

export interface FightOverride {
  abilities?: Record<string, {
    category?: DamageCategory;
    type?: DamageType;
    mitigable?: boolean;
    name?: string;
  }>;
  untargetable?: [number, number][];
}

export function applyOverrides(damages: Damage[], override: FightOverride | undefined): Damage[] {
  if (!override) return damages;
  return damages.map((d) => {
    const ab = override.abilities?.[String(d.abilityId)];
    const untargetable = (override.untargetable ?? []).some(([s, e]) => d.castEnd >= s && d.castEnd <= e);
    return {
      ...d,
      ...(ab?.category ? { category: ab.category } : {}),
      ...(ab?.type ? { type: ab.type, mitigable: ab.mitigable ?? ab.type !== "Dark" } : {}),
      ...(ab?.mitigable !== undefined ? { mitigable: ab.mitigable } : {}),
      ...(ab?.name ? { name: ab.name } : {}),
      source: { ...d.source, targetable: d.source.targetable && !untargetable },
    };
  });
}

export function loadOverride(encounterId: number): FightOverride | undefined {
  const path = join(process.cwd(), "data", "fights", `${encounterId}.json`);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as FightOverride;
}
