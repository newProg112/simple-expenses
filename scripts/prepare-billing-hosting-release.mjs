import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
  buildHosting,
  validateAllowlist
} from "./build-hosting.mjs";

export const RELEASE_RECIPE = "hosting-billing-release.json";
export const RELEASE_STAGE = path.join("dist", "billing-hosting-release");
export const RELEASE_SOURCE = path.join(RELEASE_STAGE, "source");
export const RELEASE_PUBLIC = path.join(RELEASE_SOURCE, "dist", "hosting");
export const CACHE_TOKEN = "20260902-stripe-live2";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function hostingHash(value) {
  return sha256(gzipSync(value, { level: 9 }));
}

export function entryDigest(entries) {
  const canonical = [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([relativePath, hash]) => `${relativePath}\0${hash}\n`)
    .join("");
  return sha256(Buffer.from(canonical));
}

export function pathDigest(files) {
  return entryDigest(files.map(relativePath => [relativePath, "path"]));
}

export function normaliseNewlines(value) {
  return String(value).replace(/\r\n/g, "\n");
}

export function applyCacheCorrections(relativePath, input) {
  let source = String(input).replaceAll(
    "20260901-stripe-live1",
    CACHE_TOKEN
  );
  if (relativePath === "account.html") {
    source = source.replace(
      "assets/account-access-state.js?v=20260806-demo-pro3",
      `assets/account-access-state.js?v=${CACHE_TOKEN}`
    );
  }
  const imports = {
    "resources/js/canonical-workbook-phase4a.js": [
      ["./canonical-workbook-preflight.js", `./canonical-workbook-preflight.js?v=${CACHE_TOKEN}`],
      ["./project-access.js", `./project-access.js?v=${CACHE_TOKEN}`]
    ],
    "resources/js/canonical-workbook-phase4b.js": [
      ["./canonical-workbook-phase4a.js", `./canonical-workbook-phase4a.js?v=${CACHE_TOKEN}`],
      ["./canonical-workbook-preflight.js", `./canonical-workbook-preflight.js?v=${CACHE_TOKEN}`]
    ],
    "resources/js/canonical-workbook-phase4c.js": [
      ["./canonical-workbook-phase4b.js", `./canonical-workbook-phase4b.js?v=${CACHE_TOKEN}`]
    ],
    "resources/js/canonical-workbook-preflight.js": [
      ["./project-access.js", `./project-access.js?v=${CACHE_TOKEN}`]
    ]
  };
  for (const [before, after] of imports[relativePath] || []) {
    source = source.replace(before, after);
  }
  return source;
}

export function assertExactReleasePath(root, candidate) {
  const expected = path.resolve(root, RELEASE_STAGE);
  const actual = path.resolve(candidate);
  const canonical = value => process.platform === "win32" ? value.toLowerCase() : value;
  if (canonical(expected) !== canonical(actual)) {
    throw new Error(`Refusing unexpected billing release path: ${actual}`);
  }
  return actual;
}

function readGitFile(root, revision, relativePath) {
  return execFileSync("git", [
    "-c",
    `safe.directory=${root.split(path.sep).join("/")}`,
    "show",
    `${revision}:${relativePath}`
  ], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 100 * 1024 * 1024
  });
}

