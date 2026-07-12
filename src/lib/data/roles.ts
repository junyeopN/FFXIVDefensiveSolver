import type { Role } from "../types";

export const JOB_ROLES: Record<string, Role> = {
  pld: "tank", war: "tank", drk: "tank", gnb: "tank",
  whm: "healer", sch: "healer", ast: "healer", sge: "healer",
  mnk: "dps", drg: "dps", nin: "dps", sam: "dps", rpr: "dps", vpr: "dps",
  brd: "dps", mch: "dps", dnc: "dps",
  blm: "dps", smn: "dps", rdm: "dps", pct: "dps",
};
