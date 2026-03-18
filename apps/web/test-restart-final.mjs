/**
 * Final test: Exact sequence from the updated prompt (v3).
 * Run: node test-restart-final.mjs
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

console.log("\n[1] Create sandbox");
const sandbox = await Sandbox.create(TEMPLATE_ID, { timeoutMs: 60 * 60_000 });
ok(`Sandbox ${sandbox.sandboxId}`);

const host = sandbox.getHost(3109);
const mcpUrl = `https://${host}/mcp`;

// Wait for initial server
console.log("\n[2] Wait for initial server...");
process.stdout.write("  ");
for (let i = 0; i < 10; i++) {
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

const initResp = await fetch(mcpUrl, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
});
const initTools = (await initResp.json())?.result?.tools?.map(t => t.name) ?? [];
console.log(`  Initial tools: [${initTools.join(", ")}]`);

// ═══════════════════════════════════════════════════════════════
// Step 4: Clean up default tool — EXACT prompt steps
// ═══════════════════════════════════════════════════════════════
console.log("\n[3] Step 4: Clean up default tool");

// edit_file x2: remove from index.ts
let idx = await sandbox.files.read(`${WS}/index.ts`);
idx = idx.replace('import { register as registerProductSearch } from "./tools/product-search";\n', '');
idx = idx.replace('registerProductSearch(server);\n', '');
await sandbox.files.write(`${WS}/index.ts`, idx);
ok("edit_file: removed import + registration");

// exec: rm old files
const rmResult = await sandbox.commands.run("rm -rf resources/product-search-result tools/product-search.ts", { cwd: WS });
console.log(`  rm exit=${rmResult.exitCode}`);
ok("exec: rm old resources + tool file");

// ═══════════════════════════════════════════════════════════════
// Steps 5-7: Write widget + tool + register
// ═══════════════════════════════════════════════════════════════
console.log("\n[4] Steps 5-7: Write files + register");

await sandbox.files.write(`${WS}/resources/weather-widget/widget.tsx`, `import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import "../styles.css";

export const widgetMetadata: WidgetMetadata = {
  description: "Shows weather",
  metadata: { prefersBorder: false },
};

const W: React.FC = () => {
  const { props, isPending } = useWidget<{ city: string; temp: number; cond: string }>();
  if (isPending) return <McpUseProvider><div className="p-6 animate-pulse">Loading…</div></McpUseProvider>;
  return (
    <McpUseProvider>
      <div className="rounded-2xl border border-default bg-surface-elevated p-6">
        <h2 className="text-xl font-bold">{props.city}</h2>
        <p className="text-4xl font-light mt-2">{props.temp}°C</p>
        <p className="text-secondary mt-1">{props.cond}</p>
      </div>
    </McpUseProvider>
  );
};
export default W;
`);
ok("write_file: weather-widget/widget.tsx");

await sandbox.files.write(`${WS}/tools/weather.ts`, `import { MCPServer, text, widget } from "mcp-use/server";
import { z } from "zod";

export function register(server: MCPServer) {
  server.tool(
    {
      name: "get-weather",
      description: "Get weather for a city",
      schema: z.object({ city: z.string().describe("City name") }),
      widget: { name: "weather-widget", invoking: "Fetching…", invoked: "Done" },
    },
    async ({ city }) => {
      const temp = Math.round(15 + Math.random() * 20);
      const cond = ["Sunny", "Cloudy", "Rainy"][Math.floor(Math.random() * 3)];
      return widget({ props: { city, temp, cond }, output: text(\`\${city}: \${temp}°C, \${cond}\`) });
    }
  );
}
`);
ok("write_file: tools/weather.ts");

idx = await sandbox.files.read(`${WS}/index.ts`);
idx = idx.replace(
  "// ADD NEW TOOL IMPORTS HERE",
  'import { register as registerWeather } from "./tools/weather";\n// ADD NEW TOOL IMPORTS HERE'
);
idx = idx.replace(
  "// ADD NEW TOOL REGISTRATIONS HERE",
  'registerWeather(server);\n// ADD NEW TOOL REGISTRATIONS HERE'
);
await sandbox.files.write(`${WS}/index.ts`, idx);
ok("edit_file x2: registered in index.ts");

// Show final index.ts
const finalIdx = await sandbox.files.read(`${WS}/index.ts`);
console.log("\n  Final index.ts:");
console.log("  " + finalIdx.split("\n").map((l, i) => `${String(i+1).padStart(2)}: ${l}`).join("\n  "));

// ═══════════════════════════════════════════════════════════════
// Step 8: Restart — EXACT prompt commands
// ═══════════════════════════════════════════════════════════════
console.log("\n[5] Step 8: Restart (exact prompt commands)");

// 8a) Kill
console.log("  8a) Kill via ss...");
const killResult = await sandbox.commands.run(
  "kill $(ss -tlnp 'sport = :3109' | grep -oP 'pid=\\K[0-9]+' | head -1) 2>/dev/null; sleep 2",
  { cwd: WS, timeoutMs: 10000 }
);
console.log(`      exit=${killResult.exitCode}`);
ok("8a: kill");

// 8b) npm run dev background
console.log("  8b) npm run dev (background=true)...");
await sandbox.commands.run("npm run dev > /tmp/dev.log 2>&1", { cwd: WS, timeoutMs: 5000, background: true });
ok("8b: npm run dev started");

// 8c) Verify
console.log("  8c) sleep 15 + curl tools/list...");
const verifyResult = await sandbox.commands.run(
  `sleep 15 && curl -sf http://localhost:3109/mcp -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1,"params":{}}' | head -c 500`,
  { cwd: WS, timeoutMs: 30000 }
);
console.log(`      stdout: ${verifyResult.stdout.trim().slice(0, 300)}`);

if (verifyResult.stdout.includes("get-weather")) {
  ok("8c: get-weather visible in internal curl");
} else {
  fail("8c: get-weather not in internal curl", verifyResult.stdout.slice(0, 200));
  const logs = await sandbox.commands.run("cat /tmp/dev.log | tail -30", { cwd: WS });
  console.log(`\n  /tmp/dev.log:\n${logs.stdout}`);
}

if (!verifyResult.stdout.includes("search-tools") && !verifyResult.stdout.includes("product-search")) {
  ok("8c: old default tools gone");
} else {
  fail("8c: old tools still present", "");
}

// ═══════════════════════════════════════════════════════════════
// Step 9: Verify via external URL (refresh_mcp_tools equivalent)
// ═══════════════════════════════════════════════════════════════
console.log("\n[6] Step 9: Verify via external URL");
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
  if (names.includes("get-weather")) ok("External: get-weather visible");
  else fail("External: get-weather missing", names.join(", "));
} catch (e) {
  fail("External", e);
}

// Cleanup
console.log("\n[7] Cleanup");
await sandbox.kill();
ok("Killed");

console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log("\n🎉 ALL TESTS PASSED — prompt restart sequence works!");
