import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildHosting,
  validateAllowlist
} from "./build-hosting.mjs";
import {
  applyCacheCorrections,
  entryDigest,
  firebaseConfigView,
  hashRuntimeFiles,
  hostingHash,
  liveConfigView,
  loadLiveChannel,
  loadLiveFiles,
  normaliseNewlines,
  pathDigest,
  readGitFile,
  sameList,
  sha256,
  verifyLiveChannelResult,
  writeRuntimeFile
} from "./prepare-billing-hosting-release.mjs";

export const RELEASE_RECIPE = "hosting-launch-readiness-release.json";
export const RELEASE_STAGE = path.join("dist", "launch-readiness-hosting-release");
export const RELEASE_SOURCE = path.join(RELEASE_STAGE, "source");
export const RELEASE_PUBLIC = path.join(RELEASE_SOURCE, "dist", "hosting");
export const RELEASE_REPORT = "launch-readiness-release-verification.json";
export const DEPLOY_COMMAND =
  "firebase deploy --only hosting:main --project simple-books-office";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function assertExactLaunchReleasePath(root, candidate){
  const expected = path.resolve(root, RELEASE_STAGE);
  const actual = path.resolve(candidate);
  const canonical = value => process.platform === "win32" ? value.toLowerCase() : value;
  if(canonical(expected) !== canonical(actual)){
    throw new Error(`Refusing unexpected launch-readiness release path: ${actual}`);
  }
  return actual;
}

export function stageLaunchFirebaseConfiguration(hosting){
  return {
    hosting: [{
      ...hosting,
      public: "source/dist/hosting",
      predeploy: ["npm.cmd --prefix ../.. run prepare:hosting:launch"]
    }]
  };
}

async function reconstructDeployedBillingBaseline({root, sourceRoot, billingRecipe}){
  const historicalManifest = JSON.parse(readGitFile(
    root,
    billingRecipe.historicalRuntimeGitRevision,
    "hosting-runtime-files.json"
  ).toString("utf8"));
  const files = validateAllowlist(historicalManifest.files);
  if(files.length !== billingRecipe.runtimeFileCount ||
      pathDigest(files) !== billingRecipe.runtimePathDigest){
    throw new Error("Historical billing runtime inventory changed");
  }

  const workingFiles = new Set(billingRecipe.baselineWorkingTreeFiles);
  const baselineOnly = new Map(Object.entries(billingRecipe.baselineOnlyHostingHashes));
  const baselineHashes = new Map(baselineOnly);
  const workingEntries = [];
  let gitExactCount = 0;

  for(const relativePath of files){
    if(baselineOnly.has(relativePath)) continue;
    const contents = workingFiles.has(relativePath)
      ? await readFile(path.join(root, ...relativePath.split("/")))
      : readGitFile(root, billingRecipe.baselineGitRevision, relativePath);
    if(workingFiles.has(relativePath)) workingEntries.push([relativePath, hostingHash(contents)]);
    else gitExactCount += 1;
    baselineHashes.set(relativePath, hostingHash(contents));
    await writeRuntimeFile(sourceRoot, relativePath, contents);
  }

  if(gitExactCount !== billingRecipe.baselineGitExactCount){
    throw new Error(`Unexpected historical Git baseline count: ${gitExactCount}`);
  }
  if(entryDigest(workingEntries) !== billingRecipe.baselineWorkingTreeDigest){
    throw new Error("Historical hash-locked live baseline exceptions changed");
  }
  if(entryDigest([...baselineHashes]) !== billingRecipe.baselineHostingDigest){
    throw new Error("Historical pre-billing baseline reconstruction changed");
  }

  const overlayEntries = [];
  const correctedFiles = [];
  for(const relativePath of billingRecipe.billingOverlayFiles){
    const current = await readFile(path.join(root, ...relativePath.split("/")));
    const reviewed = readGitFile(root, billingRecipe.billingGitRevision, relativePath)
      .toString("utf8");
    const corrected = applyCacheCorrections(relativePath, reviewed);
    if(corrected !== reviewed) correctedFiles.push(relativePath);
    if(normaliseNewlines(current.toString("utf8")) !== normaliseNewlines(corrected)){
      throw new Error(`Historical billing overlay drifted: ${relativePath}`);
    }
    overlayEntries.push([relativePath, sha256(current)]);
    await writeRuntimeFile(sourceRoot, relativePath, current);
  }
  if(!sameList(correctedFiles, billingRecipe.cacheCorrectionFiles) ||
      entryDigest(overlayEntries) !== billingRecipe.billingOverlayDigest){
    throw new Error("Historical billing overlay reconstruction changed");
  }

  const entries = await hashRuntimeFiles(sourceRoot, files);
  if(entryDigest(entries) !== billingRecipe.finalHostingDigest){
    throw new Error("Reconstructed deployed billing baseline digest changed");
  }
  return {files, entries};
}

