import type { Damage } from "../types";

const DEFAULT_WINDOW_MS = 5000;
const TANKBUSTER_KEEP_SEPARATE_MAX = 3;

// Multi-hit mechanics (buster combos, raidwide x3) land as separate instances a
// few seconds apart — sometimes under different ability ids with the same name.
// Collapse consecutive same-name instances into one "Name xN" row, EXCEPT
// tankbusters of 2-3 hits: each hit gets its own mitigation plan, so those stay
// separate. The heaviest hit supplies damage/category (survival checks stay
// per-hit); timing anchors to the first hit so mitigation is up before hit one.
export function mergeConsecutive(damages: Damage[], windowMs = DEFAULT_WINDOW_MS): Damage[] {
  const sorted = [...damages].sort((a, b) => a.castEnd - b.castEnd);
  const groups: { members: Damage[]; heaviest: Damage; maxTargets: number }[] = [];

  for (const d of sorted) {
    const prev = groups[groups.length - 1];
    if (
      prev &&
      prev.members[0].name === d.name &&
      d.castEnd - prev.members[prev.members.length - 1].castEnd <= windowMs
    ) {
      prev.members.push(d);
      prev.maxTargets = Math.max(prev.maxTargets, d.targets);
      if (d.amount > prev.heaviest.amount) prev.heaviest = d;
    } else {
      groups.push({ members: [d], heaviest: d, maxTargets: d.targets });
    }
  }

  return groups.flatMap(({ members, heaviest, maxTargets }) => {
    if (members.length === 1) return members;
    if (heaviest.category === "Tankbuster" && members.length <= TANKBUSTER_KEEP_SEPARATE_MAX) {
      return members;
    }
    return [
      {
        ...heaviest,
        name: `${members[0].name} x${members.length}`,
        castStart: members[0].castStart,
        castEnd: members[0].castEnd,
        targets: maxTargets,
      },
    ];
  });
}
