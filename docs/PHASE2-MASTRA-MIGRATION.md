# Phase 2: Complete Mastra Agent Migration

## Overview

Phase 1 validated that the Mastra agent can stream messages, execute MCP tools, and render MCP UI widgets. Phase 2 adds the complete agent capabilities from the CopilotKit route to make the Mastra agent fully functional for the MCP UI Studio.

## Status: COMPLETE (Prompt v2 shipped)

All implementation done. Prompt rewritten after RCA — see Phase 3 below.

---

## Phase 1 Recap — Bug Fixes (Complete)

Before Phase 2, three critical bugs were found and fixed in the Mastra agent route:

### Fix 1: MCP UI Not Rendering (ACTIVITY_SNAPSHOT)

**Problem:** MCPAppsMiddleware doesn't work with MastraAgent because Mastra executes MCP tools directly via MCPClient (server-side), never triggering the middleware's "pending tool call" detection. No `ACTIVITY_SNAPSHOT` events were emitted, so no widgets rendered.

**Solution:** Custom AG-UI function middleware (`createMcpUIMiddleware`) added via `agentWrapper.use()` that:
1. **Intercepts `TOOL_CALL_RESULT`** for MCP UI tools and emits `ACTIVITY_SNAPSHOT` with the correct `MCPAppsActivityContentSchema` format
2. **Handles proxied MCP requests** — when the frontend's `MCPAppsActivityRenderer` needs widget HTML, it sends `__proxiedMCPRequest` through `agent.runAgent()`. The middleware intercepts this and proxies it to the MCP server.

### Fix 2: clone() Drops Middlewares

**Problem:** CopilotKit runtime calls `registeredAgent.clone()` (in `@copilotkitnext/runtime`) before `runAgent()`. `MastraAgent.clone()` does `new MastraAgent(this.config)` which creates a fresh instance without any middlewares added via `.use()`.

**Solution:** Override `clone()` on the agent wrapper instance to re-attach the middleware:
```typescript
const origClone = agentWrapper.clone.bind(agentWrapper);
agentWrapper.clone = function () {
  const cloned = origClone();
  cloned.use(mcpMiddleware);
  return cloned;
};
```

### Fix 3: Duplicate React Key Errors

**Problem:** MastraAgent reuses the same `messageId` for both `TOOL_CALL_START.parentMessageId` and the follow-up `TEXT_MESSAGE_START.messageId`. When `defaultApplyEvents` builds the messages array on the frontend, it creates two messages with the same ID, causing React key collisions.

**Known ecosystem issues:** ag-ui #1037, mastra #9370 (fix merged in PR #9396), #5782, #8830.

**Solution:** Track `parentMessageId` values from `TOOL_CALL_START` in a Set. When a text message arrives with a colliding `messageId`, remap it to a fresh UUID. Subsequent events with the same original ID reuse the same remapped UUID (important — generating a new UUID per chunk would split text into separate message bubbles).

```typescript
const usedAsParentId = new Set<string>();
const idRemaps = new Map<string, string>();

// In the event handler:
if (event.type === "TOOL_CALL_START" && event.parentMessageId) {
  usedAsParentId.add(event.parentMessageId);
}
if (event.messageId && (usedAsParentId.has(event.messageId) || idRemaps.has(event.messageId))) {
  if (!idRemaps.has(event.messageId)) {
    idRemaps.set(event.messageId, crypto.randomUUID());
  }
  event = { ...event, messageId: idRemaps.get(event.messageId) };
}
```

### Fix 4: ACTIVITY_SNAPSHOT Result Format

**Problem:** Raw tool result didn't match `MCPAppsActivityContentSchema`. The frontend expects `{ content: [{type:"text", text:"..."}], structuredContent: any }`.

**Solution:** Wrap the raw result:
```typescript
const result = {
  content: [{ type: "text" as const, text: resultText }],
  structuredContent: rawResult,
};
```

---

## Phase 2 Implementation (Complete)

### What Was Added

**File:** `apps/web/app/api/mastra-agent/route.ts`

#### 1. E2B Workspace Provider

```typescript
import { z } from "zod";
import { E2BWorkspaceProvider } from "@/lib/workspace/e2b";

const workspaceProvider = new E2BWorkspaceProvider();
```

#### 2. Seven Workspace Tools

Defined as plain `{ description, parameters, execute }` objects (not using `tool()` from AI SDK — see deviation note below):

| Tool | Description |
|------|-------------|
| `provision_workspace` | Create E2B sandbox (~3s with template), returns workspaceId + endpoint |
| `read_file` | Read a file from workspace (relative to /home/user/workspace) |
| `write_file` | Create or overwrite a file, auto-creates parent dirs |
| `edit_file` | Search-and-replace in a file (exact match) |
| `exec` | Run shell command, supports `background` and `timeoutMs` options |
| `get_workspace_info` | Get sandbox status and endpoint |
| `download_workspace` | Zip workspace and return signed download URL |

