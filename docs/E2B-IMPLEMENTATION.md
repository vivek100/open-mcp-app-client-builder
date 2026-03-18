## E2B Integration — Detailed Design

This document elaborates on **Phase 3 — E2B Workspaces** from `PLAN.md` and describes how to run MCP workspaces inside [E2B](https://e2b.dev) sandboxes, expose them as MCP servers, and make them usable by the MCP UI Studio agent.

---

## What You Need from the E2B Website

To make this integration work, you provide the following from [E2B](https://e2b.dev):

| Item | Required? | Where to get it | How you use it |
|------|-----------|-----------------|----------------|
| **API Key** | **Yes** | [E2B Dashboard → API Keys](https://e2b.dev/dashboard?tab=keys) (sign up / log in, then create or copy a key) | Set as the `E2B_API_KEY` environment variable wherever the dev-tools MCP server runs (e.g. in `.env` for the Next.js app or the process that hosts the E2B-backed tools). The E2B SDK reads this automatically; no need to pass it in code. |
| **Template name/ID** | **No** (optional) | Use the default **base** template (no setup), or [build a custom template](https://e2b.dev/docs/template/defining-template) with Node + git (and optionally a pre-cloned `mcp-use-server` + `npm install`) and note the **template name** you give when building (e.g. `mcp-use-server`). | If you use the base template, `provision_e2b_workspace` can call `Sandbox.create()` with no template; the sandbox will run `git clone` + `npm install` each time. If you use a custom template, pass that template name (e.g. `Sandbox.create('mcp-use-server')`) so sandboxes start with the workspace already prepared (faster cold start). |

**Summary**

- **Minimum to run:** Create an E2B account, get an **API key** from the dashboard, and set **`E2B_API_KEY`** in the environment of your dev-tools server. You can use the default base sandbox and clone the repo inside it (no custom template).
- **Optional (faster):** Build and publish a **custom E2B template** that already has your MCP server repo and dependencies installed; then pass that template name into `provision_e2b_workspace` so new sandboxes start from that image.

---

## Quick Guide: Creating an E2B Template

You only have to do this once per template you want to use (for example, a template that has Node, git, and a pre-installed `mcp-use-server` checkout).

1. **Install E2B CLI and set API key**
   - Follow the E2B docs to install the CLI.
   - Ensure your local environment has:
     - `E2B_API_KEY=e2b_...` in a `.env` file or shell env.
2. **Initialize a template project**
   - In a new folder (this can be or contain your MCP server repo), run:
     - `e2b template init`
   - This generates template config and build scripts plus a `README.md` describing the exact build commands.
3. **Add your MCP server code**
   - Option A: clone your `mcp-use-server` repo into this template folder.
   - Option B: treat this template folder as the main repo and add `apps/mcp-use-server` inside it.
   - Make sure the template’s build step installs dependencies (e.g. `npm install` in the right directory) so sandboxes start “warm”.
4. **Build and publish the template**
   - Use the generated build script from the template `README.md` (for example):
     - `npx tsx build.dev.ts`
   - This builds and registers the template with E2B and gives you a **template name/tag** (for example `mcp-use-server-dev`).
5. **Use the template in code**
   - In your dev-tools MCP server, call:
     - `const sandbox = await Sandbox.create("mcp-use-server-dev");`
   - That template name/tag is what `PLAN.md` and this doc refer to as `templateId` / `<mcp-use-template>`.

You can always skip the custom-template step and use the base template instead; it just means `provision_e2b_workspace` will do `git clone` + `npm install` on each new sandbox.

---

## 1. E2B Capabilities We Rely On

- **Sandbox lifecycle**
  - `Sandbox.create(template?: string, opts?)`: create a new sandbox, optionally from a template that already contains a pre-cloned, pre-installed `mcp-use-server` workspace.
  - `Sandbox.connect(sandboxId)`: reconnect to an existing sandbox (e.g. to continue a prior session).
  - `sandbox.kill()`, `Sandbox.kill(sandboxId)`: terminate a sandbox.
  - `sandbox.setTimeout(timeoutMs)`, `Sandbox.setTimeout(sandboxId, timeoutMs)`: extend or reduce sandbox lifetime.
- **Command execution**
  - `sandbox.commands.run(cmd, opts?)`:
    - `background: false` (default) → wait for completion, return `{ stdout, stderr, exitCode }`.
    - `background: true` → return a `CommandHandle` that can be `.wait()`-ed or killed later.
  - Options: `cwd`, `envs`, `timeoutMs`, `onStdout`, `onStderr`, `stdin`, `user`.
- **Filesystem + transfer**
  - `sandbox.files.*`: read/write/list/delete files and directories within the sandbox.
  - `sandbox.downloadUrl(path)`: generate a signed HTTPS URL for downloading a file from the sandbox.
  - `sandbox.uploadUrl(path?)`: generate an upload URL for multipart/form-data file uploads.
- **Networking / MCP**
  - `sandbox.getHost(port)`: map an internal sandbox port (e.g. 3109) to an externally reachable host URL.
  - `sandbox.betaGetMcpUrl()`: return an MCP endpoint URL for the sandbox (E2B-managed MCP URL).

All of the above are used behind MCP tools exposed by a **dev-tools MCP server**, so the agent only ever talks via MCP, never directly via the E2B SDK.

---

## 2. High-Level Flow: E2B Workspace as an MCP Server

1. **Provision sandbox**
   - Dev-tools MCP tool calls `Sandbox.create('<mcp-use-template>', opts)` to start an E2B sandbox for the session.
2. **Prepare workspace**
   - Either:
     - Workspace is already baked into the template (pre-cloned, pre-installed `mcp-use-server`).
     - Or tool runs:
       - `git clone <repoUrl> workspace`
       - `cd workspace && npm install`
3. **Start MCP server inside sandbox**
   - Run `cd workspace && npm run dev -- --port 3109` with `background: true`.
4. **Expose MCP endpoint**
   - Use `sandbox.betaGetMcpUrl()` **or** `sandbox.getHost(3109)` as the `endpoint` for a new `McpServerEntry` in the UI.
5. **Agent connects + builds**
   - The Builder agent adds this endpoint via `add_server(endpoint)` and can now:
     - Call **coding tools** that wrap E2B commands/filesystem.
     - Call **MCP tools defined in the repo** (i.e. tools implemented in `apps/mcp-use-server` inside the sandbox).
6. **Download**
   - When done, a dev-tools MCP tool zips the workspace inside the sandbox, then returns a `downloadUrl` from `sandbox.downloadUrl(path)` for the frontend to present as a download link.

---

## 3. Dev-Tools MCP Server: E2B-Based Tools

These tools live in a dedicated dev-tools MCP server (see `PLAN.md` Phase 1b) but use E2B instead of the local filesystem.

### 3.1. `provision_e2b_workspace`

- **Purpose**: Create a new E2B sandbox, ensure it has a `mcp-use-server` workspace, start the dev server, and return an MCP endpoint URL.
- **Inputs (conceptual)**:
  - `templateId?: string` — optional E2B template name/ID; defaults to a preconfigured MCP template.
  - `repoUrl?: string` — optional Git repository URL to clone as the workspace.
  - `workspaceDir?: string` — path inside the sandbox where the workspace should live (default `/home/user/workspace`).
- **Implementation sketch**:
  - `const sandbox = await Sandbox.create(templateId ?? DEFAULT_TEMPLATE, opts)`
  - If no pre-baked workspace:
    - `sandbox.commands.run("git clone <repoUrl> workspace && cd workspace && npm install", { timeoutMs: 10 * 60_000 })`
  - Start dev server:
    - `sandbox.commands.run("cd workspace && npm run dev -- --port 3109", { background: true })`
  - Expose MCP endpoint:
    - `const mcpUrl = sandbox.betaGetMcpUrl()` **or** `const mcpUrl = sandbox.getHost(3109)`
  - Return:
    - `{ sandboxId, mcpUrl, workspacePath: workspaceDir }`

The frontend/agent treats `mcpUrl` just like any other MCP server endpoint and adds it via `add_server(mcpUrl)`.

### 3.2. `e2b_exec`

- **Purpose**: Run a shell command inside a given sandbox workspace.
- **Inputs**:
  - `sandboxId: string`
  - `cmd: string`
  - `cwd?: string` (defaults to workspace root)
  - `background?: boolean`
  - `timeoutMs?: number`
- **Behavior**:
  - Connect: `const sandbox = await Sandbox.connect(sandboxId)`
  - Run: `sandbox.commands.run(cmd, { cwd, background, timeoutMs, onStdout, onStderr })`
  - For foreground:
    - Return `{ stdout, stderr, exitCode }`.
  - For background:
    - Return `{ pid, tag?, cmd, cwd }` so the agent can later monitor/kill.

### 3.3. `e2b_read_file`, `e2b_write_file`, `e2b_edit_file`

- **Purpose**: Mirror the local `read_file` / `write_file` / `edit_file` tools, but implemented via `sandbox.files`.
- **Inputs (per tool)**:
  - Common: `sandboxId: string`, `path: string`
  - `e2b_write_file`: `content: string`
  - `e2b_edit_file`: `search: string`, `replace: string` (simple line-level edit)
- **Behavior**:
  - Connect: `const sandbox = await Sandbox.connect(sandboxId)`
  - Read: `sandbox.files.read(path)`
  - Write: `sandbox.files.write(path, content, { create: true })`
  - Edit: read → modify in memory → write back.

### 3.4. `e2b_get_workspace_info` and `e2b_stop_workspace`

- **`e2b_get_workspace_info`**:
  - Returns:
    - `{ sandboxId, isRunning, workspacePath, mcpUrl, startedAt, templateId, metrics? }`
  - Uses `sandbox.isRunning()`, `sandbox.getInfo()`, and optionally `sandbox.getMetrics()`.
- **`e2b_stop_workspace`**:
  - Calls `sandbox.kill()` and returns a boolean success flag.

---

## 4. MCP Endpoint and Introspection Refresh

Once `provision_e2b_workspace` returns `{ sandboxId, mcpUrl }`:

1. The Builder agent calls `add_server(mcpUrl)` (existing `BuilderAgentProvider` action).
2. The frontend:
   - Adds a new `McpServerEntry` for `mcpUrl`.
   - Triggers `useMcpIntrospect` to fetch tools and resources from that endpoint.
3. To make this explicit and agent-callable:
   - Extend `useMcpIntrospect` with a `refresh()` function.
   - Add a CopilotKit action in `BuilderAgentProvider`:
     - `refresh_mcp_tools()` → calls `refresh()` for all servers.
     - Optionally `refresh_mcp_server_tools(endpoint: string)` for a single server.

This gives the agent a dedicated “refresh tools” hook it can call after creating or editing tools in an E2B workspace.

---

## 5. Downloading an E2B Workspace

### 5.1. Zip-and-download via sandbox

1. Add dev-tools MCP tool `e2b_prepare_download`:
   - Inputs:
     - `sandboxId: string`
     - `workspacePath: string` (e.g. `/home/user/workspace`)
   - Implementation:
     - Connect: `const sandbox = await Sandbox.connect(sandboxId)`
     - Clean and zip inside sandbox:
       - `sandbox.commands.run("cd <workspacePath> && rm -rf node_modules dist .agent && cd .. && zip -r workspace.zip workspace", { timeoutMs: 5 * 60_000 })`
     - Generate signed URL:
       - `const url = await sandbox.downloadUrl("<parent-dir>/workspace.zip")`
     - Return `{ downloadUrl: url }`.
2. The frontend:
   - Calls `e2b_prepare_download`.
   - Uses `downloadUrl` for a direct download link, or optionally proxies it via its own `/api/download-workspace` route.

This matches the “Download button” behavior in `PLAN.md`, but uses E2B’s own signed URL mechanism.

### 5.2. Optional: Commit-and-push to GitHub

As an alternative, the dev-tools tools can:

- Configure a remote:
  - `git remote add origin https://<token>@github.com/<owner>/<repo>.git`
- Commit and push:
  - `git add . && git commit -m "MCP UI Studio workspace" && git push origin main`

Then the frontend provides a link to the GitHub archive URL.

This requires carefully scoped GitHub tokens passed into the sandbox environment and is more complex than the direct zip approach, so the **zip-and-download** method is the default recommendation.

---

## 6. Error Handling and Timeouts

- Use generous but bounded timeouts for long-running commands:
  - `npm install`, `zip` operations, and large `git clone` calls should use `timeoutMs` in the 5–10 minute range.
- The dev-tools MCP tools should:
  - Surface non-zero `exitCode` values and stderr back to the agent.
  - Include high-level error messages (e.g. “git clone failed” vs only raw stderr).
- The frontend can show:
  - Progress in chat via tool result streaming.
  - Clear error banners when provisioning or download fails.

---

## 7. Mapping Back to PLAN.md Phase 3

- **E2B sandbox template**
  - Implemented as an E2B template pre-configured with Node, git, and optionally a clean `mcp-use-server` checkout.
- **Workspace creation**
  - Implemented by `provision_e2b_workspace` (this document’s §3.1).
- **MCP connection**
  - Done via `sandbox.betaGetMcpUrl()` or `sandbox.getHost(3109)` and `add_server(mcpUrl)`.
- **Coding tools + MCP tools**
  - Coding tools implemented as dev-tools MCP tools that wrap the E2B SDK.
  - MCP tools discovered via `useMcpIntrospect` from the E2B-hosted `mcp-use-server`.
- **Download**
  - Implemented via `e2b_prepare_download` + `sandbox.downloadUrl`.

All of these details are internal implementation notes; the agent primarily thinks in terms of MCP tools and server endpoints.

