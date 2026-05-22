// Copies ../fiches into public/fiches before Vite dev/build.
// Keeps the PWA self-contained: at build time the fiches snapshot is bundled.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "fiches");
const dst = join(here, "public", "fiches");

if (!existsSync(src)) {
  console.warn("[copy-fiches] no ../fiches dir yet, skipping");
  mkdirSync(dst, { recursive: true });
  process.exit(0);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log("[copy-fiches] copied", src, "->", dst);
