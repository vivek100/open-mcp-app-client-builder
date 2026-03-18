/**
 * Test: Simulates exactly what the agent prompt tells the LLM to do.
 * 1. Provision E2B sandbox
 * 2. Read index.ts to see current state
 * 3. Remove default product-search tool
 * 4. Write new tool + widget
 * 5. Register new tool in index.ts
 * 6. Restart using the EXACT command from the prompt
 * 7. Verify new tool appears, old tool gone
 *
 * Run: node test-restart.mjs
 */

import { Sandbox } from "e2b";
import { readFileSync } from "fs";

// ── Load env vars ────────────────────────────────────────────────────────
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

let passed = 0;
let failed = 0;
function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) { console.error(`  ✗ ${label}: ${err?.message ?? err}`); failed++; }

// ═══════════════════════════════════════════════════════════════
// Step 1: Create sandbox
// ═══════════════════════════════════════════════════════════════
console.log("\n[1] Creating E2B sandbox...");
let sandbox;
try {
  sandbox = await Sandbox.create(TEMPLATE_ID, { timeoutMs: 60 * 60_000 });
  ok(`Sandbox created — ${sandbox.sandboxId}`);
} catch (e) {
  fail("Sandbox.create()", e);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Read current index.ts
// ═══════════════════════════════════════════════════════════════
console.log("\n[2] Reading current index.ts...");
let indexContent;
try {
  indexContent = await sandbox.files.read(`${WS}/index.ts`);
  console.log("  Current index.ts content:");
  console.log("  " + indexContent.split("\n").map((l, i) => `${i+1}: ${l}`).join("\n  "));
  ok("Read index.ts");
} catch (e) {
  fail("Read index.ts", e);
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Wait for server to be ready (template starts it)
// ═══════════════════════════════════════════════════════════════
console.log("\n[3] Waiting for initial server to be ready...");
const host = sandbox.getHost(3109);
const mcpUrl = `https://${host}/mcp`;

process.stdout.write("  Polling");
let initialReady = false;
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
    if (resp.status !== 502) { initialReady = true; break; }
  } catch {}
}
console.log(initialReady ? " ready!" : " timed out");
if (initialReady) ok("Initial server ready");
else fail("Initial server", "Not ready after 20s");

// List initial tools
console.log("\n  Listing initial tools...");
try {
  const resp = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const json = await resp.json();
  const names = json?.result?.tools?.map((t) => t.name) ?? [];
  console.log(`  Initial tools: [${names.join(", ")}]`);
  if (names.includes("product-search")) ok("Default product-search tool present");
  else fail("Expected product-search in initial tools", names);
} catch (e) {
  fail("Initial tools/list", e);
}

// ═══════════════════════════════════════════════════════════════
// Step 4: Remove default product-search (exact edits from prompt)
// ═══════════════════════════════════════════════════════════════
console.log("\n[4] Removing default product-search tool...");

// The prompt says:
//   search: 'import { register as registerProductSearch } from "./tools/product-search";\n'
//   replace: ''
// And:
//   search: 'registerProductSearch(server);\n'
//   replace: ''

try {
  let content = await sandbox.files.read(`${WS}/index.ts`);

  const importStr = 'import { register as registerProductSearch } from "./tools/product-search";\n';
  const regStr = 'registerProductSearch(server);\n';

  const hasImport = content.includes(importStr.trim());
  const hasReg = content.includes(regStr.trim());
  console.log(`  Import found: ${hasImport}`);
  console.log(`  Registration found: ${hasReg}`);

  if (!hasImport && !hasReg) {
    // Try to find what the actual strings look like
    console.log("\n  ⚠️  Exact strings not found. Searching for alternatives...");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes("product")) {
        console.log(`  Line ${i+1}: "${lines[i]}"`);
      }
    }
  }

  // Do the replacements (handle both with and without trailing \n)
  if (hasImport) {
    content = content.replace(importStr.trim() + "\n", "");
    console.log("  Removed import line");
  } else {
    // Try partial match
    const importLine = content.split("\n").find(l => l.includes("registerProductSearch") && l.includes("import"));
    if (importLine) {
      content = content.replace(importLine + "\n", "");
      console.log(`  Removed import (alt match): "${importLine}"`);
    }
  }

  if (hasReg) {
    content = content.replace(regStr.trim() + "\n", "");
    console.log("  Removed registration line");
  } else {
    const regLine = content.split("\n").find(l => l.includes("registerProductSearch("));
    if (regLine) {
      content = content.replace(regLine + "\n", "");
      console.log(`  Removed registration (alt match): "${regLine}"`);
    }
  }

  await sandbox.files.write(`${WS}/index.ts`, content);
  ok("Removed product-search from index.ts");

  console.log("\n  Updated index.ts:");
  console.log("  " + content.split("\n").map((l, i) => `${i+1}: ${l}`).join("\n  "));
} catch (e) {
  fail("Remove product-search", e);
}

