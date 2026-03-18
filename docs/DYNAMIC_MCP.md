# Adding "MCP on the Run" to This App

This app (with-mcp-apps) uses a **fixed** list of MCP servers in `MCPAppsMiddleware`. The **open-mcp-client** repo in this workspace shows how to let users **add and remove MCP servers at runtime** using a Python LangGraph agent and shared state. CopilotKit also supports **frontend-driven dynamic MCP** via `setMcpServers` in some setups. This doc explains both and how they fit this app.

---

## Frontend-driven dynamic MCP (`setMcpServers`)

CopilotKit’s React SDK supports **configuring MCP servers from the frontend** and updating them at runtime:

- Use **`useCopilotChat()`** from `@copilotkit/react-core` and call **`setMcpServers(list)`** with an array of `{ endpoint: string, serverId?: string }` (and optionally auth).
- You can call `setMcpServers` when the app loads, when the user adds a server, or when you get a list from your backend — so MCP servers can be **dynamic** (user connections, multi-tenant, feature flags, etc.).

**Typical pattern:**

```tsx
const { setMcpServers } = useCopilotChat();

// e.g. add a server when user connects an integration
const addMcpServer = (url: string, serverId: string) => {
  setMcpServers((prev) => [...(prev ?? []), { endpoint: url, serverId }]);
};
```

**When this applies:**

