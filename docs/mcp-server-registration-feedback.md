# Feedback: MCP Apps Widget Rendering — Architectural Gap

## The Problem

Adding an MCP server with widget support originally required registering it in two places:

1. **Studio UI / `DEFAULT_SERVERS`** — for playground preview (dynamic, works at runtime)
2. **`MCPAppsMiddleware` in `route.ts`** — for widget rendering in chat (static, baked at startup)

When a server was missing from the middleware, there was **no error** — the agent ran, the tool got called, but the widget silently rendered as plain text.

More critically: **dynamically added MCP servers could never render widgets in chat** without a server restart and a code change, because the middleware was initialized once at module load.

**Status: Fixed** — see implementation below.

---

## Root Cause: ag-ui Has No Native MCP Client

`MCPAppsMiddleware` does two things fused together:

**1. Tool injection** — connects to MCP servers, lists tools with `_meta["ui/resourceUri"]`, and injects them into the agent's tool list before the LLM runs.

**2. Widget rendering bridge** — after the LLM finishes, intercepts those tool calls, calls the real MCP server, and emits an `ACTIVITY_SNAPSHOT` event that CopilotKit's frontend uses to render the widget iframe.

The middleware exists because **ag-ui has no native MCP client**. MCP servers are treated as external — something you wire up yourself. That decision pushes all MCP-aware logic into a custom middleware class with a static config list.

### The redundancy

All the information needed for widget rendering already flows through the MCP protocol:

```
listTools  →  tool._meta["ui/resourceUri"]    ← signals "I have a widget"
callTool   →  result.structuredContent        ← the widget props
               result._meta                   ← additional widget metadata
```

The middleware reads these and re-packages them as ag-ui `ACTIVITY_SNAPSHOT` events. It is a translation layer for information the protocol already expresses.

### Why ACTIVITY_SNAPSHOT can't come from the agent

When the LLM calls a tool it only sees the tool name and arguments. It has no knowledge of:
- Which tools came from MCP servers
- The `resourceUri` needed to fetch widget HTML
- The `serverId`/`serverHash` needed to route proxied resource fetches

The middleware is the only layer that holds this mapping. It's also what intercepts the stream post-LLM, executes the actual MCP tool call, and injects `ACTIVITY_SNAPSHOT` before releasing `RUN_FINISHED`.

---

## Implemented Fix: Headers as the Dynamic Channel

Inspired by `open-mcp-client`'s pattern of passing MCP server config through agent state, we pass the active server list via an HTTP header on every request.

**Why headers over other options:**
- Headers are included on **all** requests — regular chat AND proxied widget resource fetches
- `forwardedProps`/`properties` are only reliable for chat requests; the `@copilotkitnext/react` widget renderer fires proxied requests with only `__proxiedMCPRequest` in `forwardedProps`, dropping the server list
- Headers are set at the transport level, so they're always present

### Frontend — `DynamicCopilotKitProvider`

A client component reads servers from `localStorage` and passes them as `x-mcp-servers` header on every CopilotKit request:

```tsx
// app/components/CopilotKitProvider.tsx
const [servers] = useLocalStorage<McpServerEntry[]>(STORAGE_KEY, DEFAULT_SERVERS);

const headers = useMemo(() => ({
  "x-mcp-servers": JSON.stringify(
    servers.map((s) => ({ type: "http", url: s.endpoint, serverId: s.serverId }))
  ),
}), [servers]);

return <CopilotKit runtimeUrl="/api/copilotkit" headers={headers}>{children}</CopilotKit>;
```

`layout.tsx` uses `DynamicCopilotKitProvider` instead of `CopilotKit` directly.

### Backend — per-request middleware creation

`route.ts` moved all object creation inside the handler. On each request it reads the header and creates `MCPAppsMiddleware` with the current server list:

```ts
export const POST = async (req: NextRequest) => {
  const mcpServers = readMcpServersFromHeader(req); // reads x-mcp-servers
  const middleware = new MCPAppsMiddleware({ mcpServers });
  const agent = new BuiltInAgent({ model: "openai/gpt-4o", prompt: "..." });
  agent.use(middleware);
  // ... create runtime and handle request
};
```

### Result

- Add a server in the Studio UI → next message picks it up, widget renders in chat
- Remove a server → next message it's gone
- No server restart, no code change

---

## Remaining Architectural Gap (for ag-ui team)

This fix works around the limitation. The correct long-term fix is ag-ui shipping a native MCP client that understands `_meta["ui/resourceUri"]` as a rendering signal and emits `ACTIVITY_SNAPSHOT` automatically. That would eliminate `MCPAppsMiddleware` entirely and make the widget rendering a first-class protocol feature rather than a custom bridge.

File as a feature request: ag-ui should treat `mcpServers` as a first-class runtime concept, not something wired via external middleware.
