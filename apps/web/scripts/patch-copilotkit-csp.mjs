/**
 * Patch @copilotkitnext/react sandbox CSP to allow external CDN scripts.
 *
 * CopilotKit's MCPAppsRenderer uses a hardcoded CSP in a sandboxed srcdoc iframe.
 * The script-src only allows 'self', localhost, blob, and data — blocking CDN-hosted
 * widget scripts (esm.sh, unpkg, jsdelivr, etc.). This patch widens script-src to
 * allow all origins (*) so external MCP widgets (like Excalidraw) can load.
 *
 * Run via postinstall: "postinstall": "node ./scripts/patch-copilotkit-csp.mjs"
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const OLD_SCRIPT_SRC =
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data: http://localhost:* https://localhost:*";
const NEW_SCRIPT_SRC =
  "script-src * 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data:";

function findPnpmStore() {
  let dir = resolve(__dirname, "..");
  for (let i = 0; i < 5; i++) {
    const store = join(dir, "node_modules", ".pnpm");
    try { if (statSync(store).isDirectory()) return store; } catch { /* skip */ }
    dir = dirname(dir);
  }
  return null;
}

function findTargetDirs(pnpmStore) {
  const results = [];
  try {
    for (const entry of readdirSync(pnpmStore)) {
      if (!entry.startsWith("@copilotkitnext+react@")) continue;
      const distDir = join(pnpmStore, entry, "node_modules", "@copilotkitnext", "react", "dist");
      try { if (statSync(distDir).isDirectory()) results.push(distDir); } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return results;
}

let patched = 0;

const store = findPnpmStore();
if (!store) {
  console.log("[csp-patch] pnpm store not found — skipping (fresh install?).");
  process.exit(0);
}

const distDirs = findTargetDirs(store);
if (distDirs.length === 0) {
  console.log("[csp-patch] @copilotkitnext/react not found in store — skipping.");
  process.exit(0);
}

for (const distDir of distDirs) {
  for (const file of ["index.mjs", "index.js", "index.umd.js"]) {
    const abs = join(distDir, file);
    let src;
    try { src = readFileSync(abs, "utf8"); } catch { continue; }
    if (src.includes(NEW_SCRIPT_SRC)) {
      console.log(`  [csp-patch] already patched: ${file}`);
      continue;
    }
    if (!src.includes(OLD_SCRIPT_SRC)) {
      console.log(`  [csp-patch] pattern not found (version changed?): ${file}`);
      continue;
    }
    writeFileSync(abs, src.replaceAll(OLD_SCRIPT_SRC, NEW_SCRIPT_SRC));
    patched++;
    console.log(`  [csp-patch] patched script-src: ${file}`);
  }
}

console.log(patched > 0
  ? `[csp-patch] Done — ${patched} file(s) patched.`
  : "[csp-patch] No files needed patching.");
