# FFXIV Defense Solver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js app that takes a party composition + fflogs URL, auto-assigns defensive cooldowns to every boss mechanic, and writes the plan to a Google Sheet.

**Architecture:** Single Next.js (App Router, TypeScript) app. Server-side pipeline modules with injected dependencies: fflogs client → classifier → greedy solver → sheets exporter. Hand-maintained `data/skills.json`; optional per-fight overrides in `data/fights/`. Spec: `docs/superpowers/specs/2026-07-10-ffxiv-defense-solver-design.md`.

**Tech Stack:** Next.js 15, React 19, TypeScript (strict), Vitest, googleapis (Sheets + Drive), fflogs API v2 (GraphQL over plain `fetch`).

## Global Constraints

- Node 20, npm. TypeScript `strict: true`. No dependencies beyond: `next`, `react`, `react-dom`, `googleapis`, and dev deps `typescript`, `vitest`, `@types/node`, `@types/react`, `@types/react-dom`.
- All pipeline modules are pure or take injected deps (no module-level env/network access outside `client.ts`, `exporter.ts`, and the API route).
- Times inside the pipeline are **milliseconds from fight start**; skill cooldowns/durations in `data/skills.json` are **seconds**.
- Percent amounts are integers (10 = 10%). Shield amounts are flat HP.
- Icon URLs in generated sheets use `https://raw.githubusercontent.com/junyeopN/FFXIVDefensiveSolver/main/<repo path>`.
- Run tests with `npx vitest run <file>`; all tests live next to sources as `*.test.ts`.
- Simplifications vs spec (conscious, documented): API route returns one JSON response (no progress streaming); solver iterates chronologically instead of lethality-first; invulns are not in the v1 skill DB; individual damage gets flagged but not auto-assigned; the fight picker is an error message listing fights (not a UI list); no fflogs rate-limit backoff or response cache; no retry-export button (sheet errors are shown with plans intact).

---

### Task 1: Push pending icons, scaffold Next.js + Vitest

**Files:**
- Modify: `.gitignore`
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `next-env.d.ts` (generated), `src/app/layout.tsx`, `src/app/page.tsx` (placeholder), `src/lib/smoke.test.ts`

**Interfaces:**
- Produces: a building Next.js app and a working `npx vitest run` command; job icons available on GitHub `main` (needed by Task 8 sheet formulas).

- [ ] **Step 1: Commit and push the pending icon work**

The sheet exporter references icons on GitHub `main`; job icons are currently uncommitted.

```bash
git add icons/jobs scripts/fetch_icons.py
git commit -m "Add job icons (gold 64px set) and job icon fetching"
git push
```

- [ ] **Step 2: Extend .gitignore**

Append to `.gitignore`:

```
node_modules/
.next/
.env*.local
```

- [ ] **Step 3: Create package.json**

```json
{
  "name": "ffxiv-defense-solver",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "googleapis": "^144.0.0",
    "next": "^15.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

Run: `npm install`

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: Create next.config.ts and vitest.config.ts**

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Create the app shell**

`src/app/layout.tsx`:
```tsx
import type { ReactNode } from "react";

export const metadata = { title: "FFXIV Defense Solver" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", margin: "2rem" }}>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx` (placeholder, replaced in Task 10):
```tsx
export default function Home() {
  return <main>FFXIV Defense Solver</main>;
}
```

- [ ] **Step 7: Write a smoke test and verify the toolchain**

`src/lib/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npx vitest run src/lib/smoke.test.ts`
Expected: 1 passed

Run: `npm run build`
Expected: exits 0, "Compiled successfully"

- [ ] **Step 8: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json next.config.ts vitest.config.ts next-env.d.ts src
git commit -m "chore: scaffold Next.js app with Vitest"
```

---

### Task 2: Core types + mitigation math

**Files:**
- Create: `src/lib/types.ts`, `src/lib/solver/mitigation.ts`
- Test: `src/lib/solver/mitigation.test.ts`

**Interfaces:**
- Produces (used by every later task):

```ts
// src/lib/types.ts — exact contents
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
  amount: number;        // raw (unmitigated) damage per target
  source: DamageSource;
  castStart: number;     // ms from fight start
  castEnd: number;       // ms from fight start (damage snapshot)
  targets: number;       // players hit
  mitigable: boolean;    // false => percent mits do not apply (Dark)
  aggroSlot?: string;    // for tankbusters: slot of the tank hit ("T1"/"T2")
}

export type DefenseType = "HealingIncrease" | "DamageReduction" | "Shield";

export interface DefenseAttribute {
  type: DefenseType;
  needsTarget: boolean;
  amount: number;                       // percent, or flat HP for Shield
  appliesTo?: "Magic" | "Physical";     // omitted = all damage types
  duration: number;                     // seconds
}

export type Targeting = "self" | "single" | "party";

export interface Skill {
  id: string;
  name: string;
  job: string;         // job abbr, or role tag "tank" | "melee" | "caster"
  icon: string;        // repo-relative path, e.g. "icons/pld_divine_veil.png"
  cooldown: number;    // seconds
  targeting: Targeting;
  attributes: DefenseAttribute[];
}

export type Role = "tank" | "healer" | "dps";

export interface PartyMember {
  slot: string;   // "T1" | "T2" | "H1" | "H2" | "D1" | "D2" | "D3" | "D4"
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
  mitigatedAmount: number;  // expected damage after percent mits and shields
  survivable: boolean;
}
```

```ts
// src/lib/solver/mitigation.ts — exact signatures
export function combinedReduction(reductions: number[]): number; // 0..1 input as percents
export function attributeApplies(attr: DefenseAttribute, damage: Damage): boolean;
export function mitigatedDamage(raw: number, percentReductions: number[], shield: number): number;
```

- [ ] **Step 1: Write the failing tests**

`src/lib/solver/mitigation.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { combinedReduction, attributeApplies, mitigatedDamage } from "./mitigation";
import type { Damage, DefenseAttribute } from "../types";

const baseDamage: Damage = {
  abilityId: 1,
  name: "Test Raidwide",
  type: "Magic",
  category: "Raidwide",
  amount: 100000,
  source: { name: "Boss", targetable: true },
  castStart: 0,
  castEnd: 5000,
  targets: 8,
  mitigable: true,
};

function attr(over: Partial<DefenseAttribute>): DefenseAttribute {
  return { type: "DamageReduction", needsTarget: false, amount: 10, duration: 15, ...over };
}

describe("combinedReduction", () => {
  it("stacks multiplicatively", () => {
    // 10% + 10% => 1 - 0.9*0.9 = 0.19
    expect(combinedReduction([10, 10])).toBeCloseTo(0.19);
  });

  it("returns 0 for no mits", () => {
    expect(combinedReduction([])).toBe(0);
  });
});

describe("attributeApplies", () => {
  it("applies type-agnostic reduction to magic damage", () => {
    expect(attributeApplies(attr({}), baseDamage)).toBe(true);
  });

  it("does not apply physical-only reduction to magic damage", () => {
    expect(attributeApplies(attr({ appliesTo: "Physical" }), baseDamage)).toBe(false);
  });

  it("does not apply percent reduction to unmitigable (Dark) damage", () => {
    const dark: Damage = { ...baseDamage, type: "Dark", mitigable: false };
    expect(attributeApplies(attr({}), dark)).toBe(false);
  });

  it("applies shields to unmitigable damage", () => {
    const dark: Damage = { ...baseDamage, type: "Dark", mitigable: false };
    expect(attributeApplies(attr({ type: "Shield", amount: 8000 }), dark)).toBe(true);
  });

  it("never counts HealingIncrease as damage reduction", () => {
    expect(attributeApplies(attr({ type: "HealingIncrease" }), baseDamage)).toBe(false);
  });

  it("blocks needsTarget attributes while the source is untargetable", () => {
    const untargetable: Damage = { ...baseDamage, source: { name: "Boss", targetable: false } };
    expect(attributeApplies(attr({ needsTarget: true }), untargetable)).toBe(false);
  });
});