- **Copilot Cloud (agentless):** With `<CopilotKit publicApiKey="...">`, the frontend sends the MCP list to Copilot’s backend; dynamic `setMcpServers` is the standard way to add/change servers. See [Add an MCP Client to Any React App](https://copilotkit.ai/blog/add-an-mcp-client-to-any-react-app-in-under-30-minutes) and [Connect MCP Servers](https://docs.copilotkit.ai/connect-mcp-servers).
- **Self-hosted runtime (this app):** We use `<CopilotKit runtimeUrl="/api/copilotkit">` with **BuiltInAgent** and **MCPAppsMiddleware**; the MCP list is currently defined **only in the backend** (`route.ts`). Whether the client-sent MCP list (from `setMcpServers`) is passed to your self-hosted runtime and used by MCPAppsMiddleware depends on the CopilotKit runtime contract and version. The [self-hosted MCP docs](https://docs.copilotkit.ai/guides/model-context-protocol) describe configuring MCP for your own runtime — worth checking if the runtime accepts client-provided MCP config.

**If your self-hosted runtime accepts client MCP config:** you can implement “add MCP on the run” by keeping a list in React state (or from your API), calling `setMcpServers` with that list, and optionally building a small UI (e.g. “Add server” form) that updates that state and then calls `setMcpServers`. No Python agent required.

**If it does not (current with-mcp-apps behavior):** the backend’s `MCPAppsMiddleware` list is fixed at build/load time; use one of the options below (e.g. Option A with LangGraph, or Option B with config-driven list).

---

## How open-mcp-client Does It (Reference)

| Layer | What it does |
|-------|----------------|
| **Frontend** | `MCPConfigForm` lets users add/remove servers (stdio or SSE). Config is stored in **agent state** via `useCoAgent<AgentState>({ name: "sample_agent", initialState: { mcp_config: ... } })`. |
| **Backend** | CopilotKit uses **remote** agent: `remoteEndpoints: [langGraphPlatformEndpoint({ deploymentUrl: "http://localhost:8123", agents: [{ name: "sample_agent", ... }] })]`. No BuiltInAgent. |
| **Agent (Python)** | LangGraph agent defines `AgentState` with `mcp_config: Optional[MCPConfig]`. In the chat node it runs `async with MultiServerMCPClient(mcp_config) as mcp_client`, gets tools from that client, and runs a ReAct agent with those tools. So **MCP servers are chosen from state every turn**. |

So "add MCP on the run" works because:

1. User edits config in the UI → `setAgentState({ mcp_config: newConfigs })`.
2. That state is synced to the remote agent.
3. Each time the agent runs, it reads `mcp_config` from state and builds `MultiServerMCPClient(mcp_config)` to get tools.

**Relevant files in open-mcp-client:**

- `app/api/copilotkit/route.ts` – `remoteEndpoints` + LangGraph; no BuiltInAgent, no MCPAppsMiddleware.
- `app/components/MCPConfigForm.tsx` – UI + `useCoAgent` for `mcp_config`.
- `agent/sample_agent/agent.py` – `AgentState.mcp_config`, `MultiServerMCPClient(mcp_config)`, `create_react_agent(model, mcp_tools)`.

---

## Why This App (with-mcp-apps) Doesn’t Do It Yet

This app uses:

- **BuiltInAgent** + **MCPAppsMiddleware** with a **fixed** `mcpServers` array in `apps/web/app/api/copilotkit/route.ts`.
- The runtime and middleware are created once at module load. CopilotKit does not (today) support a per-request agent factory or per-request MCP list for BuiltInAgent, so you can’t pass user-defined MCP config into the same route without changing architecture.

---

## Options to Get Dynamic MCP in This Base App

### Option A: Use the Same Pattern as open-mcp-client (Recommended)

Reuse the **remote LangGraph agent + useCoAgent + MCPConfigForm** pattern so the **agent** gets a dynamic MCP list from state. This app keeps the Next.js + CopilotKit UI and adds MCP Apps (e.g. Three.js) by registering them in the agent’s MCP config.

**Steps:**

1. **Run a LangGraph agent** (same idea as open-mcp-client):
   - Copy or adapt `open-mcp-client/agent` (Poetry, `agent.py`, `langgraph.json`, `math_server.py`).
   - In the agent’s state, keep `mcp_config` (stdio/sse/http). Include the Three.js server in that config (e.g. default or when user adds it):
   - `"threejs": { "url": "http://localhost:3108/mcp", "transport": "http" }` (adjust to match `MultiServerMCPClient`’s expected format).
   - Run the agent: `langgraph dev --port 8123` (or your chosen port).

2. **Switch this app’s backend to the remote agent:**
   - In `apps/web/app/api/copilotkit/route.ts`, remove BuiltInAgent and MCPAppsMiddleware.
   - Use `remoteEndpoints: [langGraphPlatformEndpoint({ deploymentUrl: process.env.AGENT_DEPLOYMENT_URL || "http://localhost:8123", agents: [{ name: "sample_agent", description: "..." }] })]` and the same `LangChainAdapter` / `ChatOpenAI` pattern as in open-mcp-client’s route.

3. **Add the dynamic MCP UI to this app:**
   - Copy `open-mcp-client`’s `MCPConfigForm.tsx`, `ExampleConfigs.tsx`, and `useLocalStorage` hook.
   - In `apps/web/app/page.tsx`, render `MCPConfigForm` and wrap chat with the same CopilotKit provider so `useCoAgent` works with the remote agent’s `sample_agent` and `mcp_config`.

4. **MCP Apps (Three.js) in the same agent:**
   - The LangGraph agent’s MCP client will see tools from the Three.js server (e.g. `show_threejs_scene`) if that server is in `mcp_config`.
   - Rendering the Three.js **UI** (iframe) is a host concern. If your frontend must show MCP App iframes the same way as today, you have two sub-options:
     - **4a)** Keep a **thin** use of **MCPAppsMiddleware** only for UI: e.g. a second agent or a dedicated route that only handles “which MCP App iframes to show” based on the same server list (fixed or from env). The main conversation still goes to the LangGraph agent with dynamic MCP.
     - **4b)** Rely on LangGraph Platform / CopilotKit MCP Apps support for rendering iframes if/when that flow is documented and supports your deployment.

**Result:** Users can add/remove MCP servers (stdio/sse/http) in the UI; the Python agent uses that config each turn. Three.js (or other MCP Apps) can be one of those servers; UI rendering may require the extra step above.

---

### Option B: Config-Driven (No User UI)

