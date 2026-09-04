"use strict";

const assert = require("node:assert/strict");
const {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const functionsRoot = path.join(projectRoot, "functions");
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "simple-books-founder-"));
const temporaryFunctions = path.join(temporaryRoot, "functions");
const firebaseExecutable = process.platform === "win32" ?
  "firebase.cmd" : "firebase";

function assertTemporaryPath(target) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(target));
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function writeTemporaryProject(secretLines) {
  mkdirSync(temporaryFunctions, {recursive: true});
  cpSync(
      path.join(projectRoot, "firestore.rules"),
      path.join(temporaryRoot, "firestore.rules"),
  );
  cpSync(
      path.join(projectRoot, "firestore.indexes.json"),
      path.join(temporaryRoot, "firestore.indexes.json"),
  );
  cpSync(
      path.join(functionsRoot, "package.json"),
      path.join(temporaryFunctions, "package.json"),
  );
  symlinkSync(
      path.join(functionsRoot, "node_modules"),
      path.join(temporaryFunctions, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
  );
  writeFileSync(
      path.join(temporaryFunctions, "index.js"),
      `module.exports = require(${JSON.stringify(path.join(functionsRoot, "index.js"))});\n`,
  );
  writeFileSync(
      path.join(temporaryFunctions, ".secret.local"),
      `${secretLines.join("\n")}\n`,
  );
  writeFileSync(
      path.join(temporaryFunctions, ".env.demo-simple-books"),
      [
        "STRIPE_EXPECTED_MODE=test",
        "STRIPE_PRO_PRICE_ID=price_1TnLTCJmLqrFk5SqusEJiIhu",
        "STRIPE_CHECKOUT_ENABLED=false",
        "",
      ].join("\n"),
  );
  writeFileSync(
      path.join(temporaryRoot, "firebase.json"),
      `${JSON.stringify({
        functions: [{source: "functions", codebase: "default"}],
        firestore: {
          rules: "firestore.rules",
          indexes: "firestore.indexes.json",
        },
        emulators: {
          firestore: {port: 8080},
          auth: {port: 9099},
        },
      }, null, 2)}\n`,
  );
}

function runScenario(name, adminUidLine) {
  writeFileSync(
      path.join(temporaryFunctions, ".secret.local"),
      [
        adminUidLine,
        "SIMPLE_BOOKS_DEMO_IDENTIFIERS=uid:demo-emulator",
        "",
      ].join("\n"),
  );
  const command = `node tests/functions-founder-analytics-emulator.cjs ${name}`;
  const emulatorCommand = process.platform === "win32" ?
    `"${command}"` : command;
  const result = spawnSync(firebaseExecutable, [
    "emulators:exec",
    "--config", path.join(temporaryRoot, "firebase.json"),
    "--project", "demo-simple-books",
    "--only", "auth,firestore,functions",
    emulatorCommand,
  ], {
    cwd: projectRoot,
    env: {...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: "30"},
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${name} emulator scenario failed.`);
}

try {
  assertTemporaryPath(temporaryRoot);
  writeTemporaryProject([
    "SIMPLE_BOOKS_ADMIN_UIDS=founder-emulator",
    "SIMPLE_BOOKS_DEMO_IDENTIFIERS=uid:demo-emulator",
  ]);
  runScenario("valid", "SIMPLE_BOOKS_ADMIN_UIDS=founder-emulator");
  runScenario("missing", "SIMPLE_BOOKS_ADMIN_UIDS=\" \"");
  runScenario(
      "malformed",
      "SIMPLE_BOOKS_ADMIN_UIDS=founder-emulator,,unexpected",
  );
  console.log("Founder Analytics callable emulator security suite passed.");
} finally {
  assertTemporaryPath(temporaryRoot);
  rmSync(temporaryRoot, {recursive: true, force: true});
}