describe("mitigatedDamage", () => {
  it("applies percent then shields", () => {
    // 100000 * 0.9 * 0.9 = 81000; minus 10000 shield = 71000
    expect(mitigatedDamage(100000, [10, 10], 10000)).toBe(71000);
  });

  it("never goes below zero", () => {
    expect(mitigatedDamage(1000, [], 5000)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/solver/mitigation.test.ts`
Expected: FAIL — cannot resolve `./mitigation` and `../types`

- [ ] **Step 3: Implement**

Create `src/lib/types.ts` with the exact contents from the Interfaces block above.

`src/lib/solver/mitigation.ts`:
```ts
import type { Damage, DefenseAttribute } from "../types";

export function combinedReduction(reductions: number[]): number {
  let pass = 1;
  for (const r of reductions) pass *= 1 - r / 100;
  return 1 - pass;
}

export function attributeApplies(attr: DefenseAttribute, damage: Damage): boolean {
  if (attr.needsTarget && !damage.source.targetable) return false;
  if (attr.type === "Shield") return true;
  if (attr.type === "HealingIncrease") return false;
  if (!damage.mitigable) return false;
  if (attr.appliesTo && attr.appliesTo !== damage.type) return false;
  return true;
}

export function mitigatedDamage(raw: number, percentReductions: number[], shield: number): number {
  const afterPercent = raw * (1 - combinedReduction(percentReductions));
  return Math.max(0, Math.round(afterPercent - shield));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/solver/mitigation.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/solver
git commit -m "feat: core types and mitigation math"
```

---

### Task 3: Skill database + loader

**Files:**
- Create: `data/skills.json`, `src/lib/data/skills.ts`
- Test: `src/lib/data/skills.test.ts`

**Interfaces:**
- Consumes: `Skill`, `PartyMember`, `Role` from `src/lib/types.ts`
- Produces:

```ts
export function loadSkills(): Skill[];                       // parsed + validated data/skills.json
export function skillsForMember(member: PartyMember, skills: Skill[]): Skill[];
export const JOB_ROLES: Record<string, Role>;                // "pld" -> "tank", ...
```

- [ ] **Step 1: Write the failing tests**

`src/lib/data/skills.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadSkills, skillsForMember, JOB_ROLES } from "./skills";
import type { PartyMember } from "../types";

const pld: PartyMember = { slot: "T1", job: "pld", role: "tank", maxHp: 160000 };
const mnk: PartyMember = { slot: "D1", job: "mnk", role: "dps", maxHp: 110000 };
const whm: PartyMember = { slot: "H1", job: "whm", role: "healer", maxHp: 115000 };

describe("loadSkills", () => {
  it("loads a non-empty validated skill list", () => {
    const skills = loadSkills();
    expect(skills.length).toBeGreaterThan(30);
    for (const s of skills) {
      expect(s.id).toBeTruthy();
      expect(s.cooldown).toBeGreaterThan(0);
      expect(["self", "single", "party"]).toContain(s.targeting);
      expect(s.attributes.length).toBeGreaterThan(0);
    }
  });

  it("has unique skill ids", () => {
    const ids = loadSkills().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("skillsForMember", () => {
  const skills = loadSkills();

  it("gives a paladin its own skills plus tank role actions", () => {
    const ids = skillsForMember(pld, skills).map((s) => s.id);
    expect(ids).toContain("divine_veil");
    expect(ids).toContain("reprisal");
    expect(ids).not.toContain("shake_it_off");
  });

  it("gives a monk melee role actions", () => {
    const ids = skillsForMember(mnk, skills).map((s) => s.id);
    expect(ids).toContain("feint");
    expect(ids).toContain("mantra");
    expect(ids).not.toContain("addle");
  });

  it("gives a white mage only its own skills", () => {
    const ids = skillsForMember(whm, skills).map((s) => s.id);
    expect(ids).toContain("temperance");
    expect(ids).not.toContain("sacred_soil");
  });
});

describe("JOB_ROLES", () => {
  it("classifies all 21 combat jobs", () => {
    expect(Object.keys(JOB_ROLES)).toHaveLength(21);
    expect(JOB_ROLES["gnb"]).toBe("tank");
    expect(JOB_ROLES["sge"]).toBe("healer");
    expect(JOB_ROLES["pct"]).toBe("dps");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/data/skills.test.ts`
Expected: FAIL — cannot resolve `./skills`

- [ ] **Step 3: Create data/skills.json**

Full v1 database. Values are representative Dawntrail (7.x) numbers; shield amounts are fixed representative HP per spec §3.3. Schema per `Skill` in Task 2. Attribute defaults: every attribute object must be complete (no defaults applied by the loader).

```json
[
  { "id": "reprisal", "name": "Reprisal", "job": "tank", "icon": "icons/tank_reprisal.png", "cooldown": 60, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": true, "amount": 10, "duration": 15 }] },
  { "id": "divine_veil", "name": "Divine Veil", "job": "pld", "icon": "icons/pld_divine_veil.png", "cooldown": 90, "targeting": "party",
    "attributes": [{ "type": "Shield", "needsTarget": false, "amount": 16000, "duration": 30 }] },
  { "id": "passage_of_arms", "name": "Passage of Arms", "job": "pld", "icon": "icons/pld_passage_of_arms.png", "cooldown": 120, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 15, "duration": 18 }] },
  { "id": "shake_it_off", "name": "Shake It Off", "job": "war", "icon": "icons/war_shake_it_off.png", "cooldown": 90, "targeting": "party",
    "attributes": [{ "type": "Shield", "needsTarget": false, "amount": 24000, "duration": 30 }] },
  { "id": "dark_missionary", "name": "Dark Missionary", "job": "drk", "icon": "icons/drk_dark_missionary.png", "cooldown": 90, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "appliesTo": "Magic", "duration": 15 }] },
  { "id": "heart_of_light", "name": "Heart of Light", "job": "gnb", "icon": "icons/gnb_heart_of_light.png", "cooldown": 90, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "appliesTo": "Magic", "duration": 15 }] },
  { "id": "feint", "name": "Feint", "job": "melee", "icon": "icons/melee_feint.png", "cooldown": 90, "targeting": "party",
    "attributes": [
      { "type": "DamageReduction", "needsTarget": true, "amount": 10, "appliesTo": "Physical", "duration": 15 },
      { "type": "DamageReduction", "needsTarget": true, "amount": 5, "appliesTo": "Magic", "duration": 15 }] },
  { "id": "addle", "name": "Addle", "job": "caster", "icon": "icons/caster_addle.png", "cooldown": 90, "targeting": "party",
    "attributes": [
      { "type": "DamageReduction", "needsTarget": true, "amount": 10, "appliesTo": "Magic", "duration": 15 },
      { "type": "DamageReduction", "needsTarget": true, "amount": 5, "appliesTo": "Physical", "duration": 15 }] },
  { "id": "mantra", "name": "Mantra", "job": "mnk", "icon": "icons/mnk_mantra.png", "cooldown": 90, "targeting": "party",
    "attributes": [{ "type": "HealingIncrease", "needsTarget": false, "amount": 10, "duration": 15 }] },
  { "id": "troubadour", "name": "Troubadour", "job": "brd", "icon": "icons/brd_troubadour.png", "cooldown": 90, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 15, "duration": 15 }] },
  { "id": "tactician", "name": "Tactician", "job": "mch", "icon": "icons/mch_tactician.png", "cooldown": 90, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 15, "duration": 15 }] },
  { "id": "shield_samba", "name": "Shield Samba", "job": "dnc", "icon": "icons/dnc_shield_samba.png", "cooldown": 90, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 15, "duration": 15 }] },
  { "id": "dismantle", "name": "Dismantle", "job": "mch", "icon": "icons/mch_dismantle.png", "cooldown": 120, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": true, "amount": 10, "duration": 10 }] },
  { "id": "magick_barrier", "name": "Magick Barrier", "job": "rdm", "icon": "icons/rdm_magick_barrier.png", "cooldown": 120, "targeting": "party",
    "attributes": [
      { "type": "DamageReduction", "needsTarget": false, "amount": 10, "appliesTo": "Magic", "duration": 10 },
      { "type": "HealingIncrease", "needsTarget": false, "amount": 5, "duration": 10 }] },
  { "id": "temperance", "name": "Temperance", "job": "whm", "icon": "icons/whm_temperance.png", "cooldown": 120, "targeting": "party",
    "attributes": [
      { "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 20 },
      { "type": "HealingIncrease", "needsTarget": false, "amount": 20, "duration": 20 }] },
  { "id": "sacred_soil", "name": "Sacred Soil", "job": "sch", "icon": "icons/sch_sacred_soil.png", "cooldown": 30, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 17 }] },
  { "id": "fey_illumination", "name": "Fey Illumination", "job": "sch", "icon": "icons/sch_fey_illumination.png", "cooldown": 120, "targeting": "party",
    "attributes": [
      { "type": "DamageReduction", "needsTarget": false, "amount": 5, "appliesTo": "Magic", "duration": 20 },
      { "type": "HealingIncrease", "needsTarget": false, "amount": 10, "duration": 20 }] },
  { "id": "expedient", "name": "Expedient", "job": "sch", "icon": "icons/sch_expedient.png", "cooldown": 120, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 20 }] },
  { "id": "collective_unconscious", "name": "Collective Unconscious", "job": "ast", "icon": "icons/ast_collective_unconscious.png", "cooldown": 60, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 5 }] },
  { "id": "neutral_sect", "name": "Neutral Sect", "job": "ast", "icon": "icons/ast_neutral_sect.png", "cooldown": 120, "targeting": "party",
    "attributes": [{ "type": "HealingIncrease", "needsTarget": false, "amount": 20, "duration": 20 }] },
  { "id": "sun_sign", "name": "Sun Sign", "job": "ast", "icon": "icons/ast_sun_sign.png", "cooldown": 120, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 15 }] },
  { "id": "kerachole", "name": "Kerachole", "job": "sge", "icon": "icons/sge_kerachole.png", "cooldown": 30, "targeting": "party",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 15 }] },
  { "id": "holos", "name": "Holos", "job": "sge", "icon": "icons/sge_holos.png", "cooldown": 120, "targeting": "party",
    "attributes": [
      { "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 20 },
      { "type": "Shield", "needsTarget": false, "amount": 8000, "duration": 20 }] },
  { "id": "panhaima", "name": "Panhaima", "job": "sge", "icon": "icons/sge_panhaima.png", "cooldown": 120, "targeting": "party",
    "attributes": [{ "type": "Shield", "needsTarget": false, "amount": 12000, "duration": 15 }] },
  { "id": "physis_ii", "name": "Physis II", "job": "sge", "icon": "icons/sge_physis_ii.png", "cooldown": 60, "targeting": "party",
    "attributes": [{ "type": "HealingIncrease", "needsTarget": false, "amount": 10, "duration": 15 }] },
  { "id": "rampart", "name": "Rampart", "job": "tank", "icon": "icons/tank_rampart.png", "cooldown": 90, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 20, "duration": 20 }] },
  { "id": "guardian", "name": "Guardian", "job": "pld", "icon": "icons/pld_guardian.png", "cooldown": 120, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 40, "duration": 15 }] },
  { "id": "holy_sheltron", "name": "Holy Sheltron", "job": "pld", "icon": "icons/pld_holy_sheltron.png", "cooldown": 25, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 15, "duration": 8 }] },
  { "id": "intervention", "name": "Intervention", "job": "pld", "icon": "icons/pld_intervention.png", "cooldown": 10, "targeting": "single",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 8 }] },
  { "id": "bulwark", "name": "Bulwark", "job": "pld", "icon": "icons/pld_bulwark.png", "cooldown": 90, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 18, "duration": 10 }] },
  { "id": "damnation", "name": "Damnation", "job": "war", "icon": "icons/war_damnation.png", "cooldown": 120, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 40, "duration": 15 }] },
  { "id": "bloodwhetting", "name": "Bloodwhetting", "job": "war", "icon": "icons/war_bloodwhetting.png", "cooldown": 25, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 25, "duration": 8 }] },
  { "id": "thrill_of_battle", "name": "Thrill of Battle", "job": "war", "icon": "icons/war_thrill_of_battle.png", "cooldown": 90, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 20, "duration": 10 }] },
  { "id": "nascent_flash", "name": "Nascent Flash", "job": "war", "icon": "icons/war_nascent_flash.png", "cooldown": 25, "targeting": "single",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 8 }] },
  { "id": "shadowed_vigil", "name": "Shadowed Vigil", "job": "drk", "icon": "icons/drk_shadowed_vigil.png", "cooldown": 120, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 40, "duration": 15 }] },
  { "id": "dark_mind", "name": "Dark Mind", "job": "drk", "icon": "icons/drk_dark_mind.png", "cooldown": 60, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 20, "appliesTo": "Magic", "duration": 10 }] },
  { "id": "the_blackest_night", "name": "The Blackest Night", "job": "drk", "icon": "icons/drk_the_blackest_night.png", "cooldown": 15, "targeting": "single",
    "attributes": [{ "type": "Shield", "needsTarget": false, "amount": 40000, "duration": 7 }] },
  { "id": "oblation", "name": "Oblation", "job": "drk", "icon": "icons/drk_oblation.png", "cooldown": 30, "targeting": "single",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 10 }] },
  { "id": "great_nebula", "name": "Great Nebula", "job": "gnb", "icon": "icons/gnb_great_nebula.png", "cooldown": 120, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 40, "duration": 15 }] },
  { "id": "camouflage", "name": "Camouflage", "job": "gnb", "icon": "icons/gnb_camouflage.png", "cooldown": 90, "targeting": "self",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 20 }] },
  { "id": "heart_of_corundum", "name": "Heart of Corundum", "job": "gnb", "icon": "icons/gnb_heart_of_corundum.png", "cooldown": 25, "targeting": "single",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 20, "duration": 8 }] },
  { "id": "divine_benison", "name": "Divine Benison", "job": "whm", "icon": "icons/whm_divine_benison.png", "cooldown": 30, "targeting": "single",
    "attributes": [{ "type": "Shield", "needsTarget": false, "amount": 9000, "duration": 15 }] },
  { "id": "aquaveil", "name": "Aquaveil", "job": "whm", "icon": "icons/whm_aquaveil.png", "cooldown": 60, "targeting": "single",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 15, "duration": 8 }] },
  { "id": "protraction", "name": "Protraction", "job": "sch", "icon": "icons/sch_protraction.png", "cooldown": 60, "targeting": "single",
    "attributes": [{ "type": "HealingIncrease", "needsTarget": false, "amount": 10, "duration": 10 }] },
  { "id": "exaltation", "name": "Exaltation", "job": "ast", "icon": "icons/ast_exaltation.png", "cooldown": 60, "targeting": "single",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 8 }] },
  { "id": "celestial_intersection", "name": "Celestial Intersection", "job": "ast", "icon": "icons/ast_celestial_intersection.png", "cooldown": 30, "targeting": "single",
    "attributes": [{ "type": "Shield", "needsTarget": false, "amount": 9000, "duration": 15 }] },
  { "id": "haima", "name": "Haima", "job": "sge", "icon": "icons/sge_haima.png", "cooldown": 90, "targeting": "single",
    "attributes": [{ "type": "Shield", "needsTarget": false, "amount": 30000, "duration": 15 }] },
  { "id": "taurochole", "name": "Taurochole", "job": "sge", "icon": "icons/sge_taurochole.png", "cooldown": 45, "targeting": "single",
    "attributes": [{ "type": "DamageReduction", "needsTarget": false, "amount": 10, "duration": 15 }] }
]
```

- [ ] **Step 4: Implement the loader**

`src/lib/data/skills.ts`:
```ts
import rawSkills from "../../../data/skills.json";
import type { PartyMember, Role, Skill } from "../types";

