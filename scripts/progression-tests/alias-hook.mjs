// Lets plain Node (25+, native TypeScript type stripping) run the pure
// progression rules without a test framework: resolves the project's "@/..."
// import alias to files under the repo root, adding the .ts/.tsx extension.
//
//   node --import ./scripts/progression-tests/alias-hook.mjs scripts/progression-tests/sequence.test.ts
import { register } from "node:module"

const ROOT = new URL("../../", import.meta.url).pathname

register("data:text/javascript," + encodeURIComponent(`
import { existsSync } from "node:fs"
import { pathToFileURL } from "node:url"
const ROOT = ${JSON.stringify(ROOT)}
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) {
    const base = ROOT + spec.slice(2)
    for (const ext of [".ts", ".tsx", ""]) if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, ctx)
  }
  return next(spec, ctx)
}`))
