# MCP App builder — product & engineering handoff

Stakeholder-facing summary of **what shipped**, **follow-up questions** (especially for CopilotKit), and pointers to runbooks.

| Doc | Purpose |
|-----|---------|
| **[`TRACKER.md`](TRACKER.md)** | **Production go-live checklist** (Vercel env, smoke tests, sign-off) — use this to ship |
| **[`DEPLOY.md`](DEPLOY.md)** | Step-by-step Vercel import, E2B template scripts, troubleshooting |
| **[`README.md`](../README.md)** | Developer setup, scripts, architecture overview |

---

## Shipped work (original product list)

- [x] **UI / sidebar — MCP tools**  
  Compact tool list; **details** (description, schema, preview) in a **modal**. *`ToolDetailModal` + `page.tsx`.*

- [x] **Branding & header — title**  
  **MCP App builder** + **Powered by CopilotKit**; title in `app/layout.tsx`. Logo: `apps/web/app/image.png`.

- [x] **Branding & header — top-right CTAs**  
  CopilotKit docs + GitHub; overridable via `NEXT_PUBLIC_*` (default GitHub: this demo repo — see *Input requested*). *`branding.ts`, `page.tsx`.*

- [x] **Trim chrome**  
  Top bar: branding + CTAs only. MCP: **+ Add** only. Tools: no **+ New** / **Refresh** in header. *`McpServerManager.tsx`, `page.tsx`.*

- [x] **Chat — starter prompts**  
  `useCopilotChatSuggestions` + v2 `CopilotChat` (`ChatSuggestions.tsx`). Override: `NEXT_PUBLIC_CHAT_STARTER_PROMPTS`.

- [x] **Hosted download**  
  Workspace **`.tar.gz`**, same-origin stream + blob (no `zip` / pop-up issues).

- [x] **Full app kit download**  
  `apps/web` **prebuild** runs `scripts/pack-download-kit.mjs` → **`.download-kit/base.tar.gz`**. **`POST /api/workspace/download`** with **`fullKit: true`** (default) merges E2B **`workspace/`** into **`mcp-apps-starter/apps/mcp-use-server`** → **`mcp-app-kit-{id}.tar.gz`**; missing base or merge failure → **MCP-only** `workspace-{id}.tar.gz`. **`next.config.ts`** **`outputFileTracingIncludes`**; **`turbo.json`** includes **`.download-kit/**`**.

- [x] **Manual integration tests** (`apps/web/test/`)  
  e.g. **`pnpm run test:download-kit`**, **`pnpm run test:e2b-download`**. See script headers for env and flags.

## Additional fixes (not on original checklist)

- [x] **Mastra stream ↔ duplicate React keys** — Id remapping in `apps/web/app/api/mastra-agent/route.ts` (RCA in [`README.md`](../README.md)).

- [x] **Duplicate `POST /api/mastra-agent` on load** — Single **`CopilotChat`** mount per breakpoint in `app/page.tsx` `StudioView`. Verbose logs: **`MASTRA_AGENT_DEBUG=1`**.

---

## Input requested from CopilotKit

- [ ] **Branding** — OK to ship **Powered by CopilotKit** + logo in header? Wording or placement changes?

- [ ] **GitHub / secondary CTA** — Header defaults to **`https://github.com/vivek100/open-mcp-app-client-builder`**. Should the public demo point to a **CopilotKit** org repo, stay here, or another URL? (Overridable via env.)

- [ ] **Default MCP for hosted demos** — Provide or recommend a **default MCP URL** for sidebar/API fallback vs **empty / BYO**? Align `NEXT_PUBLIC_DEFAULT_MCP_SERVERS`, `DEFAULT_MCP_SERVERS`, README, `DEPLOY.md`.

- [ ] **Chat starter prompts** — Defaults are three bounded demos: **tic tac toe**, **tip calculator**, **dice roller** (see `apps/web/app/constants/chatStarters.ts`). OK for public demo as-is, or replace via **`NEXT_PUBLIC_CHAT_STARTER_PROMPTS`** (**title** + **message** each)?

- [ ] **CopilotKit v2** — `CopilotChat` (v2) + `useCopilotChatSuggestions` — any best-practice or deprecation adjustments?

---

_Last updated: split from go-live checklist; GitHub default = vivek100 demo repo; three built-in chat starters (bounded UI demos)._
