import {createRequire} from "node:module";
import {mkdtemp,readFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";

const require=createRequire(import.meta.url);
const {main,parseArguments}=require("../scripts/probe-top-level-invoice-metadata.cjs");
const {
  assertProbeExecutionBoundary,confirmationPhrase,requireProbeConfirmation
}=require("../scripts/lib/top-level-invoice-probe-preflight.cjs");

const expected="d95e98a89f89072a9690ba4b8fb906e7daf2d8c73a3f22259b8575a2306e6af4";
const production=(overrides={})=>({
  projectId:"simple-books-office",databaseId:"(default)",databaseProvided:true,
  outputPath:"probe.json",expectedPathHash:expected,productionReadOnly:true,preflightOnly:false,...overrides
});
const productionArgs=(output)=>[
  "--production-read-only","--preflight-only","--project","simple-books-office",
  "--database","(default)","--expected-path-hash",expected,"--output",output
];

describe("top-level invoice probe production guardrails",()=>{
  it("rejects target, cap, non-interactive, and mutation controls",()=>{
    for(const flag of [
      "--collection","--collection-group","--max-documents","--limit","--page-size","--uid",
      "--apply","--write","--backfill","--repair","--migrate","--delete","--yes","--non-interactive"
    ])expect(()=>parseArguments([flag,"anything"])).toThrow("Unknown argument");
  });

  it("freezes production identity, runtime, database, output, expected hash, and emulator separation",()=>{
    expect(()=>assertProbeExecutionBoundary(production(),{},"v22.20.0")).not.toThrow();
    expect(()=>assertProbeExecutionBoundary(production({projectId:"other"}),{},"v22.20.0")).toThrow("refuses project");
    expect(()=>assertProbeExecutionBoundary(production({databaseId:"named"}),{},"v22.20.0")).toThrow("explicit --database");
    expect(()=>assertProbeExecutionBoundary(production({databaseProvided:false}),{},"v22.20.0")).toThrow("explicit --database");
    expect(()=>assertProbeExecutionBoundary(production({outputPath:""}),{},"v22.20.0")).toThrow("explicit --output");
    expect(()=>assertProbeExecutionBoundary(production({expectedPathHash:"bad"}),{},"v22.20.0")).toThrow("64 lowercase");
    expect(()=>assertProbeExecutionBoundary(production(),{},"v24.0.0")).toThrow("Node 22.x");
    expect(()=>assertProbeExecutionBoundary(production(),{FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080"},"v22.20.0"))
      .toThrow("refuses emulator variables");
  });

  it("uses an exact scope/hash confirmation phrase",()=>{
    expect(confirmationPhrase(production())).toBe(
      `READ ONLY simple-books-office (default) TOP-LEVEL invoices ONLY MAX 2 HASH ${expected}`
    );
  });

  it("refuses non-interactive production confirmation",async()=>{
    await expect(requireProbeConfirmation(production(),{
      input:{isTTY:false},output:{isTTY:false,write(){}},
    })).rejects.toThrow("interactive terminal");
  });

  it("preflight validates credentials and output without Firebase initialization, reads, or artifacts",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"invoice-metadata-preflight-"));
    try{
      const output=join(directory,"future-probe.json");
      let initialized=false;
      const result=await main(productionArgs(output),{}, {
        runtimeVersion:"v22.18.0",resolveCredentialProject:async()=>"simple-books-office",
        initializeApp(){initialized=true;throw new Error("must not initialize");}
      });
      expect(result).toMatchObject({
        firestoreReadsStarted:false,
        preflight:{scope:"TOP-LEVEL invoices ONLY",maxDocuments:2,expectedPathHash:expected}
      });
      expect(initialized).toBe(false);
      expect(await readdir(directory)).toEqual([]);
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it("fails preflight on an independent credential-project mismatch before Firebase initialization",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"invoice-metadata-identity-"));
    try{
      let initialized=false;
      await expect(main(productionArgs(join(directory,"future-probe.json")),{}, {
        runtimeVersion:"v22.18.0",resolveCredentialProject:async()=>"other-project",
        initializeApp(){initialized=true;throw new Error("must not initialize");}
      })).rejects.toThrow("Credential project mismatch");
      expect(initialized).toBe(false);
      expect(await readdir(directory)).toEqual([]);
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it("never publishes a completed artifact from an incomplete read",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"invoice-metadata-incomplete-"));
    try{
      const output=join(directory,"probe.json");
      const readOnly=Object.freeze({readTopLevelInvoices:async()=>{
        throw Object.assign(new Error("secret invoice data"),{code:7});
      }});
      await expect(main([
        "--project","demo-simple-books","--expected-path-hash",expected,"--output",output
      ],{FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080"},{
        firebase:{FieldPath:{},admin:{}},initializeApp:()=>({delete:async()=>{}}),firestore:{},
        createAdapter:()=>readOnly
      })).rejects.toMatchObject({code:"invoice-metadata-probe-incomplete"});
      const files=await readdir(directory);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^probe\.json\.incomplete-/);
      const artifact=JSON.parse(await readFile(join(directory,files[0]),"utf8"));
      expect(artifact.artifact.status).toBe("incomplete");
      expect(artifact.failure.errorCategory).toBe("permission-denied");
      await expect(readFile(output,"utf8")).rejects.toMatchObject({code:"ENOENT"});
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it("has no reachable write surface, Step 1 import, target override, or retry/pagination loop",async()=>{
    const paths=[
      "../scripts/probe-top-level-invoice-metadata.cjs",
      "../scripts/lib/top-level-invoice-metadata-adapter.cjs",
      "../scripts/lib/top-level-invoice-metadata-probe.cjs",
      "../scripts/lib/top-level-invoice-probe-preflight.cjs"
    ];
    const source=(await Promise.all(paths.map((path)=>readFile(new URL(path,import.meta.url),"utf8")))).join("\n");
    expect(source).not.toMatch(/legacy-reference-backfill-service|reference-registry-service|source-create-service|source-edit-service/);
    expect(source).not.toMatch(/writeBatch|runTransaction|\.batch\(|\.transaction\(|firestore\.doc\(|addDoc|setDoc|updateDoc|deleteDoc|collectionGroup|startAfter/);
    expect(source).not.toMatch(/--max-documents|--collection|--apply|--write|--backfill|--repair|--migrate|--delete/);
    expect(source.match(/\.get\(\)/g)).toHaveLength(1);
  });
});
