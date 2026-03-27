# CopilotKit <> MCP Apps Starter

**Primary handoff document (share with CopilotKit / stakeholders): [`docs/TRACKER.md`](docs/TRACKER.md)** — fixes shipped, production checklist, env defaults, and review asks.

This repository demonstrates how to integrate MCP Apps with CopilotKit. It uses the [Three.js example](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server) from the official Model Context Protocol organization on GitHub.


https://github.com/user-attachments/assets/8908af31-2b64-4426-9c83-c51ab86256de


## Prerequisites

- Node.js 20+ 
- [pnpm](https://pnpm.io/installation) (recommended)
- OpenAI API Key

> **Note:** This repository ignores lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to avoid conflicts between different package managers. Each developer should generate their own lock file using their preferred package manager. After that, make sure to delete it from the .gitignore.

## Getting Started

1. Install dependencies:
```bash
pnpm i
```

2. Set up environment variables (see `.env.example` for all options):
```powershell
# Copy example and edit with your values
Copy-Item .env.example .env
# Minimum: set OPENAI_API_KEY=sk-proj-... in .env
```

3. Start the MCP Apps server (or use `pnpm dev` from the repo root to start both web and MCP server):
```bash
# From repo root, start both web app and Three.js MCP server:
pnpm dev

# Or run only the Three.js MCP server (e.g. from apps/threejs-server):
cd apps/threejs-server
pnpm i
pnpm dev
```

4. Start the development server:
```bash
# Using pnpm
pnpm dev

# Using npm
npm run dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

## Available Scripts
The following scripts can also be run using your preferred package manager:
- `dev` - Starts both UI and agent servers in development mode
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `lint` - Runs ESLint for code linting

## Agent and UI

The web app is titled **MCP App builder** (subtitle **Powered by CopilotKit**), shows the CopilotKit logo from `apps/web/app/image.png`, and uses the Mastra-based agent only (`/api/mastra-agent`). Header links and labels are configurable via `NEXT_PUBLIC_HEADER_*` (docs URL, primary/secondary labels, secondary URL — or `NEXT_PUBLIC_GITHUB_REPO_URL` for the second link). Chat starter chips use **`NEXT_PUBLIC_CHAT_STARTER_PROMPTS`** (JSON array of `{ title, message }`) with **built-in defaults if unset** — see `.env.example` and **`docs/TRACKER.md`** (defaults table). The original CopilotKit route remains at `apps/web/app/api/copilotkit/route.ts` for reference.

**Starter prompts** in the chat are configured with CopilotKit’s `useCopilotChatSuggestions` (`apps/web/app/components/ChatSuggestions.tsx`) so v2 `CopilotChat` shows the framework’s suggestion pills instead of a separate row of buttons above the chat.

- **restart_server tool**: When the agent runs `restart_server`, the chat UI supports downloading the current workspace (MCP server code) as **`.tar.gz`** (hosted-friendly blob download).

### Duplicate React keys (Mastra agent) — RCA and fix

When the Mastra agent streams responses, you may see React warnings: *"Encountered two children with the same key"* (e.g. same UUID and same UUID with `-custom-after`). **Root cause:** Mastra reuses the same `messageId` for (1) the parent of tool calls (`TOOL_CALL_START.parentMessageId`) and (2) all `TEXT_MESSAGE_*` events in the run. CopilotKit creates messages from both: from text events (id = `messageId`) and from tool-call events (id = `parentMessageId`). If a text message with id `X` is emitted first and then a tool call with `parentMessageId X` is emitted, the runtime can end up with two messages with id `X`. The UI keys messages (and custom blocks as `id-custom-after`), so duplicate ids produce duplicate key errors. **Fix (in `apps/web/app/api/mastra-agent/route.ts`):** We track every id already emitted (as `messageId` or `parentMessageId`). We remap `TEXT_MESSAGE_*` when `messageId` collides with a seen `parentMessageId`, and we remap `TOOL_CALL_START.parentMessageId` when that id was already emitted, so the stream never creates two messages with the same id.

## Option D: Dynamic MCP UI (add servers, see tools, test)

The app includes a **left panel** for managing MCP servers and testing tools:

- **MCP servers**: Add or remove MCP servers by endpoint URL (and optional server ID). The list is synced to the agent via `x-mcp-servers` and persisted in memory. The default Three.js server (`http://localhost:3108/mcp`) is pre-configured. The sidebar uses minimal chrome: **+ Add** for new servers (no list-level Reset); the top bar shows branding + header CTAs.
- **Test MCP tools**: Suggested prompts to try in the chat (e.g. "Show me a rotating cube with Three.js", "Use learn_threejs to get documentation").

To use: run `pnpm dev` from the repo root, open the app, and use the left panel to add servers or follow the test suggestions in the chat.

See [docs/DYNAMIC_MCP.md](docs/DYNAMIC_MCP.md) for more on dynamic MCP options.

### Mobile layout behavior

The web app now has a dedicated small-screen layout:

- **Chat-first on mobile**: chat is shown as the primary view by default.
- **Panel switcher**: on smaller screens, `Chat`, `Servers & Tools`, and `Preview` are available via a top switcher menu instead of showing all columns at once.
- **Desktop unchanged**: the full 3-column studio remains active on larger (`md+`) screens.
- **Chat spacing fixes**: mobile message padding and scroll spacing are adjusted so the composer does not hide recent user/AI messages.
- **Composer overlap fix**: in the studio chat, bottom scrolling now keeps the latest message visible above the input instead of being covered by it.
- **Sticky composer buffer**: the chat list now adds an extra bottom spacer after CopilotKit's computed padding, so the newest message remains readable when fully scrolled down.
- **Safety fallback**: if the mobile view state is ever invalid, chat is rendered by default so the screen never appears blank.

## E2B Sandbox Template

The agent provisions isolated MCP server sandboxes via [E2B](https://e2b.dev). To keep provisioning fast (~5s instead of 60-90s), a custom E2B template is used that has all dependencies pre-installed.

### What the template includes

The template is defined in [apps/mcp-use-server/template.ts](apps/mcp-use-server/template.ts) and bakes in:
- Node.js LTS base image
- All `node_modules` from `npm install`
- Pre-built widget bundles from `npm run build`
- Auto-starts the MCP server on port 3109 when the sandbox boots

### Rebuilding the template

Rebuild when you add/change npm packages or add new tools to the MCP server:

```bash
cd apps/mcp-use-server
npx tsx --env-file=../../.env build.dev.ts
```

This publishes a new snapshot as `mcp-use-server-dev` and prints a template ID. Copy that ID into `E2B_TEMPLATE` in your `.env` (and Vercel environment variables if deployed).

> The current template ID is stored in `.env` as `E2B_TEMPLATE`.

### Environment variables required

| Variable | Description |
|----------|-------------|
| `E2B_API_KEY` | From [e2b.dev/dashboard](https://e2b.dev/dashboard) |
| `E2B_TEMPLATE` | Template ID — set after running `build.dev.ts` |
| `E2B_REPO_URL` | Fallback GitHub repo URL (used only if `E2B_TEMPLATE` is blank) |

### Hosting on Vercel

You can push this app to a **private** (or public) repo and deploy on [Vercel](https://vercel.com):

1. Push the `with-mcp-apps` folder to a GitHub/GitLab/Bitbucket repo.
2. In Vercel, import the repo and set **Root Directory** to `apps/web` (or `with-mcp-apps/apps/web` if the repo root is the parent folder).
3. In Vercel → Settings → Environment Variables, set at least **`OPENAI_API_KEY`**. Optionally set `E2B_API_KEY`, `E2B_TEMPLATE`, and `DEFAULT_MCP_SERVERS` / `NEXT_PUBLIC_DEFAULT_MCP_SERVERS` for hosted MCP servers (see [docs/DEPLOY.md](docs/DEPLOY.md)).
4. Deploy. The MCP server list starts empty (or from `NEXT_PUBLIC_DEFAULT_MCP_SERVERS`); users can add any openly hosted MCP URL in the sidebar. There is no publicly hosted Three.js MCP endpoint widely available—you can host your own or use another MCP.

See [docs/DEPLOY.md](docs/DEPLOY.md) for full Vercel deployment steps and troubleshooting.

### Agent tool pattern (MCP UI Studio preview)

The coding agent (see `apps/web/app/api/copilotkit/route.ts` and `apps/web/app/api/mastra-agent/route.ts`) is instructed to create MCP tools that include **`_meta["ui/previewData"]`** for widget tools. This sample data is used by the Studio sidebar to render a demo preview before any live tool call. Example: `tools/product-search.ts` uses `_meta: { "ui/previewData": { query: "tropical", results: [...] } }`. When adding or changing the agent system prompt, keep this requirement so new tools get a proper sidebar preview.

---

## Documentation

- **Dynamic MCP ("add MCP on the run")**: See [docs/DYNAMIC_MCP.md](docs/DYNAMIC_MCP.md) for how the **open-mcp-client** repo in this workspace adds/removes MCP servers at runtime (Python LangGraph agent + `useCoAgent` + MCPConfigForm), and how to bring that pattern into this app.
- **E2B Workspaces**: See [docs/PLAN.md](docs/PLAN.md) for the overall MCP UI Studio roadmap and [docs/E2B-IMPLEMENTATION.md](docs/E2B-IMPLEMENTATION.md) for a detailed design of running MCP workspaces inside E2B sandboxes (provisioning, command execution, MCP endpoints, and download flow).

The main UI component is in `apps/web/app/page.tsx`. You can:
- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

## 📚 Documentation

- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API
- [MCP Apps Documentation](https://mcpui.dev/guide/introduction) - Learn more about MCP Apps and how to use it

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
