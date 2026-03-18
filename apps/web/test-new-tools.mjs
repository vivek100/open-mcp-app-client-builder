/**
 * Test: Validates the new edit_file (multi-edit) and restart_server (auto-cleanup)
 * tools directly against E2B sandbox.
 * Run: node test-new-tools.mjs
 */

import { Sandbox } from "e2b";
import { readFileSync } from "fs";

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
const TEMPLATE_ID = env.E2B_TEMPLATE;
const WS = "/home/user/workspace";

let passed = 0, failed = 0;
function ok(l) { console.log(`  ✓ ${l}`); passed++; }
function fail(l, e) { console.error(`  ✗ ${l}: ${e?.message ?? e}`); failed++; }

console.log("╔══════════════════════════════════════════════════╗");
console.log("║  Test: Multi-Edit + Auto-Cleanup Tools           ║");
console.log("╚══════════════════════════════════════════════════╝");

// ═══════════════════════════════════════════════════════════════
// [1] Create sandbox
// ═══════════════════════════════════════════════════════════════
console.log("\n[1] Create sandbox");
const sandbox = await Sandbox.create(TEMPLATE_ID, { timeoutMs: 60 * 60_000 });
ok(`Sandbox ${sandbox.sandboxId}`);

const host = sandbox.getHost(3109);
const mcpUrl = `https://${host}/mcp`;

// Wait for initial server
console.log("\n[2] Wait for initial server...");
process.stdout.write("  ");
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 2000));
  process.stdout.write(".");
  try {
    const r = await fetch(mcpUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
      signal: AbortSignal.timeout(3000),
    });
    if (r.status !== 502) { console.log(" ready!"); break; }
  } catch {}
}

// Check initial tools
const initResp = await fetch(mcpUrl, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
});
const initTools = (await initResp.json())?.result?.tools?.map(t => t.name) ?? [];
console.log(`  Initial tools: [${initTools.join(", ")}]`);
ok("Initial server ready");

// ═══════════════════════════════════════════════════════════════
// [3] Test multi-edit: register new tool in index.ts with one call
// ═══════════════════════════════════════════════════════════════
console.log("\n[3] Test multi-edit on index.ts");

// First write the tool + widget files
await sandbox.files.write(`${WS}/resources/weather-widget/widget.tsx`, `import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import "../styles.css";
export const widgetMetadata: WidgetMetadata = { description: "Weather", metadata: { prefersBorder: false } };
const W: React.FC = () => {
  const { props, isPending } = useWidget<{ city: string; temp: number }>();
  if (isPending) return <McpUseProvider><div className="p-6 animate-pulse">Loading…</div></McpUseProvider>;
  return <McpUseProvider><div className="p-6"><h2 className="text-xl font-bold">{props.city}</h2><p className="text-4xl">{props.temp}°C</p></div></McpUseProvider>;
};
export default W;
`);
ok("write widget");

await sandbox.files.write(`${WS}/tools/weather.ts`, `import { MCPServer, text, widget } from "mcp-use/server";
import { z } from "zod";
export function register(server: MCPServer) {
  server.tool(
    { name: "get-weather", description: "Get weather", schema: z.object({ city: z.string() }),
      widget: { name: "weather-widget", invoking: "Loading…", invoked: "Done" } },
    async ({ city }) => widget({ props: { city, temp: Math.round(15 + Math.random() * 20) }, output: text(city + " weather") })
  );
}
`);
ok("write tool");

// Now multi-edit: apply 2 edits in one pass (like the new edit_file tool does)
let content = await sandbox.files.read(`${WS}/index.ts`);
const edits = [
  {
    search: "// ADD NEW TOOL IMPORTS HERE",
    replace: 'import { register as registerWeather } from "./tools/weather";\n// ADD NEW TOOL IMPORTS HERE'
  },
  {
    search: "// ADD NEW TOOL REGISTRATIONS HERE",
    replace: 'registerWeather(server);\n// ADD NEW TOOL REGISTRATIONS HERE'
  },
];

