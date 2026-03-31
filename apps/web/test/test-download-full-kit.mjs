/**
 * Integration test: Next.js /api/workspace/download with fullKit merge.
 *
 * 1. Ensures .download-kit/base.tar.gz (runs scripts/pack-download-kit.mjs if missing).
 * 2. Starts `next dev` on a free port (unless --no-server).
 * 3. Creates an E2B sandbox and POSTs to the download API (stream + fullKit).
 * 4. Asserts gzip body, Content-Disposition mcp-app-kit-*.tar.gz, and extracted layout.
 * 5. Optionally checks fullKit:false → workspace-*.tar.gz (same sandbox).
 *
 * Run from apps/web:
 *   pnpm run test:download-kit
 *   node test/test-download-full-kit.mjs
 *   node test/test-download-full-kit.mjs --no-server
 *
 * With --no-server, set WEB_BASE (default http://localhost:3000). Server must have E2B_API_KEY.
 *
 * Requires repo-root .env: E2B_API_KEY; E2B_TEMPLATE recommended.
 */

import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { Sandbox } from "e2b";
import * as tar from "tar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(WEB_ROOT, "..", "..");
const ENV_FILE = path.join(REPO_ROOT, ".env");

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    noServer: argv.includes("--no-server"),
    port: (() => {
      const p = argv.find((a) => a.startsWith("--port="));
      if (p) return parseInt(p.slice("--port=".length), 10);
      const i = argv.indexOf("--port");
      if (i >= 0 && argv[i + 1]) return parseInt(argv[i + 1], 10);
      return parseInt(process.env.TEST_SERVER_PORT || "31099", 10);
    })(),
  };
}

function loadDotEnv() {
  if (!existsSync(ENV_FILE)) {
    console.error(`Missing ${ENV_FILE}`);
    process.exit(1);
  }
  const envText = readFileSync(ENV_FILE, "utf-8");
  for (const line of envText.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

async function ensureBaseKit() {
  const base = path.join(WEB_ROOT, ".download-kit", "base.tar.gz");
  if (existsSync(base)) {
    console.log("[prep] base.tar.gz present");
    return;
  }
  console.log("[prep] base.tar.gz missing — running pack-download-kit.mjs …");
  const script = path.join(WEB_ROOT, "scripts", "pack-download-kit.mjs");
  const r = spawnSync(process.execPath, [script], { cwd: WEB_ROOT, stdio: "inherit" });
  if (r.status !== 0) {
    console.error("[prep] pack-download-kit failed");
    process.exit(1);
  }
  if (!existsSync(base)) {
    console.error("[prep] base.tar.gz still missing after pack");
    process.exit(1);
  }
}

async function waitForServer(baseUrl, timeoutMs = 180_000) {
  const url = `${baseUrl.replace(/\/$/, "")}/`;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(4000) });
      if (r.status < 500) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error(`Timeout waiting for Next.js at ${url}`);
}

function startNextDev(port) {
  const nextCli = path.join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!existsSync(nextCli)) {
    console.error("next CLI not found — run pnpm install in apps/web");
    process.exit(1);
  }
  const child = spawn(process.execPath, [nextCli, "dev", "--port", String(port)], {
    cwd: WEB_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (c) => process.stderr.write(c));
  child.stderr?.on("data", (c) => process.stderr.write(c));
  return child;
}

