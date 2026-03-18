# MCP UI Studio — Implementation Plan

## Vision

Build an **MCP UI Studio** where a single coding agent can:

1. **Create** new MCP UI tools by writing React components
2. **Edit** existing tools in-conversation
3. **Provision an E2B dev sandbox** and connect to it live
4. **Test** the tools it just created by calling them via MCP (rendered as iframes in chat)
5. **Download** the complete MCP server to run independently

The agent is a **full coding agent** — it runs shell commands, reads/writes files, installs packages, and manages running dev servers. The E2B sandbox is where code lives and runs. The agent creates code, starts the server, and immediately has the new tools available as callable MCP tools.

---

## Current Architecture

### Frontend (`apps/web`)

```
app/
  page.tsx                    # Main page: CopilotKitPage + TopBar + StudioView (2-column)
  layout.tsx                  # Root layout — wraps with DynamicCopilotKitProvider
  globals.css                 # Global styles + CopilotKit overrides + responsive layout
  components/
    CopilotKitProvider.tsx    # McpServersContext + DynamicCopilotKitProvider
                              #   → server list in React state (no localStorage)
                              #   → sends x-mcp-servers header to /api/copilotkit
    McpServerManager.tsx      # Server list UI (add/remove/reset)
                              #   → reads/writes via useMcpServers() context
                              #   → syncs to CopilotKit runtime via setMcpServers()
    BuilderAgentProvider.tsx  # useCopilotReadable + useCopilotAction hooks
                              #   → exposes agent actions: update schema/HTML/data,
                              #     create/delete tool, select tool, add server
                              #   → workspace actions: provision, read/write/edit file,
                              #     exec, download, refresh tools
    McpAppPreview.tsx         # iframe MCP host (postMessage / JSON-RPC 2.0 protocol)
    ToolDetail.tsx            # Left-sidebar inline detail for selected tool:
                              #   live preview + "Try in chat" prompts + tabs
                              #   (Overview / Preview Data / JSON / Source / Schema)
    shared.tsx                # LoadingSpinner, EmptyState, ErrorBanner, CreateToolForm
  hooks/
    useMcpIntrospect.ts       # Fetches tools+resources from all connected MCP servers
                              #   → re-fetches when server list changes
                              #   → prunes stale data when servers are removed
    useToolConfigStore.ts     # Merges introspected tools + local overrides
                              #   → localStorage: "mcp-builder-configs"
                              #   → prunes stale introspected tools when server removed
                              #   → upserts/syncs introspected tools on refresh
    useLocalStorage.ts        # Generic localStorage hook with SSR safety
  constants/
    mcpServers.ts             # McpServerEntry type + DEFAULT_SERVERS
                              #   (single source; no circular deps)
  api/
    copilotkit/route.ts       # CopilotKit runtime — reads x-mcp-servers header,
                              #   creates MCPAppsMiddleware per-request
    mcp-introspect/route.ts   # POST {endpoint} → {tools, resources}
                              #   supports StreamableHTTP + SSE transports
    call-tool/route.ts        # Direct tool invocation (available, not used in main flow)
    workspace/
      provision/route.ts      # POST → create E2B sandbox, clone repo, start server
      read-file/route.ts      # POST → read file from sandbox
      write-file/route.ts     # POST → write file to sandbox
      edit-file/route.ts      # POST → search-replace edit in sandbox file
      exec/route.ts           # POST → run command in sandbox
      info/route.ts           # POST → get sandbox info
      download/route.ts       # POST → zip workspace, return signed download URL
  lib/
    workspace/
      types.ts                # WorkspaceProvider interface + WorkspaceInfo type
      e2b.ts                  # E2BWorkspaceProvider (Sandbox.create/connect/files/commands)
      index.ts                # getProvider() factory
```

### UI Layout

```
┌──────────────────────────────────────────────────────┐
│  MCP UI Studio          [Refresh]  [N tools]  [Live] │
├────────────────────┬─────────────────────────────────┤
│  Left (340px)      │  Chat (flex-1)                  │
│                    │                                 │
│  ┌─ MCP Servers ─┐ │  Agent                          │
│  │ server list   │ │  ─────────────────────────────  │
│  └───────────────┘ │  [CopilotChat]                  │
│                    │                                 │
│  Tools             │  • uses tools via MCP           │
│  [tool1]           │  • builds/edits via agent       │
│  [tool2] ←selected │    actions (BuilderAgent-       │
│  [tool3]           │    Provider)                    │
│  ────────────────  │                                 │
│  Tool Detail       │                                 │
│  [live preview]    │                                 │
│  ▶ Try prompt 1    │                                 │
│  ▶ Try prompt 2    │                                 │
│  [tabs: info/data/ │                                 │
│   json/schema]     │                                 │
└────────────────────┴─────────────────────────────────┘

Mobile (<768px): 2-tab switcher — "Chat" / "Tools & Preview"
```

