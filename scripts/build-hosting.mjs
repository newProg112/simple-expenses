import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GENERATED_OUTPUT = path.join("dist", "hosting");
export const MANIFEST_FILE = "hosting-runtime-files.json";
export const EXCLUDED_LOCAL_FILES = new Set([
  "privacy.html",
  "terms.html",
  "assets/legal.css"
]);

const FORBIDDEN_TOP_LEVEL_DIRECTORIES = new Set([
  "docs",
  "functions",
  "manual-tests",
  "migration-private",
  "migration-reports",
  "node_modules",
  "scripts",
  "tests"
]);
const FORBIDDEN_ROOT_FILES = new Set([
  ".firebaserc",
  "firebase.json",
  "firestore.indexes.json",
  "firestore.rules",
  "package-lock.json",
  "package.json",
  "roadmap.md",
  "storage-cors.json",
  "storage.rules",
  "testing.md",
  "vitest.config.js"
]);
const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".webmanifest"]);
const RUNTIME_REFERENCE_EXTENSIONS = new Set([
  ".apk", ".css", ".gif", ".html", ".ico", ".jpeg", ".jpg", ".js",
  ".json", ".png", ".svg", ".webmanifest", ".webp", ".xlsm", ".xlsx"
]);
const FIREBASE_MANAGED_REFERENCES = new Set([
  "__/firebase/init.js",
  "__/firebase/init.json"
]);

export class HostingBuildError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "HostingBuildError";
    this.details = details;
  }
}

export function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

export function assertSafeOutputPath(projectRoot, outputRoot) {
  const resolvedProject = path.resolve(projectRoot);
  const expected = path.resolve(resolvedProject, GENERATED_OUTPUT);
  const actual = path.resolve(outputRoot);
  const normaliseCase = value => process.platform === "win32" ? value.toLowerCase() : value;

  if (normaliseCase(actual) !== normaliseCase(expected)) {
    throw new HostingBuildError(
      `Refusing to clean unexpected Hosting output path: ${actual}`
    );
  }
  if (normaliseCase(actual) === normaliseCase(resolvedProject)) {
    throw new HostingBuildError("Refusing to clean the project root");
  }
  return actual;
}

export function forbiddenRuntimeReason(relativePath) {
  const value = String(relativePath || "").replaceAll("\\", "/");
  const segments = value.split("/");
  const basename = segments.at(-1) || "";
  const lowerSegments = segments.map(segment => segment.toLowerCase());
  const lowerValue = value.toLowerCase();
  const lower = basename.toLowerCase();

  if (!value || value.startsWith("/") || value.includes("../") || value === "..") {
    return "path must be a project-relative file path";
  }
  if (segments.some(segment => !segment || segment === "." || segment === "..")) {
    return "path contains an empty or traversal segment";
  }
  if (segments.some(segment => segment.startsWith("."))) {
    return "dot-directories and dot-files are not publishable";
  }
  if (lowerSegments[0] === "__") {
    return "Firebase-managed reserved paths must not be copied";
  }
  const forbiddenDirectory = lowerSegments.find(segment => FORBIDDEN_TOP_LEVEL_DIRECTORIES.has(segment));
  if (forbiddenDirectory) {
    return `development directory ${forbiddenDirectory} is not publishable`;
  }
  if (FORBIDDEN_ROOT_FILES.has(lower) || FORBIDDEN_ROOT_FILES.has(lowerValue)) {
    return "development configuration is not publishable";
  }
  if (EXCLUDED_LOCAL_FILES.has(lowerValue)) {
    return "file is explicitly excluded pending owner approval";
  }
  if (lower.endsWith(".log") || lower.includes("debug.log")) {
    return "logs are not publishable";
  }
  if (
    lower.startsWith(".env") ||
    lower.startsWith(".secret") ||
    lower.includes("credential") ||
    lower.includes("private-key") ||
    lower.includes("secret") ||
    lower.includes("service-account") ||
    lower.includes("firebase-adminsdk") ||
    lower.endsWith(".local")
  ) {
    return "secret or environment files are not publishable";
  }
  return "";
}

export function validateAllowlist(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new HostingBuildError("Hosting runtime allowlist is empty or invalid");
  }

  const failures = [];
  const seen = new Set();
  for (const file of files) {
    if (typeof file !== "string") {
      failures.push(`${String(file)}: entry must be a string`);
      continue;
    }
    const normalised = file.replaceAll("\\", "/");
    const reason = forbiddenRuntimeReason(normalised);
    if (reason) failures.push(`${normalised}: ${reason}`);
    if (normalised !== file) failures.push(`${file}: path must use forward slashes`);
    if (seen.has(normalised)) failures.push(`${normalised}: duplicate allowlist entry`);
    seen.add(normalised);
  }

  if (failures.length) {
    throw new HostingBuildError("Hosting runtime allowlist validation failed", failures);
  }
  return [...seen].sort();
}

async function assertSourceFile(projectRoot, relativePath) {
  const sourcePath = path.resolve(projectRoot, ...relativePath.split("/"));
  const rootPrefix = path.resolve(projectRoot) + path.sep;
  if (!sourcePath.startsWith(rootPrefix)) {
    throw new HostingBuildError(`Source escapes project root: ${relativePath}`);
  }

  const parts = relativePath.split("/");
  let cursor = path.resolve(projectRoot);
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let stat;
    try {
      stat = await lstat(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new HostingBuildError(`Allowlisted runtime file is missing: ${relativePath}`);
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new HostingBuildError(`Symlinks are not allowed in Hosting runtime paths: ${relativePath}`);
    }
  }
  const stat = await lstat(sourcePath);
  if (!stat.isFile()) {
    throw new HostingBuildError(`Allowlisted runtime path is not a file: ${relativePath}`);
  }
  return sourcePath;
}

