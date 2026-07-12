import { describe, expect, it } from "vitest";
import { classifyInstance, FFLOGS_TYPE_DARK, FFLOGS_TYPE_MAGIC, FFLOGS_TYPE_PHYSICAL } from "./heuristics";
import type { MechanicInstance } from "./grouping";
import type { AbilityInfo, DamageTakenEvent, EnemyActor, PlayerActor } from "../fflogs/report";

const players: PlayerActor[] = [
  { id: 1, name: "T One", job: "pld", role: "tank", maxHp: 160000 },
  { id: 2, name: "T Two", job: "war", role: "tank", maxHp: 165000 },
  { id: 3, name: "H One", job: "whm", role: "healer", maxHp: 115000 },
  { id: 4, name: "H Two", job: "sch", role: "healer", maxHp: 114000 },
  { id: 5, name: "D One", job: "mnk", role: "dps", maxHp: 112000 },
  { id: 6, name: "D Two", job: "nin", role: "dps", maxHp: 111000 },
  { id: 7, name: "D Three", job: "brd", role: "dps", maxHp: 110000 },
  { id: 8, name: "D Four", job: "blm", role: "dps", maxHp: 109000 },
];
const enemies: EnemyActor[] = [{ id: 9, name: "Test Boss" }];
const slotByActorId = new Map(players.map((p, i) => [p.id, ["T1", "T2", "H1", "H2", "D1", "D2", "D3", "D4"][i]]));

function hit(targetID: number, unmitigatedAmount: number): DamageTakenEvent {
  return { timestamp: 5000, abilityGameID: 500, sourceID: 9, targetID, amount: unmitigatedAmount, unmitigatedAmount, absorbed: 0 };
}
function instance(hits: DamageTakenEvent[]): MechanicInstance {
  return { abilityGameID: 500, castStart: 1000, castEnd: 5000, hits };
}
function abilities(type: number): Map<number, AbilityInfo> {
  return new Map([[500, { gameID: 500, name: "Test Ability", type }]]);
}

describe("classifyInstance", () => {
  it("classifies a hit on 8 players as a magic raidwide", () => {
    const dmg = classifyInstance(instance(players.map((p) => hit(p.id, 60000))), players, enemies, abilities(FFLOGS_TYPE_MAGIC), slotByActorId);
    expect(dmg.category).toBe("Raidwide");
    expect(dmg.type).toBe("Magic");
    expect(dmg.amount).toBe(60000);
    expect(dmg.targets).toBe(8);
    expect(dmg.mitigable).toBe(true);
    expect(dmg.source.name).toBe("Test Boss");
  });

  it("classifies a big physical hit on one tank as a tankbuster with aggro slot", () => {
    const dmg = classifyInstance(instance([hit(1, 120000)]), players, enemies, abilities(FFLOGS_TYPE_PHYSICAL), slotByActorId);
    expect(dmg.category).toBe("Tankbuster");
    expect(dmg.type).toBe("Physical");
    expect(dmg.aggroSlot).toBe("T1");
  });

  it("classifies a small hit on one tank as individual, not a buster", () => {
    const dmg = classifyInstance(instance([hit(1, 20000)]), players, enemies, abilities(FFLOGS_TYPE_PHYSICAL), slotByActorId);
    expect(dmg.category).toBe("Individual");
  });

  it("classifies hits on three dps as individual", () => {
    const dmg = classifyInstance(instance([hit(5, 80000), hit(6, 80000), hit(7, 80000)]), players, enemies, abilities(FFLOGS_TYPE_MAGIC), slotByActorId);
    expect(dmg.category).toBe("Individual");
  });

  it("marks dark damage unmitigable", () => {
    const dmg = classifyInstance(instance(players.map((p) => hit(p.id, 60000))), players, enemies, abilities(FFLOGS_TYPE_DARK), slotByActorId);
    expect(dmg.type).toBe("Dark");
    expect(dmg.mitigable).toBe(false);
  });

  it("defaults unknown ability types to magic", () => {
    const dmg = classifyInstance(instance([hit(1, 120000)]), players, enemies, abilities(7777), slotByActorId);
    expect(dmg.type).toBe("Magic");
  });
});
