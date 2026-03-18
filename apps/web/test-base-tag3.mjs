/**
 * Diagnostic #3: Verify the FULL origin rewrite fix via mcp-introspect.
 * Run AFTER restarting the Next.js dev server.
 * Run: node test-base-tag3.mjs
 */

const WEB_BASE = "http://localhost:3000";

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
      console.log(`  ✗ HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return;
    }
    const data = await res.json();
    for (const tool of data.tools) {
      if (!tool.uiHtml) continue;
      console.log(`\n  Tool: "${tool.name}"`);

      // Check for any remaining localhost references
      const localhostRefs = [...tool.uiHtml.matchAll(/http:\/\/localhost:\d+/gi)];
      if (localhostRefs.length > 0) {
        console.log(`  ⚠️  STILL HAS ${localhostRefs.length} localhost references:`);
        for (const ref of [...new Set(localhostRefs.map(r => r[0]))]) {
          console.log(`     ${ref}`);
        }
      } else {
        console.log(`  ✅ No localhost references in HTML`);
      }

      // Show base tag
      const baseMatch = tool.uiHtml.match(/<base\b[^>]*>/i);
      console.log(`  <base>: ${baseMatch ? baseMatch[0] : "NONE"}`);

      // Show asset URLs
      const allRefs = [...tool.uiHtml.matchAll(/(?:src|href)="([^"]+\.(?:js|css|png|svg))"/gi)];
      for (const ref of allRefs) {
        console.log(`  Asset: ${ref[1]}`);
      }

      // Show inline script URLs
      const inlineUrls = [...tool.uiHtml.matchAll(/"(https?:\/\/[^"]+)"/g)];
      for (const ref of inlineUrls) {
        if (!ref[1].endsWith(".js") && !ref[1].endsWith(".css")) {
          console.log(`  Inline: ${ref[1]}`);
        }
      }
    }
  } catch (e) {
    console.log(`  ✗ FAILED: ${e.message}`);
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Verify: Full Origin Rewrite Fix                 ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // When called with the SAME origin (localhost:3109),
  // nothing should change (it's a local server)
  await checkIntrospect("http://localhost:3109/mcp");

  // When called with a DIFFERENT origin (simulating E2B external URL),
  // ALL localhost:3109 references should be replaced
  // Note: This would only work if the server is actually reachable at this URL.
  // For a real test, you'd need an E2B sandbox URL.
  console.log(`
  NOTE: For the full E2B test, you'd need to:
  1. Provision an E2B sandbox (gets external URL like https://3109-xxx.e2b.app/mcp)
  2. Call mcp-introspect with that external URL
  3. Verify all localhost:3109 references are replaced with the external URL

  The fix works by:
  1. Reading <base href="http://localhost:3109" /> from the raw HTML
  2. Extracting internal origin: http://localhost:3109
  3. Comparing with the endpoint origin (from x-mcp-servers header)
  4. If different: html.replaceAll("http://localhost:3109", "https://3109-xxx.e2b.app")
  5. This rewrites ALL absolute URLs — scripts, stylesheets, inline JS, etc.
`);
}

main().catch(console.error);
