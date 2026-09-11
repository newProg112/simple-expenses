import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {
  auditRuntimeDependencies,
  validateAllowlist,
  validateOutputInventory
} from "./build-hosting.mjs";
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
  verifyLiveChannelResult
} from "./prepare-billing-hosting-release.mjs";
import {
  RELEASE_PUBLIC,
  RELEASE_RECIPE,
  RELEASE_STAGE,
  ROLLBACK_PUBLIC,
  assertExactActivationReleasePath,
  assertRuntimeBoundaries,
  liveInventory,
  stageActivationFirebaseConfiguration,
  stageRollbackFirebaseConfiguration
} from "./prepare-stripe-live-activation-hosting-release.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/,
  /\bwhsec_[A-Za-z0-9]+/,
  /"private_key"\s*:/
];
const inspectedTextExtensions = new Set([".css", ".html", ".js", ".json", ".webmanifest"]);

async function assertNoCredentialMaterial(runtimeRoot, runtimeFiles){
  for(const relativePath of runtimeFiles){
    if(!inspectedTextExtensions.has(path.extname(relativePath).toLowerCase())) continue;
    const contents = await readFile(path.join(runtimeRoot, ...relativePath.split("/")), "utf8");
    if(credentialPatterns.some(pattern => pattern.test(contents))){
      throw new Error(`Credential-like material found in Hosting output: ${relativePath}`);
    }
  }
}

function differencesBetween(baselineEntries, candidateEntries){
  const baseline = new Map(baselineEntries);
  const candidate = new Map(candidateEntries);
  const differences = {additions: [], modifications: [], deletions: []};
  for(const [relativePath, hash] of candidate){
    if(!baseline.has(relativePath)) differences.additions.push(relativePath);
    else if(baseline.get(relativePath) !== hash) differences.modifications.push(relativePath);
  }
  for(const relativePath of baseline.keys()){
    if(!candidate.has(relativePath)) differences.deletions.push(relativePath);
  }
  for(const values of Object.values(differences)) values.sort();
  return differences;
}

export async function verifyPreparedStripeLiveActivationHostingRelease({
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
  const stageRoot = assertExactActivationReleasePath(root, path.join(root, RELEASE_STAGE));
  const stagedFirebase = JSON.parse(await readFile(path.join(stageRoot, "firebase.json"), "utf8"));
  const rollbackFirebase = JSON.parse(await readFile(
    path.join(root, RELEASE_STAGE, "rollback", "firebase.json"), "utf8"
  ));
  if(JSON.stringify(stagedFirebase) !== JSON.stringify(stageActivationFirebaseConfiguration(hosting)) ||
      JSON.stringify(rollbackFirebase) !== JSON.stringify(stageRollbackFirebaseConfiguration(hosting))){
    throw new Error("Prepared activation or rollback Firebase configuration changed");
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

  const candidateRoot = path.join(root, RELEASE_PUBLIC);
  const rollbackRoot = path.join(root, ROLLBACK_PUBLIC);
  await validateOutputInventory(candidateRoot, runtimeFiles);
  await validateOutputInventory(rollbackRoot, runtimeFiles);
  await Promise.all([
    assertNoCredentialMaterial(candidateRoot, runtimeFiles),
    assertNoCredentialMaterial(rollbackRoot, runtimeFiles)
  ]);
  const [candidateAudit, rollbackAudit] = await Promise.all([
    auditRuntimeDependencies(candidateRoot, runtimeFiles),
    auditRuntimeDependencies(rollbackRoot, runtimeFiles)
  ]);
  for(const [label, audit] of [["candidate", candidateAudit], ["rollback", rollbackAudit]]){
    if(audit.excludedReferences.length ||
        !sameList(audit.missingReferences, recipe.knownBaselineMissingReferences)){
      throw new Error(`Prepared ${label} dependency or secret containment changed`);
    }
  }

  const [candidateEntries, rollbackEntries] = await Promise.all([
    hashRuntimeFiles(candidateRoot, runtimeFiles),
    hashRuntimeFiles(rollbackRoot, runtimeFiles)
  ]);
  const differences = differencesBetween(liveEntries, candidateEntries);
  for(const key of Object.keys(differences)){
    if(!sameList(differences[key], recipe.expectedDifferences[key])){
      throw new Error(`Unexpected prepared activation ${key}: ${JSON.stringify(differences[key])}`);
    }
  }
  if(entryDigest(candidateEntries) !== recipe.finalHostingDigest){
    throw new Error("Prepared activation digest changed");
  }
  if(entryDigest(rollbackEntries) !== recipe.baselineHostingDigest){
    throw new Error("Prepared rollback is not byte-identical to the live baseline");
  }
  await assertRuntimeBoundaries(root, candidateRoot, rollbackRoot, recipe);

  return {
    verifiedLiveVersion: live.versionId,
    liveStaticFiles: liveEntries.length,
    candidateDigest: entryDigest(candidateEntries),
    rollbackDigest: entryDigest(rollbackEntries),
    differences,
    configurationPreserved: true,
    credentialMaterialAbsent: true,
    checkoutFlagsVerified: true,
    readOnlyVerification: true
  };
}

async function main(){
  const result = await verifyPreparedStripeLiveActivationHostingRelease();
  console.log(JSON.stringify(result, null, 2));
  console.log("Verified prepared Stripe-live activation release without modifying the artifact.");
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if(invokedPath === import.meta.url){
  main().catch(error => {
    console.error(error.message);
    for(const detail of error.details || []) console.error(`- ${detail}`);
    process.exitCode = 1;
  });
}
