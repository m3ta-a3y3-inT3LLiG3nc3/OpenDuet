import { describe, expect, test } from "bun:test";
import { hyperCall, hyperTools, reaMcpUrl } from "../src/m3ta/hyperagent";

const fake = (sc: unknown, seen: any[]) => (async (url: string, init: any) => { seen.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: sc } })); }) as unknown as typeof fetch;

describe("openbot -> rea-mcp hyperagent", () => {
  test("defaults to loopback rea-mcp and refuses non-loopback", () => {
    expect(reaMcpUrl({})).toBe("http://127.0.0.1:9783/mcp");
    expect(() => reaMcpUrl({ REA_MCP_URL: "http://0.0.0.0:9783/mcp" })).toThrow();
    expect(() => reaMcpUrl({ REA_MCP_URL: "https://hyperagent.com/api/mcp" })).toThrow();
  });
  test("calls rea_hyperagent_call, never hyperagent.com", async () => {
    const seen: any[] = [];
    const out = await hyperCall({}, "list_threads", {}, fake({ ok: true, status: "done", output: [{ id: "t0" }] }, seen));
    expect(out).toEqual([{ id: "t0" }]);
    expect(seen[0].url).toBe("http://127.0.0.1:9783/mcp");
    expect(seen[0].body.params).toEqual({ name: "rea_hyperagent_call", arguments: { tool: "list_threads", arguments: {} } });
  });
  test("blocked (JEV down) is returned unchanged", async () => {
    const b = { ok: false, status: "blocked", reason: "JEV (jevd) unreachable" };
    expect(await hyperCall({}, "create_thread", {}, fake(b, []))).toEqual(b);
  });
  test("maps rea-mcp reads/gated shape", async () => {
    const t = await hyperTools({}, fake({ ok: true, status: "done", output: { status: "connected", reads: ["list_threads"], gated: ["send_message"] } }, []));
    expect(t.map((x) => [x.name, x.annotations?.readOnlyHint])).toEqual([["list_threads", true], ["send_message", false]]);
  });
  test("tools list via rea_hyperagent_tools", async () => {
    const seen: any[] = [];
    expect(await hyperTools({}, fake({ ok: true, status: "done", output: { tools: [{ name: "a" }] } }, seen))).toEqual([{ name: "a" }]);
    expect(seen[0].body.params.name).toBe("rea_hyperagent_tools");
  });
});
