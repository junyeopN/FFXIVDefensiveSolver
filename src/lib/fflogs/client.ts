const REPORT_URL_RE = /^https:\/\/(?:www\.)?fflogs\.com\/reports\/([A-Za-z0-9]{8,})/;

export type FightRef = number | "last";

export function parseFflogsUrl(url: string): { reportCode: string; fightId?: FightRef } {
  const match = REPORT_URL_RE.exec(url);
  if (!match) throw new Error("Not an fflogs report URL");
  const fightMatch = /fight=(\d+|last)/.exec(url);
  const fightId: FightRef | undefined =
    fightMatch === null ? undefined : fightMatch[1] === "last" ? "last" : Number(fightMatch[1]);
  return { reportCode: match[1], fightId };
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
