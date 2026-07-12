import { describe, expect, it, vi } from "vitest";
import { FflogsClient, parseFflogsUrl } from "./client";

describe("parseFflogsUrl", () => {
  it("parses report code and fight id from a fragment", () => {
    expect(parseFflogsUrl("https://www.fflogs.com/reports/AbC123xYz9KlMnOp#fight=12&type=damage-done"))
      .toEqual({ reportCode: "AbC123xYz9KlMnOp", fightId: 12 });
  });

  it("parses fight id from a query parameter", () => {
    expect(parseFflogsUrl("https://www.fflogs.com/reports/ZNY4yvA2aqdp6xjB?fight=7"))
      .toEqual({ reportCode: "ZNY4yvA2aqdp6xjB", fightId: 7 });
  });

  it("parses fight=last as the sentinel value", () => {
    expect(parseFflogsUrl("https://www.fflogs.com/reports/ZNY4yvA2aqdp6xjB?fight=last"))
      .toEqual({ reportCode: "ZNY4yvA2aqdp6xjB", fightId: "last" });
  });

  it("parses a report URL without a fight", () => {
    expect(parseFflogsUrl("https://www.fflogs.com/reports/AbC123xYz9KlMnOp"))
      .toEqual({ reportCode: "AbC123xYz9KlMnOp", fightId: undefined });
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

  it("throws on a failed token request", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(new Response("nope", { status: 401 }));
    const client = new FflogsClient({ clientId: "bad", clientSecret: "bad", fetchFn });

    await expect(client.query("query Q { a }", {})).rejects.toThrow("fflogs token request failed: HTTP 401");
  });
});