// ═══════════════════════════════════════════════════════════════
// Step 5: Write new tool + widget
// ═══════════════════════════════════════════════════════════════
console.log("\n[5] Writing new tool + widget...");

const toolCode = `import { MCPServer, text, widget } from "mcp-use/server";
import { z } from "zod";

export function register(server: MCPServer) {
  server.tool(
    {
      name: "get-weather",
      description: "Get weather for a city",
      schema: z.object({
        city: z.string().describe("City name"),
      }),
      widget: {
        name: "weather-widget",
        invoking: "Fetching weather…",
        invoked: "Weather loaded",
      },
    },
    async ({ city }) => {
      const temp = Math.round(15 + Math.random() * 20);
      const conditions = ["Sunny", "Cloudy", "Rainy", "Windy"][Math.floor(Math.random() * 4)];
      return widget({
        props: { city, temperature: temp, conditions },
        output: text(\`Weather in \${city}: \${temp}°C, \${conditions}\`),
      });
    }
  );
}
`;

const widgetCode = `import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import "../styles.css";

export const widgetMetadata: WidgetMetadata = {
  description: "Displays weather information",
  metadata: { prefersBorder: false },
};

const WeatherWidget: React.FC = () => {
  const { props, isPending } = useWidget<{ city: string; temperature: number; conditions: string }>();
  if (isPending) return <McpUseProvider><div className="p-6 animate-pulse">Loading…</div></McpUseProvider>;
  const { city, temperature, conditions } = props;
  return (
    <McpUseProvider>
      <div className="rounded-2xl border border-default bg-surface-elevated p-6">
        <h2 className="text-xl font-bold">{city}</h2>
        <p className="text-4xl font-light mt-2">{temperature}°C</p>
        <p className="text-secondary mt-1">{conditions}</p>
      </div>
    </McpUseProvider>
  );
};
export default WeatherWidget;
`;

try {
  await sandbox.files.write(`${WS}/tools/weather.ts`, toolCode);
  ok("Wrote tools/weather.ts");
} catch (e) { fail("Write tool", e); }

try {
  await sandbox.files.write(`${WS}/resources/weather-widget/widget.tsx`, widgetCode);
  ok("Wrote resources/weather-widget/widget.tsx");
} catch (e) { fail("Write widget", e); }

// ═══════════════════════════════════════════════════════════════
// Step 6: Register in index.ts
// ═══════════════════════════════════════════════════════════════
console.log("\n[6] Registering new tool in index.ts...");
try {
  let content = await sandbox.files.read(`${WS}/index.ts`);

  // Add import
  content = content.replace(
    "// ADD NEW TOOL IMPORTS HERE",
    'import { register as registerWeather } from "./tools/weather";\n// ADD NEW TOOL IMPORTS HERE'
  );

  // Add registration
  content = content.replace(
    "// ADD NEW TOOL REGISTRATIONS HERE",
    'registerWeather(server);\n// ADD NEW TOOL REGISTRATIONS HERE'
  );

  await sandbox.files.write(`${WS}/index.ts`, content);
  ok("Registered weather tool in index.ts");

  console.log("\n  Final index.ts:");
  console.log("  " + content.split("\n").map((l, i) => `${i+1}: ${l}`).join("\n  "));
} catch (e) {
  fail("Register tool", e);
}

