import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {buildHosting, validateAllowlist} from "./build-hosting.mjs";
import {
  entryDigest,
  firebaseConfigView,
  hashRuntimeFiles,
  liveConfigView,
  loadLiveChannel,
  loadLiveFiles,
  pathDigest,
  sameList,
  sha256,
  verifyLiveChannelResult,
  writeRuntimeFile
} from "./prepare-billing-hosting-release.mjs";

export const RELEASE_RECIPE = "hosting-stripe-live-activation-release.json";
export const RELEASE_STAGE = path.join("dist", "stripe-live-activation-hosting-release");
export const RELEASE_SOURCE = path.join(RELEASE_STAGE, "source");
export const RELEASE_PUBLIC = path.join(RELEASE_SOURCE, "dist", "hosting");
export const ROLLBACK_STAGE = path.join(RELEASE_STAGE, "rollback");
export const ROLLBACK_PUBLIC = path.join(ROLLBACK_STAGE, "dist", "hosting");
export const RELEASE_REPORT = "stripe-live-activation-verification.json";
export const DEPLOY_COMMAND =
  "firebase.cmd deploy --only hosting:main --project simple-books-office --config dist/stripe-live-activation-hosting-release/firebase.json";
export const ROLLBACK_COMMAND =
  "firebase.cmd deploy --only hosting:main --project simple-books-office --config dist/stripe-live-activation-hosting-release/rollback/firebase.json";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFlag = "const ACCOUNT_CHECKOUT_ENABLED = false;";
const candidateFlag = "const ACCOUNT_CHECKOUT_ENABLED = true;";
const frontendReplacements = [
  [sourceFlag, candidateFlag],
  [
    "// Checkout remains disabled for this phase, including direct button calls.",
    "// Checkout is exposed only by the controlled production activation candidate."
  ],
  [
    'let message = "Pro checkout is currently unavailable.";',
    'let message = "Upgrade to Pro for £15/month.";'
  ],
  [
    'statusMessage = "You are on Starter. Existing records and standard Excel and JSON exports remain available. Pro checkout is currently unavailable.";',
    'statusMessage = "You are on Starter. Existing records and standard Excel and JSON exports remain available. You can upgrade to Pro again when ready.";'
  ]
];

export function activateAccountFrontend(source){
  let activated = source;
  for(const [disabled, enabled] of frontendReplacements){
    if(activated.split(disabled).length !== 2 || activated.includes(enabled)){
      throw new Error(`Source frontend activation boundary changed: ${disabled}`);
    }
    activated = activated.replace(disabled, enabled);
  }
  return activated;
}

export function assertExactActivationReleasePath(root, candidate){
  const expected = path.resolve(root, RELEASE_STAGE);
  const actual = path.resolve(candidate);
  const canonical = value => process.platform === "win32" ? value.toLowerCase() : value;
  if(canonical(expected) !== canonical(actual)){
    throw new Error(`Refusing unexpected Stripe-live activation path: ${actual}`);
  }
  return actual;
}

function isolatedHostingConfiguration(hosting, publicDirectory, predeploy = []){
  const staged = {...hosting, public: publicDirectory};
  if(predeploy.length) staged.predeploy = predeploy;
  else delete staged.predeploy;
  return {hosting: [staged]};
}

export function stageActivationFirebaseConfiguration(hosting){
  return isolatedHostingConfiguration(
    hosting,
    "source/dist/hosting",
    ["npm.cmd --prefix ../.. run verify:hosting:stripe-live"]
  );
}

export function stageRollbackFirebaseConfiguration(hosting){
  return isolatedHostingConfiguration(hosting, "dist/hosting");
}

function firebaseRc(recipe){
  return {
    projects: {default: recipe.project},
    targets: {[recipe.project]: {hosting: {[recipe.target]: [recipe.site]}}},
    etags: {}
  };
}

