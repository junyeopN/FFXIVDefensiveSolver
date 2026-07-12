import { describe, expect, it, vi } from "vitest";
import { runPipeline, type PartySelection } from "./pipeline";
import type { FightData } from "./fflogs/report";

const party: PartySelection = {
  T1: "pld", T2: "war", H1: "whm", H2: "sch", D1: "mnk", D2: "nin", D3: "brd", D4: "blm",
};

const fightData: FightData = {
  fight: { id: 3, name: "Test Boss", encounterID: 99, startTime: 0, endTime: 300000 },
  players: [
    { id: 1, name: "P1", job: "pld", role: "tank", maxHp: 160000 },
    { id: 2, name: "P2", job: "war", role: "tank", maxHp: 165000 },
    { id: 3, name: "P3", job: "whm", role: "healer", maxHp: 115000 },
    { id: 4, name: "P4", job: "sch", role: "healer", maxHp: 114000 },
    { id: 5, name: "P5", job: "mnk", role: "dps", maxHp: 112000 },
    { id: 6, name: "P6", job: "nin", role: "dps", maxHp: 111000 },
    { id: 7, name: "P7", job: "brd", role: "dps", maxHp: 110000 },
    { id: 8, name: "P8", job: "smn", role: "dps", maxHp: 109000 },
  ],
  enemies: [{ id: 9, name: "Test Boss" }],
  abilities: new Map([[500, { gameID: 500, name: "Big Raidwide", type: 1024 }]]),
  damageTaken: [1, 2, 3, 4, 5, 6, 7, 8].map((targetID) => ({
    timestamp: 65000, abilityGameID: 500, sourceID: 9, targetID,
    amount: 100000, unmitigatedAmount: 120000, absorbed: 0,
  })),
  casts: [{ timestamp: 61000, abilityGameID: 500, type: "begincast" as const }],
};

function deps(overrides: Partial<Parameters<typeof runPipeline>[2]> = {}) {
  return {
    client: {} as never,
    listFights: vi.fn().mockResolvedValue([fightData.fight]),
    fetchFightData: vi.fn().mockResolvedValue(fightData),
    exportSheet: vi.fn().mockResolvedValue("https://docs.google.com/spreadsheets/d/abc"),
    ...overrides,
  };
}

describe("runPipeline", () => {
  it("produces plans and a sheet url for a fight", async () => {
    const result = await runPipeline("https://www.fflogs.com/reports/AbC123xYz9KlMnOp#fight=3", party, deps());
    expect(result.fightName).toBe("Test Boss");
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].damage.category).toBe("Raidwide");
    expect(result.plans[0].assignments.length).toBeGreaterThan(0);
    expect(result.sheetUrl).toBe("https://docs.google.com/spreadsheets/d/abc");
  });

  it("resolves fight=last to the report's final fight", async () => {
    const result = await runPipeline("https://www.fflogs.com/reports/AbC123xYz9KlMnOp?fight=last", party, deps());
    expect(result.fightName).toBe("Test Boss");
    expect(result.plans).toHaveLength(1);
  });

  it("warns when the selected comp differs from the log", async () => {
    const result = await runPipeline("https://www.fflogs.com/reports/AbC123xYz9KlMnOp#fight=3", party, deps());
    // selection has blm, log has smn
    expect(result.warnings.some((w) => w.includes("differs"))).toBe(true);
  });

  it("returns plans even when the sheet export fails", async () => {
    const failing = deps({ exportSheet: vi.fn().mockRejectedValue(new Error("quota")) });
    const result = await runPipeline("https://www.fflogs.com/reports/AbC123xYz9KlMnOp#fight=3", party, failing);
    expect(result.sheetUrl).toBeNull();
    expect(result.sheetError).toBe("quota");
    expect(result.plans).toHaveLength(1);
  });

  it("lists fights when the URL has no fight id", async () => {
    await expect(
      runPipeline("https://www.fflogs.com/reports/AbC123xYz9KlMnOp", party, deps()),
    ).rejects.toThrow("Pick a fight");
  });
});
