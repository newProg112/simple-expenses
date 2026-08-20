import {createRequire} from "node:module";
import {mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {describe, expect, it} from "vitest";

const require = createRequire(import.meta.url);
const {
  assertExecutionBoundary,
  main,
  parseArguments,
} = require("../scripts/audit-production-reference-registry.cjs");
const {
  APPROVED_PRODUCTION_AUDIT_TARGET,
} = require("../scripts/lib/production-reference-audit-config.cjs");
const {
  atomicWriteJson,
  confirmationPhrase,
  inspectOutputPath,
  requireHumanConfirmation,
  scopeLabel,
  verifyCredentialProject,
} = require("../scripts/lib/production-reference-audit-preflight.cjs");

function productionOptions(overrides={}){
  return {
    projectId:"simple-books-office",databaseId:"(default)",databaseProvided:true,
    productionReadOnly:true,outputPath:"audit.json",uid:"",pageSize:"100",
    safetyLimits:{maxDocuments:"1000",maxPages:"100",maxUids:"50",maxElapsedMs:60000},
    ...overrides
  };
}

function productionArgs(outputPath){
  return [
    "--production-read-only","--preflight-only",
    "--project","simple-books-office","--database","(default)",
    "--output",outputPath,"--page-size","100",
    "--max-documents","1000","--max-pages","100","--max-uids","50",
    "--max-elapsed-seconds","60"
  ];
}

function emptyAdapter(){
  const page=()=>Promise.resolve({documents:[],nextCursor:null});
  return Object.freeze({readCollectionGroupPage:page,readUserCollectionPage:page});
}

describe("production reference audit Step 2B guardrails",()=>{
  it("centralises the repository-approved project and default database",async()=>{
    expect(APPROVED_PRODUCTION_AUDIT_TARGET).toEqual({projectId:"simple-books-office",databaseId:"(default)"});
    expect(Object.isFrozen(APPROVED_PRODUCTION_AUDIT_TARGET)).toBe(true);
    const firebaseRc=JSON.parse(await readFile(new URL("../.firebaserc",import.meta.url),"utf8"));
    const firebaseConfig=JSON.parse(await readFile(new URL("../firebase.json",import.meta.url),"utf8"));
    expect(firebaseRc.projects.default).toBe(APPROVED_PRODUCTION_AUDIT_TARGET.projectId);
    expect(firebaseConfig.firestore.database).toBeUndefined();
  });

  it("fails closed for wrong runtime, project, database, emulator state, output, and limits",()=>{
    for(const version of ["v24.1.0","v20.19.0","unknown"]){
      expect(()=>assertExecutionBoundary(productionOptions(),{},version)).toThrow("Node 22.x");
    }
    expect(()=>assertExecutionBoundary(productionOptions({projectId:"other"}),{},"v22.1.0")).toThrow("refuses project");
    expect(()=>assertExecutionBoundary(productionOptions({databaseId:"named"}),{},"v22.1.0")).toThrow("explicit --database");
    expect(()=>assertExecutionBoundary(productionOptions({databaseProvided:false}),{},"v22.1.0")).toThrow("explicit --database");
    expect(()=>assertExecutionBoundary(productionOptions(),{FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080"},"v22.1.0"))
      .toThrow("refuses emulator variables");
    expect(()=>assertExecutionBoundary(productionOptions({outputPath:""}),{},"v22.1.0")).toThrow("explicit --output");
    expect(()=>assertExecutionBoundary(productionOptions({safetyLimits:{}}),{},"v22.1.0")).toThrow("requires explicit --max-documents");
  });

  it("rejects all mutation-like flags and malformed flag values",()=>{
    for(const flag of ["--apply","--write","--backfill","--repair","--migrate","--delete","--yes"]){
      expect(()=>parseArguments([flag])).toThrow("Unknown argument");
    }
    expect(()=>parseArguments(["--project","--database"])).toThrow("requires a value");
  });

  it("proves credential identity independently and fails closed",async()=>{
    await expect(verifyCredentialProject("simple-books-office",async()=>"simple-books-office"))
      .resolves.toBe("simple-books-office");
    await expect(verifyCredentialProject("simple-books-office",async()=>"other-project"))
      .rejects.toThrow("Credential project mismatch");
    await expect(verifyCredentialProject("simple-books-office",async()=>{throw new Error("token secret");}))
      .rejects.toThrow("could not be established");
  });

  it("preflight-only validates identity but never initializes Firestore or creates output",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"reference-audit-preflight-"));
    try{
      const output=join(directory,"future-audit.json");
      let initialized=false;
      const result=await main(productionArgs(output),{}, {
        runtimeVersion:"v22.18.0",
        resolveCredentialProject:async()=>"simple-books-office",
        initializeApp(){initialized=true;throw new Error("must not initialize");}
      });
      expect(result).toMatchObject({firestoreReadsStarted:false,preflight:{status:"ready",scanScope:"FULL CENSUS"}});
      expect(initialized).toBe(false);
      expect(await readdir(directory)).toEqual([]);
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it("checks output directories and refuses an existing artifact before reads",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"reference-audit-output-check-"));
    try{
      const output=join(directory,"audit.json");
      await expect(inspectOutputPath(output)).resolves.toBe(resolve(output));
      await writeFile(output,"existing","utf8");
      await expect(inspectOutputPath(output)).rejects.toThrow("already exists");
      await expect(inspectOutputPath(join(directory,"missing","audit.json"))).rejects.toThrow("does not exist");
      await expect(inspectOutputPath("https://example.test/audit.json")).rejects.toThrow("local filesystem");
      await expect(inspectOutputPath("\\\\server\\share\\audit.json")).rejects.toThrow("local filesystem");
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it("writes completed artifacts atomically with no-overwrite semantics",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"reference-audit-atomic-"));
    try{
      const output=join(directory,"audit.json");
      await atomicWriteJson(output,{hashes:{overallAuditHash:"abc"}},"complete");
      const parsed=JSON.parse(await readFile(output,"utf8"));
      expect(parsed.artifact.status).toBe("complete");
      await expect(atomicWriteJson(output,{replacement:true},"complete")).rejects.toMatchObject({code:"EEXIST"});
      expect(JSON.parse(await readFile(output,"utf8")).hashes.overallAuditHash).toBe("abc");
      expect((await readdir(directory)).some(name=>name.includes(".partial-"))).toBe(false);
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it("cleans a temporary artifact if final publication is interrupted",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"reference-audit-interrupt-"));
    try{
      const output=join(directory,"audit.json");
      await expect(atomicWriteJson(output,{ok:true},"complete",{
        link:async()=>{throw Object.assign(new Error("interrupted"),{code:"EINTR"});}
      })).rejects.toMatchObject({code:"EINTR"});
      expect(await readdir(directory)).toEqual([]);
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it("uses an exact typed production phrase and refuses non-interactive confirmation",async()=>{
    expect(scopeLabel(productionOptions())).toBe("FULL CENSUS");
    expect(scopeLabel(productionOptions({uid:"diagnostic-user"}))).toBe("SINGLE UID DIAGNOSTIC");
    expect(confirmationPhrase(productionOptions()))
      .toBe("READ ONLY simple-books-office (default) FULL CENSUS");
    await expect(requireHumanConfirmation(productionOptions(),{
      input:{isTTY:false},output:{isTTY:false,write(){}},
    })).rejects.toThrow("interactive terminal");
  });

  it("never publishes the requested completed path when a safety limit stops the scan",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"reference-audit-incomplete-"));
    try{
      const output=join(directory,"audit.json");
      let deleted=false;
      await expect(main([
        "--project","demo-simple-books","--output",output,"--page-size","1","--max-pages","1"
      ],{FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080"},{
        initializeApp:()=>({delete:async()=>{deleted=true;}}),firestore:{},createAdapter:emptyAdapter,
      })).rejects.toMatchObject({code:"audit-incomplete"});
      const files=await readdir(directory);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^audit\.json\.incomplete-/);
      const artifact=JSON.parse(await readFile(join(directory,files[0]),"utf8"));
      expect(artifact.artifact.status).toBe("incomplete");
      expect(artifact.scan.complete).toBe(false);
      expect(deleted).toBe(true);
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it("keeps the guard layer structurally separate from Firestore writes and Step 1 apply",async()=>{
    const paths=[
      "../scripts/audit-production-reference-registry.cjs",
      "../scripts/lib/production-reference-audit.cjs",
      "../scripts/lib/read-only-firestore-adapter.cjs",
      "../scripts/lib/production-reference-audit-preflight.cjs"
    ];
    const source=(await Promise.all(paths.map(path=>readFile(new URL(path,import.meta.url),"utf8")))).join("\n");
    expect(source).not.toMatch(/legacy-reference-backfill-service|reference-registry-service|writeBatch|runTransaction|\.batch\(|\.transaction\(|firestore\.doc\(/);
  });
});
