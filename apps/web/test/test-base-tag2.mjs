/**
 * Diagnostic #2: Dump raw widget HTML from MCP server to see actual URLs
 * Run: node test/test-base-tag2.mjs
 */

async function main() {
  const endpoint = "http://localhost:3109/mcp";

  // 1. Initialize
  const initRes = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "diag", version: "1" } },
    }),
  });
  const sessionId = initRes.headers.get("mcp-session-id");
  const headers = { "Content-Type": "application/json" };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  // 2. List tools
  const toolsRes = await fetch(endpoint, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  });
  const tools = (await toolsRes.json())?.result?.tools ?? [];
  const uiTool = tools.find(t => t._meta?.["ui/resourceUri"]);
  if (!uiTool) { console.log("No UI tools found"); return; }

  const uri = uiTool._meta["ui/resourceUri"];
  console.log(`Tool: ${uiTool.name}, resource: ${uri}\n`);

  // 3. Read resource
  const resRes = await fetch(endpoint, {
    method: "POST", headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri } }),
  });
  const contents = (await resRes.json())?.result?.contents ?? [];
  const html = contents.find(c => typeof c.text === "string")?.text ?? "";

  console.log("═══ RAW HTML FROM MCP SERVER ═══");
  console.log(html);
  console.log("\n═══ ANALYSIS ═══");

  // Check base tag
  const baseMatch = html.match(/<base\b[^>]*>/i);
  console.log(`<base> tag: ${baseMatch ? baseMatch[0] : "NONE"}`);

  // Check all src and href attributes
  const allRefs = [...html.matchAll(/(?:src|href)="([^"]*)"/gi)];
  console.log(`\nAll src/href values (${allRefs.length}):`);
  for (const ref of allRefs) {
    const url = ref[1];
    const isAbsolute = url.startsWith("http://") || url.startsWith("https://");
    const isRootRelative = url.startsWith("/") && !isAbsolute;
    const isRelative = !isAbsolute && !isRootRelative;
    console.log(`  ${isAbsolute ? "ABSOLUTE" : isRootRelative ? "ROOT-REL" : "RELATIVE"}: ${url}`);
  }

  // Key finding
  const absoluteLocalhost = allRefs.filter(r => r[1].includes("localhost:3109"));
  if (absoluteLocalhost.length > 0) {
    console.log(`\n⚠️  FOUND ${absoluteLocalhost.length} ABSOLUTE localhost:3109 URLs`);
    console.log("   These CANNOT be fixed by <base> tag rewriting alone!");
    console.log("   Need to also rewrite all 'http://localhost:3109' → external origin");
  }
}

main().catch(console.error);
