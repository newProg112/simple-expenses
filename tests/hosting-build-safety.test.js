import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  GENERATED_OUTPUT,
  HostingBuildError,
  auditRuntimeDependencies,
  buildHosting,
  cleanGeneratedOutput,
  validateAllowlist,
  validateOutputInventory
} from "../scripts/build-hosting.mjs";

const temporaryRoots = [];

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "simple-books-hosting-test-"));
  temporaryRoots.push(root);
  return root;
}

async function put(root, relativePath, contents = "fixture") {
  const destination = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("generated Firebase Hosting publication safety", () => {
  it("copies only explicitly reviewed runtime files and removes stale artifacts", async () => {
    const root = await fixtureRoot();
    const files = [
      "assets/app.css",
      "assets/app.js",
      "assets/helper.js",
      "assets/logo.png",
      "index.html",
      "nested/page.html"
    ];
    await put(root, "index.html", `
      <link rel="stylesheet" href="/assets/app.css">
      <script type="module" src="./assets/app.js"></script>
      <a href="/nested/page.html">Page</a>
    `);
    await put(root, "assets/app.css", `body{background:url("./logo.png")}`);
    await put(root, "assets/app.js", `import "./helper.js";`);
    await put(root, "assets/helper.js", "export const ready = true;");
    await put(root, "assets/logo.png", "image");
    await put(root, "nested/page.html", "<!doctype html><title>Page</title>");

    await put(root, ".git/HEAD", "do not publish");
    await put(root, "assets/.cache/local-state.json", "do not publish");
    await put(root, "functions/index.js", "do not publish");
    await put(root, "tests/private.test.js", "do not publish");
    await put(root, "scripts/migrate.mjs", "do not publish");
    await put(root, ".env.production", "do not publish");
    await put(root, "firebase-debug.log", "do not publish");
    await put(root, "migration-reports/private.json", "do not publish");
    await put(root, "docs/internal.md", "do not publish");

    const output = path.join(root, GENERATED_OUTPUT);
    await put(root, "dist/hosting/.git/HEAD", "stale");
    await put(root, "dist/hosting/firebase-debug.log", "stale");

    const result = await buildHosting({ projectRoot: root, outputRoot: output, files });

    expect(result.inventory).toEqual([...files].sort());
    await expect(access(path.join(output, ".git", "HEAD"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(output, "functions", "index.js"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(output, "assets", "app.js"), "utf8")).toContain("helper.js");
  });

  it.each([
    ".git/HEAD",
    "assets/.cache/state.json",
    "functions/index.js",
    "nested/tests/private.test.js",
    "scripts/build.mjs",
    ".env.production",
    "config/service-account.json",
    "firebase-debug.log",
    "migration-reports/result.json",
    "docs/internal.md",
    "package.json",
    "__/firebase/init.js",
    "privacy.html",
    "terms.html",
    "assets/legal.css"
  ])("rejects a forbidden allowlist fixture: %s", relativePath => {
    expect(() => validateAllowlist(["index.html", relativePath]))
      .toThrow(HostingBuildError);
  });

  it("allows Firebase managed init references without copying reserved paths", async () => {
    const root = await fixtureRoot();
    await put(root, "index.html", `<script src="/__/firebase/init.js"></script>`);

    const result = await buildHosting({ projectRoot: root, files: ["index.html"] });

    expect(result.inventory).toEqual(["index.html"]);
    await expect(access(path.join(root, GENERATED_OUTPUT, "__"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks references to excluded legal pages and removes generated output", async () => {
    const root = await fixtureRoot();
    await put(root, "index.html", `<a href="/privacy.html">Privacy</a>`);
    await put(root, "dist/hosting/stale.html", "stale");

    await expect(buildHosting({ projectRoot: root, files: ["index.html"] }))
      .rejects.toMatchObject({
        message: "Hosting publication is blocked by source references",
        details: ["excluded pending approval: index.html -> privacy.html"]
      });
    await expect(access(path.join(root, GENERATED_OUTPUT))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks a local runtime dependency that has not been reviewed", async () => {
    const root = await fixtureRoot();
    await put(root, "index.html", `<script src="/assets/unreviewed.js"></script>`);
    await put(root, "assets/unreviewed.js", "console.log('not reviewed')");

    const audit = await auditRuntimeDependencies(root, ["index.html"]);
    expect(audit).toEqual({
      excludedReferences: [],
      missingReferences: ["index.html -> assets/unreviewed.js"]
    });
    await expect(buildHosting({ projectRoot: root, files: ["index.html"] }))
      .rejects.toThrow("Hosting publication is blocked by source references");
  });

  it("permits only an exact explicitly expected set of existing missing references", async () => {
    const root = await fixtureRoot();
    await put(root, "index.html", `<a href="/downloads/missing.xlsx">Existing issue</a>`);
    const expected = ["index.html -> downloads/missing.xlsx"];

    const result = await buildHosting({
      projectRoot: root,
      files: ["index.html"],
      expectedExistingMissingReferences: expected
    });
    expect(result.dependencyAudit.missingReferences).toEqual(expected);

    await expect(buildHosting({
      projectRoot: root,
      files: ["index.html"],
      expectedExistingMissingReferences: []
    })).rejects.toThrow("Hosting publication is blocked by source references");
    await expect(access(path.join(root, GENERATED_OUTPUT))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unexpected or forbidden files in generated output", async () => {
    const root = await fixtureRoot();
    const output = path.join(root, GENERATED_OUTPUT);
    await put(root, "dist/hosting/index.html", "ok");
    await put(root, "dist/hosting/nested/.git/HEAD", "unexpected");

    await expect(validateOutputInventory(output, ["index.html"]))
      .rejects.toMatchObject({ message: "Generated Hosting output validation failed" });
  });

  it("refuses to clean anything except the exact generated output directory", async () => {
    const root = await fixtureRoot();
    await put(root, "sentinel.txt", "preserve");

    await expect(cleanGeneratedOutput(root, root)).rejects.toThrow("unexpected Hosting output path");
    expect(await readFile(path.join(root, "sentinel.txt"), "utf8")).toBe("preserve");
  });
});

describe("reviewed Simple Books runtime allowlist", () => {
  it("wires ordinary Hosting deploys to rebuild the ignored generated directory", async () => {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const firebaseConfig = JSON.parse(await readFile(path.join(projectRoot, "firebase.json"), "utf8"));
    const packageConfig = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
    const gitignore = await readFile(path.join(projectRoot, ".gitignore"), "utf8");
    const hosting = firebaseConfig.hosting.find(entry => entry.target === "main");

    expect(hosting.public).toBe("dist/hosting");
    expect(hosting.predeploy).toEqual(["npm run build:hosting"]);
    expect(packageConfig.scripts["build:hosting"]).toBe("node scripts/build-hosting.mjs");
    expect(gitignore).toMatch(/^\/dist\/hosting\/$/m);
  });

  it("contains the approved containment inventory and remains publication-blocked", async () => {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const manifest = JSON.parse(await readFile(path.join(projectRoot, "hosting-runtime-files.json"), "utf8"));
    const files = validateAllowlist(manifest.files);

    expect(manifest.reviewedAgainstHostingVersion).toBe("ba9ff337be8b742e");
    expect(files).toHaveLength(163);
    expect(files).toContain("resources/js/stripe-billing-config.js");
    expect(files).not.toContain("privacy.html");
    expect(files).not.toContain("terms.html");
    expect(files).not.toContain("assets/legal.css");
    expect(files.some(file => file.startsWith("__/"))).toBe(false);
    const audit = await auditRuntimeDependencies(projectRoot, files);
    expect(audit.excludedReferences.length).toBeGreaterThan(0);
    expect(audit.missingReferences).toEqual([
      "expenses/index.html -> downloads/simple-expenses-android.apk",
      "expenses/webapp/index.html -> downloads/simple-expenses-android.apk",
      "resources/index.html -> downloads/Bulk-email-draft-generator-free.xlsm"
    ]);
  });
});
