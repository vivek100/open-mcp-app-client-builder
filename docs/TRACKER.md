# MCP App client builder — handoff & tracker

**This file is the main document** we share with **CopilotKit** and our team. It summarizes **what we shipped** (checklist), **how to go live on Vercel** (including review before sign-off), and **decisions we need from CopilotKit**. Operational steps: [`DEPLOY.md`](DEPLOY.md). Developer setup: root [`README.md`](../README.md).

---

## Shipped work (from original product list)

- [x] **UI / sidebar — MCP tools**  
  For MCP App servers in the sidebar, show **only a compact tool list**; the user **opens details** (description, schema, preview, etc.) in a **modal** instead of a heavy inline preview. *`ToolDetailModal` + `page.tsx`.*

- [x] **Branding & header — title**  
  Visible **MCP App builder** with subtitle **Powered by CopilotKit**; browser title in `app/layout.tsx`. Logo: `apps/web/app/image.png`.

- [x] **Branding & header — top-right CTAs (two)**  
  **CopilotKit docs** + **GitHub** (URLs/labels overridable via `NEXT_PUBLIC_*`; code default GitHub target is **this demo repo** — see *Input requested from CopilotKit*). *`branding.ts`, `page.tsx`.*

- [x] **Trim chrome**  
  Top bar: branding + CTAs (no global Refresh / tool count / Live). MCP servers: **+ Add** only (**Reset** removed). Tools section: no **+ New** / **Refresh** in the header. *`McpServerManager.tsx`, `page.tsx`.*

- [x] **Chat — starter / example prompts in the chat surface**  
  Suggestions use CopilotKit **`useCopilotChatSuggestions`** with v2 **`CopilotChat`** (`ChatSuggestions.tsx`). Optional override: `NEXT_PUBLIC_CHAT_STARTER_PROMPTS`.

- [x] **Hosted / reliability — download on Vercel**  
  Workspace download as **`.tar.gz`**, **stream + blob** same-origin (no `zip` / pop-up issues).

- [x] **Full app kit download**  
  `apps/web` **prebuild** runs `scripts/pack-download-kit.mjs`, producing **`.download-kit/base.tar.gz`** (monorepo shell: root `package.json` / `pnpm-workspace.yaml` / `apps/web` / `apps/mcp-use-server` template / `apps/threejs-server`, excluding `node_modules`, `.next`, `dist`, etc.). **`POST /api/workspace/download`** with `stream: true` and **`fullKit: true`** (default) merges the E2B **`workspace/`** tree into **`mcp-apps-starter/apps/mcp-use-server`** and streams **`mcp-app-kit-{id}.tar.gz`**. If the base tarball is missing (e.g. dev without `prebuild`) or merge fails, response falls back to **MCP-only** `workspace-{id}.tar.gz`. **Refresh the base kit** whenever the monorepo layout or starter content changes (redeploy / rebuild web). **`next.config.ts`** uses **`outputFileTracingIncludes`** so Vercel bundles **`.download-kit/base.tar.gz`**. **`turbo.json`** lists **`.download-kit/**`** as a build output for cache correctness.

- [x] **Manual integration tests (`apps/web/test/`)**  
  Ad-hoc scripts run from **`apps/web`** as **`node test/<name>.mjs`**. **`pnpm run test:download-kit`** starts **`next dev`** (port **31099** by default; set **`TEST_SERVER_PORT`** or **`--port=`**), ensures **`base.tar.gz`**, provisions an E2B sandbox, calls **`POST /api/workspace/download`** for **fullKit** and **MCP-only**, and verifies tarball contents. With **`--no-server`**, point **`WEB_BASE`** at an already-running app (default **`http://localhost:3000`**).

**Additional fixes (not on the original checklist):**

- [x] **Mastra stream ↔ duplicate React keys** — Message id remapping in `apps/web/app/api/mastra-agent/route.ts` (RCA in README).

- [x] **Duplicate `POST /api/mastra-agent` on load** — Mobile + desktop layout branches both stayed in the React tree; CSS hid mobile on ≥768px but **`CopilotChat` mounted twice**, doubling CopilotKit runtime traffic. **`app/page.tsx` `StudioView`** now mounts chat/sidebar only inside the active breakpoint (`matchMedia` 768px). Optional verbose agent logs: **`MASTRA_AGENT_DEBUG=1`** (see `.env.example`).

