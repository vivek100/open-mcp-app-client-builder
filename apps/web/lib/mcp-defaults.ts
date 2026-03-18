/**
 * Server-side default MCP servers when no x-mcp-servers header is present.
 * Unset = no defaults (suitable for Vercel). Set DEFAULT_MCP_SERVERS (JSON array) to pre-fill.
 */

export type McpServerConfig = {
  type: "http" | "sse";
  url: string;
  serverId?: string;
};

function parseDefaultMcpServers(): McpServerConfig[] {
  const raw = process.env.DEFAULT_MCP_SERVERS;
  if (raw == null || raw === "") return [];
  try {
    const parsed = JSON.parse(raw) as McpServerConfig[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is McpServerConfig =>
        s != null && typeof s.url === "string" && (s.type === "http" || s.type === "sse")
    );
  } catch {
    return [];
  }
}

let cached: McpServerConfig[] | null = null;

/** Default MCP server configs for API routes when header is absent. */
export function getDefaultMcpServers(): McpServerConfig[] {
  if (cached === null) cached = parseDefaultMcpServers();
  return cached;
}
