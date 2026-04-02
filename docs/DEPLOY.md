# Deploying MCP UI Studio on Render

Production hosting uses **[Render](https://render.com)** as a **Node Web Service** (`next start`). This app is **not** a static site: it needs API routes, streaming, and SSR.

**Infrastructure as code:** optional root **`render.yaml`** Blueprint defines build/start commands and env var *keys* (secrets use `sync: false` — set values in the Render dashboard).

---

## Prerequisites

- A [Render account](https://dashboard.render.com)
- The repo on GitHub / GitLab / Bitbucket (can be private)
- Environment variables ready (see [Step 3](#step-3--environment-variables))

---

## Step 0 — Clean up for production (optional)

Before deploying a public-facing instance, you may want to remove internal documentation:

1. **Delete the `docs/` folder** — internal planning and handoff notes.
2. **Update `.gitignore`** to exclude docs in future commits (optional):
   ```
   docs/
   ```
3. **Update `README.md`** — drop references to internal-only doc paths if you removed `docs/`.

---

## Step 1 — Push to Git

From the monorepo root (PowerShell):

```powershell
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USER/your-repo.git
git push -u origin main
```

If you already have a remote, push as usual.

---

## Step 2 — Create the Web Service on Render

1. **New → Web Service** → connect the repository.

2. **Root Directory** — **critical for this monorepo**
   - Leave **empty** if the Git repo root is **`with-mcp-apps`** (folder that contains **`pnpm-lock.yaml`**).
   - If the Git root is a *parent* folder, set Root Directory to **`with-mcp-apps`**.
   - **Do not** set Root Directory to **`apps/web` alone** — Render [does not ship files outside the service root](https://render.com/docs/monorepo-support#setting-a-root-directory), so the workspace lockfile and install would break.

3. **Runtime:** **Node**. Set **Node 20 or 22** (e.g. env **`NODE_VERSION=22`** — see [Node version](https://render.com/docs/node-version)).

4. **Build Command:**

   ```bash
   corepack enable && corepack prepare pnpm@10.13.1 --activate && pnpm install --frozen-lockfile && pnpm --filter web build
   ```

   If `corepack` fails on the image:

   ```bash
   npm install -g pnpm@10 && pnpm install --frozen-lockfile && pnpm --filter web build
   ```

5. **Start Command:**

   ```bash
   pnpm --filter web start
   ```

   Render sets **`PORT`**; **`next start`** uses it automatically.

6. **Blueprint alternative:** connect **`render.yaml`** at the monorepo root ([Blueprints](https://render.com/docs/infrastructure-as-code)) — then fill secret values in the dashboard after sync.

---

## Step 3 — Environment variables

In the service → **Environment**:

### Required

| Name | Value | Notes |
|------|-------|-------|
| `OPENAI_API_KEY` | `sk-proj-...` | Agent / Mastra |

### Highly recommended (E2B)

| Name | Value | Notes |
|------|-------|-------|
| `E2B_API_KEY` | `e2b_...` | [e2b.dev/dashboard](https://e2b.dev/dashboard) |
| `E2B_TEMPLATE` | `templateId` | Pre-built template → fast cold start (~5s vs ~60–90s). See [Creating an E2B template](#creating-an-e2b-template). |

### Optional

| Name | Notes |
|------|--------|
| `OPENAI_MODEL` | e.g. `gpt-5.2`, `gpt-4.1`, `gpt-4o` — default **`gpt-5.2`** |
| `E2B_REPO_URL` | Fallback clone if **`E2B_TEMPLATE`** empty (slower) |
| `DEFAULT_MCP_SERVERS` | JSON array — API fallback; default includes Excalidraw |
| `NEXT_PUBLIC_DEFAULT_MCP_SERVERS` | JSON array — sidebar defaults |
| `NEXT_PUBLIC_HEADER_*`, `NEXT_PUBLIC_GITHUB_REPO_URL` | Branding / header URLs |
| `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` | JSON `[{ "title", "message" }, …]` |
| `MASTRA_AGENT_DEBUG` | `1` — verbose **`/api/mastra-agent`** logs |

**`render.yaml`** lists the same keys: secrets use **`sync: false`** so you set values only in the dashboard (never commit keys).

Copy from **`.env.example`** at the monorepo root for local parity.

---

## Step 4 — Deploy

Trigger a deploy. Render runs **`pnpm install --frozen-lockfile`**, then **`pnpm --filter web build`** (which runs **`prebuild`** → **`pack-download-kit`** → **`next build`**).

First deploy often takes **~2–3 minutes**.

---

## Step 5 — Verify

Open your Render URL:

- MCP App builder (sidebar + chat), header branding
- Starter chips: tic tac toe, tip calculator, dice roller, Try Excalidraw (unless overridden)

**E2B:** message triggers **`provision_workspace`** → **Setting up…** → **Running** → **`refresh_mcp_tools`** → tools in sidebar.

**Download:** full kit **`mcp-app-kit-*.tar.gz`** when merge succeeds; otherwise **`workspace-*.tar.gz`**.

---

## Step 6 — Pre-go-live feature checklist

Run on your **production** Render URL. Keep the browser **Console** open for CSP/network issues while testing widgets.

### Shell, branding, layout

- [ ] Page loads; no blank screen or error spam.
- [ ] Header: **Powered by** logo → CopilotKit GitHub; **CopilotKit docs** pill → docs; secondary icon matches env if customized.
- [ ] **Mobile:** Chat / Tools tabs; tool detail in **modal**.
- [ ] **Desktop:** sidebar + chat; composer does not cover the last messages.

### Chat and starters

- [ ] Welcome + starter chips (defaults or **`NEXT_PUBLIC_CHAT_STARTER_PROMPTS`**).
- [ ] Free-form message streams to completion (if timeouts occur, try a faster model or check Render/plan limits).
- [ ] At least one starter runs end-to-end with E2B.

### MCP servers

- [ ] Default **Excalidraw** (unless env overrides).
- [ ] Add / remove server; introspection errors are clear; **Reconnect** works after fixes.

### Agent + E2B + widgets

- [ ] Provision → **Running**; tools after **`refresh_mcp_tools`**; built widget usable in iframe without endless CSP errors.

### Excalidraw

- [ ] **Try Excalidraw** starter: no blocked **script-src** / **style-src** / **font-src** for normal CDN loads.

### Downloads + test chips

- [ ] **`show_mcp_test_prompts`** chips append messages.
- [ ] **`restart_server`** / sidebar download → **`mcp-app-kit-*.tar.gz`** when **`prebuild`** succeeded on deploy.

### Production checks

- [ ] **HTTPS** and expected hostname / custom domain.
- [ ] Secrets only in Render env — **`NEXT_PUBLIC_*`** is client-visible.

### Automated tests (optional)

From **`apps/web`** with `.env`: **`pnpm run test:download-kit`** / **`test:e2b-download`** (see README).

---

## Creating an E2B template

Pre-built template ≈ **~5s** cold start vs **~60–90s** without.

**Prerequisite:** **`E2B_API_KEY`** in **`.env`** at monorepo root (local) or Render env.

| Goal | Command |
|------|---------|
| **Dev** | `cd apps/mcp-use-server && npx tsx --env-file=../../.env build.dev.ts` |
| **Prod** | `cd apps/mcp-use-server && npx tsx --env-file=../../.env build.prod.ts` |

Copy **`templateId`** from the build log → set **`E2B_TEMPLATE`** on Render. Template **name** ≠ **`templateId`**.

**Rebuild** after changes to **`apps/mcp-use-server`** `package.json`, tools, widgets, or **`template.ts`**.

---

## Autodeploys and monorepos

With root = full monorepo, every push may rebuild. Narrow triggers with Render [**build filters**](https://render.com/docs/monorepo-support#setting-build-filters), e.g. include `apps/web/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`.

---

## Custom domain

Render service → **Settings → Custom Domains** → follow DNS instructions.

---

## Notes vs Vercel (historical)

**`apps/web/vercel.json`** and route **`export const maxDuration`** are for **Vercel** only; Render ignores them. On Render you run a long-lived Node process — no Vercel Hobby 10s serverless cap, but still validate long agent streams in production.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build: cannot resolve **`@/...`** or missing workspace | Service root must be **pnpm monorepo root** (with **`pnpm-lock.yaml`**), not **`apps/web`** only. |
| **`pnpm install`** / lockfile errors | Commit **`pnpm-lock.yaml`**; use **`--frozen-lockfile`** as in **`render.yaml`**. |
| **`E2B_API_KEY`** missing | Set in Render **Environment** for the web service. |
| Sandbox **500** | E2B quota / billing. |
| Provision **60–90s** | Set **`E2B_TEMPLATE`** to a valid **`templateId`**. |
| Tools missing after provision | Rebuild E2B template after **`mcp-use-server`** changes. |
| Full kit is MCP-only | Build logs must show **`pack-download-kit`** / **`prebuild`** success. |
| CORS / E2B MCP | Sandboxes are usually CORS-open; align origins if you proxy. |
| Streaming cuts off | Check Render logs, model latency, and service plan. |

---

## See also

- **[`docs/RENDER.md`](RENDER.md)** — short Render-focused pointers (defers here for full steps).
- **[`render.yaml`](../render.yaml)** — Blueprint template at repo root.