### Key Design Decisions

- **Unified agent**: Single `CopilotChat` can both USE tools (via MCP) and BUILD them (via `BuilderAgentProvider` actions). No mode switching.
- **No localStorage for server list**: Server list lives in React context (`useMcpServers`), initialized from `DEFAULT_SERVERS`. Changes are in-memory only; add/remove via the UI.
- **Tool configs in localStorage**: `useToolConfigStore` persists local tool edits + created tools in `"mcp-builder-configs"`. Stale introspected tools are pruned when their server is removed.
- **Circular dep eliminated**: `DEFAULT_SERVERS` / `McpServerEntry` / `STORAGE_KEY` moved to `constants/mcpServers.ts`. Neither `CopilotKitProvider` nor `McpServerManager` imports from the other.

---

## MCP Server Architecture

### Legacy reference: `threejs-server` (manual registration)

```
apps/threejs-server/
  server.ts              # registerAppTool() + registerAppResource() manually
  src/
    mcp-app-wrapper.tsx  # useApp() hook → passes toolInputs/toolResult to widget
    threejs-app.tsx      # actual widget component
  vite.config.ts         # viteSingleFile() → dist/mcp-app.html
```

### Current pattern: `mcp-use-server` (mcp-use library, modular)

```
apps/mcp-use-server/
  index.ts                         # Entry point — server config + imports + listen
                                   #   Clear "ADD HERE" comments for new tools
  tools/
    product-search.ts              # register(server) for search-tools + get-fruit-details
    <new-tool>.ts                  # ← agent creates one file per new tool here
  resources/
    product-search-result/
      widget.tsx                   # React widget using useWidget / useCallTool
      types.ts
      components/
      hooks/
    <new-widget>/                  # ← agent creates one folder per new widget here
      widget.tsx
  package.json                     # scripts: build / dev / start / deploy
                                   # dev = "npx tsx index.ts" (tsx handles ESM + HMR)
```

**3-step pattern to add a new MCP App widget:**

```
Step 1 — resources/<name>/widget.tsx   (React component)
──────────────────────────────────────────────────────────
import { useWidget } from "mcp-use/react";

const propsSchema = z.object({ symbol: z.string(), days: z.number() });
type Props = z.infer<typeof propsSchema>;

export default function PriceChart() {
  const { props, isPending } = useWidget<Props>();
  if (isPending) return <div>Loading...</div>;
  return <div>{props.symbol} — last {props.days} days</div>;
}

Step 2 — tools/price-chart.ts   (server registration)
──────────────────────────────────────────────────────────
import { MCPServer, widget, text } from "mcp-use/server";
import { z } from "zod";

export function register(server: MCPServer) {
  server.tool(
    {
      name: "show-price-chart",
      description: "Show a stock price chart",
      schema: z.object({ symbol: z.string(), days: z.number() }),
      widget: { name: "price-chart", invoking: "Loading chart...", invoked: "Chart ready" },
      _meta: { "ui/previewData": { symbol: "AAPL", days: 30 } },
    },
    async ({ symbol, days }) => widget({ props: { symbol, days }, output: text(`Chart for ${symbol}`) })
  );
}

Step 3 — index.ts   (two lines)
──────────────────────────────────────────────────────────
import { register as registerPriceChart } from "./tools/price-chart"; // ADD NEW TOOL IMPORTS HERE
registerPriceChart(server);                                            // ADD NEW TOOL REGISTRATIONS HERE
```

**Restart after adding a tool:**
```bash
# Kill by port (avoids pkill self-kill issue in E2B shells)
ss -tlnp 'sport = :3109' | grep -oP 'pid=\K[0-9]+' | head -1 | xargs -r kill; sleep 1
npm run dev   # background=true
```

---

## Agent Architecture: Single Coding Agent

One agent handles **creation**, **workspace management**, and **testing**.

