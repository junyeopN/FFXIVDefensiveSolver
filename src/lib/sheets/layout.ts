import type { MechanicPlan, PartyMember, Skill } from "../types";

export const ICON_BASE_URL = "https://raw.githubusercontent.com/junyeopN/FFXIVDefensiveSolver/main/";

export interface CellData {
  userEnteredValue?: { stringValue?: string; formulaValue?: string; numberValue?: number };
  userEnteredFormat?: Record<string, unknown>;
  note?: string;
}
export interface RowData { values: CellData[]; }

const RED_BG = { backgroundColor: { red: 0.95, green: 0.6, blue: 0.6 } };
const HEADER_FORMAT = { textFormat: { bold: true } };
// fflogs convention: dark/unique damage is purple
const DARK_TEXT = { textFormat: { bold: true, foregroundColor: { red: 0.5, green: 0.2, blue: 0.7 } } };

export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function text(value: string, format?: Record<string, unknown>): CellData {
  return { userEnteredValue: { stringValue: value }, ...(format ? { userEnteredFormat: format } : {}) };
}

function imageCell(iconPath: string, note: string): CellData {
  return { userEnteredValue: { formulaValue: `=IMAGE("${ICON_BASE_URL}${iconPath}")` }, note };
}

export function buildSheetRows(
  plans: MechanicPlan[], party: PartyMember[], skills: Skill[],
): RowData[] {
  const skillById = new Map(skills.map((s) => [s.id, s]));

  const header: RowData = {
    values: [
      text("Cast", HEADER_FORMAT), text("Hit", HEADER_FORMAT), text("Mechanic", HEADER_FORMAT),
      text("Type", HEADER_FORMAT), text("Category", HEADER_FORMAT), text("Damage", HEADER_FORMAT),
      text("Aggro", HEADER_FORMAT),
      ...party.map((m) => ({
        ...imageCell(`icons/jobs/${m.job}.png`, `${m.slot}: ${m.job}`),
        userEnteredFormat: HEADER_FORMAT,
      })),
    ],
  };

  const rows = plans.map((plan) => {
    const d = plan.damage;
    const bySlot = new Map<string, Skill[]>();
    for (const a of plan.assignments) {
      const skill = skillById.get(a.skillId);
      if (!skill) continue;
      const list = bySlot.get(a.slot) ?? [];
      list.push(skill);
      bySlot.set(a.slot, list);
    }

    const memberCells = party.map((m) => {
      const assigned = bySlot.get(m.slot) ?? [];
      if (assigned.length === 0) return text("");
      if (assigned.length === 1) return imageCell(assigned[0].icon, assigned[0].name);
      return text(assigned.map((s) => s.name).join(" + "));
    });

    return {
      values: [
        text(formatTime(d.castStart)),
        text(formatTime(d.castEnd)),
        text(d.name, plan.survivable ? undefined : RED_BG),
        text(d.type, d.type === "Dark" ? DARK_TEXT : undefined),
        text(d.category),
        text(`${d.amount.toLocaleString("en-US")} → ${plan.mitigatedAmount.toLocaleString("en-US")}`),
        text(d.aggroSlot ?? ""),
        ...memberCells,
      ],
    };
  });

  return [header, ...rows];
}