export const JOB_ROLES: Record<string, Role> = {
  pld: "tank", war: "tank", drk: "tank", gnb: "tank",
  whm: "healer", sch: "healer", ast: "healer", sge: "healer",
  mnk: "dps", drg: "dps", nin: "dps", sam: "dps", rpr: "dps", vpr: "dps",
  brd: "dps", mch: "dps", dnc: "dps",
  blm: "dps", smn: "dps", rdm: "dps", pct: "dps",
};

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/data/skills.test.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add data/skills.json src/lib/data
git commit -m "feat: v1 defensive skill database and loader"
```

---

### Task 4: fflogs client (URL parsing, OAuth, GraphQL)

**Files:**
- Create: `src/lib/fflogs/client.ts`
- Test: `src/lib/fflogs/client.test.ts`

**Interfaces:**
- Produces:

```ts
export function parseFflogsUrl(url: string): { reportCode: string; fightId?: number };
// throws Error("Not an fflogs report URL") on bad input

export type FetchFn = typeof globalThis.fetch;

export class FflogsClient {
  constructor(opts: { clientId: string; clientSecret: string; fetchFn?: FetchFn });
  query<T>(gql: string, variables: Record<string, unknown>): Promise<T>;
  // POSTs https://www.fflogs.com/api/v2/client with Bearer token from
  // https://www.fflogs.com/oauth/token (client_credentials); token cached until expiry.
  // Throws Error with the fflogs error message on GraphQL errors.
}
```

- [ ] **Step 1: Write the failing tests**

`src/lib/fflogs/client.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { FflogsClient, parseFflogsUrl } from "./client";

