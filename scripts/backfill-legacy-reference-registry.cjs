#!/usr/bin/env node
"use strict";

const admin=require("../functions/node_modules/firebase-admin");
const {createLegacyReferenceBackfillService}=require("../functions/lib/legacy-reference-backfill-service");

function argumentsFrom(argv){
  const options={apply:false,projectId:"",uid:""};
  for(let index=0;index<argv.length;index+=1){
    const argument=argv[index];
    if(argument==="--apply")options.apply=true;
    else if(argument==="--project")options.projectId=String(argv[++index]||"").trim();
    else if(argument==="--uid")options.uid=String(argv[++index]||"").trim();
    else if(argument==="--help"||argument==="-h")options.help=true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage(){return [
  "Emulator dry-run (default):",
  "  node scripts/backfill-legacy-reference-registry.cjs --project demo-simple-books --uid <emulator-uid>",
  "",
  "Emulator apply:",
  "  node scripts/backfill-legacy-reference-registry.cjs --apply --project demo-simple-books --uid <emulator-uid>",
  "",
  "This Step 1 entry point refuses to run unless FIRESTORE_EMULATOR_HOST names localhost."
].join("\n");}

function assertEmulatorOnly(options,environment=process.env){
  const host=String(environment.FIRESTORE_EMULATOR_HOST||"").trim();
  const hostname=(host==="::1"?host:host.replace(/^\[/,"").split("]")[0].split(":")[0]).toLowerCase();
  if(!host||!["127.0.0.1","localhost","::1"].includes(hostname)){
    throw new Error("Refusing reference backfill: FIRESTORE_EMULATOR_HOST must point to localhost.");
  }
  if(!options.projectId||options.projectId.includes("/")||/\s/.test(options.projectId)){
    throw new Error("An explicit emulator Firebase --project is required.");
  }
  if(!options.uid||options.uid.includes("/")||/\s/.test(options.uid)){
    throw new Error("An explicit emulator --uid is required.");
  }
}

async function main(argv=process.argv.slice(2),environment=process.env){
  const options=argumentsFrom(argv);
  if(options.help){console.log(usage());return null;}
  assertEmulatorOnly(options,environment);
  if(!admin.apps.length)admin.initializeApp({projectId:options.projectId});
  const firestore=admin.firestore();
  const backfill=createLegacyReferenceBackfillService({
    firestore,
    serverTimestamp:()=>admin.firestore.FieldValue.serverTimestamp()
  });
  const result=await backfill({uid:options.uid,dryRun:!options.apply});
  console.log(JSON.stringify(result,null,2));
  if(options.apply&&!result.summary.cutoverReady)process.exitCode=2;
  return result;
}

if(require.main===module){
  main().catch(error=>{console.error(error.message||error);process.exitCode=1;});
}

module.exports={argumentsFrom,assertEmulatorOnly,main,usage};