function assertReleaseRuntime(runtimeFiles, recipe){
  if(runtimeFiles.length !== recipe.runtimeFileCount ||
      pathDigest(runtimeFiles) !== recipe.runtimePathDigest){
    throw new Error("Reviewed launch-readiness Hosting inventory changed");
  }
  for(const relativePath of [
    "privacy.html",
    "terms.html",
    "assets/legal.css",
    "assets/analytics-consent.js",
    "assets/analytics-consent.css",
    "firebase-config.js",
    "resources/js/firebase-runtime.js"
  ]){
    if(!runtimeFiles.includes(relativePath)){
      throw new Error(`Required launch runtime file is absent: ${relativePath}`);
    }
  }
}

function assertRuntimeBoundaries(sourceRoot, recipe, root){
  return Promise.all([
    readFile(path.join(sourceRoot, "firebase-config.js"), "utf8"),
    readFile(path.join(sourceRoot, "resources", "js", "firebase-runtime.js"), "utf8"),
    readFile(path.join(sourceRoot, "account.html"), "utf8"),
    readFile(path.join(sourceRoot, "resources", "js", "stripe-billing-config.js"), "utf8"),
    readFile(path.join(sourceRoot, "assets", "sentry-monitoring.js"), "utf8")
  ]).then(async ([firebaseConfig, firebaseRuntime, account, stripeConfig, sentry]) => {
    for(const essential of ["getAuth(app)", "getFirestore(app)", "getFunctions(app", "getStorage(app)"]){
      if(!firebaseConfig.includes(essential)) throw new Error(`Essential Firebase service missing: ${essential}`);
    }
    if(!firebaseConfig.includes("prepareFirebaseAnalyticsConsent") ||
        !firebaseConfig.includes("setAnalyticsCollectionEnabled") ||
        !firebaseConfig.includes("firebaseEmulatorsRequested(window)")){
      throw new Error("Firebase consent or explicit emulator boundary is missing");
    }
    if(!firebaseRuntime.includes("FIREBASE_EMULATOR_SESSION_KEY") ||
        !firebaseRuntime.includes("firebaseEmulatorsRequested")){
      throw new Error("Explicit Firebase emulator routing is missing");
    }
    if(!account.includes("const ACCOUNT_CHECKOUT_ENABLED = false;") ||
        recipe.expectedStripeConfiguration.checkoutEnabled !== false){
      throw new Error("Candidate frontend checkout is not disabled");
    }
    if(!stripeConfig.includes(`LIVE_PRO_PRICE_ID = "${recipe.expectedStripeConfiguration.priceId}"`) ||
        !stripeConfig.includes('expectedMode: testMode ? "test" : "live"')){
      throw new Error("Preserved live Stripe frontend configuration changed");
    }
    if(!sentry.includes("sendDefaultPii: false") || !sentry.includes("beforeSend: sanitiseEvent")){
      throw new Error("Preserved Sentry privacy controls changed");
    }
    const functionsEnvironment = await readFile(
      path.join(root, "functions", ".env.simple-books-office"),
      "utf8"
    );
    if(!/^STRIPE_CHECKOUT_ENABLED=false$/m.test(functionsEnvironment)){
      throw new Error("Production Functions checkout configuration is not disabled");
    }
  });
}

