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
            {/* eslint-disable-next-line @next/next/no-img-element */}
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
          placeholder="https://www.fflogs.com/reports/...?fight=last"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={submit} disabled={busy || !url}>
          {busy ? "Creating..." : "Create Mitigation Sheet"}
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