function sameList(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function firebaseConfigView(hosting) {
  return {
    headers: (hosting.headers || []).map(item => ({
      headers: Object.fromEntries((item.headers || []).map(header => [header.key, header.value])),
      glob: item.source
    })),
    rewrites: (hosting.rewrites || []).map(item => ({
      glob: item.source,
      path: item.destination
    })),
    redirects: (hosting.redirects || []).map(item => ({
      glob: item.source,
      location: item.destination,
      statusCode: item.type
    }))
  };
}

function liveConfigView(config = {}) {
  return {
    headers: config.headers || [],
    rewrites: config.rewrites || [],
    redirects: config.redirects || []
  };
}

export function stageFirebaseConfiguration(hosting) {
  return {
    hosting: [{
      ...hosting,
      public: "source/dist/hosting",
      predeploy: ["npm.cmd --prefix ../.. run prepare:hosting:billing"]
    }]
  };
}

export function verifyLiveChannelResult(result, recipe) {
  const channels = result?.result?.channels || [];
  const channel = channels.find(item => item.name?.endsWith("/channels/live"));
  const version = channel?.release?.version;
  const versionId = version?.name?.split("/").pop() || "";
  if (versionId !== recipe.baselineHostingVersion) {
    throw new Error(`LIVE_BASELINE_CHANGED:${versionId || "unknown"}`);
  }
  const expectedCount = recipe.baselineFileCount + recipe.expectedManagedPaths.length;
  if (Number(version.fileCount) !== expectedCount) {
    throw new Error(`LIVE_FILE_COUNT_CHANGED:${version.fileCount || "unknown"}`);
  }
  return { channel, version, versionId };
}

function loadLiveChannel(recipe, root) {
  const command = process.platform === "win32" ? "firebase.cmd" : "firebase";
  const result = spawnSync(command, [
    "hosting:channel:list",
    "--site", recipe.site,
    "--project", recipe.project,
    "--json"
  ], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`Unable to verify live Hosting baseline: ${(result.stderr || "").trim()}`);
  }
  return verifyLiveChannelResult(JSON.parse(result.stdout), recipe);
}

function firebaseToolsLibraryRoot() {
  const candidates = [];
  try {
    candidates.push(path.join(path.dirname(require.resolve("firebase-tools/package.json")), "lib"));
  } catch {
    // Firebase CLI may be installed globally rather than in this project.
  }
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib"));
  }
  const found = candidates.find(candidate => existsSync(path.join(candidate, "auth.js")));
  if (!found) throw new Error("Installed Firebase CLI libraries are unavailable for manifest verification");
  return found;
}

async function loadLiveFiles(recipe, versionId, root) {
  const libraryRoot = firebaseToolsLibraryRoot();
  const auth = require(path.join(libraryRoot, "auth.js"));
  const { Client } = require(path.join(libraryRoot, "apiv2.js"));
  const account = auth.getProjectDefaultAccount(root);
  if (!account) throw new Error("No configured Firebase CLI account is available");
  auth.setActiveAccount({}, account);
  const client = new Client({
    urlPrefix: "https://firebasehosting.googleapis.com",
    auth: true,
    apiVersion: "v1beta1"
  });
  const files = [];
  let pageToken = "";
  do {
    const queryParams = { pageSize: 1000 };
    if (pageToken) queryParams.pageToken = pageToken;
    const response = await client.get(
      `/projects/${recipe.project}/sites/${recipe.site}/versions/${versionId}/files`,
      { queryParams }
    );
    files.push(...(response.body.files || []));
    pageToken = response.body.nextPageToken || "";
  } while (pageToken);
  return files;
}

