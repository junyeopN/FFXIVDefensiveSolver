"use client";

import { useState } from "react";
import skillsData from "../../data/skills.json";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TANK_JOBS = ["pld", "war", "drk", "gnb"];
const HEALER_JOBS = ["whm", "sch", "ast", "sge"];
const DPS_JOBS = ["mnk", "drg", "nin", "sam", "rpr", "vpr", "brd", "mch", "dnc", "blm", "smn", "rdm", "pct"];

const SLOT_JOBS: Record<string, string[]> = {
  T1: TANK_JOBS, T2: TANK_JOBS,
  H1: HEALER_JOBS, H2: HEALER_JOBS,
  D1: DPS_JOBS, D2: DPS_JOBS, D3: DPS_JOBS, D4: DPS_JOBS,
};

const DEFAULT_PARTY: Record<string, string> = {
  T1: "pld", T2: "war", H1: "whm", H2: "sch", D1: "mnk", D2: "nin", D3: "brd", D4: "blm",
};

// FFXIV party-list role colors: tanks blue, healers green, dps red
const SLOT_COLORS: Record<string, string> = {
  T: "bg-blue-600",
  H: "bg-green-600",
  D: "bg-red-600",
};

const ICON_BASE = "https://raw.githubusercontent.com/junyeopN/FFXIVDefensiveSolver/main/";

const SKILLS = new Map(
  (skillsData as { id: string; name: string; icon: string }[]).map((s) => [s.id, s]),
);

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

function typeVariant(type: string): "magic" | "physical" | "dark" | "secondary" {
  if (type === "Magic") return "magic";
  if (type === "Physical") return "physical";
  if (type === "Dark") return "dark";
  return "secondary";
}

function JobTile({
  slot, job, onChange,
}: { slot: string; job: string; onChange: (job: string) => void }) {
  const color = SLOT_COLORS[slot[0]] ?? "bg-neutral-500";
  return (
    <div className="flex w-20 flex-col items-center gap-1.5">
      <div className={`flex h-16 w-16 items-center justify-center rounded-xl ${color} shadow-md`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${ICON_BASE}icons/jobs/${job}.png`} alt={job} width={48} height={48} />
      </div>
      <span className="text-xs font-semibold text-muted-foreground">{slot}</span>
      <NativeSelect value={job} onChange={(e) => onChange(e.target.value)} aria-label={`${slot} job`}>
        {SLOT_JOBS[slot].map((j) => (
          <option key={j} value={j}>{j.toUpperCase()}</option>
        ))}
      </NativeSelect>
    </div>
  );
}

function AssignmentChips({ assignments }: { assignments: Plan["assignments"] }) {
  if (assignments.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {assignments.map((a, i) => {
        const skill = SKILLS.get(a.skillId);
        return (
          <span
            key={i}
            title={skill?.name ?? a.skillId}
            className="inline-flex items-center gap-1 rounded-md border bg-secondary px-1.5 py-0.5 text-xs"
          >
            {skill && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${ICON_BASE}${skill.icon}`} alt="" width={16} height={16} className="rounded-sm" />
            )}
            <span className="font-medium">{a.slot}</span>
          </span>
        );
      })}
    </div>
  );
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
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">FFXIV Defense Solver</h1>
        <p className="text-sm text-muted-foreground">
          Paste an fflogs report, get an auto-assigned mitigation plan as a Google Sheet.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Party composition</CardTitle>
          <CardDescription>Two tanks, two healers, four DPS.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-start gap-4">
            {Object.keys(SLOT_JOBS).map((slot) => (
              <JobTile
                key={slot}
                slot={slot}
                job={party[slot]}
                onChange={(job) => setParty({ ...party, [slot]: job })}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fight log</CardTitle>
          <CardDescription>
            fflogs report URL with <code className="rounded bg-muted px-1">?fight=N</code> or{" "}
            <code className="rounded bg-muted px-1">?fight=last</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="https://www.fflogs.com/reports/...?fight=last"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && url && !busy) void submit(); }}
            />
            <Button onClick={submit} disabled={busy || !url} className="shrink-0">
              {busy ? "Solving…" : "Create Mitigation Sheet"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>{result.fightName}</CardTitle>
              <CardDescription>
                {result.plans.length} mechanics ·{" "}
                {result.plans.filter((p) => !p.survivable).length} flagged lethal
              </CardDescription>
            </div>
            {result.sheetUrl && (
              <Button variant="outline" onClick={() => window.open(result.sheetUrl!, "_blank")}>
                Open Google Sheet ↗
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {result.sheetError && (
              <Alert variant="destructive">
                <AlertTitle>Sheet export failed</AlertTitle>
                <AlertDescription>{result.sheetError}</AlertDescription>
              </Alert>
            )}
            {result.warnings.map((w) => (
              <Alert key={w} variant="warning">
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Time</TableHead>
                  <TableHead>Mechanic</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Damage</TableHead>
                  <TableHead>Assignments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.plans.map((p, i) => (
                  <TableRow key={i} className={p.survivable ? undefined : "bg-red-50 hover:bg-red-100"}>
                    <TableCell className="font-mono text-xs">{formatTime(p.damage.castEnd)}</TableCell>
                    <TableCell className="font-medium">{p.damage.name}</TableCell>
                    <TableCell><Badge variant={typeVariant(p.damage.type)}>{p.damage.type}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{p.damage.category}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-xs">
                      {p.damage.amount.toLocaleString("en-US")}
                      <span className="text-muted-foreground"> → </span>
                      {p.mitigatedAmount.toLocaleString("en-US")}
                    </TableCell>
                    <TableCell><AssignmentChips assignments={p.assignments} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