describe("parseFflogsUrl", () => {
  it("parses report code and fight id", () => {
    expect(parseFflogsUrl("https://www.fflogs.com/reports/AbC123xYz9KlMnOp#fight=12&type=damage-done"))
      .toEqual({ reportCode: "AbC123xYz9KlMnOp", fightId: 12 });
  });

  it("parses a report URL without a fight fragment", () => {
    expect(parseFflogsUrl("https://www.fflogs.com/reports/AbC123xYz9KlMnOp"))
      .toEqual({ reportCode: "AbC123xYz9KlMnOp", fightId: undefined });
  });

  it("treats fight=last as no fight id", () => {
    expect(parseFflogsUrl("https://www.fflogs.com/reports/AbC123xYz9KlMnOp#fight=last").fightId)
      .toBeUndefined();
  });

  it("rejects non-fflogs URLs", () => {
    expect(() => parseFflogsUrl("https://example.com/reports/x")).toThrow("Not an fflogs report URL");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("FflogsClient", () => {
  it("fetches a token once and reuses it", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: { a: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { a: 2 } }));
    const client = new FflogsClient({ clientId: "id", clientSecret: "sec", fetchFn });

    const first = await client.query<{ a: number }>("query Q { a }", {});
    const second = await client.query<{ a: number }>("query Q { a }", {});

    expect(first).toEqual({ a: 1 });
    expect(second).toEqual({ a: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(3); // 1 token + 2 queries
    const [tokenUrl] = fetchFn.mock.calls[0];
    expect(String(tokenUrl)).toContain("/oauth/token");
    const [, queryInit] = fetchFn.mock.calls[1];
    expect((queryInit.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("throws the GraphQL error message", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: "This report does not exist" }] }));
    const client = new FflogsClient({ clientId: "id", clientSecret: "sec", fetchFn });

    await expect(client.query("query Q { a }", {})).rejects.toThrow("This report does not exist");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/fflogs/client.test.ts`
Expected: FAIL — cannot resolve `./client`

- [ ] **Step 3: Implement**

`src/lib/fflogs/client.ts`:
```ts
const REPORT_URL_RE = /^https:\/\/(?:www\.)?fflogs\.com\/reports\/([A-Za-z0-9]{8,})/;

export function parseFflogsUrl(url: string): { reportCode: string; fightId?: number } {
  const match = REPORT_URL_RE.exec(url);
  if (!match) throw new Error("Not an fflogs report URL");
  const fightMatch = /fight=(\d+)/.exec(url);
  return { reportCode: match[1], fightId: fightMatch ? Number(fightMatch[1]) : undefined };
}

export type FetchFn = typeof globalThis.fetch;

const TOKEN_URL = "https://www.fflogs.com/oauth/token";
const API_URL = "https://www.fflogs.com/api/v2/client";

export class FflogsClient {
  private clientId: string;
  private clientSecret: string;
  private fetchFn: FetchFn;
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(opts: { clientId: string; clientSecret: string; fetchFn?: FetchFn }) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    const res = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64"),
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new Error(`fflogs token request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = body.access_token;
    this.tokenExpiry = Date.now() + (body.expires_in - 60) * 1000;
    return this.token;
  }

  async query<T>(gql: string, variables: Record<string, unknown>): Promise<T> {
    const token = await this.getToken();
    const res = await this.fetchFn(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: gql, variables }),
    });
    if (!res.ok) throw new Error(`fflogs API request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0].message);
    if (!body.data) throw new Error("fflogs API returned no data");
    return body.data;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/fflogs/client.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fflogs
git commit -m "feat: fflogs v2 client with OAuth token caching and URL parsing"
```

---

### Task 5: Report fetching + event parsing

**Files:**
- Create: `src/lib/fflogs/report.ts`
- Test: `src/lib/fflogs/report.test.ts`

**Interfaces:**
- Consumes: `FflogsClient` from Task 4.
- Produces:

```ts
export interface FightInfo { id: number; name: string; encounterID: number; startTime: number; endTime: number; }
export interface PlayerActor { id: number; name: string; job: string; role: Role; maxHp: number; }
export interface EnemyActor { id: number; name: string; }
export interface DamageTakenEvent {
  timestamp: number;        // ms, already rebased to fight start
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
export async function fetchFightData(client: FflogsClient, reportCode: string, fightId: number): Promise<FightData>;
export async function listFights(client: FflogsClient, reportCode: string): Promise<FightInfo[]>;
```

fflogs raw shapes this task depends on (from the v2 schema): `report.fights` entries `{ id, name, encounterID, startTime, endTime }` (report-relative ms); `report.masterData.actors` entries `{ id, name, type, subType }` where players have `type: "Player"` and `subType` = job name in PascalCase (e.g. `"Paladin"`); `report.masterData.abilities` entries `{ gameID, name, type }`; `report.events(...)` returns `{ data: [...], nextPageTimestamp: number | null }` and events carry absolute report timestamps plus, for damage events, `targetResources: { hitPoints, maxHitPoints }`.

- [ ] **Step 1: Write the failing tests**

`src/lib/fflogs/report.test.ts` (a fake client returning canned GraphQL responses keyed by query content):
```ts
import { describe, expect, it } from "vitest";
import { fetchFightData, listFights } from "./report";
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/fflogs/report.test.ts`
Expected: FAIL — cannot resolve `./report`

- [ ] **Step 3: Implement**

`src/lib/fflogs/report.ts`:
```ts
import type { FflogsClient } from "./client";
import type { Role } from "../types";
import { JOB_ROLES } from "../data/skills";

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

  return { fight, players, enemies, abilities: new Map(abilities.map((a) => [a.gameID, a])), damageTaken, casts };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/fflogs/report.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fflogs
git commit -m "feat: fetch and normalize fflogs fight data with event pagination"
```

---

### Task 6: Classifier (grouping, heuristics, overrides)

**Files:**
- Create: `src/lib/classify/grouping.ts`, `src/lib/classify/heuristics.ts`, `src/lib/classify/overrides.ts`, `data/fights/README.md`
- Test: `src/lib/classify/grouping.test.ts`, `src/lib/classify/heuristics.test.ts`, `src/lib/classify/overrides.test.ts`

**Interfaces:**
- Consumes: `DamageTakenEvent`, `CastEvent`, `AbilityInfo`, `PlayerActor`, `EnemyActor` from Task 5; `Damage` from Task 2.
- Produces:

```ts
// grouping.ts
export interface MechanicInstance {
  abilityGameID: number;
  castStart: number;   // begincast timestamp if found within 15s before first hit, else first hit
  castEnd: number;     // first hit timestamp
  hits: DamageTakenEvent[];
}
export function groupEvents(damage: DamageTakenEvent[], casts: CastEvent[], gapMs?: number): MechanicInstance[]; // gapMs default 2000

// heuristics.ts
export const FFLOGS_TYPE_PHYSICAL = 128;
export const FFLOGS_TYPE_MAGIC = 1024;
export const FFLOGS_TYPE_DARK = 64;
export function classifyInstance(
  instance: MechanicInstance,
  players: PlayerActor[],
  enemies: EnemyActor[],
  abilities: Map<number, AbilityInfo>,
  slotByActorId: Map<number, string>,
): Damage;

// overrides.ts
export interface FightOverride {
  abilities?: Record<string, {   // key: abilityGameID as string
    category?: DamageCategory; type?: DamageType; mitigable?: boolean; name?: string;
  }>;
  untargetable?: [number, number][];  // [startMs, endMs] windows where the boss is untargetable
}
export function applyOverrides(damages: Damage[], override: FightOverride | undefined): Damage[];
export function loadOverride(encounterId: number): FightOverride | undefined; // reads data/fights/<id>.json if present
```

The fflogs ability `type` constants above are the assumed physical/magic/dark values; Task 11 (E2E) verifies them against a real log and corrects the constants if needed. Unknown types default to `"Magic"`.

- [ ] **Step 1: Write the failing grouping tests**

`src/lib/classify/grouping.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { groupEvents } from "./grouping";
import type { DamageTakenEvent, CastEvent } from "../fflogs/report";

function hit(timestamp: number, abilityGameID: number, targetID: number, unmitigatedAmount = 50000): DamageTakenEvent {
  return { timestamp, abilityGameID, sourceID: 9, targetID, amount: unmitigatedAmount, unmitigatedAmount, absorbed: 0 };
}

describe("groupEvents", () => {
  it("groups hits of the same ability within the gap window into one instance", () => {
    const hits = [hit(1000, 500, 1), hit(1100, 500, 2), hit(1200, 500, 3)];
    const out = groupEvents(hits, []);
    expect(out).toHaveLength(1);
    expect(out[0].hits).toHaveLength(3);
    expect(out[0].castEnd).toBe(1000);
  });

  it("splits repeated casts separated by more than the gap", () => {
    const hits = [hit(1000, 500, 1), hit(31000, 500, 1)];
    const out = groupEvents(hits, []);
    expect(out).toHaveLength(2);
  });

  it("keeps different abilities separate", () => {
    const hits = [hit(1000, 500, 1), hit(1000, 600, 2)];
    expect(groupEvents(hits, [])).toHaveLength(2);
  });

  it("attaches the closest begincast within 15s as castStart", () => {
    const casts: CastEvent[] = [
      { timestamp: 500, abilityGameID: 500, type: "begincast" },
      { timestamp: 28000, abilityGameID: 500, type: "begincast" },
    ];
    const out = groupEvents([hit(5000, 500, 1), hit(31000, 500, 1)], casts);
    expect(out[0].castStart).toBe(500);
    expect(out[1].castStart).toBe(28000);
  });

  it("falls back to first hit when no begincast is near", () => {
    const out = groupEvents([hit(5000, 500, 1)], []);
    expect(out[0].castStart).toBe(5000);
  });

  it("returns instances sorted by castEnd", () => {
    const hits = [hit(9000, 600, 1), hit(1000, 500, 1)];
    const out = groupEvents(hits, []);
    expect(out.map((i) => i.abilityGameID)).toEqual([500, 600]);
  });
});
```

- [ ] **Step 2: Run grouping tests to verify they fail**

Run: `npx vitest run src/lib/classify/grouping.test.ts`
Expected: FAIL — cannot resolve `./grouping`

- [ ] **Step 3: Implement grouping**

`src/lib/classify/grouping.ts`:
```ts
import type { CastEvent, DamageTakenEvent } from "../fflogs/report";

export interface MechanicInstance {
  abilityGameID: number;
  castStart: number;
  castEnd: number;
  hits: DamageTakenEvent[];
}

const CAST_LOOKBACK_MS = 15000;

export function groupEvents(
  damage: DamageTakenEvent[], casts: CastEvent[], gapMs = 2000,
): MechanicInstance[] {
  const byAbility = new Map<number, DamageTakenEvent[]>();
  for (const e of damage) {
    const list = byAbility.get(e.abilityGameID) ?? [];
    list.push(e);
    byAbility.set(e.abilityGameID, list);
  }

  const beginCasts = casts.filter((c) => c.type === "begincast");
  const instances: MechanicInstance[] = [];

  for (const [abilityGameID, events] of byAbility) {
    events.sort((a, b) => a.timestamp - b.timestamp);
    let current: DamageTakenEvent[] = [];
    const flush = () => {
      if (current.length === 0) return;
      const first = current[0].timestamp;
      const nearCasts = beginCasts.filter(
        (c) => c.abilityGameID === abilityGameID && c.timestamp <= first && first - c.timestamp <= CAST_LOOKBACK_MS,
      );
      const castStart = nearCasts.length > 0 ? nearCasts[nearCasts.length - 1].timestamp : first;
      instances.push({ abilityGameID, castStart, castEnd: first, hits: current });
      current = [];
    };
    for (const e of events) {
      if (current.length > 0 && e.timestamp - current[current.length - 1].timestamp > gapMs) flush();
      current.push(e);
    }
    flush();
  }

  return instances.sort((a, b) => a.castEnd - b.castEnd);
}
```

- [ ] **Step 4: Run grouping tests to verify they pass**

Run: `npx vitest run src/lib/classify/grouping.test.ts`
Expected: all PASS

- [ ] **Step 5: Write the failing heuristics tests**

`src/lib/classify/heuristics.test.ts`:
```ts
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
```

- [ ] **Step 6: Run heuristics tests to verify they fail**

Run: `npx vitest run src/lib/classify/heuristics.test.ts`
Expected: FAIL — cannot resolve `./heuristics`

- [ ] **Step 7: Implement heuristics**

`src/lib/classify/heuristics.ts`:
```ts
import type { Damage, DamageCategory, DamageType } from "../types";
import type { AbilityInfo, EnemyActor, PlayerActor } from "../fflogs/report";
import type { MechanicInstance } from "./grouping";

export const FFLOGS_TYPE_PHYSICAL = 128;
export const FFLOGS_TYPE_MAGIC = 1024;
export const FFLOGS_TYPE_DARK = 64;

const RAIDWIDE_MIN_TARGETS = 6;
const TANKBUSTER_MIN_FRACTION = 0.4;

function damageTypeOf(abilityType: number | undefined): DamageType {
  if (abilityType === FFLOGS_TYPE_PHYSICAL) return "Physical";
  if (abilityType === FFLOGS_TYPE_DARK) return "Dark";
  return "Magic";
}

export function classifyInstance(
  instance: MechanicInstance,
  players: PlayerActor[],
  enemies: EnemyActor[],
  abilities: Map<number, AbilityInfo>,
  slotByActorId: Map<number, string>,
): Damage {
  const ability = abilities.get(instance.abilityGameID);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const amount = Math.max(...instance.hits.map((h) => h.unmitigatedAmount));
  const hitPlayers = instance.hits
    .map((h) => playerById.get(h.targetID))
    .filter((p): p is PlayerActor => p !== undefined);
  const targets = new Set(hitPlayers.map((p) => p.id)).size;

  let category: DamageCategory = "Individual";
  let aggroSlot: string | undefined;
  if (targets >= RAIDWIDE_MIN_TARGETS) {
    category = "Raidwide";
  } else if (targets >= 1 && targets <= 2 && hitPlayers.every((p) => p.role === "tank")) {
    const heaviestHit = instance.hits.reduce((a, b) => (a.unmitigatedAmount >= b.unmitigatedAmount ? a : b));
    const tank = playerById.get(heaviestHit.targetID);
    if (tank && tank.maxHp > 0 && amount >= tank.maxHp * TANKBUSTER_MIN_FRACTION) {
      category = "Tankbuster";
      aggroSlot = slotByActorId.get(tank.id);
    }
  }

  const sourceId = instance.hits[0]?.sourceID;
  const sourceName = enemies.find((e) => e.id === sourceId)?.name ?? "Unknown";
  const type = damageTypeOf(ability?.type);

  return {
    abilityId: instance.abilityGameID,
    name: ability?.name ?? `Ability ${instance.abilityGameID}`,
    type,
    category,
    amount,
    source: { name: sourceName, targetable: true },
    castStart: instance.castStart,
    castEnd: instance.castEnd,
    targets,
    mitigable: type !== "Dark",
    ...(aggroSlot ? { aggroSlot } : {}),
  };
}
```

- [ ] **Step 8: Run heuristics tests to verify they pass**

Run: `npx vitest run src/lib/classify/heuristics.test.ts`
Expected: all PASS

- [ ] **Step 9: Write the failing overrides tests**

`src/lib/classify/overrides.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { applyOverrides, type FightOverride } from "./overrides";
import type { Damage } from "../types";

function damage(over: Partial<Damage>): Damage {
  return {
    abilityId: 500, name: "Test", type: "Magic", category: "Raidwide", amount: 60000,
    source: { name: "Boss", targetable: true }, castStart: 1000, castEnd: 5000,
    targets: 8, mitigable: true, ...over,
  };
}

describe("applyOverrides", () => {
  it("returns damages unchanged without an override", () => {
    const input = [damage({})];
    expect(applyOverrides(input, undefined)).toEqual(input);
  });

  it("overrides category, type, mitigable, and name by ability id", () => {
    const override: FightOverride = {
      abilities: { "500": { category: "Tankbuster", type: "Dark", mitigable: true, name: "Renamed" } },
    };
    const [out] = applyOverrides([damage({})], override);
    expect(out.category).toBe("Tankbuster");
    expect(out.type).toBe("Dark");
    expect(out.mitigable).toBe(true);
    expect(out.name).toBe("Renamed");
  });

  it("marks sources untargetable inside untargetable windows", () => {
    const override: FightOverride = { untargetable: [[4000, 6000]] };
    const [inside] = applyOverrides([damage({ castEnd: 5000 })], override);
    const [outside] = applyOverrides([damage({ castEnd: 7000 })], override);
    expect(inside.source.targetable).toBe(false);
    expect(outside.source.targetable).toBe(true);
  });
});
```

- [ ] **Step 10: Run overrides tests to verify they fail**

Run: `npx vitest run src/lib/classify/overrides.test.ts`
Expected: FAIL — cannot resolve `./overrides`

- [ ] **Step 11: Implement overrides**

`src/lib/classify/overrides.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Damage, DamageCategory, DamageType } from "../types";

export interface FightOverride {
  abilities?: Record<string, {
    category?: DamageCategory;
    type?: DamageType;
    mitigable?: boolean;
    name?: string;
  }>;
  untargetable?: [number, number][];
}

export function applyOverrides(damages: Damage[], override: FightOverride | undefined): Damage[] {
  if (!override) return damages;
  return damages.map((d) => {
    const ab = override.abilities?.[String(d.abilityId)];
    const untargetable = (override.untargetable ?? []).some(([s, e]) => d.castEnd >= s && d.castEnd <= e);
    return {
      ...d,
      ...(ab?.category ? { category: ab.category } : {}),
      ...(ab?.type ? { type: ab.type, mitigable: ab.mitigable ?? ab.type !== "Dark" } : {}),
      ...(ab?.mitigable !== undefined ? { mitigable: ab.mitigable } : {}),
      ...(ab?.name ? { name: ab.name } : {}),
      source: { ...d.source, targetable: d.source.targetable && !untargetable },
    };
  });
}

export function loadOverride(encounterId: number): FightOverride | undefined {
  const path = join(process.cwd(), "data", "fights", `${encounterId}.json`);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as FightOverride;
}
```

Create `data/fights/README.md`:
```markdown
# Per-fight overrides

Optional. One file per encounter: `<encounterID>.json` (fflogs encounter id).

```json
{
  "abilities": {
    "12345": { "category": "Tankbuster", "type": "Dark", "mitigable": false, "name": "Nicer Name" }
  },
  "untargetable": [[120000, 180000]]
}
```

- `abilities` keys are fflogs ability game IDs (as strings). All fields optional.
- `untargetable` is a list of `[startMs, endMs]` windows (fight-relative) where the
  boss cannot be targeted, blocking needsTarget skills like Reprisal/Feint/Addle.
```

- [ ] **Step 12: Run all classify tests**

Run: `npx vitest run src/lib/classify`
Expected: all PASS

- [ ] **Step 13: Commit**

```bash
git add src/lib/classify data/fights
git commit -m "feat: mechanic grouping, classification heuristics, and fight overrides"
```

---

### Task 7: Mitigation solver

**Files:**
- Create: `src/lib/solver/constraints.ts`, `src/lib/solver/solver.ts`
- Test: `src/lib/solver/constraints.test.ts`, `src/lib/solver/solver.test.ts`

**Interfaces:**
- Consumes: types from Task 2, `mitigation.ts` from Task 2, `skillsForMember` from Task 3.
- Produces:

```ts
// constraints.ts
export class CooldownTracker {
  use(slot: string, skillId: string, timeMs: number): void;
  isReady(slot: string, skillId: string, timeMs: number, cooldownSec: number): boolean;
}

// solver.ts
export interface SolverConfig {
  raidwideBuffer: number;   // default 0.2 — survivable if damage <= minHp * (1 - buffer)
  tankbusterBuffer: number; // default 0.1
  leadTimeMs: number;       // default 1000 — buffs applied this long before castEnd
}
export const DEFAULT_CONFIG: SolverConfig;
export function solve(
  timeline: Damage[], party: PartyMember[], skills: Skill[], config?: SolverConfig,
): MechanicPlan[];
```

Solver algorithm (v1, per spec §5 with the chronological simplification from Global Constraints):
1. Process `timeline` in `castEnd` order with one shared `CooldownTracker`.
2. For each mechanic compute the survival threshold: Tankbuster → `tankMaxHp * (1 - tankbusterBuffer)` for the aggro tank; Raidwide → `min(member maxHp) * (1 - raidwideBuffer)`; Individual → no assignments, survivable = `amount <= min(hit-eligible maxHp)` (uses min party maxHp).
3. Build the candidate list: Tankbuster → the aggro tank's `self` skills + everyone's `single` skills (recipient = aggro tank), ordered by: short self mits first (cooldown ≤ 30), then big self mits, then externals. Raidwide → all `party` skills, ordered: enemy-debuff mits (attributes with `needsTarget`) first, then percent party mits, then shields.
4. Greedily take candidates while: skill is ready (CooldownTracker + skill.cooldown), at least one attribute passes `attributeApplies`, and the attribute `duration` ≥ `leadTimeMs / 1000` (always true in practice — keep the check for zero-duration data errors). Recompute `mitigatedDamage` after each assignment; stop when below threshold.
5. Record `use()` at `castEnd - leadTimeMs` for each assigned skill. If candidates run out first, `survivable: false`.

- [ ] **Step 1: Write the failing constraints tests**

`src/lib/solver/constraints.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { CooldownTracker } from "./constraints";

describe("CooldownTracker", () => {
  it("is ready when never used", () => {
    const t = new CooldownTracker();
    expect(t.isReady("T1", "rampart", 0, 90)).toBe(true);
  });

  it("blocks reuse within the cooldown and allows it after", () => {
    const t = new CooldownTracker();
    t.use("T1", "rampart", 10000);
    expect(t.isReady("T1", "rampart", 60000, 90)).toBe(false);
    expect(t.isReady("T1", "rampart", 100000, 90)).toBe(true);
  });

  it("tracks per slot independently", () => {
    const t = new CooldownTracker();
    t.use("T1", "rampart", 10000);
    expect(t.isReady("T2", "rampart", 10000, 90)).toBe(true);
  });
});
```

- [ ] **Step 2: Run constraints tests to verify they fail**

Run: `npx vitest run src/lib/solver/constraints.test.ts`
Expected: FAIL — cannot resolve `./constraints`

- [ ] **Step 3: Implement constraints**

`src/lib/solver/constraints.ts`:
```ts
export class CooldownTracker {
  private lastUse = new Map<string, number>();

  private key(slot: string, skillId: string): string {
    return `${slot}:${skillId}`;
  }

  use(slot: string, skillId: string, timeMs: number): void {
    this.lastUse.set(this.key(slot, skillId), timeMs);
  }

  isReady(slot: string, skillId: string, timeMs: number, cooldownSec: number): boolean {
    const last = this.lastUse.get(this.key(slot, skillId));
    if (last === undefined) return true;
    return timeMs - last >= cooldownSec * 1000;
  }
}
```

- [ ] **Step 4: Run constraints tests to verify they pass**

Run: `npx vitest run src/lib/solver/constraints.test.ts`
Expected: all PASS

- [ ] **Step 5: Write the failing solver tests**

`src/lib/solver/solver.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { solve } from "./solver";
import { loadSkills } from "../data/skills";
import type { Damage, PartyMember } from "../types";

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

function raidwide(castEnd: number, amount: number, over: Partial<Damage> = {}): Damage {
  return {
    abilityId: 500, name: "Raidwide", type: "Magic", category: "Raidwide", amount,
    source: { name: "Boss", targetable: true }, castStart: castEnd - 4000, castEnd,
    targets: 8, mitigable: true, ...over,
  };
}
function buster(castEnd: number, amount: number, over: Partial<Damage> = {}): Damage {
  return {
    abilityId: 600, name: "Buster", type: "Physical", category: "Tankbuster", amount,
    source: { name: "Boss", targetable: true }, castStart: castEnd - 4000, castEnd,
    targets: 1, mitigable: true, aggroSlot: "T1", ...over,
  };
}

describe("solve", () => {
  it("assigns party mitigation until a lethal raidwide is survivable", () => {
    // 120000 raw vs min maxHp 109000 => needs mitigation
    const [plan] = solve([raidwide(10000, 120000)], party, skills);
    expect(plan.assignments.length).toBeGreaterThan(0);
    expect(plan.survivable).toBe(true);
    expect(plan.mitigatedAmount).toBeLessThanOrEqual(109000 * 0.8);
  });

  it("assigns nothing for a trivial raidwide", () => {
    const [plan] = solve([raidwide(10000, 30000)], party, skills);
    expect(plan.assignments).toHaveLength(0);
    expect(plan.survivable).toBe(true);
  });

  it("assigns tank personals to the aggro tank on a buster", () => {
    const [plan] = solve([buster(10000, 200000)], party, skills);
    expect(plan.survivable).toBe(true);
    const slots = new Set(plan.assignments.map((a) => a.slot));
    expect(slots.has("T1")).toBe(true); // own personals used
    const t1Skills = plan.assignments.filter((a) => a.slot === "T1").map((a) => a.skillId);
    expect(t1Skills.length).toBeGreaterThan(0);
  });

  it("respects cooldowns across consecutive raidwides", () => {
    // two heavy raidwides 30s apart: 90s+ cooldown skills cannot repeat
    const plans = solve([raidwide(10000, 120000), raidwide(40000, 120000)], party, skills);
    const firstIds = new Set(plans[0].assignments.map((a) => `${a.slot}:${a.skillId}`));
    for (const a of plans[1].assignments) {
      const skill = skills.find((s) => s.id === a.skillId)!;
      if (skill.cooldown >= 60) {
        expect(firstIds.has(`${a.slot}:${a.skillId}`)).toBe(false);
      }
    }
  });

  it("only uses shields against unmitigable dark damage", () => {
    const [plan] = solve([raidwide(10000, 115000, { type: "Dark", mitigable: false })], party, skills);
    for (const a of plan.assignments) {
      const skill = skills.find((s) => s.id === a.skillId)!;
      expect(skill.attributes.some((at) => at.type === "Shield")).toBe(true);
    }
  });

  it("does not assign needsTarget mits while the boss is untargetable", () => {
    const [plan] = solve(
      [raidwide(10000, 120000, { source: { name: "Boss", targetable: false } })], party, skills);
    const ids = plan.assignments.map((a) => a.skillId);
    expect(ids).not.toContain("reprisal");
    expect(ids).not.toContain("addle");
    expect(ids).not.toContain("feint");
  });

  it("flags an unsurvivable mechanic instead of failing", () => {
    const [plan] = solve([raidwide(10000, 500000)], party, skills);
    expect(plan.survivable).toBe(false);
    expect(plan.assignments.length).toBeGreaterThan(0); // still assigns what it can
  });

  it("makes no assignments for individual damage", () => {
    const [plan] = solve([raidwide(10000, 80000, { category: "Individual", targets: 3 })], party, skills);
    expect(plan.assignments).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run solver tests to verify they fail**

Run: `npx vitest run src/lib/solver/solver.test.ts`
Expected: FAIL — cannot resolve `./solver`

- [ ] **Step 7: Implement the solver**

`src/lib/solver/solver.ts`:
```ts
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
```

- [ ] **Step 8: Run solver tests to verify they pass**

Run: `npx vitest run src/lib/solver`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/solver
git commit -m "feat: greedy chronological mitigation solver with cooldown tracking"
```

---

### Task 8: Sheet layout builder (pure)

**Files:**
- Create: `src/lib/sheets/layout.ts`
- Test: `src/lib/sheets/layout.test.ts`

**Interfaces:**
- Consumes: `MechanicPlan`, `PartyMember`, `Skill` from earlier tasks.
- Produces:

```ts
export const ICON_BASE_URL =
  "https://raw.githubusercontent.com/junyeopN/FFXIVDefensiveSolver/main/";

// Google Sheets API RowData-compatible structure (subset)
export interface CellData {
  userEnteredValue?: { stringValue?: string; formulaValue?: string; numberValue?: number };
  userEnteredFormat?: Record<string, unknown>;
  note?: string;
}
export interface RowData { values: CellData[]; }

export function buildSheetRows(
  plans: MechanicPlan[], party: PartyMember[], skills: Skill[],
): RowData[];
// Row 0: header — "Cast", "Hit", "Mechanic", "Type", "Category", "Damage", "Aggro",
//        then per member: "<SLOT>" with a job-icon =IMAGE formula cell note
// Rows 1..n: one row per mechanic plan (chronological), member cells:
//   0 skills => empty; 1 skill => =IMAGE(iconUrl) formula with skill name as note;
//   2+ skills => stringValue with names joined by " + "
// Unsurvivable rows get a red background on the mechanic name cell.

export function formatTime(ms: number): string; // 65000 -> "1:05"
```

- [ ] **Step 1: Write the failing tests**

`src/lib/sheets/layout.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/sheets/layout.test.ts`
Expected: FAIL — cannot resolve `./layout`

- [ ] **Step 3: Implement**

`src/lib/sheets/layout.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/sheets/layout.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sheets
git commit -m "feat: sheet layout builder producing Sheets API row data"
```

---

### Task 9: Sheets exporter, pipeline, API route

**Files:**
- Create: `src/lib/sheets/exporter.ts`, `src/lib/pipeline.ts`, `src/app/api/solve/route.ts`, `.env.local.example`
- Test: `src/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
// exporter.ts — thin googleapis wrapper, no unit tests (covered by E2E in Task 11)
export interface ExportInput { title: string; rows: RowData[]; }
export async function exportToSheet(input: ExportInput): Promise<string>; // returns spreadsheet URL
// Reads env: GOOGLE_SERVICE_ACCOUNT_KEY (JSON string), SHEET_SHARE_EMAIL.
// Creates spreadsheet with one sheet "Mitigation" containing rows, sets column widths
// (col 0-1: 50px, col 2: 220px, cols 7+: 90px) and row heights (40px) via batchUpdate,
// then shares to SHEET_SHARE_EMAIL as writer via the Drive API.

// pipeline.ts
export type PartySelection = Record<string, string>; // slot -> job, all 8 slots
export interface PipelineDeps {
  fetchFightData: typeof import("./fflogs/report").fetchFightData;
  listFights: typeof import("./fflogs/report").listFights;
  client: FflogsClient;
  exportSheet: (input: ExportInput) => Promise<string>;
}
export interface PipelineResult {
  sheetUrl: string | null;
  sheetError?: string;
  fightName: string;
  plans: MechanicPlan[];
  warnings: string[];
}
export async function runPipeline(url: string, party: PartySelection, deps: PipelineDeps): Promise<PipelineResult>;
```

Pipeline behavior: parse URL (fight id required — if absent, throw `Error("Pick a fight: ...")` listing fights via `listFights`); fetch fight data; build `PartyMember[]` from the selection with `maxHp` = max HP among log players of the same role (fallback 100000 if none); group + classify + apply `loadOverride(encounterID)`; drop noise instances (`amount < 5%` of min party maxHp); solve; build rows; export (sheet failure → `sheetUrl: null`, `sheetError` set, plans still returned). Warning added when the log's job composition differs from the selection.

- [ ] **Step 1: Write the failing pipeline test**

`src/lib/pipeline.test.ts`:
```ts
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
```

- [ ] **Step 2: Run pipeline test to verify it fails**

Run: `npx vitest run src/lib/pipeline.test.ts`
Expected: FAIL — cannot resolve `./pipeline`

- [ ] **Step 3: Implement pipeline**

`src/lib/pipeline.ts`:
```ts
import { parseFflogsUrl, type FflogsClient } from "./fflogs/client";
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
  if (fightId === undefined) {
    const fights = await deps.listFights(deps.client, reportCode);
    const list = fights.map((f) => `${f.id}: ${f.name}`).join(", ");
    throw new Error(`Pick a fight: append #fight=<id> to the URL. Fights in this report: ${list}`);
  }

  const data = await deps.fetchFightData(deps.client, reportCode, fightId);
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
    .filter((d) => d.amount >= minHp * NOISE_FRACTION);
  damages = applyOverrides(damages, loadOverride(data.fight.encounterID));

  const skills = loadSkills();
  const plans = solve(damages, members, skills);
  const rows = buildSheetRows(plans, members, skills);

  let sheetUrl: string | null = null;
  let sheetError: string | undefined;
  try {
    sheetUrl = await deps.exportSheet({
      title: `${data.fight.name} mitigation plan (${new Date().toISOString().slice(0, 10)})`,
      rows,
    });
  } catch (err) {
    sheetError = err instanceof Error ? err.message : String(err);
  }

  return { sheetUrl, sheetError, fightName: data.fight.name, plans, warnings };
}
```

- [ ] **Step 4: Run pipeline test to verify it passes**

Run: `npx vitest run src/lib/pipeline.test.ts`
Expected: all PASS

- [ ] **Step 5: Implement the exporter (no unit test — verified in Task 11 E2E)**

`src/lib/sheets/exporter.ts`:
```ts
import { google } from "googleapis";
import type { RowData } from "./layout";

export interface ExportInput { title: string; rows: RowData[]; }

function getAuth() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  const parsed = JSON.parse(key) as { client_email: string; private_key: string };
  return new google.auth.JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"],
  });
}

export async function exportToSheet(input: ExportInput): Promise<string> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: input.title },
      sheets: [{
        properties: { title: "Mitigation", gridProperties: { frozenRowCount: 1 } },
        data: [{ startRow: 0, startColumn: 0, rowData: input.rows }],
      }],
    },
  });

  const spreadsheetId = created.data.spreadsheetId!;
  const sheetId = created.data.sheets![0].properties!.sheetId!;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 2 },
            properties: { pixelSize: 50 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 220 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 15 },
            properties: { pixelSize: 90 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: input.rows.length },
            properties: { pixelSize: 40 }, fields: "pixelSize" } },
      ],
    },
  });

  const shareEmail = process.env.SHEET_SHARE_EMAIL;
  if (shareEmail) {
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { type: "user", role: "writer", emailAddress: shareEmail },
      sendNotificationEmail: false,
    });
  }

  return created.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
}
```

- [ ] **Step 6: Implement the API route and env example**

`src/app/api/solve/route.ts`:
```ts
import { NextResponse } from "next/server";
import { FflogsClient } from "../../../lib/fflogs/client";
import { fetchFightData, listFights } from "../../../lib/fflogs/report";
import { exportToSheet } from "../../../lib/sheets/exporter";
import { runPipeline, type PartySelection } from "../../../lib/pipeline";

