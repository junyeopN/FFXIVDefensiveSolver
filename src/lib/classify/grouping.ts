import type { CastEvent, DamageTakenEvent } from "../fflogs/report";

export interface MechanicInstance {
  abilityGameID: number;
  castStart: number;
  castEnd: number;
  hits: DamageTakenEvent[];
}

const CAST_LOOKBACK_MS = 15000;

export function groupEvents(
  damage: DamageTakenEvent[], casts: CastEvent[], gapMs = 2000,
): MechanicInstance[] {
  const byAbility = new Map<number, DamageTakenEvent[]>();
  for (const e of damage) {
    const list = byAbility.get(e.abilityGameID) ?? [];
    list.push(e);
    byAbility.set(e.abilityGameID, list);
  }

  const beginCasts = casts.filter((c) => c.type === "begincast");
  const instances: MechanicInstance[] = [];

  for (const [abilityGameID, events] of byAbility) {
    events.sort((a, b) => a.timestamp - b.timestamp);
    let current: DamageTakenEvent[] = [];
    const flush = () => {
      if (current.length === 0) return;
      const first = current[0].timestamp;
      const nearCasts = beginCasts.filter(
        (c) => c.abilityGameID === abilityGameID && c.timestamp <= first && first - c.timestamp <= CAST_LOOKBACK_MS,
      );
      const castStart = nearCasts.length > 0 ? nearCasts[nearCasts.length - 1].timestamp : first;
      instances.push({ abilityGameID, castStart, castEnd: first, hits: current });
      current = [];
    };
    for (const e of events) {
      if (current.length > 0 && e.timestamp - current[current.length - 1].timestamp > gapMs) flush();
      current.push(e);
    }
    flush();
  }

  return instances.sort((a, b) => a.castEnd - b.castEnd);
}