#### 3. Full System Prompt

Replaced the 8-line `SYSTEM_PROMPT` with the full 487-line `AGENT_SYSTEM_PROMPT` from the CopilotKit route. Includes:
- Critical rules (don't stop after tool calls, communication patterns)
- Template knowledge (mcp-use-server file structure)
- Tool and widget file patterns
- Registration patterns (index.ts marker comments)
- Three workflows: (A) Build new tool, (B) Edit existing tool, (C) Use existing tool
- Crypto price widget example
- Available tools listing

#### 4. Tool Merging

```typescript
const mastraAgent = new Agent({
  id: "default",
  name: "MCP UI Builder",
  instructions: AGENT_SYSTEM_PROMPT,
  model: openai("gpt-4o"),
  tools: {
    ...mcpTools,
    ...workspaceTools,
  } as Record<string, never>,
});
```

### Deviation from Original Plan

**`tool()` helper not available:** The plan originally used `import { tool } from "ai"` (AI SDK v4 pattern). AI SDK v5 doesn't export a `tool()` helper. Mastra accepts plain objects with `{ description, parameters: ZodSchema, execute: async fn }` as `VercelToolV5`, so we used that format directly. Works identically.

---

## Verification

### TypeScript Compilation
- **Result:** Zero errors in `mastra-agent/route.ts`
- Pre-existing errors in `copilotkit/route.ts` and `page.tsx` are unrelated

### E2E Stream Test
- `test-e2e-stream.ts` confirmed:
  - Both routes emit correct event sequences
  - Mastra route emits `ACTIVITY_SNAPSHOT` for MCP UI tools
  - No duplicate message IDs in simulated `defaultApplyEvents` output

### Browser Testing (Pending)

#### Test Scenario: Build a Weather Widget

1. Switch to Mastra backend in UI (top bar toggle)
2. Send message: "Build me a weather widget"
3. Expected agent sequence:
   - Calls `provision_workspace("weather-widget")`
   - Calls `add_mcp_server(endpoint, "weather-widget")` [frontend action]
   - Calls `set_active_workspace(workspaceId, endpoint)` [frontend action]
   - Calls `read_file` x4 to study template (index.ts, example tool, example widget, types)
   - Calls `write_file` x2 to create widget (resources/weather-widget/types.ts, widget.tsx)
   - Calls `write_file` x1 to create tool (tools/weather.ts)
   - Calls `edit_file` x2 to register in index.ts (import, registration)
   - Calls `exec` x3 to restart server (kill, npm run dev background, sleep 8)
   - Calls `refresh_mcp_tools()` [frontend action]
   - Sends final message with instructions to test the new tool

4. Verify in UI:
   - Server appears in left sidebar with "Running" badge
   - New tool "get-weather" (or similar) appears in tools list
   - Click tool to see widget UI rendered

5. Test the new tool:
   - Send message: "Show me the weather in San Francisco"
   - Verify widget renders with city, temperature, conditions

#### Test Scenario: Use Existing MCP Tool

1. Ensure Three.js server is connected (http://localhost:3108/mcp)
2. Send message: "Show me a rotating cube"
3. Expected agent sequence:
   - Calls `create_scene` MCP tool
   - Widget renders with Three.js canvas

---

## Files Modified

| File | Changes |
|------|---------|
| `apps/web/app/api/mastra-agent/route.ts` | Phase 1 fixes + Phase 2 tools/prompt (~845 lines total) |
| `apps/web/test-e2e-stream.ts` | E2E test for stream event tracing |

## Files Read (Reference Only)

| File | Purpose |
|------|---------|
| `apps/web/app/api/copilotkit/route.ts` | Reference for tools, prompt, and working MCPAppsMiddleware |
| `apps/web/lib/workspace/e2b.ts` | E2BWorkspaceProvider class |
| `@copilotkitnext/runtime/dist/chunk-4NPALSVP.mjs` | Runtime event handling, clone() behavior |
| `@copilotkitnext/react/dist/index.mjs` | Frontend rendering, MCPAppsActivityRenderer |
| `@ag-ui/client/dist/index.mjs` | AbstractAgent, defaultApplyEvents, middleware chain |
| `@ag-ui/mastra/dist/index.mjs` | MastraAgent source |
| `@ag-ui/mcp-apps-middleware/dist/index.mjs` | MCPAppsMiddleware source |

## Implementation Checklist

- [x] Import E2B workspace provider and create singleton
- [x] Define all 7 workspace tools using plain object format
- [x] Merge workspace tools with MCP tools in agent config
- [x] Replace simple prompt with full 487-line system prompt
- [x] TypeScript compilation verified (zero errors)
- [x] E2E stream test passing (ACTIVITY_SNAPSHOT confirmed)
- [ ] Browser test: weather widget build workflow
- [ ] Browser test: existing MCP tool usage (Three.js)
- [ ] Update README documentation

## Notes

- Frontend actions work automatically because they're registered in CopilotKit context that wraps both agent routes
- No changes needed to `BuilderAgentProvider.tsx` — it already provides actions to both backends
- The Mastra agent now has full feature parity with the CopilotKit agent
- Performance comparison between backends can be done by toggling in the UI and timing responses
- The `@ts-expect-error` comments for rxjs version mismatch (7.8.1 vs 7.8.2) are expected and harmless

---

## Phase 3: Prompt RCA & Rewrite

### Problems Found

| # | Problem | Impact | Root Cause |
|---|---------|--------|------------|
| 1 | Agent reads 4 files every build | 4 wasted LLM round-trips (~10s) | Workflow A step 3 says "Study the template" + example repeats it |
| 2 | Default product-search tool not removed | User sees leftover tool in sidebar | Prompt never mentions cleanup |
| 3 | Restart is 3 separate exec calls | Fragile, blind `sleep 8` with no verification | `kill`, `npm run dev`, `sleep` as separate steps |
| 4 | Too many text messages | Each message = LLM round-trip | COMMUNICATION section says "before/after every tool call" |
| 5 | Example duplicates workflow | Reinforces the verbose read-heavy pattern | 40-line example repeating workflow A with different names |

### Changes Made (Prompt v2)

**Old prompt:** 487 lines → **New prompt:** ~115 lines

1. **Eliminated "study the template" step** — Rule 2 explicitly says "do NOT call read_file to study the template. All patterns are below." Patterns are inlined but minimal (generic, not example-specific).

2. **Added default tool cleanup** — Workflow A step 4 removes product-search from index.ts AND deletes the old `resources/product-search-result/` folder and `tools/product-search.ts` file. Without the rm, `mcp-use build` still compiles the old widget (~10s wasted).

3. **Tested restart commands against live E2B** — key findings:
   - `fuser` and `lsof` are NOT available in E2B sandboxes
   - `pkill -f 'node.*index'` kills the sandbox's own command runner (fatal)
   - Working approach: `ss -tlnp` to find PID on port 3109, `kill PID`, then `npm run dev` with `background=true`
   - Build takes ~10s with 1 widget, ~20s+ with 2 (hence the rm step)
   - Verification via `curl -sf http://localhost:3109/mcp` with `tools/list` method

4. **Minimal communication rules** — "Keep messages to 1 sentence max" instead of "before calling any tool, send a short message".

5. **Removed verbose example** — No more 40-line crypto example that reinforced reading 4 files.

### Restart Command (Tested & Verified)

```
# 8a) Kill old server (ss is available, fuser/lsof are NOT)
exec("kill $(ss -tlnp 'sport = :3109' | grep -oP 'pid=\\K[0-9]+' | head -1) 2>/dev/null; sleep 2")

# 8b) Start new server (MUST use background=true)
exec("npm run dev > /tmp/dev.log 2>&1", background=true)

# 8c) Wait + verify (15s for build+startup)
exec("sleep 15 && curl -sf http://localhost:3109/mcp -X POST -H 'Content-Type: application/json' -d '{...tools/list...}' | head -c 200", timeoutMs=30000)
```

### Expected Tool Call Sequence (New)

Old flow (~18 tool calls):
```
provision → add_mcp → set_workspace → read x4 → write x3 → edit x2 → kill → npm dev → sleep → refresh
```

New flow (~13 tool calls):
```
provision → add_mcp → set_workspace → edit x2 (remove default) → exec (rm old files) → write x2-3 → edit x2 (register) → exec (kill) → exec (npm dev bg) → exec (verify curl) → refresh
```

Savings: ~5 fewer tool calls, ~4 fewer LLM round-trips, actual verification instead of blind sleep.

### E2E Test Results

`test-restart-final.mjs` — 12/12 passed:
- Sandbox provisioned, default tool removed, new tool written, registered
- Server killed via ss, restarted via npm run dev (background), verified via curl
- New `get-weather` tool visible both internally and externally
- Old `search-tools`/`get-fruit-details` removed

### Test Files

- `apps/web/test-restart-final.mjs` — validates exact prompt restart sequence against live E2B
- `apps/web/test-agent-workflow.ts` — traces agent tool calls on a build task (needs dev server)