export async function POST(req: Request): Promise<NextResponse> {
  let body: { url?: string; party?: PartySelection };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.url || !body.party) {
    return NextResponse.json({ error: "url and party are required" }, { status: 400 });
  }

  const clientId = process.env.FFLOGS_CLIENT_ID;
  const clientSecret = process.env.FFLOGS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "fflogs API credentials are not configured" }, { status: 500 });
  }

  try {
    const client = new FflogsClient({ clientId, clientSecret });
    const result = await runPipeline(body.url, body.party, {
      client, fetchFightData, listFights, exportSheet: exportToSheet,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
```

`.env.local.example`:
```
FFLOGS_CLIENT_ID=your-fflogs-v2-client-id
FFLOGS_CLIENT_SECRET=your-fflogs-v2-client-secret
GOOGLE_SERVICE_ACCOUNT_KEY={"client_email":"...","private_key":"..."}
SHEET_SHARE_EMAIL=you@example.com
```

- [ ] **Step 7: Verify everything builds and all tests pass**

Run: `npx vitest run`
Expected: all test files PASS

Run: `npm run build`
Expected: exits 0

- [ ] **Step 8: Commit**

```bash
git add src/lib/sheets/exporter.ts src/lib/pipeline.ts src/lib/pipeline.test.ts src/app/api .env.local.example
git commit -m "feat: sheets exporter, solve pipeline, and API route"
```

---

### Task 10: UI

**Files:**
- Modify: `src/app/page.tsx` (replace placeholder)

**Interfaces:**
- Consumes: `POST /api/solve` with body `{ url: string, party: Record<slot, job> }`, response `PipelineResult` or `{ error: string }`.

No unit tests for the UI (spec §9: manual E2E); correctness is checked by `npm run build` + Task 11.

- [ ] **Step 1: Implement the page**

`src/app/page.tsx`:
```tsx
"use client";

import { useState } from "react";

const SLOT_JOBS: Record<string, string[]> = {
  T1: ["pld", "war", "drk", "gnb"],
  T2: ["pld", "war", "drk", "gnb"],
  H1: ["whm", "sch", "ast", "sge"],
  H2: ["whm", "sch", "ast", "sge"],
  D1: ["mnk", "drg", "nin", "sam", "rpr", "vpr", "brd", "mch", "dnc", "blm", "smn", "rdm", "pct"],
  D2: ["mnk", "drg", "nin", "sam", "rpr", "vpr", "brd", "mch", "dnc", "blm", "smn", "rdm", "pct"],
  D3: ["mnk", "drg", "nin", "sam", "rpr", "vpr", "brd", "mch", "dnc", "blm", "smn", "rdm", "pct"],
  D4: ["mnk", "drg", "nin", "sam", "rpr", "vpr", "brd", "mch", "dnc", "blm", "smn", "rdm", "pct"],
};

const DEFAULT_PARTY: Record<string, string> = {
  T1: "pld", T2: "war", H1: "whm", H2: "sch", D1: "mnk", D2: "nin", D3: "brd", D4: "blm",
};

const ICON_BASE = "https://raw.githubusercontent.com/junyeopN/FFXIVDefensiveSolver/main/";

interface Plan {
  damage: { name: string; type: string; category: string; amount: number; castEnd: number };
  assignments: { slot: string; skillId: string }[];
  mitigatedAmount: number;
  survivable: boolean;
}
interface SolveResult {
  sheetUrl: string | null;
  sheetError?: string;
  fightName: string;
  plans: Plan[];
  warnings: string[];
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Home() {
  const [party, setParty] = useState(DEFAULT_PARTY);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, party }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body as SolveResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>FFXIV Defense Solver</h1>

      <section style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {Object.keys(SLOT_JOBS).map((slot) => (
          <label key={slot} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <img src={`${ICON_BASE}icons/jobs/${party[slot]}.png`} alt={party[slot]} width={40} height={40} />
            <span>{slot}</span>
            <select value={party[slot]} onChange={(e) => setParty({ ...party, [slot]: e.target.value })}>
              {SLOT_JOBS[slot].map((j) => (
                <option key={j} value={j}>{j.toUpperCase()}</option>
              ))}
            </select>
          </label>
        ))}
      </section>

      <section style={{ marginBottom: 16 }}>
        <input
          style={{ width: 480, marginRight: 8 }}
          placeholder="https://www.fflogs.com/reports/...#fight=N"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={submit} disabled={busy || !url}>
          {busy ? "Solving..." : "Solve"}
        </button>
      </section>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {result && (
        <section>
          <h2>{result.fightName}</h2>
          {result.warnings.map((w) => (
            <p key={w} style={{ color: "darkorange" }}>{w}</p>
          ))}
          {result.sheetUrl ? (
            <p><a href={result.sheetUrl} target="_blank" rel="noreferrer">Open the Google Sheet</a></p>
          ) : (
            <p style={{ color: "crimson" }}>Sheet export failed: {result.sheetError}</p>
          )}
          <table border={1} cellPadding={4} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr><th>Time</th><th>Mechanic</th><th>Type</th><th>Category</th><th>Damage</th><th>Assignments</th></tr>
            </thead>
            <tbody>
              {result.plans.map((p, i) => (
                <tr key={i} style={p.survivable ? undefined : { background: "#fdd" }}>
                  <td>{formatTime(p.damage.castEnd)}</td>
                  <td>{p.damage.name}</td>
                  <td>{p.damage.type}</td>
                  <td>{p.damage.category}</td>
                  <td>{p.damage.amount.toLocaleString("en-US")} → {p.mitigatedAmount.toLocaleString("en-US")}</td>
                  <td>{p.assignments.map((a) => `${a.slot} ${a.skillId}`).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: exits 0

Run: `npx vitest run`
Expected: all PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: party picker and solve UI"
```

---

### Task 11: E2E verification + README

**Files:**
- Create: `README.md`
- Possibly modify: `src/lib/classify/heuristics.ts` (ability type constants, per real-log verification)

This task needs the user's credentials — ask for them before starting:
1. fflogs v2 client id/secret (create at https://www.fflogs.com/api/clients).
2. A Google Cloud service account JSON with Sheets + Drive APIs enabled.
Put both in `.env.local` per `.env.local.example`.

- [ ] **Step 1: Run the dev server and solve a real log**

Run: `npm run dev`, open http://localhost:3000, paste a real fflogs report URL with `#fight=N`, click Solve.
Expected: plan table renders; sheet link opens a populated spreadsheet with icons.

- [ ] **Step 2: Verify the ability type mapping against the real log**

Compare a few known abilities in the plan table against fflogs' own damage-taken view for the same fight (physical = orange, magic = blue, dark = purple on fflogs). If `Type` disagrees, print the raw `type` values (temporarily log `abilities.get(...)` in the pipeline or inspect the API response), correct `FFLOGS_TYPE_PHYSICAL` / `FFLOGS_TYPE_MAGIC` / `FFLOGS_TYPE_DARK` in `src/lib/classify/heuristics.ts`, and re-run `npx vitest run src/lib/classify` (tests use the constants, so they stay green).

- [ ] **Step 3: Sanity-check the generated sheet against the reference sheet**

Open the generated sheet next to the reference (절 케프카 생존기 tab). Check: chronological order, tankbusters carry tank personals, raidwides rotate party mits, unsurvivable rows are red, icons render.

- [ ] **Step 4: Write README.md**

```markdown
# FFXIV Defensive Solver

Auto-assigns party defensive cooldowns to boss mechanics from an fflogs log,
and writes the plan to a Google Sheet.

## Setup

1. `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in:
   - `FFLOGS_CLIENT_ID` / `FFLOGS_CLIENT_SECRET` — create a v2 API client at
     https://www.fflogs.com/api/clients
   - `GOOGLE_SERVICE_ACCOUNT_KEY` — service account JSON (one line) with the
     Sheets and Drive APIs enabled
   - `SHEET_SHARE_EMAIL` — generated sheets are shared to this address
3. `npm run dev` → http://localhost:3000

## Usage

Pick your party composition, paste an fflogs report URL including `#fight=N`,
and press Solve. The plan renders inline and is exported to a new Google Sheet.

## Data

- `data/skills.json` — defensive skill database (cooldowns, effects, icons)
- `data/fights/<encounterID>.json` — optional per-fight classification overrides
- `icons/` — ability and job icons fetched from XIVAPI (`scripts/fetch_icons.py`)

## Design

See `docs/superpowers/specs/2026-07-10-ffxiv-defense-solver-design.md`.
```

- [ ] **Step 5: Final check and commit**

Run: `npx vitest run && npm run build`
Expected: all PASS, build exits 0

```bash
git add README.md
git commit -m "docs: README with setup and usage"
git push
```
