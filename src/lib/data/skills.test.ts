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