### Agent Tool Set

**Coding tools** (CopilotKit actions in `BuilderAgentProvider` → Next.js API routes → `E2BWorkspaceProvider`):

| Action | What it does |
|--------|-------------|
| `provision_workspace(name)` | Spin up an E2B sandbox, clone mcp-use-server template, start dev server |
| `read_file(path)` | Read a file in the active sandbox workspace |
| `write_file(path, content)` | Create or overwrite a file |
| `edit_file(path, search, replace)` | Targeted search-and-replace edit |
| `exec(command, background?)` | Run a shell command in the workspace root |
| `get_workspace_info()` | Return active sandbox status + MCP endpoint |
| `download_workspace()` | Zip + return signed download URL |
| `refresh_mcp_tools()` | Re-introspect all connected MCP servers |

**MCP tools from connected servers** (always available via CopilotKit → MCP):
```
search-tools, get-fruit-details   ← built-in demo tools on mcp-use-server
[tools from provisioned sandbox]  ← appear after provision + refresh
```

---

## Implementation Phases

### Phase 1a — MCP Servers ✅ DONE

- [x] `apps/threejs-server/` — reference server (manual registration + Vite)
- [x] `apps/mcp-use-server/` — `mcp-use` library server at port 3109
  - `index.ts` with `MCPServer` + `server.tool()` + widget config
  - `resources/product-search-result/widget.tsx` using `useWidget` / `useCallTool`
  - `mcp-use build` / `dev` / `start` / `deploy` scripts
  - Connected to frontend via `DEFAULT_SERVERS`

### Phase 1b — Local WorkspaceProvider ❌ SKIPPED

Skipped in favour of going direct to E2B. The `WorkspaceProvider` interface is still defined in `lib/workspace/types.ts` for potential future local support.

### Phase 2 — UI Unification ✅ DONE

- [x] Drop the Playground/Builder mode split — single unified 2-column view
- [x] Left sidebar: MCP server manager + live tool list + inline tool detail/preview
- [x] "Try in chat" prompt suggestions per tool
- [x] Chat: single agent that can both USE and BUILD tools
- [x] Tool detail tabs: Overview, Preview Data (editable JSON), Tool JSON, UI Source, Input Schema
- [x] Mobile layout: 2-tab switcher (Chat / Tools & Preview)
- [x] Stale tool pruning when a server is removed
- [x] Server list in React context only (no localStorage)
- [x] Component modularization: McpAppPreview, ToolDetail, shared, constants

### Phase 3 — E2B Workspaces ✅ DONE

**Goal:** Agent can provision an E2B sandbox, clone the `mcp-use-server` template from GitHub, start the dev server, create/edit tools, and download the result.

#### Env vars (all set in `.env`)

| Var | Value | Purpose |
|-----|-------|---------|
| `E2B_API_KEY` | `e2b_...` | E2B account API key |
| `E2B_REPO_URL` | `https://github.com/vivek100/mcp-use-server-template` | Standalone template repo cloned into each sandbox |
| `E2B_TEMPLATE` | `nlhz8vlwyupq845jsdg9` | `code-interpreter-v1` (2GB RAM — base template OOMs on npm install) |

#### Architecture

```
CopilotKit agent
    │  useCopilotAction("provision_workspace") / ("write_file") / ("exec") / ...
    ↓
BuilderAgentProvider (React)
    │  fetch("/api/workspace/<action>", { workspaceId, ...params })
    ↓
apps/web/app/api/workspace/   (Next.js API routes)
    │  import { getProvider } from "@/lib/workspace"
    ↓
E2BWorkspaceProvider
    ├── Sandbox.create(TEMPLATE_ID)  → clone E2B_REPO_URL + npm install + npm run dev
    ├── Sandbox.connect(sandboxId)   → read/write/exec on reconnect
    └── sandbox.betaGetMcpUrl()      → MCP endpoint (falls back to getHost(3109))
```

#### Agent flow

