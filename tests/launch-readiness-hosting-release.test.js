import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {forbiddenRuntimeReason, validateAllowlist} from "../scripts/build-hosting.mjs";
import {
  entryDigest,
  firebaseConfigView,
  pathDigest,
  sha256,
  verifyLiveChannelResult
} from "../scripts/prepare-billing-hosting-release.mjs";
import {
  DEPLOY_COMMAND,
  RELEASE_STAGE,
  assertExactLaunchReleasePath,
  stageLaunchFirebaseConfiguration
} from "../scripts/prepare-launch-readiness-hosting-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => readFileSync(path.join(root, ...relativePath.split("/")), "utf8");
const recipe = JSON.parse(read("hosting-launch-readiness-release.json"));
const runtime = JSON.parse(read("hosting-runtime-files.json"));
const firebase = JSON.parse(read("firebase.json"));
const packageConfig = JSON.parse(read("package.json"));

describe("launch-readiness controlled Hosting release", () => {
  it("locks the currently deployed billing release as the complete live baseline", () => {
    expect(recipe.baselineHostingVersion).toBe("54d035f39313e96b");
    expect(recipe.baselineFileCount).toBe(163);
    expect(recipe.baselineHostingDigest)
      .toBe("7ad0b197500e81658142473e2f00b2e592ce805bf19d5681e96c4973a2ec3725");
    expect(recipe.historicalBaselineRecipe).toBe("hosting-billing-release.json");
    expect(recipe.expectedManagedPaths).toEqual([
      "__/firebase/init.js",
      "__/firebase/init.json"
    ]);
  });

  it("allows exactly five additions, fifteen modifications, and no deletion", () => {
    expect(recipe.expectedDifferences.additions).toEqual([
      "assets/analytics-consent.css",
      "assets/analytics-consent.js",
      "assets/legal.css",
      "privacy.html",
      "terms.html"
    ]);
    expect(recipe.expectedDifferences.modifications).toEqual([
      "about.html",
      "assets/analytics-event-policy.js",
      "assets/analytics-events.js",
      "assets/app-shell.js",
      "assets/guides/public-shell.js",
      "faq.html",
      "features.html",
      "firebase-config.js",
      "index.html",
      "login.html",
      "pricing.html",
      "resources/js/firebase-runtime.js",
      "security.html",
      "signup.html",
      "whats-new.html"
    ]);
    expect(recipe.expectedDifferences.deletions).toEqual([]);
    expect(recipe.overlayFiles).toEqual([
      ...recipe.expectedDifferences.additions,
      ...recipe.expectedDifferences.modifications
    ].sort());
  });

  it("binds the overlay to the reviewed legal and consent commits", () => {
    expect(recipe.legalGitRevision).toBe("43cd931cb10b7ee988c0804d80b743550eff3dd7");
    expect(recipe.releaseGitRevision).toBe("d937e4746a6e2fec3aa4fa357add63d85f6c9296");
    const script = read("scripts/prepare-launch-readiness-hosting-release.mjs");
    expect(script).toContain("readGitFile(root, recipe.releaseGitRevision, relativePath)");
    expect(script).toContain("Launch overlay drifted from reviewed commit");
    expect(recipe.overlayDigest).toBe("db39660d0006555eb6a3cd6f22ecaf0dc9b78589a7c89c5ea92c3b06157c6290");
  });

  it("keeps the reviewed allowlist exact and free of repository-only files", () => {
    const files = validateAllowlist(runtime.files);
    expect(files).toHaveLength(168);
    expect(pathDigest(files)).toBe(recipe.runtimePathDigest);
    expect(files.every(relativePath => !forbiddenRuntimeReason(relativePath))).toBe(true);
    expect(files).not.toContain("hosting-launch-readiness-release.json");
    expect(files.some(relativePath => /(^|\/)(tests|scripts|functions|docs)(\/|$)/.test(relativePath)))
      .toBe(false);
    expect(files.some(relativePath => /(^|\/)(\.env|\.git)|\.log$/i.test(relativePath)))
      .toBe(false);
  });

  it("includes every legal, consent, and Firebase routing integration point", () => {
    for(const relativePath of [
      "privacy.html", "terms.html", "assets/legal.css",
      "assets/analytics-consent.js", "assets/analytics-consent.css",
      "firebase-config.js", "resources/js/firebase-runtime.js"
    ]){
      expect(runtime.files).toContain(relativePath);
    }
    expect(read("firebase-config.js")).toContain("prepareFirebaseAnalyticsConsent");
    expect(read("firebase-config.js")).toContain("firebaseEmulatorsRequested(window)");
    expect(read("resources/js/firebase-runtime.js")).toContain("FIREBASE_EMULATOR_SESSION_KEY");
    expect(read("assets/app-shell.js")).toContain('import "./analytics-consent.js');
    expect(read("assets/guides/public-shell.js")).toContain('import "../analytics-consent.js');
  });

  it("preserves essential services, operational analytics, Sentry, and disabled checkout", () => {
    const config = read("firebase-config.js");
    for(const service of ["getAuth(app)", "getFirestore(app)", "getFunctions(app", "getStorage(app)"]){
      expect(config).toContain(service);
    }
    expect(read("assets/activity-logger.js")).toContain('httpsCallable(functions, "logActivityEvent")');
    expect(read("assets/demo-analytics.js")).toContain('"demoAnalyticsEvents"');
    expect(read("assets/admin-customer-analytics-view.js")).toContain("customerAnalytics");
    expect(read("assets/sentry-monitoring.js")).toContain("sendDefaultPii: false");
    expect(read("account.html")).toContain("const ACCOUNT_CHECKOUT_ENABLED = false;");
    expect(read("functions/.env.simple-books-office")).toMatch(/^STRIPE_CHECKOUT_ENABLED=false$/m);
    expect(recipe.expectedStripeConfiguration.checkoutEnabled).toBe(false);
    expect(recipe.requiredPreservedFiles).toContain("assets/sentry-monitoring.js");
    expect(recipe.requiredPreservedFiles).toContain("assets/activity-logger.js");
  });

  it("keeps the three legacy reference defects explicit without changing their scope", () => {
    expect(recipe.knownBaselineMissingReferences).toEqual([
      "expenses/index.html -> downloads/simple-expenses-android.apk",
      "expenses/webapp/index.html -> downloads/simple-expenses-android.apk",
      "resources/index.html -> downloads/Bulk-email-draft-generator-free.xlsm"
    ]);
    expect(recipe.overlayFiles.some(relativePath =>
      relativePath.startsWith("expenses/") || relativePath.startsWith("resources/index")
    )).toBe(false);
  });

  it("preserves Hosting configuration and creates a Hosting-only isolated deploy config", () => {
    const hosting = firebase.hosting.find(item => item.target === "main");
    expect(sha256(Buffer.from(JSON.stringify(firebaseConfigView(hosting)))))
      .toBe(recipe.hostingConfigDigest);
    const staged = stageLaunchFirebaseConfiguration(hosting);
    expect(Object.keys(staged)).toEqual(["hosting"]);
    expect(staged.hosting[0].public).toBe("source/dist/hosting");
    expect(staged.hosting[0].predeploy)
      .toEqual(["npm.cmd --prefix ../.. run prepare:hosting:launch"]);
    expect(DEPLOY_COMMAND).toBe("firebase deploy --only hosting:main --project simple-books-office");
    expect(read("scripts/prepare-launch-readiness-hosting-release.mjs"))
      .toContain('deploymentWorkingDirectory: RELEASE_STAGE.split(path.sep).join("/")');
    expect(packageConfig.scripts["prepare:hosting:launch"])
      .toBe("node scripts/prepare-launch-readiness-hosting-release.mjs");
  });

  it("fails closed on live-version or live-file-count drift", () => {
    const version = {
      name: `projects/simple-books-office/sites/simple-books-office/versions/${recipe.baselineHostingVersion}`,
      fileCount: String(recipe.baselineFileCount + recipe.expectedManagedPaths.length)
    };
    const live = value => ({result: {channels: [{
      name: "projects/simple-books-office/sites/simple-books-office/channels/live",
      release: {version: value}
    }]}});
    expect(verifyLiveChannelResult(live(version), recipe).versionId)
      .toBe(recipe.baselineHostingVersion);
    expect(() => verifyLiveChannelResult(live({...version, name: `${version.name}-drift`}), recipe))
      .toThrow("LIVE_BASELINE_CHANGED");
    expect(() => verifyLiveChannelResult(live({...version, fileCount: "999"}), recipe))
      .toThrow("LIVE_FILE_COUNT_CHANGED");
  });

  it("allows cleaning only the dedicated ignored launch stage", () => {
    expect(assertExactLaunchReleasePath(root, path.join(root, RELEASE_STAGE)))
      .toBe(path.resolve(root, RELEASE_STAGE));
    expect(() => assertExactLaunchReleasePath(root, root))
      .toThrow("unexpected launch-readiness release path");
    expect(read(".gitignore")).toMatch(/^\/dist\/launch-readiness-hosting-release\/$/m);
  });

  it("locks the deterministic final candidate digest", () => {
    expect(recipe.finalHostingDigest)
      .toBe("3c63cb6acb71d00a5333bd693b3e5d7df37c13371b36b207f4cdfeef396097ed");
    expect(entryDigest([["candidate", recipe.finalHostingDigest]])).toMatch(/^[a-f0-9]{64}$/);
  });
});
