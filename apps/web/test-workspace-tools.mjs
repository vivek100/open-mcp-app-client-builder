/**
 * Workspace Tools Integration Test
 * Run: node test-workspace-tools.mjs
 *
 * Exercises every agent action backed by E2BWorkspaceProvider:
 *  provision    → git clone + npm install + npm run dev
 *  read_file    → sandbox.files.read
 *  write_file   → mkdir -p + sandbox.files.write
 *  edit_file    → read → replace → write (search-must-match)
 *  exec (fg)    → sandbox.commands.run foreground
 *  exec (bg)    → sandbox.commands.run background
 *  get_info     → Sandbox.connect (reconnect by sandboxId)
 *  mcp-introspect → tools/list + readResource for UI tools
 *  download     → tar.gz workspace + downloadUrl (same as e2b.ts; zip often missing in image)
 */

import { Sandbox } from "e2b";
import { readFileSync } from "fs";

// ── env ─────────────────────────────────────────────────────────────────────
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
const TEMPLATE_ID = env.E2B_TEMPLATE || undefined;
const REPO_URL = env.E2B_REPO_URL;
const WORKSPACE_PATH = "/home/user/workspace";

let passed = 0;
let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) {
  console.error(`  ✗ ${label}`);
  console.error(`    ${err?.message ?? err}`);
  failed++;
}

// ── [1] PROVISION (create sandbox + clone + install + start) ─────────────────
console.log("\n[1] provision_workspace — create sandbox");
let sandbox;
try {
  sandbox = TEMPLATE_ID
    ? await Sandbox.create(TEMPLATE_ID, { timeoutMs: 60 * 60_000 })
    : await Sandbox.create({ timeoutMs: 60 * 60_000 });
  ok(`Sandbox created — ID: ${sandbox.sandboxId} (template: ${TEMPLATE_ID ?? "base"})`);
} catch (e) {
  fail("Sandbox.create()", e);
  process.exit(1);
}

console.log("\n[2] provision_workspace — git clone template");
try {
  const clone = await sandbox.commands.run(
    `git clone --depth 1 ${REPO_URL} ${WORKSPACE_PATH}`,
    { timeoutMs: 2 * 60_000 }
  );
  if (clone.exitCode === 0) ok(`git clone — exit 0`);
  else fail("git clone", new Error(`exit ${clone.exitCode}: ${clone.stderr}`));
} catch (e) { fail("git clone", e); }

console.log("\n[3] provision_workspace — npm install");
try {
  const install = await sandbox.commands.run(
    `cd ${WORKSPACE_PATH} && npm install --no-audit --no-fund --prefer-offline`,
    { timeoutMs: 15 * 60_000 }
  );
  if (install.exitCode === 0) ok("npm install — exit 0");
  else fail("npm install", new Error(`exit ${install.exitCode}: ${install.stderr.slice(-400)}`));
} catch (e) { fail("npm install", e); }

console.log("\n[4] provision_workspace — npm run dev (background)");
try {
  await sandbox.commands.run(`cd ${WORKSPACE_PATH} && npm run dev`, { background: true });
  ok("npm run dev started in background");
  // Poll for MCP server
  process.stdout.write("    Waiting for MCP server on :3109");
  const host = sandbox.getHost(3109);
  const mcpUrl = `https://${host}/mcp`;
  let ready = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    process.stdout.write(".");
    try {
      const probe = await fetch(mcpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } } }),
        signal: AbortSignal.timeout(3000),
      });
      if (probe.status !== 502) { ready = true; break; }
    } catch { /* not up yet */ }
  }
  console.log(ready ? " ready!" : " timed out (continuing)");
  if (ready) ok("MCP server reachable after provision");
  else fail("MCP server startup", new Error("port 3109 still closed after 30s"));
} catch (e) { fail("npm run dev", e); }

// ── [5] read_file ─────────────────────────────────────────────────────────────
console.log("\n[5] read_file — read index.ts");
let indexContent = "";
try {
  indexContent = await sandbox.files.read(`${WORKSPACE_PATH}/index.ts`);
  if (indexContent.includes("MCPServer") && indexContent.includes("registerProductSearch")) {
    ok(`read_file index.ts — ${indexContent.length} chars, contains MCPServer + registerProductSearch`);
  } else {
    fail("read_file content check", new Error("Expected MCPServer and registerProductSearch in index.ts"));
  }
} catch (e) { fail("read_file", e); }

