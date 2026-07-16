import { NextResponse } from "next/server";

// full solve (fflogs fetch + classify + solve + Sheets write) can exceed
// the 10s serverless default on Vercel
export const maxDuration = 60;
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