Keep BuiltInAgent + MCPAppsMiddleware but make the **list of servers** come from config (env or an API) instead of a literal in code. Rebuild the middleware at startup or when config changes (e.g. on first request or via a simple in-memory cache). This does **not** let users add/remove servers from the chat UI but lets you change servers without code edits.

Example idea:

- Read `MCP_SERVERS_JSON` from env or call an internal API.
- In the route (or a factory), build `new MCPAppsMiddleware({ mcpServers: parsedList })` and create the agent/runtime with that middleware. Use the same runtime for all requests (or recreate when config changes).

---

### Option C: Per-Request MCP List (Future)

CopilotKit has an open feature for **per-request agent factory** (e.g. [issue #2941](https://github.com/CopilotKit/CopilotKit/issues/2941)). If that lands and supports passing request/context into the agent (or middleware) creation, you could read MCP config from the request (e.g. from body or session) and build `MCPAppsMiddleware` per request. Today this is not available in the built-in Next.js route, so Option A is the way to get true “add MCP on the run” behavior.

---

### Option D: Use frontend `setMcpServers` with this app (try first)

Because CopilotKit supports **dynamic MCP from the frontend** via `setMcpServers` (see section above), you can try that first with this base app:

1. **Add a small MCP "manager" component** that calls `useCopilotChat().setMcpServers()` with a list (e.g. from React state or localStorage). Optionally add a simple "Add server" form that appends `{ endpoint: url, serverId }` and then calls `setMcpServers` with the updated list.
2. **Render that component** inside `<CopilotKit runtimeUrl="/api/copilotkit">` (e.g. in `layout.tsx` or `page.tsx`) so it runs in the same tree as the chat.
3. **Verify behavior** with your self-hosted runtime: send a message and see if the agent uses the MCP servers you set from the frontend. If the runtime accepts and uses the client-sent MCP list, you get dynamic "add MCP on the run" without changing the backend or adding a Python agent.
4. **Docs to check:** [Connect MCP Servers](https://docs.copilotkit.ai/connect-mcp-servers), [Model Context Protocol (self-hosted)](https://docs.copilotkit.ai/guides/model-context-protocol). If the self-hosted runtime does not yet use client-provided MCP config, fall back to Option A (LangGraph + state) or Option B (config-driven backend list).

---

## Better Examples and References

- **In this workspace:** **open-mcp-client** is the main example of “add MCP servers on the run” (Python agent + `useCoAgent` + `MCPConfigForm`).
- **CopilotKit:** [CopilotKit/mcp-client](https://github.com/CopilotKit/mcp-client) – same architecture (LangGraph agent + MCP, frontend state).
- **Docs:** [Connect MCP Servers](https://docs.copilotkit.ai/connect-mcp-servers) (frontend `setMcpServers`), [Model Context Protocol (self-hosted)](https://docs.copilotkit.ai/guides/model-context-protocol), [Remote Endpoint (LangGraph Platform)](https://docs.copilotkit.ai/guides/backend-actions/langgraph-platform-endpoint), [Reading agent state](https://docs.copilotkit.ai/mastra/shared-state/in-app-agent-read) (useCoAgent).
- **Blog:** [Add an MCP Client to Any React App in Under 30 Minutes](https://copilotkit.ai/blog/add-an-mcp-client-to-any-react-app-in-under-30-minutes) (agentless + `setMcpServers`).

---

## Quick Comparison

| | with-mcp-apps (current) | open-mcp-client |
|--|---------------------------|-----------------|
| Agent | BuiltInAgent (in-process) | Remote LangGraph (Python) |
| MCP list | Fixed in `MCPAppsMiddleware` | From state `mcp_config` |
| UI for MCP | None | MCPConfigForm + useCoAgent |
| MCP Apps (e.g. Three.js) | Yes, via middleware | Agent can call MCP Apps servers if in `mcp_config`; UI rendering may need extra setup |

To get “add MCP on the run” in the base app, use **Option A** and reuse open-mcp-client’s agent and UI pattern; then plug in the Three.js (or other) MCP App server into the agent’s `mcp_config` and handle iframe rendering as above.