async function verifyMergedKit(buf) {
  if (buf.length < 200) throw new Error(`Body too small (${buf.length} bytes)`);
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error("Body is not gzip");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "full-kit-v-"));
  try {
    const arc = path.join(tmp, "kit.tgz");
    await fs.writeFile(arc, buf);
    await tar.x({ file: arc, cwd: tmp });
    const mcpPkg = path.join(tmp, "mcp-apps-starter", "apps", "mcp-use-server", "package.json");
    const webPkg = path.join(tmp, "mcp-apps-starter", "apps", "web", "package.json");
    await fs.access(mcpPkg);
    await fs.access(webPkg);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function verifyMcpOnlyTarball(buf) {
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) throw new Error("Body is not gzip");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-only-v-"));
  try {
    const arc = path.join(tmp, "ws.tgz");
    await fs.writeFile(arc, buf);
    await tar.x({ file: arc, cwd: tmp });
    const wsPkg = path.join(tmp, "workspace", "package.json");
    await fs.access(wsPkg);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

let serverChild;

function stopServer() {
  if (serverChild && !serverChild.killed) {
    try {
      serverChild.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    serverChild = undefined;
  }
}

process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

async function main() {
  loadDotEnv();
  const { noServer, port } = parseArgs();

  if (!process.env.E2B_API_KEY) {
    console.error("E2B_API_KEY missing in repo root .env");
    process.exit(1);
  }

  await ensureBaseKit();

  const baseUrl = (
    process.env.WEB_BASE || (noServer ? "http://localhost:3000" : `http://127.0.0.1:${port}`)
  ).replace(/\/$/, "");

  if (!noServer) {
    console.log(`\n[server] starting next dev on port ${port} …`);
    serverChild = startNextDev(port);
    serverChild.on("error", (err) => {
      console.error("[server] spawn error:", err);
      process.exit(1);
    });
    await waitForServer(baseUrl);
    console.log("[server] ready —", baseUrl);
  } else {
    console.log("\n[server] --no-server — using", baseUrl);
    await waitForServer(baseUrl, 15_000);
  }

  const TEMPLATE_ID = process.env.E2B_TEMPLATE?.trim() || undefined;
  const WORKSPACE_PATH = "/home/user/workspace";

  console.log("\n[e2b] creating sandbox …");
  let sandbox;
  try {
    sandbox = TEMPLATE_ID
      ? await Sandbox.create(TEMPLATE_ID, { timeoutMs: 60 * 60_000 })
      : await Sandbox.create({ timeoutMs: 60 * 60_000 });
    console.log(`  ✓ ${sandbox.sandboxId} (template: ${TEMPLATE_ID ?? "default"})`);
  } catch (e) {
    console.error("  ✗ Sandbox.create:", e?.message ?? e);
    stopServer();
    process.exit(1);
  }

  if (!TEMPLATE_ID) {
    await sandbox.commands.run(
      `mkdir -p ${WORKSPACE_PATH} && ` +
        `echo '{"name":"stub-workspace","version":"1.0.0"}' > ${WORKSPACE_PATH}/package.json && ` +
        `echo ok > ${WORKSPACE_PATH}/README.txt`,
      { timeoutMs: 30_000 }
    );
  }

  try {
    console.log("\n[1] POST /api/workspace/download  fullKit: true");
    const res = await fetch(`${baseUrl}/api/workspace/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: sandbox.sandboxId,
        stream: true,
        fullKit: true,
      }),
    });
    const cd = res.headers.get("Content-Disposition") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`  status ${res.status}, ${buf.length} bytes`);
    console.log(`  Content-Disposition: ${cd.slice(0, 120)}${cd.length > 120 ? "…" : ""}`);

    if (!res.ok) {
      console.error("  body:", buf.toString("utf-8").slice(0, 400));
      throw new Error(`HTTP ${res.status}`);
    }
    if (!cd.includes("mcp-app-kit-")) {
      throw new Error(`Expected filename mcp-app-kit-*.tar.gz in Content-Disposition, got: ${cd}`);
    }
    await verifyMergedKit(buf);
    console.log("  ✓ gzip + extracted mcp-apps-starter/apps/{mcp-use-server,web}/package.json");

    console.log("\n[2] POST /api/workspace/download  fullKit: false");
    const res2 = await fetch(`${baseUrl}/api/workspace/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: sandbox.sandboxId,
        stream: true,
        fullKit: false,
      }),
    });
    const cd2 = res2.headers.get("Content-Disposition") || "";
    const buf2 = Buffer.from(await res2.arrayBuffer());
    console.log(`  status ${res2.status}, ${buf2.length} bytes`);
    if (!res2.ok) {
      console.error("  body:", buf2.toString("utf-8").slice(0, 400));
      throw new Error(`HTTP ${res2.status}`);
    }
    if (!cd2.includes("workspace-")) {
      throw new Error(`Expected workspace-*.tar.gz in Content-Disposition, got: ${cd2}`);
    }
    await verifyMcpOnlyTarball(buf2);
    console.log("  ✓ MCP-only tarball has workspace/package.json");

    console.log("\nDone — download full kit + MCP-only paths OK.");
  } finally {
    try {
      await sandbox.kill();
      console.log("\n[cleanup] sandbox killed");
    } catch {
      /* ignore */
    }
  }
}

main()
  .then(() => {
    stopServer();
    process.exit(0);
  })
  .catch((e) => {
    console.error("\n✗", e?.message ?? e);
    stopServer();
    process.exit(1);
  });
