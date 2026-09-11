import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {beforeAll, describe, expect, it} from "vitest";
import {forbiddenRuntimeReason, validateAllowlist} from "../scripts/build-hosting.mjs";
import {
  firebaseConfigView,
  hashRuntimeFiles,
  pathDigest,
  sha256
} from "../scripts/prepare-billing-hosting-release.mjs";
import {
  DEPLOY_COMMAND,
  RELEASE_STAGE,
  ROLLBACK_COMMAND,
  assertExactActivationReleasePath,
  prepareStripeLiveActivationHostingRelease,
  stageActivationFirebaseConfiguration,
  stageRollbackFirebaseConfiguration
} from "../scripts/prepare-stripe-live-activation-hosting-release.mjs";
import {
  verifyPreparedStripeLiveActivationHostingRelease
} from "../scripts/verify-stripe-live-activation-hosting-release.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => readFileSync(path.join(root, ...relativePath.split("/")), "utf8");
const recipe = JSON.parse(read("hosting-stripe-live-activation-release.json"));
const runtime = JSON.parse(read("hosting-runtime-files.json"));
const firebase = JSON.parse(read("firebase.json"));
const packageConfig = JSON.parse(read("package.json"));
let prepared;
let verified;

beforeAll(async () => {
  const hosting = firebase.hosting.find(item => item.target === recipe.target);
  const entries = await hashRuntimeFiles(root, runtime.files);
  const liveFilesResult = entries.map(([relativePath, hash]) => ({
    path: `/${relativePath}`,
    hash
  }));
  liveFilesResult.push(
    {path: "/__/firebase/init.js", hash: "managed-init-js"},
    {path: "/__/firebase/init.json", hash: "managed-init-json"}
  );
  const liveChannelResult = {result: {channels: [{
    name: `projects/${recipe.project}/sites/${recipe.site}/channels/live`,
    release: {version: {
      name: `projects/${recipe.project}/sites/${recipe.site}/versions/${recipe.baselineHostingVersion}`,
      fileCount: String(recipe.baselineFileCount + recipe.expectedManagedPaths.length),
      config: firebaseConfigView(hosting)
    }}
  }]}};
  prepared = await prepareStripeLiveActivationHostingRelease({
    root,
    liveChannelResult,
    liveFilesResult
  });
  verified = await verifyPreparedStripeLiveActivationHostingRelease({
    root,
    liveChannelResult,
    liveFilesResult
  });
}, 30000);

