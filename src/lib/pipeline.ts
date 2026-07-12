import { parseFflogsUrl, type FflogsClient } from "./fflogs/client";
import { resolveFightId } from "./fflogs/report";
import type { fetchFightData as FetchFightData, listFights as ListFights } from "./fflogs/report";
import { groupEvents } from "./classify/grouping";
import { classifyInstance } from "./classify/heuristics";
import { applyOverrides, loadOverride } from "./classify/overrides";
import { solve } from "./solver/solver";
import { loadSkills, JOB_ROLES } from "./data/skills";
import { buildSheetRows } from "./sheets/layout";
import type { ExportInput } from "./sheets/exporter";
import type { MechanicPlan, PartyMember } from "./types";

export type PartySelection = Record<string, string>;

export interface PipelineDeps {
  client: FflogsClient;
  fetchFightData: typeof FetchFightData;
  listFights: typeof ListFights;
  exportSheet: (input: ExportInput) => Promise<string>;
}

export interface PipelineResult {
  sheetUrl: string | null;
  sheetError?: string;
  fightName: string;
  plans: MechanicPlan[];
  warnings: string[];
}

const SLOTS = ["T1", "T2", "H1", "H2", "D1", "D2", "D3", "D4"];
const NOISE_FRACTION = 0.05;
const FALLBACK_HP = 100000;

export async function runPipeline(
  url: string, party: PartySelection, deps: PipelineDeps,
): Promise<PipelineResult> {
  const { reportCode, fightId } = parseFflogsUrl(url);
  const fights = await deps.listFights(deps.client, reportCode);
  const resolvedFightId = resolveFightId(fights, fightId);
  if (resolvedFightId === undefined) {
    const list = fights.map((f) => `${f.id}: ${f.name}`).join(", ");
    throw new Error(`Pick a fight: append ?fight=<id> (or ?fight=last) to the URL. Fights in this report: ${list}`);
  }

  const data = await deps.fetchFightData(deps.client, reportCode, resolvedFightId);
  const warnings: string[] = [];

  const logJobs = [...data.players.map((p) => p.job)].sort().join(",");
  const pickedJobs = [...Object.values(party)].sort().join(",");
  if (logJobs !== pickedJobs) {
    warnings.push(`Selected composition differs from the log (log: ${logJobs}). HP estimates use the log's players by role.`);
  }

  const maxHpByRole = (role: string): number => {
    const hps = data.players.filter((p) => p.role === role && p.maxHp > 0).map((p) => p.maxHp);
    return hps.length > 0 ? Math.max(...hps) : FALLBACK_HP;
  };

  const members: PartyMember[] = SLOTS.map((slot) => {
    const job = party[slot];
    if (!job || !JOB_ROLES[job]) throw new Error(`Invalid or missing job for slot ${slot}`);
    return { slot, job, role: JOB_ROLES[job], maxHp: maxHpByRole(JOB_ROLES[job]) };
  });

  const slotByActorId = new Map<number, string>();
  const usedSlots = new Set<string>();
  for (const p of data.players) {
    const slot = members.find((m) => m.role === p.role && !usedSlots.has(m.slot));
    if (slot) {
      slotByActorId.set(p.id, slot.slot);
      usedSlots.add(slot.slot);
    }
  }

  const minHp = Math.min(...members.map((m) => m.maxHp));
  const instances = groupEvents(data.damageTaken, data.casts);
  let damages = instances
    .map((i) => classifyInstance(i, data.players, data.enemies, data.abilities, slotByActorId))
    .filter((d) => d.amount >= minHp * NOISE_FRACTION)
    // auto-attacks are constant pressure, not plannable mechanics
    .filter((d) => d.name.toLowerCase() !== "attack");
  damages = applyOverrides(damages, loadOverride(data.fight.encounterID));

  const skills = loadSkills();
  const plans = solve(damages, members, skills);
  const rows = buildSheetRows(plans, members, skills);

  let sheetUrl: string | null = null;
  let sheetError: string | undefined;
  try {
    sheetUrl = await deps.exportSheet({
      // seconds-precision timestamp keeps tab titles unique across runs
      title: `${data.fight.name} ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
      rows,
    });
  } catch (err) {
    sheetError = err instanceof Error ? err.message : String(err);
  }

  return { sheetUrl, sheetError, fightName: data.fight.name, plans, warnings };
}
