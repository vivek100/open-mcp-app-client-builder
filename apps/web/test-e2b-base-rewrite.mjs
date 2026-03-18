/**
 * E2B + Origin Rewrite Integration Test
 *
 * Spins up a real E2B sandbox, gets the external URL, then verifies
 * that /api/mcp-introspect correctly rewrites ALL localhost:3109
 * references in the widget HTML to the external E2B origin.
 *
 * Run: node test-e2b-base-rewrite.mjs
 */

import { Sandbox } from "e2b";
import { readFileSync } from "fs";

// ── Load env ────────────────────────────────────────────────────────────────
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
const WEB_BASE = "http://localhost:3000";

let passed = 0, failed = 0;
function ok(l) { console.log(`  ✓ ${l}`); passed++; }
function fail(l, e) { console.error(`  ✗ ${l}: ${e?.message ?? e}`); failed++; }

console.log("╔══════════════════════════════════════════════════╗");
console.log("║  E2B + Origin Rewrite Integration Test            ║");
console.log("╚══════════════════════════════════════════════════╝");

// ═══════════════════════════════════════════════════════════════
// [1] Create sandbox
// ═══════════════════════════════════════════════════════════════
console.log("\n[1] Create E2B sandbox");
const sandbox = await Sandbox.create(TEMPLATE_ID, { timeoutMs: 60 * 60_000 });
ok(`Sandbox ${sandbox.sandboxId}`);

const host = sandbox.getHost(3109);
const externalMcpUrl = `https://${host}/mcp`;
const externalOrigin = new URL(externalMcpUrl).origin;
console.log(`  External URL: ${externalMcpUrl}`);
console.log(`  External origin: ${externalOrigin}`);

// ═══════════════════════════════════════════════════════════════
// [2] Wait for MCP server to start
// ═══════════════════════════════════════════════════════════════
console.log("\n[2] Wait for MCP server...");
process.stdout.write("  ");
let serverReady = false;
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
  try {
    const r = await fetch(externalMcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (r.status !== 502) { serverReady = true; break; }
  } catch {}
}
console.log(serverReady ? " ready!" : " timed out");
if (serverReady) ok("Server started");
else { fail("Server didn't start in 30s", ""); await sandbox.kill(); process.exit(1); }

// ═══════════════════════════════════════════════════════════════
// [3] Direct MCP: get RAW HTML (before our fix)
// ═══════════════════════════════════════════════════════════════
console.log("\n[3] Direct MCP — raw widget HTML");
let rawHtml = "";
try {
  // Initialize
  const initHeaders = { "Content-Type": "application/json" };
  const initRes = await fetch(externalMcpUrl, {
    method: "POST", headers: initHeaders,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
    }),
    signal: AbortSignal.timeout(5000),
  });
  const sessionId = initRes.headers.get("mcp-session-id");
  const headers = { "Content-Type": "application/json" };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  // List tools
  const toolsRes = await fetch(externalMcpUrl, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(5000),
  });
  const tools = (await toolsRes.json())?.result?.tools ?? [];
  console.log(`  Tools: [${tools.map(t => t.name).join(", ")}]`);
  ok(`Found ${tools.length} tools`);

  const uiTool = tools.find(t => t._meta?.["ui/resourceUri"]);
  if (uiTool) {
    const uri = uiTool._meta["ui/resourceUri"];
    console.log(`  UI tool: "${uiTool.name}" → ${uri}`);

    // Read resource
    const resRes = await fetch(externalMcpUrl, {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri } }),
      signal: AbortSignal.timeout(5000),
    });
    const contents = (await resRes.json())?.result?.contents ?? [];
    rawHtml = contents.find(c => typeof c.text === "string")?.text ?? "";

    // Analyze raw HTML
    const rawLocalhost = [...rawHtml.matchAll(/http:\/\/localhost:\d+/g)];
    console.log(`\n  RAW HTML localhost references: ${rawLocalhost.length}`);
    for (const url of [...new Set(rawLocalhost.map(r => r[0]))]) {
      console.log(`    ${url}`);
    }

    const baseMatch = rawHtml.match(/<base\b[^>]*>/i);
    console.log(`  RAW <base> tag: ${baseMatch ? baseMatch[0] : "NONE"}`);

    if (rawLocalhost.length > 0) {
      ok(`Raw HTML has ${rawLocalhost.length} localhost refs (expected — sandbox internal address)`);
    }

    // Check that raw HTML has external origin anywhere (it shouldn't)
    if (rawHtml.includes(externalOrigin)) {
      fail("Raw HTML already has external origin (unexpected)", "");
    } else {
      ok("Raw HTML does NOT contain external origin (expected)");
    }
  } else {
    console.log("  No UI tools found in raw MCP");
  }
} catch (e) {
  fail("Direct MCP check", e);
}

