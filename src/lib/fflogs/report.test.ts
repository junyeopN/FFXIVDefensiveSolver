import { describe, expect, it } from "vitest";
import { fetchFightData, listFights, resolveFightId } from "./report";
import type { FflogsClient } from "./client";

const FIGHT = { id: 3, name: "Test Boss", encounterID: 99, startTime: 100000, endTime: 400000 };

const MASTER_DATA = {
  actors: [
    { id: 1, name: "Tank One", type: "Player", subType: "Paladin" },
    { id: 2, name: "Healer One", type: "Player", subType: "WhiteMage" },
    { id: 9, name: "Test Boss", type: "NPC", subType: "Boss" },
  ],
  abilities: [{ gameID: 500, name: "Big Raidwide", type: 1024 }],
};

// two pages of damage taken, one page of casts.
// dataType arrives as a GraphQL variable, so the fake keys off variables, not query text.
function fakeClient(): FflogsClient {
  let damagePage = 0;
  return {
    query: async (gql: string, vars: Record<string, unknown>) => {
      if (gql.includes("masterData")) return { reportData: { report: { masterData: MASTER_DATA } } };
      if (gql.includes("fights")) return { reportData: { report: { fights: [FIGHT] } } };
      if (vars.dataType === "DamageTaken") {
        damagePage += 1;
        if (damagePage === 1)
          return { reportData: { report: { events: {
            data: [{ timestamp: 105000, type: "damage", abilityGameID: 500, sourceID: 9, targetID: 1,
                     amount: 50000, unmitigatedAmount: 60000, absorbed: 0,
                     targetResources: { hitPoints: 160000, maxHitPoints: 160000 } }],
            nextPageTimestamp: 106000 } } } };
        return { reportData: { report: { events: {
          data: [{ timestamp: 106000, type: "damage", abilityGameID: 500, sourceID: 9, targetID: 2,
                   amount: 48000, unmitigatedAmount: 60000, absorbed: 2000,
                   targetResources: { hitPoints: 115000, maxHitPoints: 115000 } }],
          nextPageTimestamp: null } } } };
      }
      if (vars.dataType === "Casts")
        return { reportData: { report: { events: {
          data: [{ timestamp: 101000, type: "begincast", abilityGameID: 500, sourceID: 9 }],
          nextPageTimestamp: null } } } };
      throw new Error(`unexpected query: ${gql}`);
    },
  } as unknown as FflogsClient;
}

describe("listFights", () => {
  it("returns fight infos", async () => {
    const fights = await listFights(fakeClient(), "CODE");
    expect(fights).toEqual([FIGHT]);
  });
});

describe("resolveFightId", () => {
  const fights = [
    { id: 1, name: "A", encounterID: 9, startTime: 0, endTime: 100 },
    { id: 7, name: "B", encounterID: 9, startTime: 200, endTime: 300 },
  ];

  it("passes numeric ids through", () => {
    expect(resolveFightId(fights, 1)).toBe(1);
  });

  it("resolves 'last' to the highest fight id", () => {
    expect(resolveFightId(fights, "last")).toBe(7);
  });

  it("returns undefined for undefined", () => {
    expect(resolveFightId(fights, undefined)).toBeUndefined();
  });

  it("throws when the report has no fights and 'last' is requested", () => {
    expect(() => resolveFightId([], "last")).toThrow("no fights");
  });
});

describe("fetchFightData", () => {
  it("assembles players, enemies, abilities, and rebased events", async () => {
    const data = await fetchFightData(fakeClient(), "CODE", 3);

    expect(data.fight.id).toBe(3);
    expect(data.players).toEqual([
      { id: 1, name: "Tank One", job: "pld", role: "tank", maxHp: 160000 },
      { id: 2, name: "Healer One", job: "whm", role: "healer", maxHp: 115000 },
    ]);
    expect(data.enemies).toEqual([{ id: 9, name: "Test Boss" }]);
    expect(data.abilities.get(500)).toEqual({ gameID: 500, name: "Big Raidwide", type: 1024 });

    // paginated: both damage events present, timestamps rebased to fight start
    expect(data.damageTaken).toHaveLength(2);
    expect(data.damageTaken[0].timestamp).toBe(5000);
    expect(data.damageTaken[1].targetID).toBe(2);
    expect(data.casts[0]).toEqual({ timestamp: 1000, abilityGameID: 500, type: "begincast" });
  });

  it("rejects an unknown fight id", async () => {
    await expect(fetchFightData(fakeClient(), "CODE", 42)).rejects.toThrow("Fight 42 not found");
  });
});
