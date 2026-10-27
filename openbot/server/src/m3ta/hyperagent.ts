/**
 * LOCAL-ONLY m3ta patch (2026-10-27, HyperAgent C2-C8): OpenBot no longer spawns its own mcp-remote bridge.
 * Every HyperAgent call goes through rea-mcp on 127.0.0.1:9783 (sole HyperAgent entry), where JEV (jevd) gates
 * writes and fails closed. rea-mcp results with status blocked/awaiting_approval are returned unchanged.
 * Non-loopback REA_MCP_URL is refused. No tokens are read or logged here.
 */
export const REA_MCP_URL_DEFAULT = "http://127.0.0.1:9783/mcp";
type Tool = { name: string; description?: string; annotations?: { readOnlyHint?: boolean } };
type Env = Record<string, string | undefined>;
const READ_RE = /^(list|get|read|search|find|fetch|show|describe|status|whoami|query|lookup|view)([_.-]|$)/i;

/** Unknown tools count as writes (gated). Second client-side guard; rea-mcp classifies too. */
export function isHyperRead(t: Tool): boolean {
  if (/approve|resolve|send|message|create|update|upload|write|delete|pay|spend|purchase|post|publish/i.test(t.name)) return false;
  return t.annotations?.readOnlyHint === true || READ_RE.test(t.name);
}

export function reaMcpUrl(env: Env): string {
  const u = env.REA_MCP_URL || REA_MCP_URL_DEFAULT;
  const h = new URL(u).hostname;
  if (!["127.0.0.1", "::1", "[::1]", "localhost"].includes(h)) throw new Error(`refusing non-loopback REA_MCP_URL host ${h}`);
  return u;
}

let id = 0;
async function rpc(env: Env, method: string, params: unknown, fetchFn: typeof fetch = fetch): Promise<any> {
  const r = await fetchFn(reaMcpUrl(env), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j: any = await r.json();
  if (j.error) throw new Error(`rea-mcp: ${j.error.message}`);
  return j.result;
}

export async function hyperTools(env: Env, fetchFn?: typeof fetch): Promise<Tool[]> {
  const sc = (await rpc(env, "tools/call", { name: "rea_hyperagent_tools", arguments: {} }, fetchFn))?.structuredContent;
  const out = sc?.output ?? sc;
  if (Array.isArray(out)) return out;
  if (Array.isArray(out?.tools)) return out.tools;
  // rea-mcp shape: { status, reads: string[], gated: string[] }
  return [...(out?.reads ?? []).map((name: string) => ({ name, annotations: { readOnlyHint: true } })), ...(out?.gated ?? []).map((name: string) => ({ name, annotations: { readOnlyHint: false } }))];
}

export async function hyperCall(env: Env, name: string, args: Record<string, unknown>, fetchFn?: typeof fetch): Promise<unknown> {
  const sc = (await rpc(env, "tools/call", { name: "rea_hyperagent_call", arguments: { tool: name, arguments: args } }, fetchFn))?.structuredContent;
  return sc?.status === "done" && "output" in sc ? sc.output : sc;
}
