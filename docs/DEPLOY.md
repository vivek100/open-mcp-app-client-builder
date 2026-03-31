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

## Step 6 — Pre-go-live feature checklist

Run these on your **Production** (or final Preview) URL before you share the app widely. Use a normal browser profile (no stale cache), and keep **dev tools → Console** open for CSP / network errors while testing widgets.

### Shell, branding, and layout

- [ ] **Page loads** without a blank screen or repeated error toasts.
- [ ] **Header:** title **MCP App builder**, **Powered by** logo opens [CopilotKit on GitHub](https://github.com/CopilotKit/CopilotKit), **CopilotKit docs** pill opens [docs](https://docs.copilotkit.ai/), secondary icon matches your **`NEXT_PUBLIC_GITHUB_REPO_URL`** / **`NEXT_PUBLIC_HEADER_SECONDARY_CTA_URL`** if you customized them.
- [ ] **Mobile (narrow viewport):** **Chat** and **Tools** tabs both work; tool detail opens in a **modal** (not a broken third column).
- [ ] **Desktop:** sidebar + chat column layout; composer does not hide the latest messages.

### Chat and starter prompts

- [ ] **Welcome** and **starter chips** appear (default four: Tic tac toe, Tip calculator, Dice roller, Try Excalidraw — or your **`NEXT_PUBLIC_CHAT_STARTER_PROMPTS`** JSON).
- [ ] **Send a short free-form message** — assistant replies and streaming completes without **`ECONNRESET`** / timeout (may require **Vercel Pro** + sufficient **`maxDuration`** for long runs).
- [ ] **Use at least one starter** end-to-end (see **Agent + E2B** below).

### MCP servers (sidebar)

- [ ] **Default server(s)** appear (built-in **Excalidraw** at `https://mcp.excalidraw.com` unless you overrode **`DEFAULT_MCP_SERVERS`** / **`NEXT_PUBLIC_DEFAULT_MCP_SERVERS`**).
- [ ] **Add a server** — valid HTTP MCP URL + optional `serverId`; list updates and **`x-mcp-servers`** behavior matches expectations on refresh.
- [ ] **Remove a server** — it disappears from the list and does not break the UI.
- [ ] **Introspection errors** — if you use a bad URL, the UI shows a clear state; **Reconnect** (if shown) recovers after fixing the URL.

### Agent + E2B sandbox (full product path)

- [ ] **Provision workspace** — e.g. starter **Tic tac toe** or an explicit message that triggers workspace setup; sidebar shows **Setting up…** then **Running** (much faster with **`E2B_TEMPLATE`** set).
- [ ] **Tool list** — after the agent runs **`refresh_mcp_tools`**, sandbox tools appear in the sidebar and can be opened for **detail + preview**.
- [ ] **Built widget** — agent-created UI renders in the MCP Apps area (iframe) without endless CSP violations for normal **esm.sh** / template assets; user can interact (e.g. tic tac toe moves).

### Excalidraw MCP (default CDN / CSP path)

- [ ] **Try Excalidraw** starter (or equivalent): diagram tool loads styles/scripts from allowed hosts **without** blocked **style-src** / **script-src** / **font-src** errors in the console (CopilotKit **1.54+** + server **`_meta.ui.csp`** where applicable).
- [ ] **Tool result** is visible or actionable (e.g. diagram opens as expected).

### Post-provision UX (tools + downloads)

- [ ] **`show_mcp_test_prompts`** — after provision / tool changes, **clickable test chips** appear in chat when the agent emits them; chips **append messages** and drive quick server tests.
- [ ] **`restart_server` flow** — after server restart in chat, **Download full app kit** (or equivalent) works from the tool UI **or** from the **sidebar download** on the running workspace row.
- [ ] **Download artifact** — filename **`mcp-app-kit-*.tar.gz`** when full-kit merge succeeds; verify archive opens locally. If you only get **`workspace-*.tar.gz`**, confirm **`prebuild`** / **`pack-download-kit`** ran on the deployed build (see [Troubleshooting](#troubleshooting)).

### Production-only checks

- [ ] **HTTPS** and correct **hostname** (custom domain if configured).
- [ ] **Secrets** — Production env has **`OPENAI_API_KEY`**, **`E2B_*`** as needed; no secrets in client bundles (only **`NEXT_PUBLIC_*`** is exposed).
- [ ] Optional: **`MASTRA_AGENT_DEBUG=1`** on a **Preview** deploy only — not required for final Production unless you need verbose server logs.

### Automated tests (optional, from clone)

From **`apps/web`** with `.env` configured, you can run **`pnpm run test:download-kit`** / **`pnpm run test:e2b-download`** (see root **README** scripts) against your stack — useful for CI or pre-release smoke, not a substitute for manual UI checks above.

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