```
User: "Build me a stock price chart widget"

Agent:
  1. provision_workspace("price-chart")
     → E2BWorkspaceProvider.provision():
         Sandbox.create("nlhz8vlwyupq845jsdg9")
         → git clone https://github.com/vivek100/mcp-use-server-template
         → npm install --no-audit --no-fund --prefer-offline
         → npm run dev (background) = npx tsx index.ts
         → poll :3109, wait for ready
         → betaGetMcpUrl() or getHost(3109) → endpoint
     → BuilderAgentProvider sets activeWorkspace + calls onAddServer(endpoint)
     → frontend introspects, demo tools appear in sidebar

  2. write_file("resources/price-chart/widget.tsx", widgetCode)
     write_file("tools/price-chart.ts", toolCode)
     edit_file("index.ts",
       "// ADD NEW TOOL IMPORTS HERE",
       'import { register as registerPriceChart } from "./tools/price-chart";\n// ADD NEW TOOL IMPORTS HERE')
     edit_file("index.ts",
       "// ADD NEW TOOL REGISTRATIONS HERE",
       'registerPriceChart(server);\n// ADD NEW TOOL REGISTRATIONS HERE')

  3. exec("ss -tlnp 'sport = :3109' | grep -oP 'pid=\\K[0-9]+' | head -1 | xargs -r kill; sleep 1")
     exec("npm run dev", { background: true })

  4. refresh_mcp_tools()  →  frontend re-introspects, show-price-chart appears

  5. Agent calls show-price-chart({ symbol: "AAPL", days: 30 }) via MCP
     → widget iframe renders in chat

  6. Iterate: edit_file → exec rebuild → refresh → call → repeat

  7. download_workspace()  →  signed URL to workspace.zip
```

#### Implementation checklist

**Workspace infrastructure:**
- [x] `apps/web/lib/workspace/types.ts` — `WorkspaceProvider` interface + `WorkspaceInfo` type
- [x] `apps/web/lib/workspace/e2b.ts` — `E2BWorkspaceProvider`
- [x] `apps/web/lib/workspace/index.ts` — `getProvider()` factory

**API routes:**
- [x] `apps/web/app/api/workspace/provision/route.ts`
- [x] `apps/web/app/api/workspace/read-file/route.ts`
- [x] `apps/web/app/api/workspace/write-file/route.ts`
- [x] `apps/web/app/api/workspace/edit-file/route.ts`
- [x] `apps/web/app/api/workspace/exec/route.ts`
- [x] `apps/web/app/api/workspace/info/route.ts`
- [x] `apps/web/app/api/workspace/download/route.ts`

**Agent integration:**
- [x] `BuilderAgentProvider` — 8 workspace actions + `activeWorkspace` state + 5 readables
- [x] `page.tsx` — `onRefreshServers` wired down
- [x] `e2b` npm package installed
- [x] Kill-by-port command (safe, avoids pkill self-kill)

**Template repo:**
- [x] Published at `https://github.com/vivek100/mcp-use-server-template`
- [x] `npm run dev` = `npx tsx index.ts` (bypasses ESM extension issue in compiled dist)
- [x] `E2B_REPO_URL` + `E2B_TEMPLATE` set in `.env`

**Tests passing:**
- [x] `test-e2b.mjs` — 14/14 (basic E2B operations)
- [x] `test-workspace-tools.mjs` — 19/19 (full agent tool flow: provision → write → edit → exec → restart → introspect → download)
- [x] TypeScript: `tsc --noEmit` clean

#### Known technical decisions

