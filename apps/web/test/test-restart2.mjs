/**
 * Test: Find a restart command that works in E2B.
 * Tries multiple approaches and reports which ones succeed.
 *
 * Run: node test/test-restart2.mjs
 */

import { Sandbox } from "e2b";
import { readFileSync } from "fs";

const envText = readFileSync("../../../.env", "utf-8");
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

console.log("[1] Creating sandbox...");
const sandbox = await Sandbox.create(TEMPLATE_ID, { timeoutMs: 60 * 60_000 });
console.log(`  Sandbox: ${sandbox.sandboxId}`);

const host = sandbox.getHost(3109);
const mcpUrl = `https://${host}/mcp`;

// Wait for initial server
console.log("\n[2] Waiting for initial server...");
process.stdout.write("  Polling");
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
  try {
    const resp = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (resp.status !== 502) { console.log(" ready!"); break; }
  } catch {}
}

// Show initial tool list
const initResp = await fetch(mcpUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
});
const initTools = await initResp.json();
console.log(`  Initial tools: ${initTools?.result?.tools?.map(t => t.name).join(", ")}`);

// Show running processes
console.log("\n[3] Current processes on port 3109...");
const psResult = await sandbox.commands.run("ss -tlnp 'sport = :3109' 2>/dev/null || netstat -tlnp 2>/dev/null | grep 3109", { cwd: WS });
console.log(`  ${psResult.stdout.trim()}`);

const fuser = await sandbox.commands.run("fuser 3109/tcp 2>&1 || echo 'fuser not available'", { cwd: WS });
console.log(`  fuser: ${fuser.stdout.trim()}`);

const lsof = await sandbox.commands.run("lsof -t -i:3109 2>&1 || echo 'lsof not available'", { cwd: WS });
console.log(`  lsof PIDs: ${lsof.stdout.trim()}`);

// Write a modified index.ts (remove default, add a dummy tool inline)
console.log("\n[4] Modifying index.ts with a test tool...");
const newIndex = `import { MCPServer, text } from "mcp-use/server";
import { z } from "zod";

const server = new MCPServer({
  name: "mcp-use-server",
  title: "mcp-use-server",
  version: "1.0.0",
  description: "MCP server - test restart",
  baseUrl: process.env.MCP_URL || "http://localhost:3109",
  favicon: "favicon.ico",
  websiteUrl: "https://mcp-use.com",
  icons: [{ src: "icon.svg", mimeType: "image/svg+xml", sizes: ["512x512"] }],
});

server.tool(
  { name: "test-restart-tool", description: "A test tool", schema: z.object({ x: z.string() }) },
  async ({ x }) => text("hello " + x)
);

server.listen(parseInt(process.env.PORT ?? "3109", 10)).then(() => {
  console.log("Server running on port " + (process.env.PORT ?? "3109"));
});
`;
await sandbox.files.write(`${WS}/index.ts`, newIndex);
console.log("  Written.");

// ═══════════════════════════════════════════════════════════════
// Try different restart approaches
// ═══════════════════════════════════════════════════════════════

