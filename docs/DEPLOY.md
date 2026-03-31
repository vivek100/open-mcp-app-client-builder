# Deploying MCP UI Studio to Vercel

## Prerequisites

- A [Vercel account](https://vercel.com) (free tier works; long-running API routes need **Pro** for >10s timeout)
- The repo pushed to GitHub / GitLab / Bitbucket (can be private)
- Environment variables ready (see below)

---

## Step 0 — Clean up for production (optional)

Before deploying a public-facing instance, you may want to remove internal documentation:

1. **Delete the `docs/` folder** — contains internal planning, handoff notes, and implementation details not needed in production.

2. **Update `.gitignore`** to exclude docs in future commits (if you keep a separate dev branch):
   ```
   # Internal docs (remove for production)
   docs/
   ```

3. **Update `README.md`** — remove references to internal docs (`docs/PLAN.md`, `docs/HANDOFF.md`, etc.) and keep only user-facing setup instructions.

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

If you already have a remote and **`main`**, skip **`git init`** and push as usual.

---

## Step 2 — Import project on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository** and select your repo
3. Vercel will auto-detect **Next.js** — keep the defaults
4. Set **Root Directory**:
   - If repo root is **`with-mcp-apps`**: set to **`apps/web`**
   - If repo root is a parent folder: set to **`with-mcp-apps/apps/web`**
5. **`apps/web/vercel.json`** sets **Install Command** to **`cd ../.. && pnpm install --frozen-lockfile`**. Leave **Build Command** and **Output Directory** on defaults.

---

## Step 3 — Set environment variables

In the Vercel project → **Settings → Environment Variables**:

### Required

| Name | Value | Notes |
|------|-------|-------|
| `OPENAI_API_KEY` | `sk-proj-...` | **Required** — Agent / Mastra |

### Highly Recommended (E2B)

| Name | Value | Notes |
|------|-------|-------|
| `E2B_API_KEY` | `e2b_...` | From [e2b.dev/dashboard](https://e2b.dev/dashboard) — enables sandbox provisioning |
| `E2B_TEMPLATE` | `templateId` string | **Strongly recommended** — pre-built template for fast cold start (~5s vs ~60-90s). See [Creating an E2B Template](#creating-an-e2b-template) below |

### Optional

| Name | Value | Notes |
|------|-------|-------|
| `OPENAI_MODEL` | e.g. `gpt-5.2`, `gpt-4.1`, `gpt-4o` | Defaults to **`gpt-5.2`** |
| `E2B_REPO_URL` | URL | Fallback clone when **`E2B_TEMPLATE`** is empty (slower). Default: `mcp-use-server-template` repo |
| `DEFAULT_MCP_SERVERS` | JSON array | API fallback when no header. Default: Excalidraw |
| `NEXT_PUBLIC_DEFAULT_MCP_SERVERS` | JSON array | Initial sidebar list. Default: Excalidraw |
| `NEXT_PUBLIC_HEADER_*` | Various | Docs URL, labels, secondary CTA |
| `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` | JSON | Custom starter chips |
| `MASTRA_AGENT_DEBUG` | `1` | Verbose agent logs |

> **Tip:** Vercel bulk import: paste **`KEY=value`** lines.

---

## Step 4 — Deploy

Click **Deploy**. Vercel will:

1. **`pnpm install --frozen-lockfile`** at the monorepo root
2. **`next build`** in **`apps/web`** (runs **`prebuild`** first to create the download kit)

First deploy takes **~2–3 minutes**.

---

## Step 5 — Verify

Open the deployment URL:

- MCP App builder layout (sidebar + chat), branded header
- Chat welcome + starter chips (defaults: tic tac toe, tip calculator, dice roller, Excalidraw test)

**E2B flow:**

1. Send a message that triggers **`provision_workspace`**
2. Sidebar shows **Setting up…** then **Running** (faster with **`E2B_TEMPLATE`**)
3. **`refresh_mcp_tools`** → tools appear in the sidebar

**Download:**

- Full kit download returns **`mcp-app-kit-*.tar.gz`** (merged monorepo + workspace)
- If base tarball missing, falls back to **MCP-only** **`workspace-*.tar.gz`**

---

## Creating an E2B Template

Using a pre-built E2B template dramatically improves cold start time (**~5s** vs **60-90s** without).

### Prerequisites

- **`E2B_API_KEY`** in **`.env`** at the monorepo root

### Build commands

| Goal | Command |
|------|---------|
| **Dev** snapshot | `cd apps/mcp-use-server && npx tsx --env-file=../../.env build.dev.ts` |
| **Prod** snapshot | `cd apps/mcp-use-server && npx tsx --env-file=../../.env build.prod.ts` |

Both commands output a **`templateId`** in the console log. Copy this value and set **`E2B_TEMPLATE=<templateId>`** in Vercel.

> **Note:** The template **name** (alias like `mcp-use-server`) is not the same as **`templateId`**. Use the ID.

**When to rebuild:**
- After changing **`apps/mcp-use-server/package.json`**
- After modifying tools or widgets in the template
- After updating start commands in **`template.ts`**

First build takes **~2–3 minutes**; subsequent builds are faster with layer cache.

---

## Timeouts (Vercel)

**`apps/web/vercel.json`** sets **`maxDuration: 60`** for agent routes:

- `/api/mastra-agent`
- `/api/copilotkit`
- `/api/workspace/download`

**Hobby** plans cap at **10s** — use **Pro** if agent runs or downloads time out.

---

## Custom domain (optional)

Vercel → **Domains** → add DNS per instructions.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails: cannot resolve **`@/...`** | Root Directory must be **`apps/web`** |
| **`E2B_API_KEY`** missing at runtime | Set for **Production** in Vercel env vars |
| Sandbox provision **500** | E2B quota / billing; check dashboard |
| Provision takes **60–90s** | **`E2B_TEMPLATE`** empty or wrong — rebuild template |
| Tools missing after provision | Rebuild E2B template after changing **`apps/mcp-use-server`** |
| Full kit download is MCP-only | Confirm **`prebuild`** ran; check build logs for **`pack-download-kit`** |
| CORS from E2B MCP URL | E2B sandboxes are generally CORS-open; if you proxy, align origins |
| `ECONNRESET` / timeout errors | Increase function timeout (Pro plan) or use faster model |
