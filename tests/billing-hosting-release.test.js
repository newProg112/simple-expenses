import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CACHE_TOKEN,
  RELEASE_STAGE,
  applyCacheCorrections,
  assertExactReleasePath,
  entryDigest,
  sha256,
  stageFirebaseConfiguration,
  verifyLiveChannelResult
} from "../scripts/prepare-billing-hosting-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recipe = JSON.parse(await readFile(path.join(root, "hosting-billing-release.json"), "utf8"));
const runtime = JSON.parse(await readFile(path.join(root, "hosting-runtime-files.json"), "utf8"));

describe("billing-only Hosting release recipe", () => {
  it("locks the containment baseline and exact 23-file billing scope", () => {
    expect(recipe.baselineHostingVersion).toBe("ba9ff337be8b742e");
    expect(recipe.billingOverlayFiles).toHaveLength(23);
    expect(recipe.cacheCorrectionFiles).toHaveLength(21);
    expect(recipe.expectedDifferences.additions).toEqual([
      "resources/js/stripe-billing-config.js"
    ]);
    expect(recipe.expectedDifferences.modifications).toHaveLength(22);
    expect(recipe.expectedDifferences.deletions).toEqual([]);
    expect(runtime.files).toContain("resources/js/stripe-billing-config.js");
  });

  it("excludes legal drafts and legal-link changes from every billing overlay", async () => {
    expect(recipe.billingOverlayFiles).not.toContain("privacy.html");
    expect(recipe.billingOverlayFiles).not.toContain("terms.html");
    expect(recipe.billingOverlayFiles).not.toContain("assets/legal.css");
    for (const relativePath of recipe.billingOverlayFiles) {
      const source = await readFile(path.join(root, ...relativePath.split("/")), "utf8");
      expect(source, relativePath).not.toMatch(/privacy\.html|terms\.html|legal\.css/i);
    }
  });

  it("hash-locks the current overlay bytes and disabled checkout intent", async () => {
    const entries = [];
    for (const relativePath of recipe.billingOverlayFiles) {
      const source = await readFile(path.join(root, ...relativePath.split("/")));
      entries.push([relativePath, sha256(source)]);
    }
    expect(entryDigest(entries)).toBe(recipe.billingOverlayDigest);
    expect(recipe.expectedStripeConfiguration).toEqual({
      mode: "live",
      priceId: "price_1UAwaZQwA8Uui39wNgjE9zNh",
      checkoutEnabled: false
    });
  });

  it("reconstructs the complete cache-correction dependency chain", () => {
    expect(applyCacheCorrections(
      "account.html",
      "./assets/account-access-state.js?v=20260806-demo-pro3"
    )).toContain(`account-access-state.js?v=${CACHE_TOKEN}`);
    expect(applyCacheCorrections(
      "resources/js/canonical-workbook-phase4b.js",
      'from "./canonical-workbook-phase4a.js";\nfrom "./canonical-workbook-preflight.js";'
    )).toBe(
      `from "./canonical-workbook-phase4a.js?v=${CACHE_TOKEN}";\n` +
      `from "./canonical-workbook-preflight.js?v=${CACHE_TOKEN}";`
    );
  });

  it("keeps the three unchanged live download issues explicit and bounded", () => {
    expect(recipe.knownBaselineMissingReferences).toEqual([
      "expenses/index.html -> downloads/simple-expenses-android.apk",
      "expenses/webapp/index.html -> downloads/simple-expenses-android.apk",
      "resources/index.html -> downloads/Bulk-email-draft-generator-free.xlsm"
    ]);
  });

  it("generates a Hosting-only config whose predeploy rebuilds the isolated output", () => {
    const source = {
      target: "main",
      public: "dist/hosting",
      predeploy: ["npm run build:hosting"],
      headers: [],
      rewrites: []
    };
    const staged = stageFirebaseConfiguration(source);
    expect(Object.keys(staged)).toEqual(["hosting"]);
    expect(staged.hosting[0]).toMatchObject({
      target: "main",
      public: "source/dist/hosting",
      predeploy: ["npm.cmd --prefix ../.. run prepare:hosting:billing"]
    });
  });

  it.runIf(process.platform === "win32")(
    "runs the generated hook through Firebase CLI's Windows lifecycle shell",
    async () => {
      const crossEnvShell = path.join(
        process.env.APPDATA || "",
        "npm",
        "node_modules",
        "firebase-tools",
        "node_modules",
        "cross-env",
        "src",
        "bin",
        "cross-env-shell.js"
      );
      expect(existsSync(crossEnvShell)).toBe(true);

      const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "billing-hook-"));
      const fixtureStage = path.join(fixtureRoot, "dist", "billing-hosting-release");
      try {
        await mkdir(path.join(fixtureRoot, "scripts"), { recursive: true });
        await mkdir(fixtureStage, { recursive: true });
        await writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
          private: true,
          scripts: {
            "prepare:hosting:billing": "node scripts/fixture-prepare.cjs"
          }
        }));
        await writeFile(
          path.join(fixtureRoot, "scripts", "fixture-prepare.cjs"),
          'console.log("BILLING_HOOK_FIXTURE_OK");\n'
        );

        const hook = stageFirebaseConfiguration({
          target: "main",
          public: "dist/hosting"
        }).hosting[0].predeploy[0];
        const escapedHook = hook.replace(/"/g, '\\"');
        const translatedCommand =
          `"${process.execPath}" "${crossEnvShell}" "${escapedHook}"`;
        const result = spawnSync(translatedCommand, [], {
          cwd: fixtureStage,
          encoding: "utf8",
          shell: true
        });

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain("BILLING_HOOK_FIXTURE_OK");
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    }
  );

  it("fails closed if the live version or file count changes", () => {
    const live = version => ({
      result: {
        channels: [{
          name: "projects/simple-books-office/sites/simple-books-office/channels/live",
          release: { version }
        }]
      }
    });
    const expected = {
      name: `projects/simple-books-office/sites/simple-books-office/versions/${recipe.baselineHostingVersion}`,
      fileCount: String(recipe.baselineFileCount + recipe.expectedManagedPaths.length)
    };
    expect(verifyLiveChannelResult(live(expected), recipe).versionId)
      .toBe(recipe.baselineHostingVersion);
    expect(() => verifyLiveChannelResult(live({ ...expected, name: `${expected.name}-changed` }), recipe))
      .toThrow("LIVE_BASELINE_CHANGED");
    expect(() => verifyLiveChannelResult(live({ ...expected, fileCount: "999" }), recipe))
      .toThrow("LIVE_FILE_COUNT_CHANGED");
  });

  it("allows cleaning only the exact ignored release stage", () => {
    expect(assertExactReleasePath(root, path.join(root, RELEASE_STAGE)))
      .toBe(path.resolve(root, RELEASE_STAGE));
    expect(() => assertExactReleasePath(root, root)).toThrow("unexpected billing release path");
  });
});