async function tryRestart(label, killCmd, startCmd, useBackground) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  TRYING: ${label}`);
  console.log(`  Kill: ${killCmd}`);
  console.log(`  Start: ${startCmd} (background=${useBackground})`);
  console.log(`${"─".repeat(60)}`);

  // Kill
  try {
    const r = await sandbox.commands.run(killCmd, { cwd: WS, timeoutMs: 10000 });
    console.log(`  Kill exit=${r.exitCode} stdout="${r.stdout.trim()}" stderr="${r.stderr.trim()}"`);
  } catch (e) {
    console.log(`  Kill error: ${e.message}`);
  }

  await new Promise((r) => setTimeout(r, 2000));

  // Start
  try {
    if (useBackground) {
      // Use E2B's background command
      const proc = await sandbox.commands.run(startCmd, { cwd: WS, timeoutMs: 5000, background: true });
      console.log(`  Start: launched in background`);
    } else {
      const r = await sandbox.commands.run(startCmd, { cwd: WS, timeoutMs: 5000 });
      console.log(`  Start exit=${r.exitCode}`);
    }
  } catch (e) {
    // timeout = good for foreground server (means it's still running)
    if (e.message?.includes("timeout") || e.message?.includes("Timeout")) {
      console.log(`  Start: timed out (expected for long-running server)`);
    } else {
      console.log(`  Start error: ${e.message}`);
    }
  }

  // Wait for server
  console.log("  Waiting 12s for build + startup...");
  await new Promise((r) => setTimeout(r, 12000));

  // Verify via internal curl
  try {
    const r = await sandbox.commands.run(
      `curl -s http://localhost:3109/mcp -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1,"params":{}}' 2>&1 | head -c 500`,
      { cwd: WS, timeoutMs: 10000 }
    );
    console.log(`  Internal curl: ${r.stdout.trim().slice(0, 200)}`);

    if (r.stdout.includes("test-restart-tool")) {
      console.log(`  ✅ SUCCESS — new tool visible!`);
      return true;
    } else if (r.stdout.includes("tools")) {
      console.log(`  ⚠️  Got tools response but test-restart-tool not found`);
    } else {
      console.log(`  ❌ FAIL — unexpected response`);
    }
  } catch (e) {
    console.log(`  ❌ curl error: ${e.message}`);
  }

  // Also try external URL
  try {
    // Need to re-initialize for stateful MCP
    await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
      signal: AbortSignal.timeout(5000),
    });
    const resp = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(5000),
    });
    const json = await resp.json();
    const names = json?.result?.tools?.map(t => t.name) ?? [];
    console.log(`  External tools: [${names.join(", ")}]`);
    if (names.includes("test-restart-tool")) {
      console.log(`  ✅ SUCCESS via external URL!`);
      return true;
    }
  } catch (e) {
    console.log(`  External fetch failed: ${e.message}`);
  }

  // Check logs
  try {
    const logs = await sandbox.commands.run("cat /tmp/dev.log 2>/dev/null | tail -15", { cwd: WS });
    if (logs.stdout.trim()) console.log(`  Dev logs:\n${logs.stdout.trim()}`);
  } catch {}

  return false;
}

// ── Approach A: fuser kill + nohup npm run dev ──
await tryRestart(
  "A: fuser kill + nohup",
  "fuser -k 3109/tcp 2>/dev/null || true",
  "nohup npm run dev > /tmp/dev.log 2>&1 &",
  false
);

// ── Approach B: kill by PID from ss + npm run dev (E2B background) ──
// First find the PID
const ss = await sandbox.commands.run("ss -tlnp 'sport = :3109' | grep -oP 'pid=\\K[0-9]+' | head -1", { cwd: WS });
const pid = ss.stdout.trim();
console.log(`\n  Found PID on 3109: "${pid}"`);

await tryRestart(
  "B: kill PID + E2B background",
  pid ? `kill ${pid} 2>/dev/null; sleep 1` : "echo 'no pid found'",
  "npm run dev > /tmp/dev.log 2>&1",
  true
);

// ── Approach C: kill port via lsof + shell background ──
await tryRestart(
  "C: lsof kill + shell &",
  "kill $(lsof -t -i:3109) 2>/dev/null; sleep 1",
  "cd /home/user/workspace && npm run dev > /tmp/dev.log 2>&1 &",
  false
);

// ── Approach D: direct npm run build then npm start ──
await tryRestart(
  "D: npm run build then node directly",
  "kill $(lsof -t -i:3109) 2>/dev/null; sleep 1",
  "npm run build && node dist/index.js > /tmp/dev.log 2>&1 &",
  false
);

// Cleanup
console.log("\n\nCleaning up...");
await sandbox.kill();
console.log("Done.");
