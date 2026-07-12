import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FflogsClient, parseFflogsUrl } from "./client";
import { fetchFightData, listFights, resolveFightId } from "./report";

// Loads FFLOGS_CLIENT_ID / FFLOGS_CLIENT_SECRET from the environment or .env.local.
// The whole suite is skipped when credentials are absent, so CI and offline runs stay green.
function loadCredentials(): { clientId: string; clientSecret: string } | null {
  const envPath = join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
  const clientId = process.env.FFLOGS_CLIENT_ID;
  const clientSecret = process.env.FFLOGS_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const creds = loadCredentials();
const EXAMPLE_URL = "https://www.fflogs.com/reports/ZNY4yvA2aqdp6xjB?fight=last";

describe.runIf(creds !== null)("live fflogs fetch (example report)", () => {
  it("fetches the last fight of the example report", async () => {
    const client = new FflogsClient(creds!);
    const { reportCode, fightId } = parseFflogsUrl(EXAMPLE_URL);

    const fights = await listFights(client, reportCode);
    expect(fights.length).toBeGreaterThan(0);
    const resolved = resolveFightId(fights, fightId)!;
    const data = await fetchFightData(client, reportCode, resolved);

    expect(data.players.length).toBeGreaterThan(0);
    expect(data.damageTaken.length).toBeGreaterThan(0);

    // summary for manual inspection
    const byAbility = new Map<number, { name: string; hits: number; maxUnmit: number }>();
    for (const e of data.damageTaken) {
      const ability = data.abilities.get(e.abilityGameID);
      const entry = byAbility.get(e.abilityGameID) ?? { name: ability?.name ?? String(e.abilityGameID), hits: 0, maxUnmit: 0 };
      entry.hits += 1;
      entry.maxUnmit = Math.max(entry.maxUnmit, e.unmitigatedAmount);
      byAbility.set(e.abilityGameID, entry);
    }
    const top = [...byAbility.values()].sort((a, b) => b.maxUnmit - a.maxUnmit).slice(0, 10);

    console.log(`fight: ${data.fight.name} (id ${data.fight.id}, encounter ${data.fight.encounterID})`);
    console.log(`players: ${data.players.map((p) => `${p.name}[${p.job} ${p.maxHp}hp]`).join(", ")}`);
    console.log(`damage events: ${data.damageTaken.length}, casts: ${data.casts.length}`);
    console.log("top damage:", top);
  }, 60000);
});

describe.runIf(creds === null)("live fflogs fetch (skipped)", () => {
  it.skip("needs FFLOGS_CLIENT_ID / FFLOGS_CLIENT_SECRET in env or .env.local", () => {});
});