const results = [];
for (const edit of edits) {
  if (!content.includes(edit.search)) {
    results.push("SKIP");
    continue;
  }
  content = content.replace(edit.search, edit.replace);
  results.push("OK");
}
await sandbox.files.write(`${WS}/index.ts`, content);

console.log(`  Edit results: [${results.join(", ")}]`);
if (results.every(r => r === "OK")) ok("multi-edit: both edits applied");
else fail("multi-edit: some edits failed", results.join(", "));

// Verify both markers still exist (for future tools)
const afterEdit = await sandbox.files.read(`${WS}/index.ts`);
if (afterEdit.includes("// ADD NEW TOOL IMPORTS HERE") && afterEdit.includes("// ADD NEW TOOL REGISTRATIONS HERE")) {
  ok("markers preserved for future tools");
} else {
  fail("markers lost after multi-edit", "");
}

// Verify default tool is still in index.ts (we didn't remove it manually)
if (afterEdit.includes("registerProductSearch")) {
  ok("default product-search still in index.ts (not manually removed)");
} else {
  fail("default tool unexpectedly missing", "");
}

// ═══════════════════════════════════════════════════════════════
// [4] Test restart_server auto-cleanup logic
// ═══════════════════════════════════════════════════════════════
console.log("\n[4] Test restart_server auto-cleanup");
const startTime = Date.now();

// --- Auto-cleanup logic (mirrors route.ts restart_server) ---
console.log("  Scanning index.ts for referenced tools...");
const indexContent = await sandbox.files.read(`${WS}/index.ts`);

// Find imported tool files
const importedTools = new Set();
for (const m of indexContent.matchAll(/from\s+["']\.\/tools\/([^"']+)["']/g)) {
  importedTools.add(m[1]);
}
console.log(`  Imported tools: [${[...importedTools].join(", ")}]`);

// List actual tool files
const toolsLs = await sandbox.commands.run("ls tools/ 2>/dev/null", { cwd: WS, timeoutMs: 5000 });
const toolFiles = (toolsLs.stdout || "").split("\n").filter(Boolean);
console.log(`  Tool files on disk: [${toolFiles.join(", ")}]`);

// Remove orphaned tool files (NOT imported in index.ts)
let removedToolFiles = [];
for (const f of toolFiles) {
  const name = f.replace(/\.ts$/, "");
  if (!importedTools.has(name)) {
    console.log(`  → Removing orphaned tool: tools/${f}`);
    await sandbox.commands.run(`rm -f tools/${f}`, { cwd: WS });
    removedToolFiles.push(f);
  }
}

// Find referenced widget folders from imported tool files
const referencedWidgets = new Set();
for (const toolName of importedTools) {
  try {
    const toolSrc = await sandbox.files.read(`${WS}/tools/${toolName}.ts`);
    for (const m of toolSrc.matchAll(/name:\s*["']([^"']+)["']/g)) {
      referencedWidgets.add(m[1]);
    }
  } catch {}
}
console.log(`  Referenced widgets: [${[...referencedWidgets].join(", ")}]`);

// List resource folders
const resLs = await sandbox.commands.run("ls resources/ 2>/dev/null", { cwd: WS, timeoutMs: 5000 });
const resFolders = (resLs.stdout || "").split("\n").filter(f => f && f !== "styles.css");
console.log(`  Resource folders on disk: [${resFolders.join(", ")}]`);

// Remove orphaned resource folders
let removedResFolders = [];
for (const folder of resFolders) {
  if (!referencedWidgets.has(folder)) {
    console.log(`  → Removing orphaned resource: resources/${folder}`);
    await sandbox.commands.run(`rm -rf resources/${folder}`, { cwd: WS });
    removedResFolders.push(folder);
  }
}

