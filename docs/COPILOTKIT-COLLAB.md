# MCP UI Studio — Plan & Alignment

## What We're Building

**MCP UI Studio** — a workspace where a coding agent creates, runs, and tests MCP UI tools in a single session. The agent writes React components, spins up a dev server, then immediately uses the tools it created via MCP to verify the output (rendered as iframes in the chat).

---

## The Core Loop

```
User: "Create a tool that shows a stock price chart"

Agent (coding agent):
  1. Writes resources/price-chart.tsx  (one React component file)
  2. Dev server hot-reloads → tool is registered
  3. Agent calls price_chart({ symbol: "AAPL", days: 30 }) via MCP
  4. Chart UI renders in iframe inside the chat
  5. User gives feedback → agent edits the file → repeat
```

The agent creates the tool and then immediately tests it by calling it through MCP — no separate testing step, no context switch.

---

## Agent Capabilities

The agent is a **coding agent** with:

**Core dev tools:**
- `readFile` — read any file in the workspace
- `writeFile` — create or overwrite a file
- `editFile` — targeted search-and-replace edit (no full rewrite)
- `exec` — run any shell command (start dev server, `npm install`, etc.)

**MCP tools from the running server:**
- Built-in demo tools (e.g., `show_threejs_scene`) — available from the start
- Any tools the agent creates during the session — registered automatically via auto-discovery

The agent's MCP tool set grows as it creates things. After writing a new component and the server hot-reloads, the new MCP tool is immediately callable in the same conversation.

---

## Workspace Provisioning

A workspace is a running MCP dev server. The agent provisions one by cloning the MCP server template:

```
Agent:
  1. exec("git clone https://github.com/org/mcp-server-template my-project")
  2. exec("cd my-project && npm install")
  3. exec("cd my-project && npm run dev --port 3110")  ← background
  4. Frontend adds localhost:3110 via setMcpServers
  5. Agent writes components, calls tools, iterates
```

**Phase 1 (now):** local workspace — agent runs shell commands on the local machine.
**Phase 2 (future):** E2B sandbox — same flow, but `exec` runs inside an isolated cloud sandbox. Each user gets their own sandbox URL.

---

## Download

When the user is done, they can download the entire workspace as a standalone MCP server — a zip of the project directory that runs with `npm install && npm run start`. No studio dependency.

---

## Architecture

```
[Browser]
  CopilotChat  (single agent chat — create + test in one place)
  Tool Sidebar (live list from connected MCP servers)
  Preview Panel (iframe, renders when agent calls a UI tool)

[Next.js API]
  BuiltInAgent + MCPAppsMiddleware → connected to dev server(s)

[mcp-use-server]  (Phase 1: localhost | Phase 2: E2B sandbox)
  auto-discovers resources/*.tsx
  each file = one MCP tool + its UI

[Workspace]
  Phase 1: local filesystem + local shell
  Phase 2: E2B sandbox (same agent mechanics, different execution env)
```

---

## How We're Using CopilotKit

| Feature | Usage |
|---------|-------|
| `BuiltInAgent` | Runs the coding agent; has core dev tools + MCP tools from dev server(s) |
| `MCPAppsMiddleware` | Connects agent to the mcp-use dev server(s); tools auto-available |
| `setMcpServers` | Frontend dynamically adds newly provisioned dev servers to the agent's MCP context |
| `useCopilotReadable` | Feeds workspace state (running servers, tool list) into agent context each turn |
| `CopilotChat` | Main UI — create and test in one chat |

---

## Roadmap

| Phase | Description | Status |
|-------|-------------|--------|
| 1a | mcp-use server with auto-discovery + built-in threejs demo | **Next** |
| 1b | Coding agent: core dev tools + dev server spin-up + MCP test loop | Planned |
| 2  | UI unification + download feature | Planned |
| 3  | E2B workspaces (isolated per-user sandboxes) | Future |

---

## Open Questions for CopilotKit

1. **Dynamic MCP servers**: When the agent spins up a new dev server (new port locally, new URL on E2B), we add it via `setMcpServers`. Does this work correctly with `BuiltInAgent` + `MCPAppsMiddleware` mid-session, or does the runtime need to restart?
2. **Streaming tool inputs to iframe** *(exploratory)*: The MCP UI App postMessage protocol supports partial/streaming tool inputs. Is there a hook for capturing partial tool args as they stream to the iframe?
