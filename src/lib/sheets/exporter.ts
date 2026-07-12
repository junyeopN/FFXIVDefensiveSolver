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
