#!/usr/bin/env node
// Inspect a .wasm plug-in without any toolchain: V8 parses it for us.
//   node inspect_wasm.mjs <file.wasm>
// Exits 1 if the module has imports (PhotoCraft rejects any) or lacks a required export.
// Uses ESM so it runs the same under Node's default-type, esm, or cjs settings.
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node inspect_wasm.mjs <file.wasm>");
  process.exit(2);
}

const bytes = fs.readFileSync(file);
let mod;
try {
  mod = new WebAssembly.Module(bytes);
} catch (e) {
  console.error(`FAIL: not a valid WebAssembly module -> ${e.message}`);
  process.exit(1);
}

const imports = WebAssembly.Module.imports(mod);
const exps = WebAssembly.Module.exports(mod);

console.log(`file    : ${file} (${bytes.length} bytes)`);
console.log(`imports : ${imports.length ? imports.map((i) => `${i.module}.${i.name}`).join(", ") : "none"}`);
console.log("exports :");
for (const e of exps) console.log(`  - ${e.name} (${e.kind})`);

const required = ["memory", "pc_abi_version", "pc_manifest", "pc_alloc", "pc_filter"];
const missing = required.filter((n) => !exps.some((e) => e.name === n));
let bad = 0;
if (imports.length) {
  console.error("FAIL: module has imports; the host rejects any (no WASI, files, network)");
  bad = 1;
}
if (missing.length) {
  console.error(`FAIL: missing required export(s): ${missing.join(", ")}`);
  bad = 1;
}
if (!bad) console.log("OK: zero imports, all required exports present");
process.exit(bad);
