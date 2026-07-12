import type { Assignment, Damage, MechanicPlan, PartyMember, Skill } from "../types";
import { attributeApplies, mitigatedDamage } from "./mitigation";
import { CooldownTracker } from "./constraints";
import { skillsForMember } from "../data/skills";

export interface SolverConfig {
  raidwideBuffer: number;
  tankbusterBuffer: number;
  leadTimeMs: number;
}

export const DEFAULT_CONFIG: SolverConfig = {
  raidwideBuffer: 0.2,
  tankbusterBuffer: 0.1,
  leadTimeMs: 1000,
};

interface Candidate {
  slot: string;
  skill: Skill;
  priority: number; // lower = assigned first
}

function isShieldSkill(skill: Skill): boolean {
  return skill.attributes.some((a) => a.type === "Shield");
}
function isEnemyDebuff(skill: Skill): boolean {
  return skill.attributes.some((a) => a.needsTarget);
}

function busterCandidates(damage: Damage, party: PartyMember[], skills: Skill[]): Candidate[] {
  const tankSlot = damage.aggroSlot;
  if (!tankSlot) return [];
  const out: Candidate[] = [];
  for (const member of party) {
    for (const skill of skillsForMember(member, skills)) {
      if (skill.targeting === "self" && member.slot === tankSlot) {
        out.push({ slot: member.slot, skill, priority: skill.cooldown <= 30 ? 0 : 1 });
      } else if (skill.targeting === "single") {
        out.push({ slot: member.slot, skill, priority: 2 });
      }
    }
  }
  return out.sort((a, b) => a.priority - b.priority);
}

function raidwideCandidates(party: PartyMember[], skills: Skill[]): Candidate[] {
  const out: Candidate[] = [];
  for (const member of party) {
    for (const skill of skillsForMember(member, skills)) {
      if (skill.targeting !== "party") continue;
      const priority = isEnemyDebuff(skill) ? 0 : isShieldSkill(skill) ? 2 : 1;
      out.push({ slot: member.slot, skill, priority });
    }
  }
  return out.sort((a, b) => a.priority - b.priority);
}

export function solve(
  timeline: Damage[], party: PartyMember[], skills: Skill[], config: SolverConfig = DEFAULT_CONFIG,
): MechanicPlan[] {
  const tracker = new CooldownTracker();
  const minPartyHp = Math.min(...party.map((m) => m.maxHp));
  const plans: MechanicPlan[] = [];
  const sorted = [...timeline].sort((a, b) => a.castEnd - b.castEnd);

  for (const damage of sorted) {
    if (damage.category === "Individual") {
      plans.push({
        damage, assignments: [],
        mitigatedAmount: damage.amount,
        survivable: damage.amount <= minPartyHp,
      });
      continue;
    }

    const tank = party.find((m) => m.slot === damage.aggroSlot);
    const threshold = damage.category === "Tankbuster" && tank
      ? tank.maxHp * (1 - config.tankbusterBuffer)
      : minPartyHp * (1 - config.raidwideBuffer);

    const candidates = damage.category === "Tankbuster"
      ? busterCandidates(damage, party, skills)
      : raidwideCandidates(party, skills);

    const useTime = damage.castEnd - config.leadTimeMs;
    const assignments: Assignment[] = [];
    const reductions: number[] = [];
    let shield = 0;
    let current = mitigatedDamage(damage.amount, reductions, shield);

    for (const cand of candidates) {
      if (current <= threshold) break;
      if (!tracker.isReady(cand.slot, cand.skill.id, useTime, cand.skill.cooldown)) continue;
      const applicable = cand.skill.attributes.filter((a) => attributeApplies(a, damage));
      if (applicable.length === 0) continue;

      for (const attr of applicable) {
        if (attr.type === "DamageReduction") reductions.push(attr.amount);
        if (attr.type === "Shield") shield += attr.amount;
      }
      assignments.push({ slot: cand.slot, skillId: cand.skill.id });
      tracker.use(cand.slot, cand.skill.id, useTime);
      current = mitigatedDamage(damage.amount, reductions, shield);
    }

    plans.push({ damage, assignments, mitigatedAmount: current, survivable: current <= threshold });
  }

  return plans;
}
