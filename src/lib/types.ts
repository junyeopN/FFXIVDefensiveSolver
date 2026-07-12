export type DamageType = "Magic" | "Physical" | "Dark";
export type DamageCategory = "Raidwide" | "Tankbuster" | "Individual";

export interface DamageSource {
  name: string;
  targetable: boolean;
}

export interface Damage {
  abilityId: number;
  name: string;
  type: DamageType;
  category: DamageCategory;
  amount: number;
  source: DamageSource;
  castStart: number;
  castEnd: number;
  targets: number;
  mitigable: boolean;
  aggroSlot?: string;
}

export type DefenseType = "HealingIncrease" | "DamageReduction" | "Shield";

export interface DefenseAttribute {
  type: DefenseType;
  needsTarget: boolean;
  amount: number;
  appliesTo?: "Magic" | "Physical";
  duration: number;
}

export type Targeting = "self" | "single" | "party";

export interface Skill {
  id: string;
  name: string;
  job: string;
  icon: string;
  cooldown: number;
  targeting: Targeting;
  attributes: DefenseAttribute[];
}

export type Role = "tank" | "healer" | "dps";

export interface PartyMember {
  slot: string;
  job: string;
  role: Role;
  maxHp: number;
}

export interface Assignment {
  slot: string;
  skillId: string;
}

export interface MechanicPlan {
  damage: Damage;
  assignments: Assignment[];
  mitigatedAmount: number;
  survivable: boolean;
}