// ── [6] write_file — create new tool ─────────────────────────────────────────
console.log("\n[6] write_file — create tools/say-hello.ts");
const newTool = `import { MCPServer, widget, text } from "mcp-use/server";
import { z } from "zod";

export function register(server: MCPServer) {
  server.tool(
    {
      name: "say-hello",
      description: "Say hello to someone",
      schema: z.object({ name: z.string().describe("The name to greet") }),
      widget: { name: "say-hello", invoking: "Greeting...", invoked: "Hello!" },
    },
    async ({ name }) => widget({ props: { name }, output: text(\`Hello, \${name}!\`) })
  );
}
`;
try {
  // Mirror write_file: mkdir -p then write
  const fullPath = `${WORKSPACE_PATH}/tools/say-hello.ts`;
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  await sandbox.commands.run(`mkdir -p "${dir}"`);
  await sandbox.files.write(fullPath, newTool);
  const check = await sandbox.files.read(fullPath);
  if (check.includes("say-hello") && check.includes("widget")) {
    ok("write_file tools/say-hello.ts — content verified");
  } else {
    fail("write_file content", new Error("Written content does not match"));
  }
} catch (e) { fail("write_file", e); }

// ── [7] edit_file — add import + register to index.ts ────────────────────────
console.log("\n[7] edit_file — patch index.ts to register say-hello");
try {
  // First edit: add import
  const importSearch = `// ADD NEW TOOL IMPORTS HERE`;
  const importReplace = `import { register as registerSayHello } from "./tools/say-hello";\n// ADD NEW TOOL IMPORTS HERE`;
  if (!indexContent.includes(importSearch)) {
    fail("edit_file (import)", new Error(`Search string not found: "${importSearch}"`));
  } else {
    const afterImport = indexContent.replace(importSearch, importReplace);
    await sandbox.files.write(`${WORKSPACE_PATH}/index.ts`, afterImport);

    // Second edit: add registration
    const regSearch = `// ADD NEW TOOL REGISTRATIONS HERE`;
    const regReplace = `registerSayHello(server);\n// ADD NEW TOOL REGISTRATIONS HERE`;
    const current = await sandbox.files.read(`${WORKSPACE_PATH}/index.ts`);
    if (!current.includes(regSearch)) {
      fail("edit_file (register)", new Error(`Search string not found: "${regSearch}"`));
    } else {
      await sandbox.files.write(`${WORKSPACE_PATH}/index.ts`, current.replace(regSearch, regReplace));
      const final = await sandbox.files.read(`${WORKSPACE_PATH}/index.ts`);
      if (final.includes("registerSayHello") && final.includes("registerSayHello(server)")) {
        ok("edit_file index.ts — both import and registration added");
      } else {
        fail("edit_file content verify", new Error("registerSayHello not in final index.ts"));
      }
    }
  }
} catch (e) { fail("edit_file", e); }

// ── [8] exec foreground — list tools/ directory ───────────────────────────────
console.log("\n[8] exec (foreground) — ls tools/");
try {
  const ls = await sandbox.commands.run("ls tools/", {
    cwd: WORKSPACE_PATH,
    timeoutMs: 10_000,
  });
  if (ls.exitCode === 0 && ls.stdout.includes("say-hello.ts")) {
    ok(`exec ls tools/ — found say-hello.ts (exit ${ls.exitCode})`);
    console.log(`    Files: ${ls.stdout.trim()}`);
  } else {
    fail("exec ls tools/", new Error(`stdout: "${ls.stdout}" stderr: "${ls.stderr}"`));
  }
} catch (e) { fail("exec foreground", e); }

// ── [9] exec background — restart dev server after edits ─────────────────────
console.log("\n[9] exec (background) — restart server with new tool");
try {
  // Kill the process listening on port 3109 (avoids pkill self-kill issue)
  const kill = await sandbox.commands.run(
    `ss -tlnp 'sport = :3109' | grep -oP 'pid=\\K[0-9]+' | head -1 | xargs -r kill; sleep 1; true`,
    { cwd: WORKSPACE_PATH, timeoutMs: 10_000 }
  );
  ok(`kill port-3109 process — exit ${kill.exitCode}`);

  // Restart in background
  await sandbox.commands.run(`npm run dev`, {
    cwd: WORKSPACE_PATH,
    background: true,
  });
  ok("npm run dev restarted in background");

  // Poll for server to come back
  process.stdout.write("    Waiting for server to restart");
  const host = sandbox.getHost(3109);
  const mcpUrl = `https://${host}/mcp`;
  let ready = false;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    process.stdout.write(".");
    try {
      const probe = await fetch(mcpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } } }),
        signal: AbortSignal.timeout(3000),
      });
      if (probe.status !== 502) { ready = true; break; }
    } catch { /* not up yet */ }
  }
  console.log(ready ? " ready!" : " timed out (continuing)");
  if (ready) ok("Server restarted successfully after edit");
  else fail("Server restart", new Error("port 3109 still closed after 30s"));
} catch (e) { fail("exec background restart", e); }

