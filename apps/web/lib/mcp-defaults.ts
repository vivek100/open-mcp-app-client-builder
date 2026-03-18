/**
 * Server-side default MCP servers when no x-mcp-servers header is present.
 * Set DEFAULT_MCP_SERVERS (JSON array) in env for production, e.g.:
 * [{"type":"http","url":"https://your-mcp.example.com/mcp","serverId":"threejs"}]
 * Leave unset for local dev (falls back to localhost threejs).
 */

export type McpServerConfig = {
  type: "http" | "sse";
  url: string;
  serverId?: string;
};

const LOCAL_DEFAULTS: McpServerConfig[] = [
  { type: "http", url: "http://localhost:3108/mcp", serverId: "threejs" },
];

function parseDefaultMcpServers(): McpServerConfig[] {
  const raw = process.env.DEFAULT_MCP_SERVERS;
  if (raw == null || raw === "") return LOCAL_DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as McpServerConfig[];
    if (!Array.isArray(parsed)) return LOCAL_DEFAULTS;
    return parsed.filter(
      (s): s is McpServerConfig =>
        s != null && typeof s.url === "string" && (s.type === "http" || s.type === "sse")
    );
  } catch {
    return LOCAL_DEFAULTS;
  }
}

let cached: McpServerConfig[] | null = null;

/** Default MCP server configs for API routes when header is absent. */
export function getDefaultMcpServers(): McpServerConfig[] {
  if (cached === null) cached = parseDefaultMcpServers();
  return cached;
}
