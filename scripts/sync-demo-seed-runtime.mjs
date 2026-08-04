import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = resolve(projectRoot, "functions", "generated");
const runtimeFiles = Object.freeze([
  "assets/demo-mode.js",
  "assets/demo-seed.js",
  "assets/demo-seed-engine.js",
  "resources/js/business-logic.js",
  "resources/js/ledger-engine.js",
  "resources/js/ledger-firestore.js"
]);

await Promise.all(runtimeFiles.map(async relativePath => {
  const destination = resolve(runtimeRoot, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(projectRoot, relativePath), destination);
}));

await writeFile(
  resolve(runtimeRoot, "package.json"),
  `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  "utf8"
);

console.log(`Prepared ${runtimeFiles.length} canonical demo runtime modules.`);