// ── [10] get_info — reconnect via Sandbox.connect ────────────────────────────
console.log("\n[10] get_info — Sandbox.connect(sandboxId)");
const sandboxId = sandbox.sandboxId;
try {
  const reconnected = await Sandbox.connect(sandboxId);
  const host = reconnected.getHost(3109);
  if (host.includes(sandboxId)) {
    ok(`Sandbox.connect(${sandboxId}) — getHost works on reconnected sandbox`);
  } else {
    ok(`Sandbox.connect(${sandboxId}) — reconnected (host: ${host})`);
  }
} catch (e) { fail("get_info (Sandbox.connect)", e); }

// ── [11] mcp-introspect — tools/list after adding say-hello ──────────────────
console.log("\n[11] mcp-introspect — tools/list (should include say-hello)");
try {
  const host = sandbox.getHost(3109);
  const mcpUrl = `https://${host}/mcp`;

  // Initialize session
  await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
  });

  // List tools
  const toolsRes = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const toolsJson = await toolsRes.json();
  const toolNames = toolsJson?.result?.tools?.map((t) => t.name) ?? [];

  if (toolNames.length > 0) {
    ok(`tools/list → [${toolNames.join(", ")}]`);
  } else {
    fail("tools/list returned no tools", new Error(JSON.stringify(toolsJson).slice(0, 300)));
  }

  if (toolNames.includes("say-hello")) {
    ok("say-hello tool is registered after restart");
  } else {
    fail("say-hello not in tools/list", new Error(`Got: [${toolNames.join(", ")}]`));
  }

  // Call the new say-hello tool
  const callRes = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "say-hello", arguments: { name: "World" } } }),
  });
  const callJson = await callRes.json();
  const resultText = JSON.stringify(callJson?.result ?? callJson);
  if (resultText.includes("World") || resultText.includes("Hello")) {
    ok(`tools/call say-hello — result includes "World" or "Hello"`);
    console.log(`    Response: ${resultText.slice(0, 200)}`);
  } else {
    fail("tools/call say-hello", new Error(`Unexpected response: ${resultText.slice(0, 300)}`));
  }
} catch (e) { fail("mcp-introspect", e); }

// ── [12] download_workspace — tar.gz + download URL (matches lib/workspace/e2b.ts) ──
console.log("\n[12] download_workspace — tar.gz and get URL");
try {
  const clean = await sandbox.commands.run(
    `cd ${WORKSPACE_PATH} && rm -rf node_modules dist .agent`,
    { timeoutMs: 120_000 }
  );
  if (clean.exitCode !== 0) throw new Error(`clean failed: ${clean.stderr}`);
  ok("workspace cleaned (node_modules + dist + .agent removed)");

  const archive = await sandbox.commands.run(
    `cd /home/user && rm -f workspace.tar.gz workspace.zip && tar -czf workspace.tar.gz workspace`,
    { timeoutMs: 5 * 60_000 }
  );
  if (archive.exitCode !== 0) throw new Error(`tar failed: ${archive.stderr || archive.stdout}`);
  ok("workspace archived as workspace.tar.gz");

  const url = await sandbox.downloadUrl("/home/user/workspace.tar.gz");
  if (url.startsWith("http")) {
    ok(`downloadUrl — got signed URL (${url.length} chars)`);
    const head = await fetch(url, { method: "GET", redirect: "follow" });
    const bytes = (await head.arrayBuffer()).byteLength;
    if (head.ok && bytes > 64) ok(`GET signed URL — ${head.status}, ${bytes} bytes`);
    else fail("GET signed URL", new Error(`${head.status}, ${bytes} bytes`));
  } else {
    fail("downloadUrl", new Error(`Unexpected URL: ${url}`));
  }
} catch (e) { fail("download_workspace", e); }

// ── Cleanup ───────────────────────────────────────────────────────────────────
console.log("\n[13] Cleanup");
try {
  await sandbox.kill();
  ok(`Sandbox ${sandboxId} killed`);
} catch (e) { fail("sandbox.kill()", e); }

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(56)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