function referenceCandidates(source) {
  const found = new Set();
  const patterns = [
    /(?:href|src|action|poster)\s*=\s*["']([^"']+)["']/gi,
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\burl\s*\(\s*["']?([^"')]+)["']?\s*\)/gi,
    /["']((?:\/|\.\.?\/)[^"'\s]+)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

export function resolveLocalRuntimeReference(fromFile, reference) {
  const raw = String(reference || "").trim();
  if (
    !raw || raw.startsWith("#") || raw.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.includes("${")
  ) {
    return "";
  }

  const withoutSuffix = raw.split(/[?#]/, 1)[0];
  if (!withoutSuffix || withoutSuffix === "/") return "";
  const resolved = withoutSuffix.startsWith("/")
    ? path.posix.normalize(withoutSuffix.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), withoutSuffix));
  const extension = path.posix.extname(resolved).toLowerCase();
  if (!extension || !RUNTIME_REFERENCE_EXTENSIONS.has(extension)) return "";
  return resolved;
}

export async function auditRuntimeDependencies(projectRoot, files) {
  const allowlist = new Set(files);
  const excludedReferences = [];
  const missingReferences = [];

  for (const relativePath of files) {
    const extension = path.posix.extname(relativePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const sourcePath = await assertSourceFile(projectRoot, relativePath);
    const source = await readFile(sourcePath, "utf8");
    for (const reference of referenceCandidates(source)) {
      const resolved = resolveLocalRuntimeReference(relativePath, reference);
      if (!resolved || FIREBASE_MANAGED_REFERENCES.has(resolved)) continue;
      const item = `${relativePath} -> ${resolved}`;
      if (EXCLUDED_LOCAL_FILES.has(resolved)) excludedReferences.push(item);
      else if (!allowlist.has(resolved)) missingReferences.push(item);
    }
  }

  return {
    excludedReferences: [...new Set(excludedReferences)].sort(),
    missingReferences: [...new Set(missingReferences)].sort()
  };
}

async function inventoryFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = toPosix(path.relative(root, absolute));
    if (entry.isSymbolicLink()) {
      throw new HostingBuildError(`Generated output contains a symlink: ${relative}`);
    }
    if (entry.isDirectory()) files.push(...await inventoryFiles(root, absolute));
    else if (entry.isFile()) files.push(relative);
    else throw new HostingBuildError(`Generated output contains a non-file entry: ${relative}`);
  }
  return files.sort();
}

export async function validateOutputInventory(outputRoot, files) {
  const actual = await inventoryFiles(outputRoot);
  const expected = [...files].sort();
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const unexpected = actual.filter(file => !expectedSet.has(file));
  const missing = expected.filter(file => !actualSet.has(file));
  const forbidden = actual
    .map(file => [file, forbiddenRuntimeReason(file)])
    .filter(([, reason]) => reason)
    .map(([file, reason]) => `${file}: ${reason}`);

  if (unexpected.length || missing.length || forbidden.length) {
    throw new HostingBuildError("Generated Hosting output validation failed", [
      ...unexpected.map(file => `unexpected: ${file}`),
      ...missing.map(file => `missing: ${file}`),
      ...forbidden.map(item => `forbidden: ${item}`)
    ]);
  }
  return actual;
}

export async function cleanGeneratedOutput(projectRoot, outputRoot) {
  const safeOutput = assertSafeOutputPath(projectRoot, outputRoot);
  await rm(safeOutput, { recursive: true, force: true });
}

export async function buildHosting({
  projectRoot,
  outputRoot = path.join(projectRoot, GENERATED_OUTPUT),
  files
}) {
  const safeOutput = assertSafeOutputPath(projectRoot, outputRoot);
  await cleanGeneratedOutput(projectRoot, safeOutput);
  const reviewedFiles = validateAllowlist(files);

  try {
    for (const relativePath of reviewedFiles) {
      await assertSourceFile(projectRoot, relativePath);
    }
    const audit = await auditRuntimeDependencies(projectRoot, reviewedFiles);
    if (audit.excludedReferences.length || audit.missingReferences.length) {
      throw new HostingBuildError("Hosting publication is blocked by source references", [
        ...audit.excludedReferences.map(item => `excluded pending approval: ${item}`),
        ...audit.missingReferences.map(item => `not in reviewed runtime allowlist: ${item}`)
      ]);
    }

    for (const relativePath of reviewedFiles) {
      const sourcePath = path.join(projectRoot, ...relativePath.split("/"));
      const destinationPath = path.join(safeOutput, ...relativePath.split("/"));
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
    }
    const inventory = await validateOutputInventory(safeOutput, reviewedFiles);
    return { outputRoot: safeOutput, inventory };
  } catch (error) {
    await cleanGeneratedOutput(projectRoot, safeOutput);
    throw error;
  }
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(await readFile(path.join(projectRoot, MANIFEST_FILE), "utf8"));
  const result = await buildHosting({ projectRoot, files: manifest.files });
  console.log(`Validated ${result.inventory.length} Hosting runtime files in ${result.outputRoot}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error.message);
    for (const detail of error.details || []) console.error(`- ${detail}`);
    console.error("No generated Hosting output has been left behind.");
    process.exitCode = 1;
  });
}
