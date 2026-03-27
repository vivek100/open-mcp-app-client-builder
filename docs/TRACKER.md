# MCP App client builder — handoff & tracker

**This file is the main document** we share with **CopilotKit** and our team. It summarizes **what we fixed**, **how to ship to production**, **defaults for optional env vars**, and **open decisions / review items**. Operational detail for Vercel import lives in [`DEPLOY.md`](DEPLOY.md). Day-to-day developer setup stays in the root [`README.md`](../README.md) (keep that README in sync with this tracker when onboarding or rebranding).

---

## Recent changes & issues fixed

- **Tools UI** — Sidebar is a compact tool list only; clicking a tool opens **`ToolDetailModal`** with Preview-first tabs (schema, prompts, etc.).
- **Chat starters** — Example prompts live **inside** CopilotKit v2 chat via **`useCopilotChatSuggestions`** (`apps/web/app/components/ChatSuggestions.tsx`). Optional env: **`NEXT_PUBLIC_CHAT_STARTER_PROMPTS`** (JSON). If unset or invalid, **code defaults** apply (tic tac toe, flow charts, stock chart) — see [`chatStarters.ts`](../apps/web/app/constants/chatStarters.ts).
- **Header & branding** — CopilotKit wordmark (`apps/web/app/image.png`), product title **MCP App builder**, subtitle **Powered by CopilotKit**, two header CTAs. URLs/labels are env-driven with **defaults** — [`branding.ts`](../apps/web/app/constants/branding.ts).
- **Trimmed chrome** — Top bar is branding + CTAs only (no global Refresh/tool count/Live). MCP panel: **+ Add** only (**Reset** removed). Tools panel: no **+ New** / **Refresh** header actions (local create-tool form removed; agent/MCP drive tools).
- **Hosted workspace download** — Sandboxes package **`.tar.gz`** (no `zip`); download uses **same-origin stream + blob** so hosted (e.g. Vercel) is not blocked by pop-up rules.
- **Mastra stream / React keys** — Duplicate message ids from Mastra streams caused duplicate React keys; **remapped ids** in `apps/web/app/api/mastra-agent/route.ts` (see README “Duplicate React keys” for RCA).
- **Optional `NEXT_PUBLIC_*` branding/prompts** — **No env required** for local dev; all new keys fall back to sensible defaults in code (table below).

---

## Optional env variables — defaults in code

These are **safe to omit**. Values are applied at build time on Vercel for `NEXT_PUBLIC_*`.

| Variable | Default when unset |
|----------|---------------------|
| `NEXT_PUBLIC_HEADER_DOCS_URL` | `https://docs.copilotkit.ai/` |
| `NEXT_PUBLIC_HEADER_PRIMARY_CTA_LABEL` | `CopilotKit docs` |
| `NEXT_PUBLIC_HEADER_SECONDARY_CTA_URL` | Uses `NEXT_PUBLIC_GITHUB_REPO_URL` if set; else see next row |
| `NEXT_PUBLIC_GITHUB_REPO_URL` | If both secondary URL vars unset: `https://github.com/CopilotKit/CopilotKit` |
| `NEXT_PUBLIC_HEADER_SECONDARY_CTA_LABEL` | `GitHub` |
| `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` | Three built-in prompts (tic tac toe, flow charts, stock chart) |

Invalid JSON for chat starters falls back to the same built-in defaults.

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

- [ ] **Header URLs/labels** — set `NEXT_PUBLIC_HEADER_*` and/or `NEXT_PUBLIC_GITHUB_REPO_URL` if defaults are not right for the demo
- [ ] **Chat starters** — `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` if defaults are not right for the story

### Smoke test after deploy

- [ ] Home loads; logo + header links match intended URLs
- [ ] Chat sends and agent responds (`OPENAI_API_KEY` valid)
- [ ] If E2B enabled: provision completes; tools appear after refresh
- [ ] Download workspace (`.tar.gz`) works for a running sandbox

**Step-by-step import:** [`DEPLOY.md`](DEPLOY.md).

---

## Input requested from CopilotKit

Items we’d like **alignment or guidance** on:

- [ ] **Branding** — OK to ship **Powered by CopilotKit** + official-style logo in header as implemented? Any preferred wording or placement?
- [ ] **Default secondary CTA** — Code default is **`https://github.com/CopilotKit/CopilotKit`**. Should the public demo instead deep-link a **specific repo**, **docs only**, or a **CopilotKit-owned** showcase URL?
- [ ] **Hosted MCP demos** — Any **recommended public HTTP MCP endpoint(s)** we should pre-wire for hosted demos (or explicit “none” / bring-your-own guidance)?
- [ ] **CopilotKit v2 patterns** — `CopilotChat` (v2) + `useCopilotChatSuggestions` — anything we should change to match **current best practice** or upcoming deprecations?
- [ ] **Attribution / license** — Any **required** footer, README, or third-party notice beyond what we have?

---

## Review checklist (our team & CopilotKit)

- [ ] **README** — Review root [`README.md`](../README.md) for accuracy vs this tracker (stack, deploy pointer, E2B, MCP UI, download format **tar.gz**). Treat **this tracker** as source of truth for handoff scope; trim or update README sections that contradict it.
- [ ] **DEPLOY.md** — Tables and verify steps match latest env vars and UI behavior.
- [ ] **`.env.example`** — Present in repo and documents all optional `NEXT_PUBLIC_*` keys (gitignore allows `!.env.example`).
- [ ] **End-to-end smoke** — One full path on production: chat → provision (if E2B) → tools → download.
- [ ] **Vendor marks** — Quick pass on CopilotKit **name/logo** usage with your legal/design standards if required.

---

## Implemented scope (reference)

| Area | Status | Notes |
|------|--------|--------|
| Tools list + modal detail | Done | `ToolDetail.tsx`, `page.tsx` |
| Chat suggestions (framework-native) | Done | `ChatSuggestions.tsx`, `chatStarters.ts` |
| Header branding + env CTAs | Done | `page.tsx`, `branding.ts`, `image.png` |
| Trim chrome (servers/tools/header) | Done | `McpServerManager.tsx`, `page.tsx` |
| Hosted download reliability | Done | `e2b`/API download path, client blob |
| Mastra duplicate keys | Done | `mastra-agent/route.ts` |

---

_Last updated: tracker as primary handoff doc; env defaults confirmed in code._
