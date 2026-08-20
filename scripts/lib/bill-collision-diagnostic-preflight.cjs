"use strict";

const {createInterface}=require("node:readline/promises");
const {PRODUCTION_NODE_MAJOR}=require("./production-reference-audit-config.cjs");
const {EMULATOR_VARIABLES,LOCAL_HOSTS,emulatorHostname,nodeMajor}=require("./production-reference-audit-preflight.cjs");
const {BILL_COLLISION_DIAGNOSTIC_TARGET,BILL_COLLISION_LIMITS}=require("./bill-collision-diagnostic-config.cjs");
const {DIAGNOSTIC_SCHEMA_VERSION,DIAGNOSTIC_VERSION}=require("./bill-collision-diagnostic.cjs");

const HASH_PATTERN=/^[a-f\d]{64}$/;
function identifier(value,label){
  const text=String(value||"").trim();
  if(!text||text.includes("/")||/\s/.test(text))throw new Error(`${label} is invalid.`);
  return text;
}
function requiredHash(value,label){
  const text=String(value||"").trim();
  if(!HASH_PATTERN.test(text))throw new Error(`${label} must be 64 lowercase hexadecimal characters.`);
  return text;
}

function assertBillCollisionBoundary(options,environment=process.env,runtimeVersion=process.version){
  identifier(options.projectId,"Project ID");identifier(options.databaseId,"Database ID");
  requiredHash(options.expectedAuditHash,"Expected audit hash");
  if(!options.auditPath)throw new Error("An explicit prior --audit artifact is required.");
  const emulatorHost=emulatorHostname(environment);
  if(!options.productionReadOnly){
    if(!emulatorHost||!LOCAL_HOSTS.has(emulatorHost))throw new Error("Refusing non-emulator Firestore reads without --production-read-only.");
    return;
  }
  const present=EMULATOR_VARIABLES.filter((name)=>String(environment[name]||"").trim());
  if(present.length)throw new Error(`Production read-only mode refuses emulator variables: ${present.join(", ")}.`);
  if(options.projectId!==BILL_COLLISION_DIAGNOSTIC_TARGET.projectId)throw new Error(`Production mode refuses project: ${options.projectId}`);
  if(!options.databaseProvided||options.databaseId!==BILL_COLLISION_DIAGNOSTIC_TARGET.databaseId){
    throw new Error(`Production mode requires explicit --database ${BILL_COLLISION_DIAGNOSTIC_TARGET.databaseId}.`);
  }
  if(nodeMajor(runtimeVersion)!==PRODUCTION_NODE_MAJOR)throw new Error(`Production mode requires Node ${PRODUCTION_NODE_MAJOR}.x; current runtime is ${runtimeVersion||"unknown"}.`);
  if(!options.outputPath)throw new Error("Production mode requires explicit --output.");
  if(!options.preflightOnly)requiredHash(options.expectedManifestHash,"Expected collision manifest hash");
}

function confirmationPhrase(options,binding){
  return `READ ONLY ${options.projectId} ${options.databaseId} BILL COLLISIONS ONLY MAX ${BILL_COLLISION_LIMITS.totalDocuments} AUDIT ${binding.priorAuditHash} MANIFEST ${binding.collisionManifestHash}`;
}

function preflightSummary(options,binding,details={}){
  const manifestSupplied=Boolean(options.expectedManifestHash);
  return Object.freeze({
    status:manifestSupplied?"ready":"manifest-review-required",
    requestedProjectId:options.projectId,credentialProjectId:details.credentialProjectId||null,
    requestedDatabaseId:options.databaseId,nodeVersion:details.nodeVersion||process.version,
    emulatorVariablesPresent:[...(details.emulatorVariablesPresent||[])],outputPath:details.outputPath||null,
    diagnosticVersion:DIAGNOSTIC_VERSION,reportSchemaVersion:DIAGNOSTIC_SCHEMA_VERSION,
    scope:"BILL COLLISION GROUPS ONLY",limits:{...BILL_COLLISION_LIMITS},
    priorAuditHash:binding.priorAuditHash,derivedCollisionManifestHash:binding.collisionManifestHash,
    expectedManifestHash:manifestSupplied?options.expectedManifestHash:null,
    manifestVerified:manifestSupplied&&options.expectedManifestHash===binding.collisionManifestHash,
    productionReadOnlyAcknowledged:Boolean(options.productionReadOnly),preflightOnly:Boolean(options.preflightOnly),
  });
}

function formatPreflight(summary){return [
  "=== SIMPLE BOOKS BILL COLLISION DIAGNOSTIC: STRICTLY READ ONLY ===",
  `Project requested: ${summary.requestedProjectId}`,
  `Credential project: ${summary.credentialProjectId||"not required in emulator mode"}`,
  `Database: ${summary.requestedDatabaseId}`,
  `Emulator variables present: ${summary.emulatorVariablesPresent.length?summary.emulatorVariablesPresent.join(", "):"none"}`,
  `Node: ${summary.nodeVersion}`,
  `Diagnostic/schema: ${summary.diagnosticVersion} / ${summary.reportSchemaVersion}`,
  `Output: ${summary.outputPath||"stdout only (emulator mode)"}`,
  `Scope: ${summary.scope}`,
  `Maximum documents/read operations/pages: ${summary.limits.totalDocuments}/${summary.limits.readOperations}/${summary.limits.queryPages}`,
  `Prior audit hash: ${summary.priorAuditHash}`,
  `Derived collision manifest hash: ${summary.derivedCollisionManifestHash}`,
  `Manifest authorization: ${summary.manifestVerified?"verified":"separate review required before an actual read"}`,
].join("\n");}

async function requireConfirmation(options,binding,streams={}){
  const input=streams.input||process.stdin,output=streams.output||process.stderr;
  if(!input.isTTY||!output.isTTY)throw new Error("Production diagnostic requires an interactive terminal confirmation.");
  const expected=confirmationPhrase(options,binding);
  output.write(`\nType this exact phrase to begin bounded Firestore READS:\n${expected}\n> `);
  const interface_=createInterface({input,output});
  try{const answer=await interface_.question("");if(answer!==expected)throw new Error("Exact read-only confirmation phrase did not match; aborting before Firestore reads.");}
  finally{interface_.close();}
}

module.exports=Object.freeze({assertBillCollisionBoundary,confirmationPhrase,formatPreflight,preflightSummary,requireConfirmation});