---

## Production go-live checklist (Vercel)

Use **Vercel → Project → Settings → Environment Variables** (at least **Production**).

### Secrets and API keys

- [ ] **OpenAI** — `OPENAI_API_KEY` (required for `/api/mastra-agent` and chat)
- [ ] **E2B** — `E2B_API_KEY` if **provision workspace / sandbox** must work in production
- [ ] **E2B template** — `E2B_TEMPLATE` (recommended for fast cold start; see `docs/DEPLOY.md`, `apps/mcp-use-server/build.dev.ts`)
- [ ] **E2B repo** — `E2B_REPO_URL` only if the default template repo should be overridden

### Server / routing

- [ ] **Root directory** — e.g. `apps/web` vs `with-mcp-apps/apps/web` per your Git layout (`vercel.json` install must reach monorepo root)
- [ ] **Function timeouts** — workspace provision/download routes: `maxDuration` in `vercel.json` vs plan limits

### Optional product / hosted MCP

- [ ] **Default MCP list** — `NEXT_PUBLIC_DEFAULT_MCP_SERVERS` (`[]` vs hosted URL) and/or `DEFAULT_MCP_SERVERS` for API fallback

### Branding & copy (public env)

- [ ] **Header URLs/labels** — Override `NEXT_PUBLIC_HEADER_*` / `NEXT_PUBLIC_GITHUB_REPO_URL` if the demo should not use code defaults
- [ ] **Chat starters** — Set `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` when the three final prompts are decided (see *Input requested*)

### Smoke test after deploy

- [ ] Home loads; logo + header links match intended URLs
- [ ] Chat sends and agent responds (`OPENAI_API_KEY` valid)
- [ ] If E2B enabled: provision completes; tools appear after refresh
- [ ] Download workspace (`.tar.gz`) works for a running sandbox; optional **full kit** filename `mcp-app-kit-*.tar.gz` when merge succeeds

### Review before sign-off

- [ ] **README** — Root [`README.md`](../README.md) matches this tracker (stack, E2B, MCP UI, **tar.gz** download). Fix sections that contradict this doc.
- [ ] **DEPLOY.md** — Tables and verify steps match current env vars and UI
- [ ] **`.env.example`** — Documents `NEXT_PUBLIC_*` options; file is tracked (`!.env.example` in `.gitignore`)
- [ ] **End-to-end** — One full production path: chat → provision (if E2B) → tools → download
- [ ] **Vendor marks** — CopilotKit **name/logo** usage passes your design/legal bar if required

**Step-by-step import:** [`DEPLOY.md`](DEPLOY.md).

---

## Input requested from CopilotKit

- [ ] **Branding** — OK to ship **Powered by CopilotKit** + logo in header as implemented? Preferred wording or placement changes?

- [ ] **GitHub / secondary CTA** — The header **GitHub** pill currently defaults to **`https://github.com/vivek100/open-mcp-app-client-builder`**. Should the **public** demo instead point to a repo on **CopilotKit’s org/account**, stay on this repo, or use another URL? (All overridable via env.)

- [ ] **Default MCP for hosted demos** — Will you **provide or recommend a default MCP server** for new users (sidebar and/or API fallback)? **Which HTTP MCP URL** (if any), vs **empty / BYO only**? Should docs mention any **other public demo endpoints**, or only bring-your-own? Align `NEXT_PUBLIC_DEFAULT_MCP_SERVERS`, `DEFAULT_MCP_SERVERS`, README, and `DEPLOY.md`.

- [ ] **The three chat starter prompts** — **Two** are set: **tic tac toe** and **flow charts** (`chatStarters.ts`). The **third is TBD**. What should the **full set of three** be for the public demo (short **title** + full **message** for each)?

- [ ] **CopilotKit v2** — `CopilotChat` (v2) + `useCopilotChatSuggestions` — anything to adjust for **current best practice** or upcoming deprecations?

---

_Last updated: checklist-style shipped work; production + review merged; GitHub default = vivek100 demo repo; two starters + third TBD._