if (removedToolFiles.length > 0 || removedResFolders.length > 0) {
  ok(`Auto-cleanup removed: tools=[${removedToolFiles.join(",")}] resources=[${removedResFolders.join(",")}]`);
} else {
  fail("Auto-cleanup didn't remove anything (expected product-search-result)", "");
}

// Verify cleanup
const toolsAfter = await sandbox.commands.run("ls tools/ 2>/dev/null", { cwd: WS });
const resAfter = await sandbox.commands.run("ls resources/ 2>/dev/null", { cwd: WS });
console.log(`  After cleanup — tools: [${toolsAfter.stdout.trim()}]`);
console.log(`  After cleanup — resources: [${resAfter.stdout.trim()}]`);

// --- Kill + restart + poll (mirrors route.ts restart_server) ---
console.log("\n  Killing old server...");
await sandbox.commands.run(
  "kill $(ss -tlnp 'sport = :3109' | grep -oP 'pid=\\K[0-9]+' | head -1) 2>/dev/null; sleep 2",
  { cwd: WS, timeoutMs: 10000 }
);
ok("Kill command");

console.log("  Starting npm run dev (background)...");
await sandbox.commands.run("npm run dev > /tmp/dev.log 2>&1", { cwd: WS, timeoutMs: 5000, background: true });
ok("npm run dev started");

console.log("  Polling for server health...");
let serverReady = false;
let toolsResponse = "";

for (let attempt = 0; attempt < 6; attempt++) {
  await new Promise(r => setTimeout(r, 5000));
  process.stdout.write(`  attempt ${attempt + 1}/6 (${((Date.now() - startTime) / 1000).toFixed(0)}s)...`);

  const result = await sandbox.commands.run(
    "curl -sf http://localhost:3109/mcp -X POST " +
      "-H 'Content-Type: application/json' " +
      "-d '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1,\"params\":{}}' 2>/dev/null | head -c 500",
    { cwd: WS, timeoutMs: 10000 }
  );

  if (result.stdout && result.stdout.includes("tools")) {
    console.log(" ✅ ready!");
    toolsResponse = result.stdout;
    serverReady = true;
    break;
  } else {
    console.log(" waiting...");
  }
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

if (serverReady) {
  ok(`Server restarted in ${totalTime}s`);

  if (toolsResponse.includes("get-weather")) ok("get-weather visible");
  else fail("get-weather not found", toolsResponse.slice(0, 200));

  // The key test: default tools should be GONE because auto-cleanup removed them
  if (!toolsResponse.includes("search-tools") && !toolsResponse.includes("get-fruit-details")) {
    ok("Default tools auto-cleaned (search-tools, get-fruit-details gone)");
  } else {
    fail("Default tools still present after auto-cleanup", toolsResponse.slice(0, 300));
  }
} else {
  fail("Server didn't start in 30s", "");
  const logs = await sandbox.commands.run("cat /tmp/dev.log | tail -40", { cwd: WS });
  console.log(`\n  Build logs:\n${logs.stdout}`);
}

// ═══════════════════════════════════════════════════════════════
// [5] External URL verification
// ═══════════════════════════════════════════════════════════════
console.log("\n[5] External URL verification");
try {
  await fetch(mcpUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
    signal: AbortSignal.timeout(5000),
  });
  const resp = await fetch(mcpUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(5000),
  });
  const names = (await resp.json())?.result?.tools?.map(t => t.name) ?? [];
  console.log(`  External tools: [${names.join(", ")}]`);
  if (names.includes("get-weather")) ok("External: get-weather");
  else fail("External: get-weather missing", names.join(", "));
  if (!names.includes("search-tools")) ok("External: default tools cleaned");
  else fail("External: default tools still present", names.join(", "));
} catch (e) {
  fail("External fetch", e);
}

// Cleanup
console.log("\n[6] Cleanup");
await sandbox.kill();
ok("Killed");

console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log("\n🎉 Multi-edit + auto-cleanup works!");