export async function assertRuntimeBoundaries(root, sourceRoot, rollbackRoot, recipe){
  const read = relativePath => readFile(path.join(sourceRoot, ...relativePath.split("/")), "utf8");
  const [account, firebaseConfig, firebaseRuntime, stripeConfig, consent, sentry,
    activity, customerAnalytics, rollbackAccount] = await Promise.all([
    read("account.html"), read("firebase-config.js"),
    read("resources/js/firebase-runtime.js"), read("resources/js/stripe-billing-config.js"),
    read("assets/analytics-consent.js"), read("assets/sentry-monitoring.js"),
    read("assets/activity-logger.js"), read("assets/admin-customer-analytics-view.js"),
    readFile(path.join(rollbackRoot, "account.html"), "utf8")
  ]);
  if(!account.includes(candidateFlag) || account.includes(sourceFlag)){
    throw new Error("Activation candidate frontend checkout is not enabled");
  }
  if(!rollbackAccount.includes(sourceFlag) || rollbackAccount.includes(candidateFlag)){
    throw new Error("Rollback frontend checkout is not disabled");
  }
  for(const essential of ["getAuth(app)", "getFirestore(app)", "getFunctions(app", "getStorage(app)"]){
    if(!firebaseConfig.includes(essential)) throw new Error(`Essential Firebase service missing: ${essential}`);
  }
  if(!firebaseConfig.includes("prepareFirebaseAnalyticsConsent") ||
      !firebaseConfig.includes("firebaseEmulatorsRequested(window)") ||
      !firebaseRuntime.includes("FIREBASE_EMULATOR_SESSION_KEY")){
    throw new Error("Firebase consent or explicit emulator routing changed");
  }
  if(!consent.includes("Essential only") || !consent.includes("Accept analytics") ||
      !sentry.includes("sendDefaultPii: false") || !sentry.includes("beforeSend: sanitiseEvent") ||
      !activity.includes('httpsCallable(functions, "logActivityEvent")') ||
      !customerAnalytics.includes("customerAnalytics")){
    throw new Error("Consent, Sentry, or operational analytics boundary changed");
  }
  if(!stripeConfig.includes(`LIVE_PRO_PRICE_ID = "${recipe.expectedStripeConfiguration.priceId}"`) ||
      !stripeConfig.includes('expectedMode: testMode ? "test" : "live"')){
    throw new Error("Live Stripe frontend configuration changed");
  }

  const productionEnvironment = await readFile(
    path.join(root, "functions", ".env.simple-books-office"), "utf8"
  );
  const localEnvironment = await readFile(path.join(root, "functions", ".env.local"), "utf8");
  if(!/^STRIPE_EXPECTED_MODE=live$/m.test(productionEnvironment) ||
      !new RegExp(`^STRIPE_PRO_PRICE_ID=${recipe.expectedStripeConfiguration.priceId}$`, "m")
        .test(productionEnvironment) ||
      !/^STRIPE_CHECKOUT_ENABLED=true$/m.test(productionEnvironment)){
    throw new Error("Production Functions activation configuration is not exact");
  }
  if(!/^STRIPE_EXPECTED_MODE=test$/m.test(localEnvironment) ||
      !/^STRIPE_CHECKOUT_ENABLED=false$/m.test(localEnvironment) ||
      new RegExp(`^STRIPE_PRO_PRICE_ID=${recipe.expectedStripeConfiguration.priceId}$`, "m")
        .test(localEnvironment)){
    throw new Error("Local Functions Stripe configuration is not isolated in disabled test mode");
  }
}

