/**
 * Simulate the origin rewrite logic with real HTML from the MCP server.
 * Proves the fix works for the E2B case (different internal vs external origin).
 * Run: node test/test-base-tag-sim.mjs
 */

// 1. Fetch raw HTML from the local MCP server
async function getRawHtml() {
  const endpoint = "http://localhost:3109/mcp";
  const initRes = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "sim", version: "1" } },
    }),
  });
  const sessionId = initRes.headers.get("mcp-session-id");
  const headers = { "Content-Type": "application/json" };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const toolsRes = await fetch(endpoint, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const tools = (await toolsRes.json())?.result?.tools ?? [];
  const uiTool = tools.find(t => t._meta?.["ui/resourceUri"]);
  if (!uiTool) { console.log("No UI tools"); process.exit(1); }

  const resRes = await fetch(endpoint, {
    method: "POST", headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "resources/read",
      params: { uri: uiTool._meta["ui/resourceUri"] },
    }),
  });
  const contents = (await resRes.json())?.result?.contents ?? [];
  return contents.find(c => typeof c.text === "string")?.text ?? "";
}

// 2. Apply the same rewrite logic as our fix
function rewriteHtml(html, externalOrigin) {
  const baseTagMatch = html.match(/<base\s+href="([^"]*)"[^>]*>/i);
  if (baseTagMatch) {
    try {
      const internalOrigin = new URL(baseTagMatch[1]).origin;
      if (internalOrigin !== externalOrigin) {
        html = html.replaceAll(internalOrigin, externalOrigin);
      }
    } catch {}
  } else {
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${externalOrigin}/">`);
  }
  return html;
}

// 3. Test
async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Simulate E2B Origin Rewrite                     ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const rawHtml = await getRawHtml();
  const E2B_ORIGIN = "https://3109-abc123.e2b.app";

  console.log("\n── RAW HTML (from local server) ──");
  const rawLocalhost = [...rawHtml.matchAll(/http:\/\/localhost:\d+/g)];
  console.log(`  localhost references: ${rawLocalhost.length}`);
  for (const url of [...new Set(rawLocalhost.map(r => r[0]))]) {
    console.log(`    ${url}`);
  }

  console.log(`\n── AFTER REWRITE (simulating E2B endpoint: ${E2B_ORIGIN}/mcp) ──`);
  const rewritten = rewriteHtml(rawHtml, E2B_ORIGIN);

  // Check: no localhost should remain
  const remaining = [...rewritten.matchAll(/http:\/\/localhost:\d+/g)];
  if (remaining.length === 0) {
    console.log("  ✅ ALL localhost references replaced!");
  } else {
    console.log(`  ✗ Still ${remaining.length} localhost refs:`);
    for (const r of remaining) console.log(`    ${r[0]}`);
  }

  // Check: E2B origin should appear
  const e2bRefs = [...rewritten.matchAll(new RegExp(E2B_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
  console.log(`  E2B origin references: ${e2bRefs.length}`);

  // Show the rewritten HTML
  console.log("\n── REWRITTEN HTML ──");
  console.log(rewritten);

  // Verify specific URLs
  console.log("\n── VERIFICATION ──");
  const allRefs = [...rewritten.matchAll(/(?:src|href)="([^"]+)"/gi)];
  let allOk = true;
  for (const ref of allRefs) {
    const url = ref[1];
    if (url.includes("localhost")) {
      console.log(`  ✗ STILL LOCALHOST: ${url}`);
      allOk = false;
    }
  }
  const inlineUrls = [...rewritten.matchAll(/"(https?:\/\/[^"]+)"/g)];
  for (const ref of inlineUrls) {
    if (ref[1].includes("localhost")) {
      console.log(`  ✗ INLINE LOCALHOST: ${ref[1]}`);
      allOk = false;
    }
  }
  if (allOk) {
    console.log("  ✅ All URLs correctly rewritten to E2B origin");
  }
}

main().catch(console.error);