async function writeRuntimeFile(root, relativePath, contents) {
  const destination = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

async function hashRuntimeFiles(root, files) {
  const entries = [];
  for (const relativePath of files) {
    entries.push([
      relativePath,
      hostingHash(await readFile(path.join(root, ...relativePath.split("/"))))
    ]);
  }
  return entries;
}

function assertStripeConfiguration(source, recipe) {
  const expected = recipe.expectedStripeConfiguration;
  if (!source.includes(`LIVE_PRO_PRICE_ID = "${expected.priceId}"`)) {
    throw new Error("Billing overlay has the wrong live Stripe price");
  }
  if (!source.includes('expectedMode: testMode ? "test" : "live"')) {
    throw new Error("Billing overlay does not fail closed to live mode outside local Firebase");
  }
  if (expected.checkoutEnabled !== false) {
    throw new Error("Billing release recipe must keep checkout disabled");
  }
}

export async function prepareBillingHostingRelease({
  root = projectRoot,
  liveChannelResult
} = {}) {
  const recipe = JSON.parse(await readFile(path.join(root, RELEASE_RECIPE), "utf8"));
  if (recipe.schemaVersion !== 1) throw new Error("Unsupported billing release recipe");

  const runtimeManifest = JSON.parse(
    await readFile(path.join(root, "hosting-runtime-files.json"), "utf8")
  );
  const runtimeFiles = validateAllowlist(runtimeManifest.files);
  if (runtimeFiles.length !== recipe.runtimeFileCount ||
      pathDigest(runtimeFiles) !== recipe.runtimePathDigest) {
    throw new Error("Reviewed Hosting runtime inventory changed");
  }
  if (!runtimeFiles.includes("resources/js/stripe-billing-config.js")) {
    throw new Error("Stripe billing configuration is absent from the reviewed inventory");
  }

  const live = liveChannelResult
    ? verifyLiveChannelResult(liveChannelResult, recipe)
    : loadLiveChannel(recipe, root);

  let liveStaticFileCount = recipe.baselineFileCount;
  let firebaseManagedPaths = [];
  if (!liveChannelResult) {
    const liveFiles = await loadLiveFiles(recipe, live.versionId, root);
    const staticEntries = [];
    for (const file of liveFiles) {
      const relativePath = String(file.path || "").replace(/^\//, "");
      if (relativePath.startsWith("__/")) firebaseManagedPaths.push(relativePath);
      else staticEntries.push([relativePath, file.hash]);
    }
    staticEntries.sort(([left], [right]) => left.localeCompare(right));
    firebaseManagedPaths.sort();
    liveStaticFileCount = staticEntries.length;
    if (liveStaticFileCount !== recipe.baselineFileCount ||
        entryDigest(staticEntries) !== recipe.baselineHostingDigest) {
      throw new Error("Current live Hosting manifest differs from the verified containment baseline");
    }
    if (!sameList(firebaseManagedPaths, recipe.expectedManagedPaths)) {
      throw new Error("Firebase-managed live file inventory changed");
    }
  }

  const firebase = JSON.parse(await readFile(path.join(root, "firebase.json"), "utf8"));
  const hosting = firebase.hosting.find(item => item.target === recipe.target);
  if (!hosting) throw new Error("Main Hosting target is missing");
  if (sha256(Buffer.from(JSON.stringify(firebaseConfigView(hosting)))) !==
      recipe.hostingConfigDigest) {
    throw new Error("Hosting headers, redirects or rewrites changed");
  }
  if (sha256(Buffer.from(JSON.stringify(liveConfigView(live.version.config)))) !==
      recipe.hostingConfigDigest) {
    throw new Error("Live Hosting configuration no longer matches the release recipe");
  }

  const stageRoot = assertExactReleasePath(root, path.join(root, RELEASE_STAGE));
  const sourceRoot = path.join(root, RELEASE_SOURCE);
  await rm(sourceRoot, { recursive: true, force: true });
  await mkdir(sourceRoot, { recursive: true });

  const additionSet = new Set(recipe.expectedDifferences.additions);
  const baselineFiles = runtimeFiles.filter(file => !additionSet.has(file));
  if (baselineFiles.length !== recipe.baselineFileCount) {
    throw new Error("Baseline file count changed");
  }
  const workingFiles = new Set(recipe.baselineWorkingTreeFiles);
  const baselineOnly = new Map(Object.entries(recipe.baselineOnlyHostingHashes));
  const baselineHashes = new Map(baselineOnly);
  const workingEntries = [];
  let gitExactCount = 0;

  for (const relativePath of baselineFiles) {
    if (baselineOnly.has(relativePath)) continue;
    const contents = workingFiles.has(relativePath)
      ? await readFile(path.join(root, ...relativePath.split("/")))
      : readGitFile(root, recipe.baselineGitRevision, relativePath);
    if (workingFiles.has(relativePath)) {
      workingEntries.push([relativePath, hostingHash(contents)]);
    } else {
      gitExactCount += 1;
    }
    baselineHashes.set(relativePath, hostingHash(contents));
    await writeRuntimeFile(sourceRoot, relativePath, contents);
  }
  if (gitExactCount !== recipe.baselineGitExactCount) {
    throw new Error(`Unexpected Git baseline count: ${gitExactCount}`);
  }
  if (entryDigest(workingEntries) !== recipe.baselineWorkingTreeDigest) {
    throw new Error("Hash-locked live baseline exceptions changed");
  }
  if (entryDigest([...baselineHashes]) !== recipe.baselineHostingDigest) {
    throw new Error("Reconstructed baseline does not match ba9ff337be8b742e");
  }

  const overlayEntries = [];
  const correctedFiles = [];
  for (const relativePath of recipe.billingOverlayFiles) {
    const current = await readFile(path.join(root, ...relativePath.split("/")));
    const reviewed = readGitFile(root, recipe.billingGitRevision, relativePath).toString("utf8");
    const corrected = applyCacheCorrections(relativePath, reviewed);
    if (corrected !== reviewed) correctedFiles.push(relativePath);
    if (normaliseNewlines(current.toString("utf8")) !== normaliseNewlines(corrected)) {
      throw new Error(`Billing overlay drifted from reviewed source: ${relativePath}`);
    }
    overlayEntries.push([relativePath, sha256(current)]);
    await writeRuntimeFile(sourceRoot, relativePath, current);
  }
  if (!sameList(correctedFiles, recipe.cacheCorrectionFiles)) {
    throw new Error("Recovered cache-correction scope changed");
  }
  if (entryDigest(overlayEntries) !== recipe.billingOverlayDigest) {
    throw new Error("Billing overlay byte inventory changed");
  }
  assertStripeConfiguration(
    (await readFile(path.join(sourceRoot, "resources/js/stripe-billing-config.js"))).toString("utf8"),
    recipe
  );

  const build = await buildHosting({
    projectRoot: sourceRoot,
    files: runtimeFiles,
    expectedExistingMissingReferences: recipe.knownBaselineMissingReferences
  });
  const finalEntries = await hashRuntimeFiles(build.outputRoot, runtimeFiles);
  const finalHashes = new Map(finalEntries);
  const differences = { additions: [], modifications: [], deletions: [] };
  for (const [relativePath, hash] of finalHashes) {
    if (!baselineHashes.has(relativePath)) differences.additions.push(relativePath);
    else if (baselineHashes.get(relativePath) !== hash) differences.modifications.push(relativePath);
  }
  for (const relativePath of baselineHashes.keys()) {
    if (!finalHashes.has(relativePath)) differences.deletions.push(relativePath);
  }
  for (const key of Object.keys(differences)) differences[key].sort();
  if (!sameList(differences.additions, recipe.expectedDifferences.additions) ||
      !sameList(differences.modifications, recipe.expectedDifferences.modifications) ||
      !sameList(differences.deletions, recipe.expectedDifferences.deletions)) {
    throw new Error(`Unexpected release differences: ${JSON.stringify(differences)}`);
  }
  if (entryDigest(finalEntries) !== recipe.finalHostingDigest) {
    throw new Error("Final Hosting byte inventory changed");
  }

  await mkdir(stageRoot, { recursive: true });
  await writeFile(
    path.join(stageRoot, "firebase.json"),
    `${JSON.stringify(stageFirebaseConfiguration(hosting), null, 2)}\n`
  );
  await writeFile(path.join(stageRoot, ".firebaserc"), `${JSON.stringify({
    projects: { default: recipe.project },
    targets: {
      [recipe.project]: { hosting: { [recipe.target]: [recipe.site] } }
    },
    etags: {}
  }, null, 2)}\n`);
  const report = {
    preparedAt: new Date().toISOString(),
    project: recipe.project,
    site: recipe.site,
    target: recipe.target,
    verifiedLiveVersion: live.versionId,
    liveStaticFilesVerified: liveStaticFileCount,
    firebaseManagedPaths,
    baselineFiles: baselineHashes.size,
    releaseFiles: finalHashes.size,
    differences,
    finalHostingDigest: recipe.finalHostingDigest,
    hostingConfigurationPreserved: true,
    checkoutEnabled: false,
    legalDraftsIncluded: false,
    knownBaselineMissingReferences: build.dependencyAudit.missingReferences
  };
  await writeFile(
    path.join(stageRoot, "billing-release-verification.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  return { stageRoot, publicRoot: build.outputRoot, report };
}

async function main() {
  const result = await prepareBillingHostingRelease();
  console.log(JSON.stringify(result.report, null, 2));
  console.log(`Prepared billing-only Hosting release at ${result.stageRoot}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error.message);
    for (const detail of error.details || []) console.error(`- ${detail}`);
    process.exitCode = 1;
  });
}
