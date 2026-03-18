/**
 * E2B + MCP Workspace Integration Test
 * Run: node test-e2b.mjs
 *
 * Tests:
 *  1. E2B API key + sandbox creation
 *  2. File write / read / edit inside sandbox
 *  3. Shell exec inside sandbox
 *  4. MCP dev server starts and is reachable
 *  5. MCP introspect via /api/mcp-introspect (requires Next.js running)
 */

import { Sandbox } from "e2b";
import { readFileSync } from "fs";

// ── Load env vars from .env ────────────────────────────────────────────────
const envText = readFileSync("../../.env", "utf-8");
const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);
process.env.E2B_API_KEY = env.E2B_API_KEY;
process.env.E2B_REPO_URL = env.E2B_REPO_URL;

const TEMPLATE_ID = env.E2B_TEMPLATE;
const WORKSPACE_PATH = "/home/user/workspace";

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`  ✓ ${label}`);
  passed++;
}
function fail(label, err) {
  console.error(`  ✗ ${label}`);
  console.error(`    ${err?.message ?? err}`);
  failed++;
}

// ── TEST 1: Create sandbox ────────────────────────────────────────────────
console.log("\n[1] E2B Sandbox creation");
let sandbox;
try {
  // Use custom template with pre-installed deps for fast cold start
  console.log(`  Using template: ${TEMPLATE_ID}`);
  sandbox = await Sandbox.create(TEMPLATE_ID, { timeoutMs: 60 * 60_000 });
  ok(`Sandbox created — ID: ${sandbox.sandboxId}`);
} catch (e) {
  fail("Sandbox.create()", e);
  console.error("\nFATAL: Cannot continue without a sandbox.");
  process.exit(1);
}

// ── TEST 2: File write ────────────────────────────────────────────────────
console.log("\n[2] File operations");
try {
  await sandbox.files.write("/home/user/hello.txt", "hello from test");
  ok("files.write()");
} catch (e) {
  fail("files.write()", e);
}

// ── TEST 3: File read ─────────────────────────────────────────────────────
try {
  const content = await sandbox.files.read("/home/user/hello.txt");
  if (content === "hello from test") ok("files.read() — content matches");
  else fail("files.read()", new Error(`Got: "${content}"`));
} catch (e) {
  fail("files.read()", e);
}

// ── TEST 4: File edit (read → replace → write) ────────────────────────────
try {
  const original = await sandbox.files.read("/home/user/hello.txt");
  const edited = original.replace("hello", "goodbye");
  await sandbox.files.write("/home/user/hello.txt", edited);
  const result = await sandbox.files.read("/home/user/hello.txt");
  if (result === "goodbye from test") ok("edit (read+replace+write) — content matches");
  else fail("edit", new Error(`Got: "${result}"`));
} catch (e) {
  fail("edit", e);
}

// ── TEST 5: exec foreground ───────────────────────────────────────────────
console.log("\n[3] Shell exec");
try {
  const r = await sandbox.commands.run("echo 'exec works'");
  if (r.stdout.trim() === "exec works") ok(`commands.run() foreground — exitCode: ${r.exitCode}`);
  else fail("commands.run()", new Error(`stdout: "${r.stdout}"`));
} catch (e) {
  fail("commands.run()", e);
}

// ── TEST 6: Verify workspace files are pre-installed in template ──────────
console.log("\n[4] Verify template workspace (pre-installed, no clone needed)");
try {
  const ls = await sandbox.commands.run(`ls ${WORKSPACE_PATH}`);
  if (ls.exitCode === 0 && ls.stdout.includes("index.ts")) {
    ok(`workspace files present — ${ls.stdout.trim().split("\n").join(", ")}`);
  } else {
    fail("workspace files", new Error(`ls output: ${ls.stdout}`));
  }
} catch (e) {
  fail("workspace check", e);
}

// ── TEST 7: Verify node_modules are pre-installed ─────────────────────────
console.log("\n[5] Verify node_modules are pre-baked (no npm install needed)");
try {
  const nm = await sandbox.commands.run(`ls ${WORKSPACE_PATH}/node_modules | wc -l`);
  const count = parseInt(nm.stdout.trim(), 10);
  if (count > 100) ok(`node_modules present — ${count} packages`);
  else fail("node_modules", new Error(`Only ${count} entries found`));
} catch (e) {
  fail("node_modules check", e);
}

// ── TEST 8: MCP server should already be running (started by setStartCmd) ─
console.log("\n[6] MCP server — should be up immediately (template setStartCmd)");
try {
  const host = sandbox.getHost(3109);
  const mcpPoll = `https://${host}/mcp`;

  // Poll for up to 15s (server starts during Sandbox.create — may need a moment)
  process.stdout.write("    Polling port 3109");
  let ready = false;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    process.stdout.write(".");
    try {
      const probe = await fetch(mcpPoll, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 0, method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } },
        }),
        signal: AbortSignal.timeout(3000),
      });
      if (probe.status !== 502) { ready = true; break; }
    } catch { /* not up yet */ }
  }
  console.log(ready ? " ready!" : " timed out (continuing anyway)");
  if (ready) ok("MCP server is reachable — no clone/install needed");
  else fail("MCP server did not start in time", new Error("port 3109 still closed after 16s"));
} catch (e) {
  fail("server check", e);
}

// ── TEST 9: Reach MCP endpoint ────────────────────────────────────────────
console.log("\n[7] MCP endpoint reachability");
let mcpUrl;
try {
  const host = sandbox.getHost(3109);
  mcpUrl = `https://${host}/mcp`;
  ok(`getHost(3109) → ${mcpUrl}`);
} catch (e) {
  fail("sandbox.getHost(3109)", e);
}

if (mcpUrl) {
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    });
    ok(`MCP endpoint responded — HTTP ${res.status}`);

    // list tools
    const tools = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const toolsJson = await tools.json();
    const toolNames = toolsJson?.result?.tools?.map((t) => t.name) ?? [];
    if (toolNames.length > 0) {
      ok(`tools/list → [${toolNames.join(", ")}]`);
    } else {
      fail("tools/list — no tools returned", new Error(JSON.stringify(toolsJson)));
    }
  } catch (e) {
    fail(`fetch ${mcpUrl}`, e);
  }
}

// ── TEST 10: Write a new tool file ─────────────────────────────────────────
console.log("\n[8] Write new tool file into workspace");
const sampleTool = `import { MCPServer, widget, text } from "mcp-use/server";
import { z } from "zod";

export function register(server: MCPServer) {
  server.tool(
    {
      name: "say-hello",
      description: "Say hello to someone",
      schema: z.object({ name: z.string() }),
      widget: { name: "say-hello", invoking: "Greeting...", invoked: "Hello!" },
    },
    async ({ name }) => widget({ props: { name }, output: text(\`Hello, \${name}!\`) })
  );
}
`;
try {
  await sandbox.files.write(`${WORKSPACE_PATH}/tools/say-hello.ts`, sampleTool);
  const check = await sandbox.files.read(`${WORKSPACE_PATH}/tools/say-hello.ts`);
  if (check.includes("say-hello")) ok("write new tool file + read back");
  else fail("write new tool file", new Error("Content mismatch"));
} catch (e) {
  fail("write new tool file", e);
}

// ── Cleanup ───────────────────────────────────────────────────────────────
console.log("\n[9] Cleanup");
try {
  await sandbox.kill();
  ok(`Sandbox ${sandbox.sandboxId} killed`);
} catch (e) {
  fail("sandbox.kill()", e);
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
