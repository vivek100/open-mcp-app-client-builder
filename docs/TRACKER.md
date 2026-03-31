# Production go-live checklist

Use this document to **sign off a Vercel (or similar) deployment** of the MCP App builder.

**Related docs:** step-by-step deploy **[`DEPLOY.md`](DEPLOY.md)** · developer setup **[`README.md`](../README.md)** · shipped features & open questions for stakeholders **[`HANDOFF.md`](HANDOFF.md)**.

---

## Environment variables (Vercel → Settings → Environment Variables)

Configure at least **Production** (and Preview/Development if you use them).

### Secrets and API keys

- [ ] **OpenAI** — `OPENAI_API_KEY` (required for `/api/mastra-agent` and chat)
- [ ] **E2B** — `E2B_API_KEY` if **provision workspace / sandbox** must work in production
- [ ] **E2B template** — `E2B_TEMPLATE` (**`templateId`** from `build.dev.ts` / `build.prod.ts`; recommended for ~5s cold start — see `DEPLOY.md`)
- [ ] **E2B repo** — `E2B_REPO_URL` only if the default clone URL should be overridden

### Server / routing

- [ ] **Root directory** — `apps/web` or `with-mcp-apps/apps/web` so `vercel.json` reaches the monorepo root for `pnpm install`
- [ ] **Function timeouts** — Long routes use `maxDuration` (see `DEPLOY.md`); confirm **Vercel plan** allows enough duration (e.g. provision / download / agent)

### Optional product / hosted MCP

- [ ] **Default MCP list** — `NEXT_PUBLIC_DEFAULT_MCP_SERVERS` and/or `DEFAULT_MCP_SERVERS` (`[]` vs hosted URL)

### Branding & copy (public env)

- [ ] **Header** — `NEXT_PUBLIC_HEADER_*` / `NEXT_PUBLIC_GITHUB_REPO_URL` if defaults are wrong for this deployment
- [ ] **Chat starters** — `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` when the final three prompts are decided (see `HANDOFF.md`)

---

## Smoke test after deploy

- [ ] Home loads; logo + header links match intent
- [ ] Chat sends; agent responds (`OPENAI_API_KEY` valid)
- [ ] If E2B enabled: provision completes; tools appear after refresh
- [ ] Download **`.tar.gz`** works for a running sandbox; optional **full kit** filename `mcp-app-kit-*.tar.gz` when merge succeeds

---

## Review before sign-off

- [ ] **README** — Accurate for this repo (stack, scripts, E2B `templateId`, lockfile)
- [ ] **DEPLOY.md** — Matches your Vercel layout and env set
- [ ] **`.env.example`** — Complete for optional vars; file tracked
- [ ] **End-to-end** — One full path: chat → provision (if E2B) → tools → download
- [ ] **Vendor marks** — CopilotKit name/logo meets design/legal bar if required

**Import walkthrough:** [`DEPLOY.md`](DEPLOY.md).

---

_Stakeholder handoff (shipped list, CopilotKit asks): [`HANDOFF.md`](HANDOFF.md)._
