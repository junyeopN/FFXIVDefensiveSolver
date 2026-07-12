import rawSkills from "../../../data/skills.json";
import type { PartyMember, Skill } from "../types";
import { JOB_ROLES } from "./roles";

export { JOB_ROLES };

const MELEE_JOBS = new Set(["mnk", "drg", "nin", "sam", "rpr", "vpr"]);
const CASTER_JOBS = new Set(["blm", "smn", "rdm", "pct"]);

const VALID_TARGETING = new Set(["self", "single", "party"]);
const VALID_DEFENSE_TYPES = new Set(["HealingIncrease", "DamageReduction", "Shield"]);

function assertSkill(s: Skill, index: number): void {
  const ctx = `skills.json[${index}] (${s.id ?? "?"})`;
  if (!s.id || !s.name || !s.job || !s.icon) throw new Error(`${ctx}: missing required field`);
  if (!(s.cooldown > 0)) throw new Error(`${ctx}: cooldown must be > 0`);
  if (!VALID_TARGETING.has(s.targeting)) throw new Error(`${ctx}: bad targeting ${s.targeting}`);
  if (!Array.isArray(s.attributes) || s.attributes.length === 0) throw new Error(`${ctx}: no attributes`);
  for (const a of s.attributes) {
    if (!VALID_DEFENSE_TYPES.has(a.type)) throw new Error(`${ctx}: bad attribute type ${a.type}`);
    if (!(a.amount > 0) || !(a.duration > 0)) throw new Error(`${ctx}: bad attribute numbers`);
  }
}

export function loadSkills(): Skill[] {
  const skills = rawSkills as Skill[];
  const seen = new Set<string>();
  skills.forEach((s, i) => {
    assertSkill(s, i);
    if (seen.has(s.id)) throw new Error(`skills.json: duplicate id ${s.id}`);
    seen.add(s.id);
  });
  return skills;
}

export function skillsForMember(member: PartyMember, skills: Skill[]): Skill[] {
  return skills.filter((s) => {
    if (s.job === member.job) return true;
    if (s.job === "tank") return JOB_ROLES[member.job] === "tank";
    if (s.job === "melee") return MELEE_JOBS.has(member.job);
    if (s.job === "caster") return CASTER_JOBS.has(member.job);
    return false;
  });
}
