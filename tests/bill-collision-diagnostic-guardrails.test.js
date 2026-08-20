import {createRequire} from "node:module";
import {mkdtemp,readFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";

const require=createRequire(import.meta.url);
const {auditFixture}=require("./helpers/bill-collision-test-fixture.cjs");
const {buildCollisionAuditBinding}=require("../scripts/lib/bill-collision-audit-binding.cjs");
const {createBillCollisionReadOnlyAdapter}=require("../scripts/lib/bill-collision-read-only-adapter.cjs");
const {main,parseArguments}=require("../scripts/diagnose-bill-reference-collisions.cjs");
const {
  assertBillCollisionBoundary,confirmationPhrase,requireConfirmation
}=require("../scripts/lib/bill-collision-diagnostic-preflight.cjs");

const productionGroups=[
  {uid:"fixture-owner-a",reference:"fixture canonical a",sourceIds:["a1","a2"]},
  {uid:"fixture-owner-b",reference:"fixture canonical b",sourceIds:["b1","b2","b3"]},
  {uid:"fixture-owner-c",reference:"fixture canonical c",sourceIds:["c1","c2","c3","c4","c5","c6"]},
];
const productionAudit=auditFixture(productionGroups,50,{projectId:"simple-books-office"});
const productionBinding=buildCollisionAuditBinding(productionAudit,{
  projectId:"simple-books-office",databaseId:"(default)",
  expectedAuditHash:productionAudit.hashes.overallAuditHash,production:true
});
const options=(overrides={})=>({
  projectId:"simple-books-office",databaseId:"(default)",databaseProvided:true,
  auditPath:"attempt-4.json",outputPath:"diagnostic.json",
  expectedAuditHash:productionAudit.hashes.overallAuditHash,
  expectedManifestHash:productionBinding.collisionManifestHash,
  productionReadOnly:true,preflightOnly:false,...overrides
});
const args=(output,extra=[])=>[
  "--production-read-only","--preflight-only","--project","simple-books-office","--database","(default)",
  "--audit","attempt-4.json","--expected-audit-hash",productionAudit.hashes.overallAuditHash,"--output",output,...extra
];

describe("Bill collision diagnostic production guardrails",()=>{
  it("rejects scope/cap overrides, mutation flags, and non-interactive shortcuts",()=>{
    for(const flag of [
      "--uid","--bill","--collection","--collection-group","--max-documents","--page-size","--limit",
      "--apply","--write","--backfill","--repair","--resolve","--migrate","--delete","--yes","--non-interactive"
    ])expect(()=>parseArguments([flag,"anything"])).toThrow("Unknown argument");
  });

  it("freezes production project, database, Node, output, emulator separation, and actual-read manifest",()=>{
    expect(()=>assertBillCollisionBoundary(options(),{},"v22.20.0")).not.toThrow();
    expect(()=>assertBillCollisionBoundary(options({projectId:"other"}),{},"v22.20.0")).toThrow("refuses project");
    expect(()=>assertBillCollisionBoundary(options({databaseId:"named"}),{},"v22.20.0")).toThrow("explicit --database");
    expect(()=>assertBillCollisionBoundary(options({databaseProvided:false}),{},"v22.20.0")).toThrow("explicit --database");
    expect(()=>assertBillCollisionBoundary(options({outputPath:""}),{},"v22.20.0")).toThrow("explicit --output");
    expect(()=>assertBillCollisionBoundary(options({expectedManifestHash:""}),{},"v22.20.0")).toThrow("manifest hash");
    expect(()=>assertBillCollisionBoundary(options(),{},"v24.0.0")).toThrow("Node 22.x");
    expect(()=>assertBillCollisionBoundary(options(),{FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080"},"v22.20.0"))
      .toThrow("refuses emulator variables");
  });

  it("derives the manifest in preflight without Firebase initialization, reads, or artifacts",async()=>{
    const directory=await mkdtemp(join(tmpdir(),"bill-collision-preflight-"));
    try{
      let initialized=false;
      const result=await main(args(join(directory,"future.json")),{}, {
        runtimeVersion:"v22.18.0",loadAudit:async()=>productionAudit,
        resolveCredentialProject:async()=>"simple-books-office",
        initializeApp(){initialized=true;throw new Error("must not initialize");}
      });
      expect(result).toMatchObject({
        firestoreReadsStarted:false,
        preflight:{status:"manifest-review-required",scope:"BILL COLLISION GROUPS ONLY",
          derivedCollisionManifestHash:productionBinding.collisionManifestHash}
      });
      expect(initialized).toBe(false);
      expect(await readdir(directory)).toEqual([]);
    }finally{await rm(directory,{recursive:true,force:true});}
  });

  it("uses exact audit/manifest/cap confirmation and refuses non-interactive execution",async()=>{
    expect(confirmationPhrase(options(),productionBinding)).toBe(
      `READ ONLY simple-books-office (default) BILL COLLISIONS ONLY MAX 75 AUDIT ${productionBinding.priorAuditHash} MANIFEST ${productionBinding.collisionManifestHash}`
    );
    await expect(requireConfirmation(options(),productionBinding,{
      input:{isTTY:false},output:{isTTY:false,write(){}},
    })).rejects.toThrow("interactive terminal");
  });

  it("never publishes a completed artifact for drift or partial reads",async()=>{
    const audit=auditFixture([{uid:"emulator-user",reference:"collision",sourceIds:["one","two"]}],3);
    const binding=buildCollisionAuditBinding(audit,{expectedAuditHash:audit.hashes.overallAuditHash});
    for(const reason of ["collision-membership-drift","collision-detail-partial-read"]){
      const directory=await mkdtemp(join(tmpdir(),"bill-collision-incomplete-"));
      try{
        const output=join(directory,"diagnostic.json");
        await expect(main([
          "--project","demo-simple-books","--audit","fixture.json",
          "--expected-audit-hash",audit.hashes.overallAuditHash,
          "--expected-collision-manifest-hash",binding.collisionManifestHash,"--output",output
        ],{FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080"},{
          loadAudit:async()=>audit,firebase:{FieldPath:{},admin:{}},initializeApp:()=>({delete:async()=>{}}),firestore:{},
          createAdapter:()=>Object.freeze({readCollisionEvidence:async()=>({
            complete:false,reason,observed:{collisionGroups:99},metrics:{documentsRead:1,readOperations:1,queryPages:1}
          })})
        })).rejects.toMatchObject({code:"bill-collision-diagnostic-incomplete"});
        const files=await readdir(directory);
        expect(files).toHaveLength(1);expect(files[0]).toMatch(/^diagnostic\.json\.incomplete-/);
        const artifact=JSON.parse(await readFile(join(directory,files[0]),"utf8"));
        expect(artifact.artifact.status).toBe("incomplete");expect(artifact.groups).toEqual([]);
        await expect(readFile(output,"utf8")).rejects.toMatchObject({code:"ENOENT"});
      }finally{await rm(directory,{recursive:true,force:true});}
    }
  });

  it("exposes exactly one adapter read method even when the underlying fake has writes",()=>{
    const firestore={collectionGroup(){return {};},doc(){return {};},getAll(){return [];},batch(){},runTransaction(){},set(){}};
    const adapter=createBillCollisionReadOnlyAdapter(firestore,{documentId:()=>"__name__"});
    expect(Object.keys(adapter)).toEqual(["readCollisionEvidence"]);expect(Object.isFrozen(adapter)).toBe(true);
  });

  it("contains no write service/API imports or mutable CLI controls",async()=>{
    const paths=[
      "../scripts/diagnose-bill-reference-collisions.cjs","../scripts/lib/bill-collision-audit-binding.cjs",
      "../scripts/lib/bill-collision-diagnostic.cjs","../scripts/lib/bill-collision-diagnostic-config.cjs",
      "../scripts/lib/bill-collision-diagnostic-preflight.cjs","../scripts/lib/bill-collision-read-only-adapter.cjs"
    ];
    const source=(await Promise.all(paths.map((path)=>readFile(new URL(path,import.meta.url),"utf8")))).join("\n");
    expect(source).not.toMatch(/legacy-reference-backfill-service|reference-registry-service|source-create-service|source-edit-service/);
    expect(source).not.toMatch(/writeBatch|runTransaction|firestore\.batch\(|firestore\.runTransaction\(|transaction\.(set|create|update|delete)\(|addDoc|setDoc|updateDoc|deleteDoc/);
    expect(source).not.toMatch(/--max-documents|--page-size|--collection|--apply|--write|--backfill|--repair|--resolve|--migrate|--delete|--non-interactive/);
  });
});