export async function prepareLaunchReadinessHostingRelease({
  root = projectRoot,
  liveChannelResult,
  liveFilesResult
} = {}){
  const recipe = JSON.parse(await readFile(path.join(root, RELEASE_RECIPE), "utf8"));
  const billingRecipe = JSON.parse(await readFile(
    path.join(root, recipe.historicalBaselineRecipe),
    "utf8"
  ));
  billingRecipe.historicalRuntimeGitRevision = recipe.historicalRuntimeGitRevision;
  if(recipe.schemaVersion !== 1 || recipe.releaseName !== "launch-readiness"){
    throw new Error("Unsupported launch-readiness release recipe");
  }

  const runtimeManifest = JSON.parse(await readFile(
    path.join(root, "hosting-runtime-files.json"),
    "utf8"
  ));
  const runtimeFiles = validateAllowlist(runtimeManifest.files);
  assertReleaseRuntime(runtimeFiles, recipe);

  const firebase = JSON.parse(await readFile(path.join(root, "firebase.json"), "utf8"));
  const hosting = firebase.hosting.find(item => item.target === recipe.target);
  if(!hosting) throw new Error("Main Hosting target is missing");
  if(sha256(Buffer.from(JSON.stringify(firebaseConfigView(hosting)))) !== recipe.hostingConfigDigest){
    throw new Error("Hosting headers, redirects or rewrites changed");
  }

  const live = liveChannelResult
    ? verifyLiveChannelResult(liveChannelResult, recipe)
    : loadLiveChannel(recipe, root);
  if(sha256(Buffer.from(JSON.stringify(liveConfigView(live.version.config)))) !==
      recipe.hostingConfigDigest){
    throw new Error("Live Hosting configuration no longer matches the release recipe");
  }
  const liveFiles = liveFilesResult || await loadLiveFiles(recipe, live.versionId, root);
  const liveStaticEntries = [];
  const managedPaths = [];
  for(const file of liveFiles){
    const relativePath = String(file.path || "").replace(/^\//, "");
    if(relativePath.startsWith("__/")) managedPaths.push(relativePath);
    else liveStaticEntries.push([relativePath, file.hash]);
  }
  liveStaticEntries.sort(([left], [right]) => left.localeCompare(right));
  managedPaths.sort();
  if(liveStaticEntries.length !== recipe.baselineFileCount ||
      entryDigest(liveStaticEntries) !== recipe.baselineHostingDigest){
    throw new Error("Current live Hosting manifest differs from the verified billing release");
  }
  if(!sameList(managedPaths, recipe.expectedManagedPaths)){
    throw new Error("Firebase-managed live file inventory changed");
  }

  const stageRoot = assertExactLaunchReleasePath(root, path.join(root, RELEASE_STAGE));
  const sourceRoot = path.join(root, RELEASE_SOURCE);
  await rm(sourceRoot, {recursive: true, force: true});
  await mkdir(sourceRoot, {recursive: true});

  const baseline = await reconstructDeployedBillingBaseline({
    root,
    sourceRoot,
    billingRecipe
  });
  const reconstructed = new Map(baseline.entries);
  if(!sameList(baseline.files, liveStaticEntries.map(([relativePath]) => relativePath))){
    throw new Error("Reconstructed baseline paths differ from current live Hosting");
  }
  for(const [relativePath, hash] of liveStaticEntries){
    if(reconstructed.get(relativePath) !== hash){
      throw new Error(`Reconstructed baseline differs from live bytes: ${relativePath}`);
    }
  }

  const expectedOverlay = [
    ...recipe.expectedDifferences.additions,
    ...recipe.expectedDifferences.modifications
  ];
  if(!sameList(recipe.overlayFiles, expectedOverlay)){
    throw new Error("Launch overlay and expected difference scope disagree");
  }
  const overlayEntries = [];
  for(const relativePath of recipe.overlayFiles){
    const contents = readGitFile(root, recipe.releaseGitRevision, relativePath);
    const current = await readFile(path.join(root, ...relativePath.split("/")));
    if(normaliseNewlines(current.toString("utf8")) !==
        normaliseNewlines(contents.toString("utf8"))){
      throw new Error(`Launch overlay drifted from reviewed commit: ${relativePath}`);
    }
    overlayEntries.push([relativePath, sha256(current)]);
    await writeRuntimeFile(sourceRoot, relativePath, current);
  }
  if(entryDigest(overlayEntries) !== recipe.overlayDigest){
    throw new Error("Launch overlay byte inventory changed");
  }
  for(const relativePath of recipe.requiredPreservedFiles){
    if(recipe.overlayFiles.includes(relativePath) || !reconstructed.has(relativePath)){
      throw new Error(`Required live file is not preserved: ${relativePath}`);
    }
  }
  await assertRuntimeBoundaries(sourceRoot, recipe, root);

  const build = await buildHosting({
    projectRoot: sourceRoot,
    files: runtimeFiles,
    expectedExistingMissingReferences: recipe.knownBaselineMissingReferences
  });
  const finalEntries = await hashRuntimeFiles(build.outputRoot, runtimeFiles);
  const finalHashes = new Map(finalEntries);
  const baselineHashes = new Map(liveStaticEntries);
  const differences = {additions: [], modifications: [], deletions: []};
  for(const [relativePath, hash] of finalHashes){
    if(!baselineHashes.has(relativePath)) differences.additions.push(relativePath);
    else if(baselineHashes.get(relativePath) !== hash) differences.modifications.push(relativePath);
  }
  for(const relativePath of baselineHashes.keys()){
    if(!finalHashes.has(relativePath)) differences.deletions.push(relativePath);
  }
  for(const key of Object.keys(differences)) differences[key].sort();
  for(const key of Object.keys(differences)){
    if(!sameList(differences[key], recipe.expectedDifferences[key])){
      throw new Error(`Unexpected launch ${key}: ${JSON.stringify(differences[key])}`);
    }
  }
  if(entryDigest(finalEntries) !== recipe.finalHostingDigest){
    throw new Error("Final launch-readiness Hosting byte inventory changed");
  }

  await writeFile(
    path.join(stageRoot, "firebase.json"),
    `${JSON.stringify(stageLaunchFirebaseConfiguration(hosting), null, 2)}\n`
  );
  await writeFile(path.join(stageRoot, ".firebaserc"), `${JSON.stringify({
    projects: {default: recipe.project},
    targets: {
      [recipe.project]: {hosting: {[recipe.target]: [recipe.site]}}
    },
    etags: {}
  }, null, 2)}\n`);

  const report = {
    schemaVersion: 1,
    releaseName: recipe.releaseName,
    project: recipe.project,
    site: recipe.site,
    target: recipe.target,
    verifiedLiveBaseline: {
      version: live.versionId,
      staticFiles: liveStaticEntries.length,
      digest: entryDigest(liveStaticEntries),
      firebaseManagedPaths: managedPaths
    },
    reviewedGitRevisions: {
      legal: recipe.legalGitRevision,
      release: recipe.releaseGitRevision
    },
    differences,
    totalFiles: finalHashes.size,
    finalHostingDigest: recipe.finalHostingDigest,
    hostingConfiguration: {
      preserved: true,
      digest: recipe.hostingConfigDigest
    },
    checkoutDisabled: {
      frontend: true,
      productionFunctionsConfiguration: true
    },
    knownBaselineMissingReferences: build.dependencyAudit.missingReferences,
    deploymentWorkingDirectory: RELEASE_STAGE.split(path.sep).join("/"),
    deploymentCommand: DEPLOY_COMMAND
  };
  await writeFile(
    path.join(stageRoot, RELEASE_REPORT),
    `${JSON.stringify(report, null, 2)}\n`
  );
  return {stageRoot, publicRoot: build.outputRoot, report};
}

async function main(){
  const result = await prepareLaunchReadinessHostingRelease();
  console.log(JSON.stringify(result.report, null, 2));
  console.log(`Prepared launch-readiness Hosting release at ${result.stageRoot}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if(invokedPath === import.meta.url){
  main().catch(error => {
    console.error(error.message);
    for(const detail of error.details || []) console.error(`- ${detail}`);
    process.exitCode = 1;
  });
}
