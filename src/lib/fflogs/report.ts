import type { FflogsClient, FightRef } from "./client";
import type { Role } from "../types";
import { JOB_ROLES } from "../data/roles";

export interface FightInfo { id: number; name: string; encounterID: number; startTime: number; endTime: number; }
export interface PlayerActor { id: number; name: string; job: string; role: Role; maxHp: number; }
export interface EnemyActor { id: number; name: string; }
export interface DamageTakenEvent {
  timestamp: number;
  abilityGameID: number;
  sourceID: number;
  targetID: number;
  amount: number;
  unmitigatedAmount: number;
  absorbed: number;
}
export interface CastEvent { timestamp: number; abilityGameID: number; type: "begincast" | "cast"; }
export interface AbilityInfo { gameID: number; name: string; type: number; }
export interface FightData {
  fight: FightInfo;
  players: PlayerActor[];
  enemies: EnemyActor[];
  abilities: Map<number, AbilityInfo>;
  damageTaken: DamageTakenEvent[];
  casts: CastEvent[];
}

// fflogs subType is the job name in PascalCase
const SUBTYPE_TO_JOB: Record<string, string> = {
  Paladin: "pld", Warrior: "war", DarkKnight: "drk", Gunbreaker: "gnb",
  WhiteMage: "whm", Scholar: "sch", Astrologian: "ast", Sage: "sge",
  Monk: "mnk", Dragoon: "drg", Ninja: "nin", Samurai: "sam", Reaper: "rpr", Viper: "vpr",
  Bard: "brd", Machinist: "mch", Dancer: "dnc",
  BlackMage: "blm", Summoner: "smn", RedMage: "rdm", Pictomancer: "pct",
};

const FIGHTS_QUERY = `query Fights($code: String!) {
  reportData { report(code: $code) { fights { id name encounterID startTime endTime } } }
}`;

const MASTER_DATA_QUERY = `query Master($code: String!) {
  reportData { report(code: $code) { masterData {
    actors { id name type subType }
    abilities { gameID name type }
  } } }
}`;

const EVENTS_QUERY = `query Events($code: String!, $fightId: Int!, $dataType: EventDataType!, $hostility: HostilityType!, $start: Float!, $end: Float!) {
  reportData { report(code: $code) { events(
    fightIDs: [$fightId], dataType: $dataType, startTime: $start, endTime: $end,
    hostilityType: $hostility, limit: 10000, includeResources: true
  ) { data nextPageTimestamp } } }
}`;

interface RawEventsPage { data: Record<string, unknown>[]; nextPageTimestamp: number | null; }

export async function listFights(client: FflogsClient, reportCode: string): Promise<FightInfo[]> {
  const res = await client.query<{ reportData: { report: { fights: FightInfo[] } } }>(
    FIGHTS_QUERY, { code: reportCode });
  return res.reportData.report.fights;
}

export function resolveFightId(fights: FightInfo[], fightId: FightRef | undefined): number | undefined {
  if (fightId === undefined) return undefined;
  if (fightId === "last") {
    if (fights.length === 0) throw new Error("Report has no fights");
    return fights.reduce((a, b) => (a.id >= b.id ? a : b)).id;
  }
  return fightId;
}

async function fetchAllEvents(
  client: FflogsClient, reportCode: string, fight: FightInfo, dataType: string, hostility: string,
): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  let start = fight.startTime;
  for (;;) {
    const res = await client.query<{ reportData: { report: { events: RawEventsPage } } }>(
      EVENTS_QUERY, { code: reportCode, fightId: fight.id, dataType, hostility, start, end: fight.endTime });
    const page = res.reportData.report.events;
    events.push(...page.data);
    if (page.nextPageTimestamp === null) return events;
    start = page.nextPageTimestamp;
  }
}

export async function fetchFightData(
  client: FflogsClient, reportCode: string, fightId: number,
): Promise<FightData> {
  const fights = await listFights(client, reportCode);
  const fight = fights.find((f) => f.id === fightId);
  if (!fight) throw new Error(`Fight ${fightId} not found in report`);

  const master = await client.query<{ reportData: { report: { masterData: {
    actors: { id: number; name: string; type: string; subType: string }[];
    abilities: { gameID: number; name: string; type: number }[];
  } } } }>(MASTER_DATA_QUERY, { code: reportCode });

  const { actors, abilities } = master.reportData.report.masterData;
  // players taking damage = Friendlies; boss casts = Enemies
  const rawDamage = await fetchAllEvents(client, reportCode, fight, "DamageTaken", "Friendlies");
  const rawCasts = await fetchAllEvents(client, reportCode, fight, "Casts", "Enemies");

  const maxHpByActor = new Map<number, number>();
  for (const e of rawDamage) {
    const res = e.targetResources as { maxHitPoints?: number } | undefined;
    const targetID = e.targetID as number;
    if (res?.maxHitPoints) {
      maxHpByActor.set(targetID, Math.max(maxHpByActor.get(targetID) ?? 0, res.maxHitPoints));
    }
  }

  const players: PlayerActor[] = actors
    .filter((a) => a.type === "Player" && SUBTYPE_TO_JOB[a.subType])
    .map((a) => {
      const job = SUBTYPE_TO_JOB[a.subType];
      return { id: a.id, name: a.name, job, role: JOB_ROLES[job], maxHp: maxHpByActor.get(a.id) ?? 0 };
    });

  const enemies: EnemyActor[] = actors.filter((a) => a.type === "NPC").map((a) => ({ id: a.id, name: a.name }));

  const damageTaken: DamageTakenEvent[] = rawDamage
    .filter((e) => e.type === "damage")
    .map((e) => ({
      timestamp: (e.timestamp as number) - fight.startTime,
      abilityGameID: e.abilityGameID as number,
      sourceID: e.sourceID as number,
      targetID: e.targetID as number,
      amount: (e.amount as number) ?? 0,
      unmitigatedAmount: (e.unmitigatedAmount as number) ?? ((e.amount as number) ?? 0),
      absorbed: (e.absorbed as number) ?? 0,
    }));

  const casts: CastEvent[] = rawCasts
    .filter((e) => e.type === "begincast" || e.type === "cast")
    .map((e) => ({
      timestamp: (e.timestamp as number) - fight.startTime,
      abilityGameID: e.abilityGameID as number,
      type: e.type as "begincast" | "cast",
    }));

  // fflogs returns ability.type as a string; normalize to number once here
  const abilityMap = new Map<number, AbilityInfo>(
    abilities.map((a) => [a.gameID, { gameID: a.gameID, name: a.name, type: Number(a.type) }]),
  );
  return { fight, players, enemies, abilities: abilityMap, damageTaken, casts };
}