| Decision | Rationale |
|----------|-----------|
| `code-interpreter-v1` template (2GB) | Base template (512MB) OOM-kills npm install for React 19 + Vite 7 |
| `npx tsx index.ts` for dev | `mcp-use build` emits extensionless ESM imports; `node dist/index.js` fails. `tsx` runs TS directly |
| Kill by port (`ss -tlnp`) | `pkill -f "tsx index.ts"` self-kills the shell (pattern appears in the sh process's own cmdline) |
| `betaGetMcpUrl()` with fallback | E2B managed URL preferred; falls back to `getHost(3109)` if SDK version doesn't have it |
| Sandbox timeout: 60 min | Default 5-min idle timeout too short for dev sessions |

---

### Phase 4 — UX Polish ✅ DONE (4a + 4b)

**Goal:** Make the end-to-end flow feel polished in the browser. All infrastructure works; now improve the user-facing experience.

#### 4a — Workspace status in the sidebar ✅

- [x] `activeWorkspace` state lifted to `StudioView` in `page.tsx`
- [x] `McpServerManager` accepts `activeWorkspace` prop; matches by endpoint URL
- [x] Status badge: amber spinner + "Setting up…" during provisioning, green dot + "Running" when live
- [x] Download icon button (↓) on the running sandbox entry → calls `/api/workspace/download` → opens signed zip URL in new tab
- [x] Sandbox server row highlighted with emerald border/bg when active

#### 4b — Starter prompts & chat greeting ✅

- [x] 3 starter prompt chips above the CopilotChat input: "Build a crypto price widget", "Build a weather dashboard widget", "Build a stock chart widget"
- [x] CopilotChat `welcomeMessageText` set to a friendly greeting explaining what the agent can do
- [x] CopilotChat `chatInputPlaceholder` updated to guide user intent

#### 4c — Error handling & resilience (future)

- [ ] If `provision_workspace` fails, show a user-friendly error and allow retry
- [ ] If sandbox times out mid-session, detect 502 and surface a "sandbox expired, re-provision?" prompt
- [ ] Workspace ID persistence in localStorage for page-refresh reconnect

#### 4d — Build custom E2B template (future, for faster cold start)

- [ ] Run `npx tsx build.dev.ts` in `apps/mcp-use-server/` to bake in `npm install`
- [ ] Cold-start drops from ~60s to ~10s
- [ ] Update `E2B_TEMPLATE` with the resulting template ID

---

### Phase 5 — Deployment ← NEXT

- [ ] Deploy `apps/web` to Vercel (see `docs/DEPLOY.md` for step-by-step)
- [ ] Set production env vars (`E2B_API_KEY`, `E2B_REPO_URL`, `E2B_TEMPLATE`, `OPENAI_API_KEY`)
- [ ] Rate-limit sandbox creation (one active sandbox per user session)
- [ ] Add CORS if the MCP endpoint will be used by external clients

---

## Open Questions → ANSWERED

| Question | Answer |
|----------|--------|
| `betaGetMcpUrl()` availability? | Falls back to `getHost(3109)` — both tested and working |
| Sandbox timeout? | Set to 60 min in `e2b.ts` (`SANDBOX_TIMEOUT_MS = 60 * 60 * 1000`) |
| npm install duration? | ~60-90s with `code-interpreter-v1` (2GB RAM). Faster custom template possible via build scripts |
| Rebuild detection after restart? | Poll `:3109` MCP endpoint (same pattern as provision). Test confirms ~4s roundtrip |
| Download zip security? | E2B `sandbox.downloadUrl()` returns a signed short-lived URL — no proxying needed |

---

## File Structure (Current)

```
with-mcp-apps/
  .env                          # E2B_API_KEY, E2B_REPO_URL, E2B_TEMPLATE, OPENAI_API_KEY
  apps/
    web/
      app/
        page.tsx                  # unified UI (2-col: sidebar + chat)
        layout.tsx
        globals.css
        constants/
          mcpServers.ts           # McpServerEntry, DEFAULT_SERVERS
        components/
          CopilotKitProvider.tsx  # McpServersContext + provider
          McpServerManager.tsx    # server list UI
          BuilderAgentProvider.tsx # agent actions (tool + workspace)
          McpAppPreview.tsx       # iframe MCP host
          ToolDetail.tsx          # inline tool detail panel
          shared.tsx              # LoadingSpinner, EmptyState, ErrorBanner, CreateToolForm
        hooks/
          useMcpIntrospect.ts
          useToolConfigStore.ts
          useLocalStorage.ts
        api/
          copilotkit/route.ts
          mcp-introspect/route.ts
          call-tool/route.ts
          workspace/
            provision/route.ts
            read-file/route.ts
            write-file/route.ts
            edit-file/route.ts
            exec/route.ts
            info/route.ts
            download/route.ts
      lib/
        workspace/
          types.ts                # WorkspaceProvider interface
          e2b.ts                  # E2BWorkspaceProvider
          index.ts                # getProvider() factory
      test-e2b.mjs               # E2B basic ops test (14/14)
      test-workspace-tools.mjs   # Full agent tool flow test (19/19)
    threejs-server/               # reference server (manual registration)
    mcp-use-server/               # mcp-use library server
                                  # also published as standalone GitHub repo:
                                  # https://github.com/vivek100/mcp-use-server-template
      index.ts
      tools/product-search.ts
      resources/product-search-result/widget.tsx
      template.ts                 # E2B Build System 2.0 template definition
      build.dev.ts                # Build dev E2B template
      build.prod.ts               # Build prod E2B template
  docs/
    PLAN.md                       # this file
```