// ═══════════════════════════════════════════════════════════════
// Step 7: Restart using EXACT command from prompt
// ═══════════════════════════════════════════════════════════════
console.log("\n[7] Restarting server using prompt's exact command...");

// The prompt says:
// exec("pkill -f 'node.*index' || true; sleep 1 && npm run dev > /tmp/dev.log 2>&1 &", background=true)
const restartCmd = "pkill -f 'node.*index' || true; sleep 1 && npm run dev > /tmp/dev.log 2>&1 &";
console.log(`  Command: ${restartCmd}`);

try {
  const r = await sandbox.commands.run(restartCmd, {
    cwd: WS,
    timeoutMs: 10000, // should return quickly since it backgrounds
  });
  console.log(`  exit: ${r.exitCode}, stdout: ${r.stdout.trim()}, stderr: ${r.stderr.trim()}`);
  ok("Restart command executed");
} catch (e) {
  fail("Restart command", e);
}

// ═══════════════════════════════════════════════════════════════
// Step 8: Verify using prompt's exact verify command
// ═══════════════════════════════════════════════════════════════
console.log("\n[8] Verifying server with prompt's curl command...");

// The prompt says:
// exec("sleep 10 && curl -s http://localhost:3109/mcp -X POST -H 'Content-Type: application/json' -d '...' | head -c 200", timeoutMs=30000)
const verifyCmd = `sleep 10 && curl -s http://localhost:3109/mcp -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' | head -c 200`;
console.log(`  Command: sleep 10 && curl ...`);

try {
  const r = await sandbox.commands.run(verifyCmd, { cwd: WS, timeoutMs: 30000 });
  console.log(`  exit: ${r.exitCode}`);
  console.log(`  stdout: ${r.stdout.trim()}`);
  if (r.stderr.trim()) console.log(`  stderr: ${r.stderr.trim()}`);

  if (r.stdout.includes("initialize") || r.stdout.includes("serverInfo") || r.stdout.includes("protocolVersion")) {
    ok("Server responded to initialize");
  } else if (r.stdout.includes("error") || r.exitCode !== 0) {
    fail("Server verify", `Bad response: ${r.stdout.slice(0, 200)}`);

    // Check logs
    console.log("\n  Checking /tmp/dev.log for errors...");
    const logResult = await sandbox.commands.run("cat /tmp/dev.log | tail -40", { cwd: WS });
    console.log("  " + logResult.stdout.split("\n").map(l => `  ${l}`).join("\n"));
  } else {
    // Empty response or unexpected
    console.log("  ⚠️  Unexpected response, checking if server is even running...");
    const ps = await sandbox.commands.run("ps aux | grep -i node | grep -v grep");
    console.log(`  Running processes: ${ps.stdout.trim()}`);

    fail("Server verify", `Unexpected: "${r.stdout.slice(0, 100)}"`);
  }
} catch (e) {
  fail("Server verify command", e);

  // Check logs on failure
  console.log("\n  Checking /tmp/dev.log...");
  try {
    const logResult = await sandbox.commands.run("cat /tmp/dev.log | tail -40", { cwd: WS });
    console.log("  " + logResult.stdout.split("\n").map(l => `  ${l}`).join("\n"));
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// Step 9: List tools via external URL to verify
// ═══════════════════════════════════════════════════════════════
console.log("\n[9] Listing tools via external MCP URL...");
try {
  // Re-initialize first
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
  const names = json?.result?.tools?.map((t) => t.name) ?? [];
  console.log(`  Final tools: [${names.join(", ")}]`);

  if (names.includes("get-weather")) ok("New get-weather tool visible");
  else fail("get-weather not found", `Tools: ${names}`);

  if (!names.includes("product-search")) ok("product-search removed");
  else fail("product-search still present", "Should have been removed");

} catch (e) {
  fail("Final tools/list", e);
}

// ═══════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════
console.log("\n[10] Cleanup");
try {
  await sandbox.kill();
  ok(`Sandbox ${sandbox.sandboxId} killed`);
} catch (e) { fail("kill", e); }

console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
