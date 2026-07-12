import type { Damage, DamageCategory, DamageType } from "../types";
import type { AbilityInfo, EnemyActor, PlayerActor } from "../fflogs/report";
import type { MechanicInstance } from "./grouping";

// Assumed fflogs FF ability type values; verified against a real log during E2E.
export const FFLOGS_TYPE_PHYSICAL = 128;
export const FFLOGS_TYPE_MAGIC = 1024;
export const FFLOGS_TYPE_DARK = 64;

const RAIDWIDE_MIN_TARGETS = 6;
const TANKBUSTER_MIN_FRACTION = 0.4;

function damageTypeOf(abilityType: number | undefined): DamageType {
  if (abilityType === FFLOGS_TYPE_PHYSICAL) return "Physical";
  if (abilityType === FFLOGS_TYPE_DARK) return "Dark";
  return "Magic";
}

export function classifyInstance(
  instance: MechanicInstance,
  players: PlayerActor[],
  enemies: EnemyActor[],
  abilities: Map<number, AbilityInfo>,
  slotByActorId: Map<number, string>,
): Damage {
  const ability = abilities.get(instance.abilityGameID);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const amount = Math.max(...instance.hits.map((h) => h.unmitigatedAmount));
  const hitPlayers = instance.hits
    .map((h) => playerById.get(h.targetID))
    .filter((p): p is PlayerActor => p !== undefined);
  const targets = new Set(hitPlayers.map((p) => p.id)).size;

  let category: DamageCategory = "Individual";
  let aggroSlot: string | undefined;
  if (targets >= RAIDWIDE_MIN_TARGETS) {
    category = "Raidwide";
  } else if (targets >= 1 && targets <= 2 && hitPlayers.every((p) => p.role === "tank")) {
    const heaviestHit = instance.hits.reduce((a, b) => (a.unmitigatedAmount >= b.unmitigatedAmount ? a : b));
    const tank = playerById.get(heaviestHit.targetID);
    if (tank && tank.maxHp > 0 && amount >= tank.maxHp * TANKBUSTER_MIN_FRACTION) {
      category = "Tankbuster";
      aggroSlot = slotByActorId.get(tank.id);
    }
  }

  const sourceId = instance.hits[0]?.sourceID;
  const sourceName = enemies.find((e) => e.id === sourceId)?.name ?? "Unknown";
  const type = damageTypeOf(ability?.type);

  return {
    abilityId: instance.abilityGameID,
    name: ability?.name ?? `Ability ${instance.abilityGameID}`,
    type,
    category,
    amount,
    source: { name: sourceName, targetable: true },
    castStart: instance.castStart,
    castEnd: instance.castEnd,
    targets,
    mitigable: type !== "Dark",
    ...(aggroSlot ? { aggroSlot } : {}),
  };
}