export function liveInventory(files){
  const staticEntries = [];
  const managedPaths = [];
  for(const file of files){
    const relativePath = String(file.path || "").replace(/^\//, "");
    if(relativePath.startsWith("__/")) managedPaths.push(relativePath);
    else staticEntries.push([relativePath, file.hash]);
  }
  staticEntries.sort(([left], [right]) => left.localeCompare(right));
  managedPaths.sort();
  return {staticEntries, managedPaths};
}

export async function prepareStripeLiveActivationHostingRelease({
  root = projectRoot,
  liveChannelResult,
  liveFilesResult
} = {}){
  const recipe = JSON.parse(await readFile(path.join(root, RELEASE_RECIPE), "utf8"));
  if(recipe.schemaVersion !== 1 || recipe.releaseName !== "stripe-live-activation"){
    throw new Error("Unsupported Stripe-live activation release recipe");
  }
  const manifest = JSON.parse(await readFile(path.join(root, "hosting-runtime-files.json"), "utf8"));
  const runtimeFiles = validateAllowlist(manifest.files);
  if(runtimeFiles.length !== recipe.baselineFileCount ||
      pathDigest(runtimeFiles) !== recipe.runtimePathDigest){
    throw new Error("Activation Hosting allowlist changed");
  }

  const firebase = JSON.parse(await readFile(path.join(root, "firebase.json"), "utf8"));
  const hosting = firebase.hosting.find(item => item.target === recipe.target);
  if(!hosting || sha256(Buffer.from(JSON.stringify(firebaseConfigView(hosting)))) !==
      recipe.hostingConfigDigest){
    throw new Error("Hosting headers, redirects or rewrites changed");
  }
  const live = liveChannelResult
    ? verifyLiveChannelResult(liveChannelResult, recipe)
    : loadLiveChannel(recipe, root);
  if(sha256(Buffer.from(JSON.stringify(liveConfigView(live.version.config)))) !==
      recipe.hostingConfigDigest){
    throw new Error("Live Hosting configuration changed");
  }
  const liveFiles = liveFilesResult || await loadLiveFiles(recipe, live.versionId, root);
  const {staticEntries: liveEntries, managedPaths} = liveInventory(liveFiles);
  if(liveEntries.length !== recipe.baselineFileCount ||
      entryDigest(liveEntries) !== recipe.baselineHostingDigest ||
      !sameList(managedPaths, recipe.expectedManagedPaths)){
    throw new Error("Live Hosting byte inventory changed");
  }

  const stageRoot = assertExactActivationReleasePath(root, path.join(root, RELEASE_STAGE));
  const sourceRoot = path.join(root, RELEASE_SOURCE);
  const rollbackRoot = path.join(root, ROLLBACK_STAGE);
  await rm(stageRoot, {recursive: true, force: true});
  await mkdir(sourceRoot, {recursive: true});
  for(const relativePath of runtimeFiles){
    await writeRuntimeFile(
      sourceRoot,
      relativePath,
      await readFile(path.join(root, ...relativePath.split("/")))
    );
  }
  const baselineEntries = await hashRuntimeFiles(sourceRoot, runtimeFiles);
  if(entryDigest(baselineEntries) !== recipe.baselineHostingDigest ||
      !sameList(baselineEntries.map(([relativePath]) => relativePath),
        liveEntries.map(([relativePath]) => relativePath))){
    throw new Error("Local runtime is not the verified live baseline");
  }
  const liveHashes = new Map(liveEntries);
  for(const [relativePath, hash] of baselineEntries){
    if(liveHashes.get(relativePath) !== hash){
      throw new Error(`Local runtime differs from live bytes: ${relativePath}`);
    }
  }

  const baselineBuild = await buildHosting({
    projectRoot: sourceRoot,
    files: runtimeFiles,
    expectedExistingMissingReferences: recipe.knownBaselineMissingReferences
  });
  await mkdir(path.dirname(path.join(rollbackRoot, "dist", "hosting")), {recursive: true});
  await cp(baselineBuild.outputRoot, path.join(rollbackRoot, "dist", "hosting"), {recursive: true});
  const accountPath = path.join(sourceRoot, "account.html");
  const account = await readFile(accountPath, "utf8");
  await writeFile(accountPath, activateAccountFrontend(account));
  const build = await buildHosting({
    projectRoot: sourceRoot,
    files: runtimeFiles,
    expectedExistingMissingReferences: recipe.knownBaselineMissingReferences
  });
  await assertRuntimeBoundaries(root, build.outputRoot, path.join(rollbackRoot, "dist", "hosting"), recipe);

  const finalEntries = await hashRuntimeFiles(build.outputRoot, runtimeFiles);
  const finalHashes = new Map(finalEntries);
  const baselineHashes = new Map(liveEntries);
  const differences = {additions: [], modifications: [], deletions: []};
  for(const [relativePath, hash] of finalHashes){
    if(!baselineHashes.has(relativePath)) differences.additions.push(relativePath);
    else if(baselineHashes.get(relativePath) !== hash) differences.modifications.push(relativePath);
  }
  for(const relativePath of baselineHashes.keys()){
    if(!finalHashes.has(relativePath)) differences.deletions.push(relativePath);
  }
  for(const key of Object.keys(differences)){
    differences[key].sort();
    if(!sameList(differences[key], recipe.expectedDifferences[key])){
      throw new Error(`Unexpected activation ${key}: ${JSON.stringify(differences[key])}`);
    }
  }
  if(entryDigest(finalEntries) !== recipe.finalHostingDigest){
    throw new Error("Final activation Hosting byte inventory changed");
  }
  const rollbackEntries = await hashRuntimeFiles(path.join(rollbackRoot, "dist", "hosting"), runtimeFiles);
  if(entryDigest(rollbackEntries) !== recipe.baselineHostingDigest){
    throw new Error("Prepared Hosting rollback differs from the live baseline");
  }

  await writeFile(path.join(stageRoot, "firebase.json"),
    `${JSON.stringify(stageActivationFirebaseConfiguration(hosting), null, 2)}\n`);
  await writeFile(path.join(stageRoot, ".firebaserc"),
    `${JSON.stringify(firebaseRc(recipe), null, 2)}\n`);
  await writeFile(path.join(rollbackRoot, "firebase.json"),
    `${JSON.stringify(stageRollbackFirebaseConfiguration(hosting), null, 2)}\n`);
  await writeFile(path.join(rollbackRoot, ".firebaserc"),
    `${JSON.stringify(firebaseRc(recipe), null, 2)}\n`);

  const report = {
    schemaVersion: 1,
    releaseName: recipe.releaseName,
    project: recipe.project,
    site: recipe.site,
    target: recipe.target,
    verifiedLiveBaseline: {
      version: live.versionId,
      staticFiles: liveEntries.length,
      digest: entryDigest(liveEntries),
      firebaseManagedPaths: managedPaths
    },
    differences,
    totalFiles: finalEntries.length,
    finalHostingDigest: recipe.finalHostingDigest,
    hostingConfiguration: {preserved: true, digest: recipe.hostingConfigDigest},
    checkoutActivation: {
      frontendSource: false,
      frontendCandidate: true,
      productionFunctionsConfiguration: true,
      localFunctionsMode: "test",
      localFunctionsCheckout: false,
      liveProPriceId: recipe.expectedStripeConfiguration.priceId
    },
    preservedRuntimeBoundaries: {
      legalAndConsent: true,
      essentialFirebaseAndExplicitEmulatorRouting: true,
      founderAndCustomerAnalytics: true,
      sentry: true
    },
    rollbackArtifact: {
      staticFiles: rollbackEntries.length,
      digest: entryDigest(rollbackEntries),
      workingDirectory: ".",
      command: ROLLBACK_COMMAND
    },
    knownBaselineMissingReferences: build.dependencyAudit.missingReferences,
    deploymentWorkingDirectory: ".",
    deploymentCommand: DEPLOY_COMMAND
  };
  await writeFile(path.join(stageRoot, RELEASE_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  return {stageRoot, publicRoot: build.outputRoot, rollbackRoot, report};
}

async function main(){
  const result = await prepareStripeLiveActivationHostingRelease();
  console.log(JSON.stringify(result.report, null, 2));
  console.log(`Prepared Stripe-live activation Hosting release at ${result.stageRoot}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if(invokedPath === import.meta.url){
  main().catch(error => {
    console.error(error.message);
    for(const detail of error.details || []) console.error(`- ${detail}`);
    process.exitCode = 1;
  });
}
