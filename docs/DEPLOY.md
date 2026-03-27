# Deploying MCP UI Studio to Vercel

## Prerequisites

- A [Vercel account](https://vercel.com) (free tier works)
- The repo pushed to GitHub / GitLab / Bitbucket (can be private)
- Environment variables ready (see below). Copy from `.env.example` and fill in values.

---

## Step 1 — Push to GitHub

If not already done (PowerShell):

```powershell
git init
git add .
git commit -m "Initial commit"
# For a private repo, create it in GitHub then:
git remote add origin https://github.com/YOUR_USER/my-mcp-ui-studio.git
git push -u origin main
```

---

## Step 2 — Import project on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **"Import Git Repository"** and select your repo (private repos are supported)
3. Vercel will auto-detect **Next.js** — keep the defaults
4. Set the **Root Directory**:
   - If the repo root is **this folder** (`with-mcp-apps`): set Root Directory to **`apps/web`**
   - If the repo root is the parent (e.g. `mcpUiTemplate`): set Root Directory to **`with-mcp-apps/apps/web`**
5. The `apps/web/vercel.json` already sets **Install Command** to run from the monorepo root (`cd ../.. && pnpm install --frozen-lockfile`). Leave Build Command and Output Directory as auto-detected.

---

## Step 3 — Set environment variables

In the Vercel project → **Settings → Environment Variables**, add at least:

| Name | Value | Required | Notes |
|------|-------|----------|-------|
| `OPENAI_API_KEY` | `sk-proj-...` | **Yes** | Your OpenAI API key for the agent |
| `E2B_API_KEY` | `e2b_...` | If using E2B | From [e2b.dev/dashboard](https://e2b.dev/dashboard) — needed for "Build a widget" sandbox flow |
| `E2B_TEMPLATE` | (template ID) | Optional | Pre-built template for fast sandbox start (~5s). Set after running `apps/mcp-use-server` build; see below |
| `E2B_REPO_URL` | (URL) | No | Hardcoded fallback is `https://github.com/vivek100/mcp-use-server-template` — override only if you use a different repo |

**Optional — default MCP servers (hosted):**

When deployed, the app does not run local MCP servers. You can connect **openly hosted** MCP servers:

| Name | Value | Notes |
|------|-------|-------|
| `DEFAULT_MCP_SERVERS` | JSON array | API fallback when no header. e.g. `[{"type":"http","url":"https://your-mcp.example.com/mcp","serverId":"my-mcp"}]` |
| `NEXT_PUBLIC_DEFAULT_MCP_SERVERS` | JSON array | Initial sidebar list in the UI. e.g. `[{"endpoint":"https://your-mcp.example.com/mcp","serverId":"my-mcp"}]`. Use `[]` to start with no servers; users can add URLs in the sidebar. |

**Optional — header & chat copy (no secrets):**

| Name | Value | Notes |
|------|-------|-------|
| `NEXT_PUBLIC_HEADER_DOCS_URL` | URL | Primary CTA + logo link; defaults to CopilotKit docs |
| `NEXT_PUBLIC_HEADER_PRIMARY_CTA_LABEL` | string | Primary pill text; default `CopilotKit docs` |
| `NEXT_PUBLIC_HEADER_SECONDARY_CTA_URL` | URL | Second pill (e.g. GitHub); alias `NEXT_PUBLIC_GITHUB_REPO_URL`. Default in code: `vivek100/open-mcp-app-client-builder` |
| `NEXT_PUBLIC_HEADER_SECONDARY_CTA_LABEL` | string | Second pill text; default `GitHub` |
| `NEXT_PUBLIC_CHAT_STARTER_PROMPTS` | JSON array | Starter chips; if unset, **two** built-in prompts (tic tac toe, flow charts) — add a third when product decides |

There is no widely available **publicly hosted Three.js MCP** HTTP endpoint; registries like [mcp.pizza](https://www.mcp.pizza) list run-your-own servers. You can host your own or add any public MCP URL in the app’s MCP servers panel after deploy.

> **Tip:** Use Vercel’s bulk import (paste `KEY=value` lines) for multiple variables.

---

## Step 4 — Deploy

Click **Deploy**. Vercel will:
1. Install dependencies (`pnpm install` at the monorepo root, or `npm install` in the web app)
2. Run `next build`
3. Deploy to a `*.vercel.app` URL

First deploy takes ~2 minutes.

---

## Step 5 — Verify

Open the deployed URL. You should see:
- The MCP App builder layout (sidebar + chat) and branded header
- A greeting message in the chat (*MCP App builder* welcome text)
- Starter suggestion chips from CopilotKit (by default **two** prompts, or override with `NEXT_PUBLIC_CHAT_STARTER_PROMPTS`)

Test the full flow:
1. Click a starter suggestion (e.g. **tic tac toe** / **flow charts**) or type your own prompt
2. The agent should call `provision_workspace` → sidebar shows **"Setting up…"** badge
3. After ~5-10s: badge turns green **"Running"** (fast because `E2B_TEMPLATE` has everything pre-installed)
4. New MCP tools appear in the sidebar after the agent calls `refresh_mcp_tools`

---

## Monorepo note

This project is a **pnpm workspace** monorepo. The `apps/web/vercel.json` sets:

- **Install Command:** `cd ../.. && pnpm install --frozen-lockfile` (so dependencies install from the workspace root)

If your repo root is the parent of `with-mcp-apps`, adjust Root Directory to `with-mcp-apps/apps/web`; the install command in `vercel.json` goes up two levels from `apps/web`, so it will reach the monorepo root.

---

## Custom domain (optional)

In Vercel project settings → **Domains**, add your domain and follow the DNS instructions.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails: `Cannot find module '@/lib/workspace'` | Check that Root Directory is set to `with-mcp-apps/apps/web` |
| `E2B_API_KEY` not found at runtime | Ensure env vars are set for **Production** environment in Vercel |
| Sandbox provision fails with 500 | Check E2B dashboard for quota/billing — free tier has limited concurrent sandboxes |
| Provision is slow (~60-90s) | `E2B_TEMPLATE` is blank or wrong — set it to the template ID from `apps/mcp-use-server/build.dev.ts` |
| Tools missing after provision | Template was built before new tools were added — rebuild it (see below) |
| CORS error from E2B sandbox endpoint | E2B sandbox URLs already have CORS open — no action needed |

---

## Rebuilding the E2B template

The `E2B_TEMPLATE` snapshot bakes the `apps/mcp-use-server` directory (including `node_modules` and built widgets) into an E2B image. Rebuild it whenever you:

- Add or update npm packages in `apps/mcp-use-server/package.json`
- Add a new tool or widget to the MCP server

```bash
cd apps/mcp-use-server
npx tsx --env-file=../../.env build.dev.ts
```

The script will print the new template ID when done. Update `E2B_TEMPLATE` in your `.env` (and in Vercel's environment variables) with the new ID.

> The build takes ~2-3 minutes on first run (Docker layer cache misses). Subsequent rebuilds that only change tool files are faster (~1 min) because the Node.js base layer is cached.
