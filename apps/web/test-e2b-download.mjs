/**
 * E2B download flow smoke test (matches apps/web/lib/workspace/e2b.ts prepareDownload)
 *
 * Run from apps/web:
 *   node test-e2b-download.mjs
 *
 * Requires ../../.env with E2B_API_KEY and E2B_TEMPLATE (recommended).
 */

import { Sandbox } from "e2b";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", "..", ".env");

const envText = readFileSync(envPath, "utf-8");
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
const TEMPLATE_ID = env.E2B_TEMPLATE?.trim() || undefined;
const WORKSPACE_PATH = "/home/user/workspace";

if (!process.env.E2B_API_KEY) {
  console.error("Missing E2B_API_KEY in ../../.env");
  process.exit(1);
}

console.log("\n[1] Create sandbox");
let sandbox;
try {
  sandbox = TEMPLATE_ID
    ? await Sandbox.create(TEMPLATE_ID, { timeoutMs: 60 * 60_000 })
    : await Sandbox.create({ timeoutMs: 60 * 60_000 });
  console.log(`  ✓ Sandbox ${sandbox.sandboxId} (template: ${TEMPLATE_ID ?? "default base"})`);
} catch (e) {
  console.error("  ✗ Sandbox.create:", e.message ?? e);
  process.exit(1);
}

if (!TEMPLATE_ID) {
  console.log("\n[1b] No E2B_TEMPLATE — ensure workspace dir exists");
  await sandbox.commands.run(`mkdir -p ${WORKSPACE_PATH} && echo test > ${WORKSPACE_PATH}/README.txt`, {
    timeoutMs: 30_000,
  });
}

console.log("\n[2] prepareDownload — clean + tar.gz (same as e2b.ts)");
try {
  const clean = await sandbox.commands.run(
    `cd ${WORKSPACE_PATH} && rm -rf node_modules dist .agent`,
    { timeoutMs: 120_000 }
  );
  if (clean.exitCode !== 0) {
    throw new Error(`clean failed exit ${clean.exitCode}: ${clean.stderr || clean.stdout}`);
  }
  console.log("  ✓ Stripped node_modules / dist / .agent");

  const archive = await sandbox.commands.run(
    `cd /home/user && rm -f workspace.tar.gz workspace.zip && tar -czf workspace.tar.gz workspace`,
    { timeoutMs: 5 * 60_000 }
  );
  if (archive.exitCode !== 0) {
    throw new Error(
      `tar failed exit ${archive.exitCode}: ${archive.stderr || archive.stdout || "exit 127 often means tar missing"}`
    );
  }
  console.log("  ✓ Created /home/user/workspace.tar.gz");

  const downloadUrl = await sandbox.downloadUrl("/home/user/workspace.tar.gz");
  if (!downloadUrl?.startsWith("http")) {
    throw new Error(`Bad downloadUrl: ${String(downloadUrl).slice(0, 80)}`);
  }
  console.log(`  ✓ Signed URL (${downloadUrl.length} chars)\n    ${downloadUrl.slice(0, 72)}…`);

  console.log("\n[3] Fetch signed URL (expect 200, body is gzip archive)");
  const res = await fetch(downloadUrl, { redirect: "follow" });
  console.log(`  Status: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${buf.toString("utf-8").slice(0, 200)}`);
  }
  if (buf.length < 100) {
    throw new Error(`Body too small (${buf.length} bytes) — expected a tarball`);
  }
  // gzip magic: 1f 8b
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    console.log(`  ✓ Body looks like gzip (${buf.length} bytes)`);
  } else {
    console.log(`  ? First bytes: ${buf.subarray(0, 8).toString("hex")} (expected gzip 1f8b…)`);
  }

  console.log("\nDone — download path works end-to-end.");
} catch (e) {
  console.error("\n  ✗", e.message ?? e);
  process.exitCode = 1;
} finally {
  try {
    await sandbox.kill();
    console.log("\n[cleanup] Sandbox killed.");
  } catch {
    /* ignore */
  }
}

process.exit(process.exitCode ?? 0);