// ═══════════════════════════════════════════════════════════════
// [4] mcp-introspect: HTML AFTER our fix
// ═══════════════════════════════════════════════════════════════
console.log("\n[4] mcp-introspect — HTML after origin rewrite fix");
try {
  const res = await fetch(`${WEB_BASE}/api/mcp-introspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: externalMcpUrl }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    fail(`mcp-introspect HTTP ${res.status}`, await res.text());
  } else {
    const data = await res.json();
    console.log(`  Tools: ${data.tools.length}, Resources: ${data.resources.length}`);

    for (const tool of data.tools) {
      if (!tool.uiHtml) continue;
      console.log(`\n  Tool: "${tool.name}" (HTML: ${tool.uiHtml.length} chars)`);

      // Check for remaining localhost references
      const localhostRefs = [...tool.uiHtml.matchAll(/http:\/\/localhost:\d+/g)];
      if (localhostRefs.length === 0) {
        ok(`No localhost references in "${tool.name}" HTML`);
      } else {
        fail(`"${tool.name}" still has ${localhostRefs.length} localhost refs`,
          [...new Set(localhostRefs.map(r => r[0]))].join(", "));
      }

      // Check that external origin is present
      const e2bRefs = [...tool.uiHtml.matchAll(new RegExp(
        externalOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'
      ))];
      if (e2bRefs.length > 0) {
        ok(`"${tool.name}" has ${e2bRefs.length} external origin references`);
      } else {
        fail(`"${tool.name}" has NO external origin references`, "rewrite didn't work");
      }

      // Show <base> tag
      const baseMatch = tool.uiHtml.match(/<base\b[^>]*>/i);
      console.log(`  <base>: ${baseMatch ? baseMatch[0] : "NONE"}`);

      // Show asset URLs
      const allRefs = [...tool.uiHtml.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/gi)];
      for (const ref of allRefs) {
        const isExternal = ref[1].startsWith(externalOrigin);
        console.log(`  ${isExternal ? "✅" : "⚠️ "} Asset: ${ref[1]}`);
      }

      // Show inline script URLs
      const inlineUrls = [...tool.uiHtml.matchAll(/"(https?:\/\/[^"]+)"/g)];
      for (const ref of inlineUrls) {
        if (!ref[1].endsWith(".js") && !ref[1].endsWith(".css")) {
          const isExternal = ref[1].startsWith(externalOrigin);
          console.log(`  ${isExternal ? "✅" : "⚠️ "} Inline: ${ref[1]}`);
        }
      }
    }
  }
} catch (e) {
  fail("mcp-introspect", e);
}

// ═══════════════════════════════════════════════════════════════
// [5] Verify assets are actually reachable at the external URL
// ═══════════════════════════════════════════════════════════════
console.log("\n[5] Verify external assets are reachable");
try {
  const res = await fetch(`${WEB_BASE}/api/mcp-introspect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: externalMcpUrl }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  const uiTool = data.tools.find(t => t.uiHtml);
  if (uiTool) {
    const jsMatch = uiTool.uiHtml.match(/src="([^"]+\.js)"/i);
    const cssMatch = uiTool.uiHtml.match(/href="([^"]+\.css)"/i);

    for (const [label, url] of [["JS", jsMatch?.[1]], ["CSS", cssMatch?.[1]]]) {
      if (!url) continue;
      try {
        const assetRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (assetRes.ok) {
          ok(`${label} asset reachable: ${assetRes.status} (${url.slice(-40)})`);
        } else {
          fail(`${label} asset HTTP ${assetRes.status}`, url);
        }
      } catch (e) {
        fail(`${label} asset fetch`, `${url}: ${e.message}`);
      }
    }
  }
} catch (e) {
  fail("Asset reachability", e);
}

// ═══════════════════════════════════════════════════════════════
// [6] Cleanup
// ═══════════════════════════════════════════════════════════════
console.log("\n[6] Cleanup");
await sandbox.kill();
ok("Sandbox killed");

// Summary
console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log("\n🎉 E2B origin rewrite works end-to-end!");
