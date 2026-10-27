/**
 * LOCAL-ONLY m3ta patch (2026-10-27): HyperAgent for OpenDuet Bots, via rea-mcp 127.0.0.1:9783 (JEV-gated).
 * Same contract as openbot-tmw server/src/m3ta/tools.ts. Reads run; writes always ask first through approvals.
 * Disable with HYPERAGENT_MCP=0.
 */
import { currentApprovalContext } from "@openbot/toolkit/continuation";
import type { GrantedTool } from "@openbot/toolkit/granted-tool";
import { HeadlessToolSuspension } from "@openbot/toolkit/headless-tools";
import { z } from "zod";
import { type ApprovalGate, ApprovalRefusedError } from "../approvals/types";
import { hyperCall, hyperTools, isHyperRead } from "./hyperagent";

const REFUSED = "Refused.";
const body = z.record(z.string(), z.unknown());

export function hyperagentTools(options: {
  actorId: string;
  botId: string;
  approvalGate?: ApprovalGate;
  env?: Record<string, string | undefined>;
}): GrantedTool[] {
  const env = options.env ?? process.env;
  if (env.HYPERAGENT_MCP === "0") return [];
  const tools: GrantedTool[] = [];
  const tool = <T>(name: string, description: string, parameters: z.ZodType<T>, run: (i: T) => Promise<unknown>) =>
    tools.push({
      name,
      ref: `m3ta/${name}`,
      description,
      parameters,
      async execute(args) {
        const parsed = parameters.safeParse(args ?? {});
        if (!parsed.success) return `${REFUSED} Invalid arguments for ${name}.`;
        try {
          const out = await run(parsed.data);
          return typeof out === "string" ? out : JSON.stringify(out);
        } catch (error) {
          if (error instanceof ApprovalRefusedError) return `${REFUSED} ${error.message}`;
          if (error instanceof HeadlessToolSuspension) throw error;
          return `${name} failed: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      },
    });
  tool("hyperagent_list_tools", "List HyperAgent tools and whether each is a read or a gated write.", z.object({}), async () =>
    (await hyperTools(env)).map((t) => ({ name: t.name, kind: isHyperRead(t) ? "read" : "write (asks first)" })),
  );
  tool("hyperagent_read", "Run a read-only HyperAgent tool (list/get). Refuses anything that writes, sends or spends.",
    z.object({ tool: z.string().min(1), arguments: body.optional() }), async (i) => {
      const t = (await hyperTools(env)).find((x) => x.name === i.tool);
      if (!t) return `${REFUSED} Unknown HyperAgent tool ${i.tool}.`;
      if (!isHyperRead(t)) return `${REFUSED} ${i.tool} is not read-only; use hyperagent_write, which asks first.`;
      return hyperCall(env, i.tool, i.arguments ?? {});
    });
  tool("hyperagent_write", "Run a HyperAgent tool that writes, sends or spends. Always asks the person first.",
    z.object({ tool: z.string().min(1), arguments: body.optional() }), async (i) => {
      if (!options.approvalGate) return `${REFUSED} Approvals are not available, so this cannot run.`;
      const permit = await options.approvalGate({
        actorId: options.actorId, botId: options.botId, toolRef: "m3ta/hyperagent_write", effect: "write",
        scope: `hyperagent/${i.tool}`, args: i, target: { tool: i.tool }, continuation: currentApprovalContext(),
      });
      if (permit && "replay" in permit) return permit.replay;
      const result = await hyperCall(env, i.tool, i.arguments ?? {});
      await permit?.complete(result);
      return result;
    });
  return tools;
}
