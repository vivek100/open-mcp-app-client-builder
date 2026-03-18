/**
 * Diagnostic: Verify <base> tag rewriting in all widget HTML paths.
 *
 * Tests:
 * 1. mcp-introspect (sidebar) — checks uiHtml <base> tag
 * 2. Direct MCP connection — reads raw HTML before our fix
 * 3. Compares raw vs fixed <base> tags
 *
 * Run: node test-base-tag.mjs
 */

const WEB_BASE = "http://localhost:3000";

// ── Helper: call /api/mcp-introspect and inspect HTML ──────────────────────

async function checkIntrospect(endpoint) {
  console.log(`\n── mcp-introspect: ${endpoint} ──`);
  try {
    const res = await fetch(`${WEB_BASE}/api/mcp-introspect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text();
      console.log(`  ✗ HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    console.log(`  Tools: ${data.tools.length}, Resources: ${data.resources.length}`);

    for (const tool of data.tools) {
      console.log(`\n  Tool: "${tool.name}" (hasUI: ${tool.hasUI})`);
      if (!tool.uiHtml) {
        console.log(`    No HTML`);
        continue;
      }
      console.log(`    HTML length: ${tool.uiHtml.length} chars`);

      // Extract <base> tag
      const baseMatch = tool.uiHtml.match(/<base\b[^>]*>/i);
      if (baseMatch) {
        console.log(`    <base> tag (AFTER fix): ${baseMatch[0]}`);
        // Extract href
        const hrefMatch = baseMatch[0].match(/href="([^"]*)"/i);
        if (hrefMatch) {
          const baseUrl = hrefMatch[1];
          console.log(`    Base URL: ${baseUrl}`);
          // Check if it's localhost
          if (baseUrl.includes("localhost")) {
            console.log(`    ⚠️  BASE URL IS LOCALHOST — assets will fail if server is not local`);
          } else {
            console.log(`    ✅ Base URL is external`);
          }
        }
      } else {
        console.log(`    ⚠️  No <base> tag found in HTML`);
      }

      // Extract first few asset references
      const srcRefs = [...tool.uiHtml.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|svg))"/gi)];
      if (srcRefs.length > 0) {
        console.log(`    Asset references (${srcRefs.length}):`);
        for (const ref of srcRefs.slice(0, 5)) {
          console.log(`      ${ref[1]}`);
        }
      }
    }
    return data;
  } catch (e) {
    console.log(`  ✗ FAILED: ${e.message}`);
    return null;
  }
}

// ── Helper: direct MCP connection to see RAW HTML (before our fix) ─────────

async function checkRawMcp(endpoint) {
  console.log(`\n── Direct MCP (raw HTML): ${endpoint} ──`);
  try {
    // Initialize session
    const initRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "diag", version: "1" } },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!initRes.ok) {
      console.log(`  ✗ Initialize failed: HTTP ${initRes.status}`);
      return null;
    }
    // Extract session header for streamable HTTP
    const sessionId = initRes.headers.get("mcp-session-id");
    const headers = { "Content-Type": "application/json" };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    // List tools
    const toolsRes = await fetch(endpoint, {
      method: "POST", headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(5000),
    });
    const toolsData = await toolsRes.json();
    const tools = toolsData?.result?.tools ?? [];
    console.log(`  Tools found: ${tools.length}`);

    // Find UI tools
    const uiTools = tools.filter(t => t._meta?.["ui/resourceUri"]);
    console.log(`  UI tools: ${uiTools.length}`);

    for (const tool of uiTools) {
      const uri = tool._meta["ui/resourceUri"];
      console.log(`\n  Tool: "${tool.name}" → resource: ${uri}`);

      // Read resource
      const resRes = await fetch(endpoint, {
        method: "POST", headers,
        body: JSON.stringify({
          jsonrpc: "2.0", id: 3, method: "resources/read",
          params: { uri },
        }),
        signal: AbortSignal.timeout(5000),
      });
      const resData = await resRes.json();
      const contents = resData?.result?.contents ?? [];
      const textContent = contents.find(c => typeof c.text === "string");

      if (!textContent) {
        console.log(`    No text content in resource`);
        continue;
      }

      const html = textContent.text;
      const baseMatch = html.match(/<base\b[^>]*>/i);
      if (baseMatch) {
        console.log(`    <base> tag (RAW from server): ${baseMatch[0]}`);
        const hrefMatch = baseMatch[0].match(/href="([^"]*)"/i);
        if (hrefMatch) {
          console.log(`    Raw base URL: ${hrefMatch[1]}`);
          const expectedOrigin = new URL(endpoint).origin;
          if (hrefMatch[1].includes("localhost") && !endpoint.includes("localhost")) {
            console.log(`    ⚠️  RAW HTML has localhost base, but server is external (${expectedOrigin})`);
            console.log(`    → Our fix should rewrite to: <base href="${expectedOrigin}/">`);
          }
        }
      } else {
        console.log(`    No <base> tag in raw HTML`);
      }
    }

    return { tools, uiTools };
  } catch (e) {
    console.log(`  ✗ FAILED: ${e.message}`);
    return null;
  }
}

// ── Helper: check what x-mcp-servers the frontend would send ───────────────

async function checkFrontendServers() {
  console.log(`\n── Frontend server config ──`);
  try {
    // Check if we can read the page and find the server list
    // (This is a rough check — the real state is in React)
    console.log("  Note: Frontend state can only be fully checked from browser DevTools");
    console.log("  Check browser console for: [useMcpIntrospect] logs");
    console.log("  Check Network tab → x-mcp-servers header on agent requests");
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Diagnostic: <base> Tag Rewriting Verification   ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // 1. Check known servers via mcp-introspect (applies our fix)
  const servers = [
    "http://localhost:3108/mcp",     // threejs (likely running)
    "http://localhost:3109/mcp",     // mcp-use-server (might not be running)
  ];

  for (const s of servers) {
    await checkIntrospect(s);
  }

  // 2. Direct MCP check (raw HTML, no fix)
  for (const s of servers) {
    await checkRawMcp(s);
  }

  // 3. Frontend config analysis
  await checkFrontendServers();

  // 4. Summary
  console.log(`\n${"═".repeat(60)}`);
  console.log("  DIAGNOSIS");
  console.log(`${"═".repeat(60)}`);
  console.log(`
  The <base> tag fix works as follows:
  1. mcp-introspect reads HTML from the MCP server
  2. It replaces <base href="..."> with <base href="SERVER_ORIGIN/">
  3. SERVER_ORIGIN = new URL(endpoint).origin

  If the endpoint is localhost:3109, the fix produces:
    <base href="http://localhost:3109/">  ← SAME as broken URL!

  If the endpoint is an E2B external URL, the fix produces:
    <base href="https://3109-xxx.e2b.app/">  ← CORRECT

  KEY: The fix only works when the frontend sends the EXTERNAL
  server URL. If it sends localhost:3109, the base tag stays localhost.

  TO DEBUG: In browser DevTools, check:
  - Console: [useMcpIntrospect] logs → which endpoints are used
  - Network tab: x-mcp-servers header → what URLs the frontend sends
  - The server at localhost:3109 is NOT running, so either:
    a) Remove localhost:3109 from server list (it's unreachable)
    b) Use the E2B external URL instead
`);
}

main().catch(console.error);
