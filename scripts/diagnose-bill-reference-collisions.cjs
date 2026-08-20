#!/usr/bin/env node
"use strict";

const {readFile}=require("node:fs/promises");
const {createRequire}=require("node:module");
const {resolve}=require("node:path");
const functionsRequire=createRequire(resolve(__dirname,"../functions/package.json"));
const {buildCollisionAuditBinding}=require("./lib/bill-collision-audit-binding.cjs");
const {createBillCollisionDiagnostic}=require("./lib/bill-collision-diagnostic.cjs");
const {BILL_COLLISION_DIAGNOSTIC_TARGET}=require("./lib/bill-collision-diagnostic-config.cjs");
const {createBillCollisionReadOnlyAdapter}=require("./lib/bill-collision-read-only-adapter.cjs");
const {
  EMULATOR_VARIABLES,atomicWriteJson,incompleteArtifactPath,inspectOutputPath,localJsonPath,verifyCredentialProject,
}=require("./lib/production-reference-audit-preflight.cjs");
const {
  assertBillCollisionBoundary,formatPreflight,preflightSummary,requireConfirmation,
}=require("./lib/bill-collision-diagnostic-preflight.cjs");

function parseArguments(argv){
  const options={
    projectId:"",databaseId:"(default)",databaseProvided:false,auditPath:"",outputPath:"",
    expectedAuditHash:"",expectedManifestHash:"",productionReadOnly:false,preflightOnly:false,help:false,
  };
  function valueAfter(index,flag){const value=String(argv[index+1]||"").trim();if(!value||value.startsWith("--"))throw new Error(`${flag} requires a value.`);return value;}
  for(let index=0;index<argv.length;index+=1){
    const argument=argv[index];
    if(argument==="--project")options.projectId=valueAfter(index++,argument);
    else if(argument==="--database"){options.databaseId=valueAfter(index++,argument);options.databaseProvided=true;}
    else if(argument==="--audit")options.auditPath=valueAfter(index++,argument);
    else if(argument==="--output")options.outputPath=valueAfter(index++,argument);
    else if(argument==="--expected-audit-hash")options.expectedAuditHash=valueAfter(index++,argument);
    else if(argument==="--expected-collision-manifest-hash")options.expectedManifestHash=valueAfter(index++,argument);
    else if(argument==="--production-read-only")options.productionReadOnly=true;
    else if(argument==="--preflight-only")options.preflightOnly=true;
    else if(argument==="--help"||argument==="-h")options.help=true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage(){return [
  "STRICTLY READ ONLY Bill canonical-reference collision diagnostic",
  "",
  "Production preflight only (performs zero Firestore reads):",
  `  node scripts/diagnose-bill-reference-collisions.cjs --production-read-only --preflight-only --project ${BILL_COLLISION_DIAGNOSTIC_TARGET.projectId} --database '${BILL_COLLISION_DIAGNOSTIC_TARGET.databaseId}' --audit <attempt-4.json> --expected-audit-hash <approved-hash> --output <new-report.json>`,
  "",
  "The first preflight derives the privacy-safe collision manifest hash for separate review.",
  "A future authorized read must also provide --expected-collision-manifest-hash and exact interactive confirmation.",
  "Scope/caps are immutable and there are no mutation or non-interactive flags.",
].join("\n");}

async function loadAudit(pathValue){
  const path=localJsonPath(pathValue,"Prior audit path");
  return JSON.parse(await readFile(path,"utf8"));
}

async function main(argv=process.argv.slice(2),environment=process.env,dependencies={}){
  const options=parseArguments(argv);
  if(options.help){process.stdout.write(`${usage()}\n`);return null;}
  const runtimeVersion=dependencies.runtimeVersion||process.version;
  assertBillCollisionBoundary(options,environment,runtimeVersion);
  const audit=await (dependencies.loadAudit||loadAudit)(options.auditPath);
  const binding=buildCollisionAuditBinding(audit,{
    projectId:options.projectId,databaseId:options.databaseId,expectedAuditHash:options.expectedAuditHash,
    expectedManifestHash:options.expectedManifestHash,production:options.productionReadOnly,
  });
  let outputPath=null;
  if(options.outputPath)outputPath=await (dependencies.inspectOutputPath||inspectOutputPath)(options.outputPath);
  let credentialProjectId=null;
  if(options.productionReadOnly){
    const resolver=dependencies.resolveCredentialProject||(()=>{
      const {GoogleAuth}=functionsRequire("google-auth-library");return new GoogleAuth().getProjectId();
    });
    credentialProjectId=await verifyCredentialProject(options.projectId,resolver);
  }
  const summary=preflightSummary(options,binding,{
    credentialProjectId,nodeVersion:runtimeVersion,outputPath,
    emulatorVariablesPresent:EMULATOR_VARIABLES.filter((name)=>String(environment[name]||"").trim()),
  });
  process.stderr.write(`${formatPreflight(summary)}\n`);
  if(options.preflightOnly){
    process.stderr.write("PREFLIGHT COMPLETE: zero Firebase/Firestore document reads were performed.\n");
    return {preflight:summary,firestoreReadsStarted:false};
  }
  if(options.productionReadOnly)await (dependencies.requireHumanConfirmation||requireConfirmation)(options,binding);

  const firebase=dependencies.firebase||(()=>{
    const admin=functionsRequire("firebase-admin"),firestoreApi=functionsRequire("firebase-admin/firestore");
    return {admin,FieldPath:firestoreApi.FieldPath,getFirestore:firestoreApi.getFirestore};
  })();
  const initializeApp=dependencies.initializeApp||((configuration,name)=>firebase.admin.initializeApp(configuration,name));
  const app=initializeApp({projectId:options.projectId},`bill-collision-diagnostic-${process.pid}-${Date.now()}`);
  try{
    const firestore=dependencies.firestore||(options.databaseId==="(default)"?firebase.admin.firestore(app):firebase.getFirestore(app,options.databaseId));
    const adapter=(dependencies.createAdapter||createBillCollisionReadOnlyAdapter)(firestore,firebase.FieldPath);
    const report=await createBillCollisionDiagnostic(adapter,binding);
    const status=report.artifact.status;
    let artifactPath=null;
    if(outputPath){
      artifactPath=status==="complete"?outputPath:incompleteArtifactPath(outputPath);
      await (dependencies.atomicWriteJson||atomicWriteJson)(artifactPath,report,status);
      process.stderr.write(`${status.toUpperCase()} local artifact: ${artifactPath}\n`);
    }
    const printable={...report,artifact:{status,path:artifactPath}};
    process.stdout.write(`${JSON.stringify(printable,null,2)}\n`);
    if(status!=="complete"){
      const error=new Error("Bill collision diagnostic is incomplete; the requested completed output artifact was not created.");
      error.code="bill-collision-diagnostic-incomplete";error.report=printable;throw error;
    }
    return printable;
  }finally{await app.delete();}
}

if(require.main===module){main().catch((error)=>{process.stderr.write(`READ ONLY Bill collision diagnostic failed: ${String(error?.message||error)}\n`);process.exitCode=1;});}

module.exports=Object.freeze({loadAudit,main,parseArguments,usage});