describe("controlled Stripe-live activation Hosting release", () => {
  it("locks the currently live 168-file launch baseline", () => {
    expect(recipe.baselineHostingVersion).toBe("e2fceb0659593bf6");
    expect(recipe.baselineFileCount).toBe(168);
    expect(recipe.baselineHostingDigest)
      .toBe("3c63cb6acb71d00a5333bd693b3e5d7df37c13371b36b207f4cdfeef396097ed");
    expect(recipe.expectedManagedPaths).toEqual([
      "__/firebase/init.js", "__/firebase/init.json"
    ]);
    expect(prepared.report.verifiedLiveBaseline.version).toBe(recipe.baselineHostingVersion);
    expect(verified.verifiedLiveVersion).toBe(recipe.baselineHostingVersion);
  });

  it("enables frontend checkout only in the candidate and prepares an exact disabled rollback", () => {
    expect(read("account.html")).toContain("const ACCOUNT_CHECKOUT_ENABLED = false;");
    expect(read(`${RELEASE_STAGE.replaceAll("\\", "/")}/source/dist/hosting/account.html`))
      .toContain("const ACCOUNT_CHECKOUT_ENABLED = true;");
    expect(read(`${RELEASE_STAGE.replaceAll("\\", "/")}/source/dist/hosting/account.html`))
      .toContain('let message = "Upgrade to Pro for £15/month.";');
    expect(read(`${RELEASE_STAGE.replaceAll("\\", "/")}/rollback/dist/hosting/account.html`))
      .toContain("const ACCOUNT_CHECKOUT_ENABLED = false;");
    expect(prepared.report.differences).toEqual({
      additions: [], modifications: ["account.html"], deletions: []
    });
    expect(prepared.report.rollbackArtifact.digest).toBe(recipe.baselineHostingDigest);
  });

  it("activates only production Functions while local development stays disabled and test-mode", () => {
    const production = read("functions/.env.simple-books-office");
    const local = read("functions/.env.local");
    expect(production).toMatch(/^STRIPE_EXPECTED_MODE=live$/m);
    expect(production).toMatch(new RegExp(
      `^STRIPE_PRO_PRICE_ID=${recipe.expectedStripeConfiguration.priceId}$`, "m"
    ));
    expect(production).toMatch(/^STRIPE_CHECKOUT_ENABLED=true$/m);
    expect(local).toMatch(/^STRIPE_EXPECTED_MODE=test$/m);
    expect(local).toMatch(/^STRIPE_CHECKOUT_ENABLED=false$/m);
    expect(local).not.toContain(recipe.expectedStripeConfiguration.priceId);
    expect(read("scripts/disable-production-checkout.mjs"))
      .toContain("Production Functions checkout flag set to disabled");
  });

  it("preserves the exact live price and production entitlement validation", () => {
    const backend = read("functions/lib/stripe-billing-config.js");
    const entitlement = read("functions/lib/plan-entitlements.js");
    const webhook = read("functions/lib/stripe-webhook-processor.js");
    expect(backend).toContain(`LIVE_PRO_PRICE_ID = "${recipe.expectedStripeConfiguration.priceId}"`);
    expect(backend).toContain('throw new StripeBillingConfigurationError("live-price-mismatch")');
    expect(backend).toContain("Number(price.unit_amount) !== 1500");
    expect(entitlement).toContain("source.stripeMode === configuration.expectedMode");
    expect(entitlement).toContain("source.stripePriceId === configuration.proPriceId");
    expect(webhook).toContain("subscriptionUsesConfiguredPrice");
  });

  it("preserves legal, consent, Firebase, operational analytics, and Sentry runtime boundaries", () => {
    const publicPrefix = `${RELEASE_STAGE.replaceAll("\\", "/")}/source/dist/hosting/`;
    for(const file of [
      "privacy.html", "terms.html", "assets/legal.css",
      "assets/analytics-consent.js", "assets/analytics-consent.css",
      "firebase-config.js", "resources/js/firebase-runtime.js",
      "assets/activity-logger.js", "assets/admin-customer-analytics-view.js",
      "assets/sentry-monitoring.js"
    ]) expect(runtime.files).toContain(file);
    expect(read(`${publicPrefix}firebase-config.js`)).toContain("prepareFirebaseAnalyticsConsent");
    expect(read(`${publicPrefix}firebase-config.js`)).toContain("getAuth(app)");
    expect(read(`${publicPrefix}resources/js/firebase-runtime.js`))
      .toContain("FIREBASE_EMULATOR_SESSION_KEY");
    expect(read(`${publicPrefix}assets/activity-logger.js`))
      .toContain('httpsCallable(functions, "logActivityEvent")');
    expect(read(`${publicPrefix}assets/admin-customer-analytics-view.js`))
      .toContain("customerAnalytics");
    expect(read(`${publicPrefix}assets/sentry-monitoring.js`)).toContain("sendDefaultPii: false");
  });

  it("keeps deny-by-default containment and excludes repository-only or secret material", () => {
    const files = validateAllowlist(runtime.files);
    expect(files).toHaveLength(168);
    expect(pathDigest(files)).toBe(recipe.runtimePathDigest);
    expect(files.every(file => !forbiddenRuntimeReason(file))).toBe(true);
    expect(files.some(file => /(^|\/)(tests|scripts|functions|docs)(\/|$)/.test(file))).toBe(false);
    expect(files.some(file => /(^|\/)(\.env|\.git)|secret|credential/i.test(file))).toBe(false);
  });

  it("preserves Hosting configuration and isolates activation and rollback deploys", () => {
    const hosting = firebase.hosting.find(item => item.target === recipe.target);
    expect(sha256(Buffer.from(JSON.stringify(firebaseConfigView(hosting)))))
      .toBe(recipe.hostingConfigDigest);
    expect(stageActivationFirebaseConfiguration(hosting).hosting[0]).toMatchObject({
      target: "main", public: "source/dist/hosting",
      predeploy: ["npm.cmd --prefix ../.. run verify:hosting:stripe-live"]
    });
    expect(stageRollbackFirebaseConfiguration(hosting).hosting[0]).toMatchObject({
      target: "main", public: "dist/hosting"
    });
    expect(stageRollbackFirebaseConfiguration(hosting).hosting[0].predeploy).toBeUndefined();
    expect(DEPLOY_COMMAND).toBe(
      "firebase.cmd deploy --only hosting:main --project simple-books-office --config dist/stripe-live-activation-hosting-release/firebase.json"
    );
    expect(ROLLBACK_COMMAND).toBe(
      "firebase.cmd deploy --only hosting:main --project simple-books-office --config dist/stripe-live-activation-hosting-release/rollback/firebase.json"
    );
    expect(packageConfig.scripts["prepare:hosting:stripe-live"])
      .toBe("node scripts/prepare-stripe-live-activation-hosting-release.mjs");
    expect(packageConfig.scripts["verify:hosting:stripe-live"])
      .toBe("node scripts/verify-stripe-live-activation-hosting-release.mjs");
  });

  it("uses a read-only predeploy verifier that cannot remove its Windows working directory", () => {
    const verifier = read("scripts/verify-stripe-live-activation-hosting-release.mjs");
    const staged = stageActivationFirebaseConfiguration(
      firebase.hosting.find(item => item.target === recipe.target)
    );
    expect(staged.hosting[0].predeploy[0]).toContain("verify:hosting:stripe-live");
    expect(staged.hosting[0].predeploy[0]).not.toContain("prepare:hosting:stripe-live");
    expect(verifier).not.toMatch(/\b(?:rm|rename|writeFile|copyFile|cp|buildHosting)\s*\(/);
    expect(verifier).not.toContain("prepareStripeLiveActivationHostingRelease(");
    expect(verified).toMatchObject({
      readOnlyVerification: true,
      candidateDigest: recipe.finalHostingDigest,
      rollbackDigest: recipe.baselineHostingDigest,
      differences: {additions: [], modifications: ["account.html"], deletions: []}
    });
    expect(verified.credentialMaterialAbsent).toBe(true);
  });

  it("keeps known legacy defects documented without expanding activation scope", () => {
    expect(recipe.knownBaselineMissingReferences).toEqual([
      "expenses/index.html -> downloads/simple-expenses-android.apk",
      "expenses/webapp/index.html -> downloads/simple-expenses-android.apk",
      "resources/index.html -> downloads/Bulk-email-draft-generator-free.xlsm"
    ]);
    expect(recipe.expectedDifferences).toEqual({
      additions: [], modifications: ["account.html"], deletions: []
    });
  });

  it("locks the deterministic activation digest and safe stage path", () => {
    expect(recipe.finalHostingDigest)
      .toBe("a6cf998dad13dca194fec0072b48a5209f07ac912465f95ee5ff64e80c068eff");
    expect(prepared.report.totalFiles).toBe(168);
    expect(assertExactActivationReleasePath(root, path.join(root, RELEASE_STAGE)))
      .toBe(path.resolve(root, RELEASE_STAGE));
    expect(() => assertExactActivationReleasePath(root, root))
      .toThrow("unexpected Stripe-live activation path");
    expect(read(".gitignore")).toMatch(/^\/dist\/stripe-live-activation-hosting-release\/$/m);
  });
});
