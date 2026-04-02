# Production go-live checklist

Use this document to **sign off a Render deployment** of the MCP App builder.

**Related docs:** step-by-step deploy **[`DEPLOY.md`](DEPLOY.md)** · developer setup **[`README.md`](../README.md)** · shipped features & open questions for stakeholders **[`HANDOFF.md`](HANDOFF.md)**.

---

## Environment variables (Render → Web Service → Environment)

Configure **Production** (and other environments if you use them).

### Secrets and API keys

- [ ] **OpenAI** — `OPENAI_API_KEY` (required for `/api/mastra-agent` and chat); optional **`OPENAI_MODEL`** (default `gpt-5.2`)
- [ ] **E2B** — `E2B_API_KEY` if **provision workspace / sandbox** must work in production
- [ ] **E2B template** — `E2B_TEMPLATE` (**`templateId`** from `build.dev.ts` / `build.prod.ts`; recommended for ~5s cold start — see `DEPLOY.md`)
- [ ] **E2B repo** — `E2B_REPO_URL` only if the default clone URL should be overridden

### Server / build

- [ ] **Root directory** — **pnpm monorepo root** (folder with **`pnpm-lock.yaml`**), **not** `apps/web` alone (see `DEPLOY.md` / `RENDER.md`)
- [ ] **Build / start** — Match `DEPLOY.md` or **`render.yaml`** (`pnpm install --frozen-lockfile`, `pnpm --filter web build`, `pnpm --filter web start`)
- [ ] **Long requests** — Web Service runs Node continuously; still smoke-test agent streams and downloads on your Render plan

### Optional product / hosted MCP

- [x] **Default MCP list** — Built-in default: Excalidraw (`https://mcp.excalidraw.com`). Override via env if needed.

### Branding & copy (public env)

- [ ] **Header** — `NEXT_PUBLIC_HEADER_*` / `NEXT_PUBLIC_GITHUB_REPO_URL` if defaults are wrong for this deployment
- [ ] **Chat starters** — Defaults ship as four bounded demos + Excalidraw test; set `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` only if you want custom chips (see `HANDOFF.md`)

---

## Smoke test after deploy

- [ ] Home loads; logo + header links match intent
- [ ] Chat sends; agent responds (`OPENAI_API_KEY` valid)
- [ ] If E2B enabled: provision completes; tools appear after refresh
- [ ] Download **`.tar.gz`** works for a running sandbox; optional **full kit** filename `mcp-app-kit-*.tar.gz` when merge succeeds

---

## Review before sign-off

- [ ] **README** — Accurate for this repo (stack, scripts, E2B `templateId`, lockfile)
- [ ] **DEPLOY.md** — Matches your Render service root, build commands, and env set
- [ ] **`.env.example`** — Complete for optional vars; file tracked
- [ ] **End-to-end** — One full path: chat → provision (if E2B) → tools → download
- [ ] **Vendor marks** — CopilotKit name/logo meets design/legal bar if required

**Import walkthrough:** [`DEPLOY.md`](DEPLOY.md).

---

_Stakeholder handoff (shipped list, CopilotKit asks): [`HANDOFF.md`](HANDOFF.md)._
