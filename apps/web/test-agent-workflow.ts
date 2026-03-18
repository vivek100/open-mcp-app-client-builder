/**
 * E2E test: Trace the full "build a widget" workflow from the Mastra agent.
 * Shows every tool call the agent makes, in order, with timing.
 * Goal: identify wasted read_file calls, missing steps, restart issues.
 */

const WEB_BASE = "http://localhost:3000";
const MCP_URL = "http://localhost:3108/mcp";
const SERVER_ID = "threejs";

function parseSSEEvents(raw: string): any[] {
  const events: any[] = [];
  for (const chunk of raw.split("\n\n")) {
    const dataLines = chunk
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    if (dataLines.length > 0) {
      try {
        events.push(JSON.parse(dataLines.join("\n")));
      } catch {}
    }
  }
  return events;
}

async function sendToAgent(route: string, message: string, mcpServers: any[]) {
  const start = Date.now();
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
        tools: [],
        context: [],
        forwardedProps: {},
        state: {},
      },
    }),
  });
  const raw = await resp.text();
  const elapsed = Date.now() - start;
  return { raw, events: parseSSEEvents(raw), status: resp.status, elapsed };
}

function analyzeWorkflow(label: string, events: any[], elapsed: number) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${label} — Workflow Trace`);
  console.log(`  Total time: ${(elapsed / 1000).toFixed(1)}s | Events: ${events.length}`);
  console.log(`${"═".repeat(70)}`);

  // Extract tool calls in order
  const toolCalls: {
    name: string;
    args: string;
    resultPreview: string;
  }[] = [];

  const toolArgsAccum = new Map<string, string>();
  const toolNameById = new Map<string, string>();

  // Extract text messages
  const textMessages: string[] = [];
  let currentText = "";

  for (const e of events) {
    // Track tool call starts
    if (e.type === "TOOL_CALL_START" && e.toolCallId) {
      toolNameById.set(e.toolCallId, e.toolCallName || "unknown");
      toolArgsAccum.set(e.toolCallId, "");
    }

    // Accumulate tool args
    if (e.type === "TOOL_CALL_ARGS" && e.toolCallId && e.delta) {
      const prev = toolArgsAccum.get(e.toolCallId) || "";
      toolArgsAccum.set(e.toolCallId, prev + e.delta);
    }

    // Tool results
    if (e.type === "TOOL_CALL_RESULT" && e.toolCallId) {
      const name = toolNameById.get(e.toolCallId) || "unknown";
      const args = toolArgsAccum.get(e.toolCallId) || "";
      const content = e.content || "";
      const preview = content.length > 200 ? content.slice(0, 200) + "..." : content;
      toolCalls.push({ name, args, resultPreview: preview });
    }

    // Text messages
    if (e.type === "TEXT_MESSAGE_CONTENT" && e.delta) {
      currentText += e.delta;
    }
    if (e.type === "TEXT_MESSAGE_END" && currentText) {
      textMessages.push(currentText.trim());
      currentText = "";
    }

    // Activity snapshots
    if (e.type === "ACTIVITY_SNAPSHOT") {
      toolCalls.push({
        name: "📊 ACTIVITY_SNAPSHOT",
        args: JSON.stringify({ activityType: e.activityType }),
        resultPreview: `resourceUri=${e.content?.resourceUri || "?"}`,
      });
    }
  }

  // Print tool call sequence
  console.log(`\n  ── Tool Calls (${toolCalls.length} total) ──\n`);

  let readCount = 0;
  let writeCount = 0;
  let editCount = 0;
  let execCount = 0;

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const num = String(i + 1).padStart(2);

    // Parse args for readable display
    let argsSummary = "";
    try {
      const parsed = JSON.parse(tc.args);
      if (parsed.path) argsSummary = parsed.path;
      else if (parsed.cmd) argsSummary = parsed.cmd.slice(0, 80);
      else if (parsed.name) argsSummary = parsed.name;
      else argsSummary = tc.args.slice(0, 80);
    } catch {
      argsSummary = tc.args.slice(0, 80);
    }

    console.log(`  ${num}. ${tc.name.padEnd(25)} → ${argsSummary}`);

    // Count by type
    if (tc.name === "read_file") readCount++;
    if (tc.name === "write_file") writeCount++;
    if (tc.name === "edit_file") editCount++;
    if (tc.name === "exec") execCount++;
  }

  // Print text messages
  console.log(`\n  ── Agent Messages (${textMessages.length}) ──\n`);
  for (let i = 0; i < textMessages.length; i++) {
    const msg = textMessages[i];
    const preview = msg.length > 150 ? msg.slice(0, 150) + "..." : msg;
    console.log(`  ${i + 1}. "${preview}"`);
  }

  // Summary
  console.log(`\n  ── Summary ──`);
  console.log(`  read_file:  ${readCount}`);
  console.log(`  write_file: ${writeCount}`);
  console.log(`  edit_file:  ${editCount}`);
  console.log(`  exec:       ${execCount}`);
  console.log(`  Total tool calls: ${toolCalls.length}`);
  console.log(`  Total messages: ${textMessages.length}`);

  // Count restart_server calls
  let restartCount = toolCalls.filter((tc) => tc.name === "restart_server").length;

  // Issues detection
  console.log(`\n  ── Issues Detected ──`);
  let issueCount = 0;

  if (readCount >= 4) {
    issueCount++;
    console.log(`  ⚠️  ${readCount} read_file calls — agent is "studying" the template. Prompt already has full patterns.`);
  }

  // Check restart: should use restart_server tool (not manual exec kill/npm dev)
  const hasRestartTool = restartCount > 0;
  const hasManualKill = toolCalls.some((tc) => tc.name === "exec" && tc.args.includes("kill"));
  const hasManualNpmDev = toolCalls.some((tc) => tc.name === "exec" && tc.args.includes("npm run dev"));

  if (!hasRestartTool && !hasManualKill && !hasManualNpmDev) {
    issueCount++;
    console.log(`  ⚠️  No restart at all — server was never restarted`);
  } else if (!hasRestartTool && (hasManualKill || hasManualNpmDev)) {
    issueCount++;
    console.log(`  ⚠️  Agent used manual exec for restart instead of restart_server tool`);
  } else if (hasRestartTool) {
    console.log(`  ✅ Agent used restart_server tool (${restartCount}x)`);
  }

  // Check if agent used multi-edit (edits array) vs multiple separate edit_file calls
  if (editCount > 2) {
    console.log(`  ℹ️  ${editCount} edit_file calls — could batch with multi-edit`);
  }

  if (issueCount === 0) {
    console.log(`  ✅ No issues detected`);
  }

  return { toolCalls, textMessages, readCount, writeCount, editCount, execCount };
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Agent Workflow Trace — Build Widget Task        ║");
  console.log("╚══════════════════════════════════════════════════╝");

  const mcpServers = [{ type: "http", url: MCP_URL, serverId: SERVER_ID }];
  const message = "Build me a weather widget that shows temperature and conditions for a city";

  console.log(`\nSending to /api/mastra-agent: "${message}"`);
  console.log("(This may take 30-90 seconds...)\n");

  const result = await sendToAgent("/api/mastra-agent", message, mcpServers);

  if (result.status !== 200) {
    console.log(`\n  ERROR: HTTP ${result.status}`);
    console.log(result.raw.slice(0, 500));
    return;
  }

  analyzeWorkflow("/api/mastra-agent", result.events, result.elapsed);
}

main().catch(console.error);
