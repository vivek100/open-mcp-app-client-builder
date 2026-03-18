/**
 * E2E test: Trace all event IDs from Mastra stream to diagnose duplicate React keys.
 * Focus: which events share messageId / parentMessageId / toolCallId?
 */

const WEB_BASE = "http://localhost:3000";
const MCP_URL = "http://localhost:3108/mcp";
const SERVER_ID = "threejs";

function parseSSEEvents(raw: string): any[] {
  const events: any[] = [];
  for (const chunk of raw.split("\n\n")) {
    const dataLines = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    if (dataLines.length > 0) {
      try { events.push(JSON.parse(dataLines.join("\n"))); } catch {}
    }
  }
  return events;
}

async function sendToAgent(route: string, message: string, mcpServers: any[]) {
  const resp = await fetch(`${WEB_BASE}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mcp-servers": JSON.stringify(mcpServers),
    },
    body: JSON.stringify({
      method: "agent/run",
      params: { agentId: "default" },
      body: {
        threadId: `test-${Date.now()}`,
        runId: `run-${Date.now()}`,
        messages: [{ id: `msg-${Date.now()}`, role: "user", content: message }],
        tools: [], context: [], forwardedProps: {}, state: {},
      },
    }),
  });
  const raw = await resp.text();
  return { raw, events: parseSSEEvents(raw), status: resp.status };
}

function shortId(id: string | undefined): string {
  if (!id) return "—";
  return id.slice(0, 8);
}

function traceIds(label: string, events: any[]) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${label} — Full Event ID Trace`);
  console.log(`${"═".repeat(70)}`);
  console.log(
    "  #  | Type                   | messageId | parentMsgId | toolCallId | role"
  );
  console.log("  " + "-".repeat(66));

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    // Skip TOOL_CALL_ARGS — too noisy, same toolCallId as START
    if (e.type === "TOOL_CALL_ARGS") continue;
    // Skip TEXT_MESSAGE_CONTENT — same messageId as START
    if (e.type === "TEXT_MESSAGE_CONTENT") continue;

    const type = (e.type || "").padEnd(22);
    const msgId = shortId(e.messageId);
    const parentId = shortId(e.parentMessageId);
    const tcId = shortId(e.toolCallId);
    const role = e.role || "—";

    console.log(
      `  ${String(i).padStart(2)} | ${type} | ${msgId.padEnd(9)} | ${parentId.padEnd(11)} | ${tcId.padEnd(10)} | ${role}`
    );
  }

  // Now analyze: which IDs appear in multiple events with different roles?
  console.log(`\n  --- ID Analysis ---`);

  // Collect all messageIds and what role/type they appear in
  const idUsage = new Map<string, { types: string[]; roles: string[] }>();

  for (const e of events) {
    const ids = [e.messageId, e.parentMessageId].filter(Boolean);
    for (const id of ids) {
      if (!idUsage.has(id)) idUsage.set(id, { types: [], roles: [] });
      const entry = idUsage.get(id)!;
      if (e.messageId === id) {
        entry.types.push(e.type);
        if (e.role) entry.roles.push(e.role);
      }
      if (e.parentMessageId === id) {
        entry.types.push(`${e.type}(parent)`);
      }
    }
  }

  // Find IDs used in multiple distinct roles or as both messageId and parentMessageId
  let duplicateFound = false;
  for (const [id, usage] of idUsage) {
    const uniqueRoles = [...new Set(usage.roles)];
    const isParent = usage.types.some((t) => t.includes("(parent)"));
    const isMessage = usage.types.some((t) => !t.includes("(parent)"));

    if (uniqueRoles.length > 1 || (isParent && isMessage)) {
      duplicateFound = true;
      console.log(`\n  POTENTIAL DUPLICATE: ${id}`);
      console.log(`    Used as messageId in: ${usage.types.filter((t) => !t.includes("(parent)")).join(", ")}`);
      console.log(`    Used as parentMessageId in: ${usage.types.filter((t) => t.includes("(parent)")).join(", ")}`);
      console.log(`    Roles: ${uniqueRoles.join(", ")}`);
    }
  }

  if (!duplicateFound) {
    console.log("  No potential duplicate IDs found in raw stream.");
    console.log("  (Duplicates may be created by defaultApplyEvents on the frontend)");
  }

  // Show how defaultApplyEvents would build messages
  console.log(`\n  --- Simulated defaultApplyEvents message building ---`);
  const messages: { id: string; role: string; source: string }[] = [];

  for (const e of events) {
    switch (e.type) {
      case "TEXT_MESSAGE_START":
        messages.push({ id: e.messageId, role: "assistant", source: "TEXT_MESSAGE_START" });
        break;
      case "TEXT_MESSAGE_CHUNK":
        // transformChunks converts these to START/CONTENT/END
        // START uses the messageId from the chunk
        if (!messages.find((m) => m.id === e.messageId)) {
          messages.push({ id: e.messageId, role: e.role || "assistant", source: "TEXT_MESSAGE_CHUNK" });
        }
        break;
      case "TOOL_CALL_START": {
        // defaultApplyEvents: if parentMessageId matches last message, reuse it
        // Otherwise create new assistant message with parentMessageId as id
        const parentId = e.parentMessageId;
        const lastMsg = messages[messages.length - 1];
        if (lastMsg && lastMsg.id === parentId && lastMsg.role === "assistant") {
          // Reuses existing — tool call gets attached to this message
          console.log(`  TOOL_CALL_START: reusing message ${shortId(parentId)} for tool ${e.toolCallName}`);
        } else {
          // Creates NEW assistant message with id = parentMessageId
          messages.push({ id: parentId, role: "assistant", source: `TOOL_CALL_START(${e.toolCallName})` });
          console.log(`  TOOL_CALL_START: creating NEW message ${shortId(parentId)} for tool ${e.toolCallName}`);
        }
        break;
      }
      case "TOOL_CALL_RESULT":
        messages.push({ id: e.messageId, role: "tool", source: "TOOL_CALL_RESULT" });
        break;
      case "ACTIVITY_SNAPSHOT":
        messages.push({ id: e.messageId, role: "activity", source: "ACTIVITY_SNAPSHOT" });
        break;
    }
  }

  console.log(`\n  Final messages array (${messages.length} messages):`);
  for (const m of messages) {
    console.log(`    id=${shortId(m.id)}  role=${m.role.padEnd(10)}  from=${m.source}`);
  }

  // Check for duplicate IDs in messages array
  const msgIdCounts = new Map<string, number>();
  for (const m of messages) {
    msgIdCounts.set(m.id, (msgIdCounts.get(m.id) || 0) + 1);
  }

  console.log(`\n  --- Duplicate message IDs ---`);
  let hasDupes = false;
  for (const [id, count] of msgIdCounts) {
    if (count > 1) {
      hasDupes = true;
      const dupes = messages.filter((m) => m.id === id);
      console.log(`  DUPLICATE id=${shortId(id)} appears ${count} times:`);
      for (const d of dupes) {
        console.log(`    role=${d.role}, from=${d.source}`);
      }
    }
  }
  if (!hasDupes) {
    console.log("  No duplicates found in simulated messages array.");
  }
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Duplicate Key RCA — Event ID Trace             ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const mcpServers = [{ type: "http", url: MCP_URL, serverId: SERVER_ID }];
  const message = "Use the show_threejs_scene tool to show a simple red cube rotating";

  // Test Mastra route (where duplicates happen)
  console.log("\nSending to /api/mastra-agent...");
  const mastra = await sendToAgent("/api/mastra-agent", message, mcpServers);
  traceIds("/api/mastra-agent (Mastra)", mastra.events);

  // Also test CopilotKit for comparison
  console.log("\n\nSending to /api/copilotkit...");
  const copilot = await sendToAgent("/api/copilotkit", message, mcpServers);
  traceIds("/api/copilotkit (BuiltIn)", copilot.events);
}

main().catch(console.error);
