import { describe, expect, it } from "vitest";
import { buildSheetRows, formatTime, ICON_BASE_URL } from "./layout";
import { loadSkills } from "../data/skills";
import type { Damage, MechanicPlan, PartyMember } from "../types";

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

function plan(over: Partial<MechanicPlan> & { damage?: Partial<Damage> }): MechanicPlan {
  const damage: Damage = {
    abilityId: 500, name: "Raidwide", type: "Magic", category: "Raidwide", amount: 120000,
    source: { name: "Boss", targetable: true }, castStart: 61000, castEnd: 65000,
    targets: 8, mitigable: true, ...(over.damage ?? {}),
  };
  return { damage, assignments: over.assignments ?? [], mitigatedAmount: over.mitigatedAmount ?? 90000,
           survivable: over.survivable ?? true };
}

describe("formatTime", () => {
  it("formats ms as m:ss", () => {
    expect(formatTime(65000)).toBe("1:05");
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(600000)).toBe("10:00");
  });
});

describe("buildSheetRows", () => {
  it("builds header + one row per plan with 7 + 8 columns", () => {
    const rows = buildSheetRows([plan({})], party, skills);
    expect(rows).toHaveLength(2);
    expect(rows[0].values).toHaveLength(15);
    expect(rows[1].values).toHaveLength(15);
    expect(rows[0].values[7].note).toContain("pld");
  });

  it("renders a single assignment as an IMAGE formula with the name in a note", () => {
    const rows = buildSheetRows([plan({ assignments: [{ slot: "T1", skillId: "divine_veil" }] })], party, skills);
    const t1Cell = rows[1].values[7];
    expect(t1Cell.userEnteredValue?.formulaValue).toBe(`=IMAGE("${ICON_BASE_URL}icons/pld_divine_veil.png")`);
    expect(t1Cell.note).toBe("Divine Veil");
  });

  it("renders multiple assignments for one member as joined names", () => {
    const rows = buildSheetRows(
      [plan({ assignments: [{ slot: "T1", skillId: "rampart" }, { slot: "T1", skillId: "guardian" }] })],
      party, skills);
    expect(rows[1].values[7].userEnteredValue?.stringValue).toBe("Rampart + Guardian");
  });

  it("writes cast/hit times, name, type, category, and both damage numbers", () => {
    const rows = buildSheetRows([plan({ mitigatedAmount: 90000 })], party, skills);
    const cells = rows[1].values;
    expect(cells[0].userEnteredValue?.stringValue).toBe("1:01");
    expect(cells[1].userEnteredValue?.stringValue).toBe("1:05");
    expect(cells[2].userEnteredValue?.stringValue).toBe("Raidwide");
    expect(cells[3].userEnteredValue?.stringValue).toBe("Magic");
    expect(cells[4].userEnteredValue?.stringValue).toBe("Raidwide");
    expect(cells[5].userEnteredValue?.stringValue).toBe("120,000 → 90,000");
  });

  it("marks unsurvivable rows with a red background on the name cell", () => {
    const rows = buildSheetRows([plan({ survivable: false })], party, skills);
    const format = rows[1].values[2].userEnteredFormat as { backgroundColor?: unknown };
    expect(format?.backgroundColor).toBeDefined();
  });

  it("renders the Dark damage type in purple text", () => {
    const rows = buildSheetRows([plan({ damage: { type: "Dark", mitigable: false } })], party, skills);
    const format = rows[1].values[3].userEnteredFormat as { textFormat?: unknown };
    expect(format?.textFormat).toBeDefined();
    expect(rows[1].values[3].userEnteredValue?.stringValue).toBe("Dark");
  });
});
