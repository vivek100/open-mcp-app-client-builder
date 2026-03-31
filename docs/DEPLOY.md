# Deploying MCP UI Studio to Vercel

## Prerequisites

- A [Vercel account](https://vercel.com) (free tier works; long-running API routes may need **Pro** — see **Timeouts** below)
- The repo pushed to GitHub / GitLab / Bitbucket (can be private)
- Environment variables ready (see below). Copy from **`.env.example`** at the monorepo root and fill in values.

---

## Step 1 — Push to GitHub

If the project is **not** yet in Git, from the monorepo root (PowerShell):

```powershell
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USER/your-repo.git
git push -u origin main
```

If you already have a remote and **`main`**, skip **`git init`** and only push as usual.

---

## Step 2 — Import project on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository** and select your repo (private repos are supported)
3. Vercel will auto-detect **Next.js** — keep the defaults unless you know you need overrides
4. Set **Root Directory**:
   - Repo root is **`with-mcp-apps`**: **`apps/web`**
   - Repo root is a parent folder (e.g. **`mcpUiTemplate`**): **`with-mcp-apps/apps/web`**
5. **`apps/web/vercel.json`** sets **Install Command** to **`cd ../.. && pnpm install --frozen-lockfile`** (install from the **pnpm workspace root**). Leave **Build Command** and **Output Directory** on the defaults (**`next build`**, **`.next`**).

---

## Step 3 — Set environment variables

In the Vercel project → **Settings → Environment Variables**, add at least:

| Name | Value | Required | Notes |
|------|-------|----------|-------|
| `OPENAI_API_KEY` | `sk-proj-...` | **Yes** | Agent / Mastra |
| `E2B_API_KEY` | `e2b_...` | If using E2B | [e2b.dev/dashboard](https://e2b.dev/dashboard) — sandbox provisioning |
| `E2B_TEMPLATE` | `templateId` string | **Recommended** | From **`apps/mcp-use-server`** `build.dev.ts` / `build.prod.ts` output (`BuildInfo.templateId`). Fast cold start (~5s) |
| `E2B_REPO_URL` | URL | No | Fallback clone when **`E2B_TEMPLATE`** is empty. Code default: **`https://github.com/vivek100/mcp-use-server-template`** |

**Optional — default MCP servers (hosted)**

| Name | Value | Notes |
|------|-------|-------|
| `DEFAULT_MCP_SERVERS` | JSON array | API fallback when no header |
| `NEXT_PUBLIC_DEFAULT_MCP_SERVERS` | JSON array | Initial sidebar list. Use **`[]`** for empty |

**Optional — header & chat (no secrets)**

| Name | Notes |
|------|--------|
| `NEXT_PUBLIC_HEADER_*` | Docs URL, labels, secondary CTA |
| `NEXT_PUBLIC_GITHUB_REPO_URL` | Alias for secondary URL |
| `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` | JSON starter chips |

**Optional — debugging**

| Name | Notes |
|------|--------|
| `MASTRA_AGENT_DEBUG` | Set to **`1`** for verbose **`/api/mastra-agent`** logs (per-request MCP load, etc.) |

There is no widely available **public Three.js MCP** HTTP endpoint; use your own URL or registries such as [mcp.pizza](https://www.mcp.pizza).

> **Tip:** Vercel bulk import: paste **`KEY=value`** lines.

---

## Step 4 — Deploy

Click **Deploy**. Vercel will:

1. **`pnpm install --frozen-lockfile`** at the monorepo root (via **`vercel.json`**)
2. **`next build`** in **`apps/web`**, which runs **`prebuild`** first:
   - **`node scripts/pack-download-kit.mjs`** → **`apps/web/.download-kit/base.tar.gz`** (monorepo shell for **full app kit** download; gitignored locally but traced into the serverless bundle via **`next.config.ts`** **`outputFileTracingIncludes`**)
   - then **`next build`**

First deploy often takes **~2–3 minutes**.

---

## Step 5 — Verify

Open the deployment URL:

- MCP App builder layout (sidebar + chat), branded header
- Chat welcome + starter chips (**two** defaults, or **`NEXT_PUBLIC_CHAT_STARTER_PROMPTS`**)

**E2B flow**

1. Send a message that triggers **`provision_workspace`**
2. Sidebar **Setting up…** then **Running** (faster with **`E2B_TEMPLATE`**)
3. **`refresh_mcp_tools`** → tools appear in the sidebar

**Download**

- With **`prebuild`** succeeding on Vercel, **full kit** download should return **`mcp-app-kit-*.tar.gz`**; if the base tarball is missing or merge fails, the API falls back to **MCP-only** **`workspace-*.tar.gz`**.

---

## Monorepo note

**`pnpm-lock.yaml`** must be committed at the workspace root so **`--frozen-lockfile`** works.

If **Root Directory** is **`with-mcp-apps/apps/web`**, **`vercel.json`** still **`cd ../..`** to reach the monorepo root — ensure that path is correct for your repo layout.

---

## Timeouts (Vercel)

These routes set **`export const maxDuration = 300`** (5 minutes) where needed:

- **`/api/mastra-agent`**
- **`/api/copilotkit`**
- **`/api/workspace/provision`**
- **`/api/workspace/download`**
- **`/api/mcp-introspect`**

**Hobby** plans cap serverless duration below 300s — use **Pro** (or adjust limits in the Vercel dashboard) if long downloads or agent runs time out.

---

## Custom domain (optional)

Vercel → **Domains** → add DNS per instructions.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails: cannot resolve **`@/...`** | Root Directory must be **`apps/web`** (or **`…/with-mcp-apps/apps/web`**) |
| **`E2B_API_KEY`** missing at runtime | Set for **Production** (and Preview if needed) in Vercel |
| Sandbox provision **500** | E2B quota / billing; check dashboard |
| Provision **60–90s** | **`E2B_TEMPLATE`** empty or wrong — rebuild template and set **`templateId`** |
| Tools missing after provision | Rebuild E2B template after changing **`apps/mcp-use-server`** |
| Full kit download is MCP-only only | Confirm **`next build`** ran **`prebuild`**; check build logs for **`pack-download-kit`**; see **`docs/HANDOFF.md`** (full kit behavior) |
| Many **`POST /api/mastra-agent`** on first load (historical) | Fixed in app by a **single** **`CopilotChat`** mount (**`app/page.tsx`**); if you forked old layout, avoid duplicating chat across hidden + visible branches |
| CORS from E2B MCP URL | E2B sandboxes are generally CORS-open for MCP; if you proxy, align origins |

---

## E2B template: scripts and when to rebuild

The template is defined in **`apps/mcp-use-server/template.ts`**. Rebuild when you change **`package.json`**, tools, widgets, or start commands there.

**Prerequisite:** **`E2B_API_KEY`** in **`.env`** at the monorepo root (or exported in the shell).

| Goal | Command | Output |
|------|---------|--------|
| **Dev** snapshot (iterate often) | `cd apps/mcp-use-server && npx tsx --env-file=../../.env build.dev.ts` | Publishes template name **`mcp-use-server-dev`**; copy **`templateId`** from the log |
| **Prod** snapshot | `cd apps/mcp-use-server && npx tsx --env-file=../../.env build.prod.ts` | Same as dev for env: monorepo **`.env`** at repo root; publishes template name **`mcp-use-server`**; copy **`templateId`** from the log |

Set **`E2B_TEMPLATE=<templateId>`** locally and in Vercel. The **template name** (alias) is **not** the same as **`templateId`**.

First build often **~2–3 minutes**; later builds may be faster with layer cache.
