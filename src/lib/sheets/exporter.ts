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
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// Sheet tab titles forbid []*/\?: and are capped at 100 chars.
function sanitizeTabTitle(title: string): string {
  return title.replace(/[[\]*/\\?:]/g, "").slice(0, 100);
}

// Service accounts have no Drive storage quota, so the app writes each plan as a
// new tab in a user-owned spreadsheet (shared with the service account as editor).
export async function exportToSheet(input: ExportInput): Promise<string> {
  const spreadsheetId = process.env.MITIGATION_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error("MITIGATION_SPREADSHEET_ID is not set");

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const title = sanitizeTabTitle(input.title);

  const added = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: { title, gridProperties: { frozenRowCount: 1 } },
        },
      }],
    },
  });
  const sheetId = added.data.replies![0].addSheet!.properties!.sheetId!;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { updateCells: {
            start: { sheetId, rowIndex: 0, columnIndex: 0 },
            rows: input.rows,
            fields: "userEnteredValue,userEnteredFormat,note",
        } },
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

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
}
