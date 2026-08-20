import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

const require = createRequire(import.meta.url);
const {
  canonicalSerialize,
  compareAuditReports,
  createProductionReferenceAudit,
  sha256,
  validatePageSize,
} = require("../scripts/lib/production-reference-audit.cjs");
const {createReadOnlyFirestoreAdapter} = require("../scripts/lib/read-only-firestore-adapter.cjs");
const {
  assertExecutionBoundary,
  parseArguments,
} = require("../scripts/audit-production-reference-registry.cjs");
const {referenceRegistryKey} = require("../functions/lib/reference-registry-key.js");

const updateTime = "2026-08-20T12:00:00.000Z";

function validMetadata(overrides={}){
  return {
    schemaVersion:1,migrationVersion:"phase3c3c-v1",status:"complete",cutoverReady:true,
    scanned:0,blankSkipped:0,activeClaimCreated:0,activeClaimAlreadyValid:0,
    legacyConflictCreated:0,legacyConflictAlreadyValid:0,incompatibleExistingRegistry:0,
    sourceChangedDuringApply:0,migrationErrors:0,collisionGroups:0,
    lastRunAt:"2026-08-20T12:00:00.000Z",completedAt:"2026-08-20T12:00:00.000Z",...overrides
  };
}

function document(path,data,time=updateTime){
  return {id:path.split("/").at(-1),path,updateTime:time,data};
}

function datasets(entries=[]){
  const map=new Map();
  for(const entry of entries){
    const collection=entry.path.split("/").at(-2);
    const items=map.get(collection)||[];
    items.push(entry);
    map.set(collection,items);
  }
  return map;
}

function readOnlyAdapter(entries,{reversePages=false,failGroup="",failUserCollection=""}={}){
  const data=datasets(entries);
  function page(items,pageSize,cursor){
    const ordered=[...items].sort((left,right)=>left.path.localeCompare(right.path));
    const start=cursor===null?0:Number(cursor);
    const slice=ordered.slice(start,start+pageSize);
    if(reversePages)slice.reverse();
    return Promise.resolve({documents:slice,nextCursor:start+slice.length<ordered.length?String(start+slice.length):null});
  }
  return Object.freeze({
    readCollectionGroupPage(collection,pageSize,cursor){
      if(collection===failGroup)return Promise.reject(Object.assign(new Error("private/path/customer@example.test"),{code:"permission-denied"}));
      return page(data.get(collection)||[],pageSize,cursor);
    },
    readUserCollectionPage(uid,collection,pageSize,cursor){
      if(collection===failUserCollection)return Promise.reject(Object.assign(new Error("Supplier secret"),{code:"unavailable"}));
      return page((data.get(collection)||[]).filter(item=>item.path.startsWith(`users/${uid}/${collection}/`)),pageSize,cursor);
    }
  });
}

async function registry(uid,type,reference,overrides={}){
  const key=await referenceRegistryKey(type,reference);
  return document(`users/${uid}/referenceKeys/${key.registryDocumentId}`,{
    schemaVersion:1,recordType:type,canonicalReference:key.canonicalReference,
    sourceId:overrides.sourceId||"source-1",state:overrides.state||"active",
    claimedAt:"historical",retiredAt:null,...overrides
  });
}

async function audit(entries,options={}){
  return createProductionReferenceAudit(readOnlyAdapter(entries,options.adapterOptions),{
    projectId:"demo-simple-books",pageSize:options.pageSize||2,uid:options.uid
  });
}

describe("production reference audit primitives",()=>{
  it("canonicalises object keys, timestamps, and hashes deterministically",()=>{
    const timestamp={toDate:()=>new Date("2026-08-20T00:00:00.000Z"),toMillis:()=>1787184000000};
    expect(canonicalSerialize({z:1,a:{d:2,c:timestamp}}))
      .toBe('{"a":{"c":{"$timestamp":"2026-08-20T00:00:00.000Z"},"d":2},"z":1}');
    expect(sha256({b:2,a:1})).toBe(sha256({a:1,b:2}));
    expect(()=>canonicalSerialize({value:undefined})).toThrow("unsupported value");
    expect(()=>canonicalSerialize(new Map())).toThrow("JSON-like");
  });

  it("validates conservative page boundaries",()=>{
    expect(validatePageSize(undefined)).toBe(200);
    expect(validatePageSize("1")).toBe(1);
    expect(validatePageSize(500)).toBe(500);
    for(const value of [0,501,1.5,"bad"]){expect(()=>validatePageSize(value)).toThrow("Page size");}
  });

  it("enforces CLI read-only boundaries and refuses apply or ambiguous production",()=>{
    expect(()=>parseArguments(["--apply"])).toThrow("Unknown argument");
    expect(()=>assertExecutionBoundary({projectId:"demo-simple-books",databaseId:"(default)"},{}))
      .toThrow("Refusing non-emulator");
    expect(()=>assertExecutionBoundary({projectId:"demo-simple-books",databaseId:"(default)"},{FIRESTORE_EMULATOR_HOST:"firestore.googleapis.com:443"}))
      .toThrow("Refusing non-emulator");
    expect(()=>assertExecutionBoundary({projectId:"simple-books-office",databaseId:"(default)",productionReadOnly:true},{FIRESTORE_EMULATOR_HOST:"127.0.0.1:8080"}))
      .toThrow("refuses emulator variables");
    expect(()=>assertExecutionBoundary({projectId:"other-project",databaseId:"(default)",productionReadOnly:true},{}))
      .toThrow("refuses project");
    const production={
      projectId:"simple-books-office",databaseId:"(default)",databaseProvided:true,
      productionReadOnly:true,outputPath:"audit.json",
      safetyLimits:{maxDocuments:100,maxPages:100,maxUids:10,maxElapsedMs:1000}
    };
    expect(()=>assertExecutionBoundary(production,{},"v24.0.0")).toThrow("Node 22.x");
    expect(()=>assertExecutionBoundary(production,{},"v22.20.0")).not.toThrow();
  });

  it("exposes only two read methods and rejects any adapter with write reachability",async()=>{
    const firestore={collection(){return {};},collectionGroup(){return {};},set(){throw new Error("write");}};
    const FieldPath={documentId:()=>"__name__"};
    const adapter=createReadOnlyFirestoreAdapter(firestore,FieldPath);
    expect(Object.keys(adapter).sort()).toEqual(["readCollectionGroupPage","readUserCollectionPage"]);
    expect(Object.isFrozen(adapter)).toBe(true);
    await expect(createProductionReferenceAudit({...readOnlyAdapter([]),set(){}},{projectId:"demo-simple-books"}))
      .rejects.toThrow("exact read-only");
    const cli=readFileSync(new URL("../scripts/audit-production-reference-registry.cjs",import.meta.url),"utf8");
    expect(cli).not.toMatch(/writeBatch|runTransaction|transaction\.|--apply|--write|--backfill|--repair|--migrate|--delete|firestore\.doc\(/);
  });
});

describe("production reference audit results",()=>{
  it("discovers UIDs without parent documents and paginates every discovery/source collection",async()=>{
    const entries=[
      document("users/no-parent/invoices/z",{invoiceNo:"INV-002"}),
      document("users/no-parent/invoices/a",{invoiceNo:"INV-001"}),
      document("users/bill-only/bills/b",{billNumber:"BILL-001"}),
      document("users/registry-only/referenceKeys/bad",{schemaVersion:0}),
      document("users/metadata-only/referenceBackfillMigrations/phase3c3c-v1",validMetadata())
    ];
    const report=await audit(entries,{pageSize:1});
    expect(report.census).toMatchObject({complete:true,totalDiscoveredUids:4,orderedUids:["bill-only","metadata-only","no-parent","registry-only"]});
    expect(report.metrics.pagesFetched).toBeGreaterThan(10);
    expect(report.metrics.documentsRead).toBeGreaterThan(entries.length);
    expect(report.perUid.find(item=>item.uid==="no-parent").invoices.totalCount).toBe(2);
  });

  it("reports unique, blank, collision, valid active, and consistent conflict states privately",async()=>{
    const uid="audit-user";
    const active=await registry(uid,"invoice","INV-OK",{sourceId:"invoice-ok"});
    const conflictKey=await referenceRegistryKey("bill","BILL-9");
    const conflict=document(`users/${uid}/referenceKeys/${conflictKey.registryDocumentId}`,{
      schemaVersion:1,recordType:"bill",canonicalReference:conflictKey.canonicalReference,
      sourceId:"__legacy_conflict__",state:"legacy-conflict",
      conflictingSourceIds:["bill-a","bill-b"],conflictCount:2
    });
    const report=await audit([
      document(`users/${uid}/invoices/invoice-ok`,{invoiceNo:"INV-OK",client:"Private Customer",amount:999}),
      document(`users/${uid}/invoices/invoice-pending`,{invoiceNo:"INV-PENDING",email:"private@example.test"}),
      document(`users/${uid}/invoices/invoice-blank`,{invoiceNo:"",address:"Secret Road"}),
      document(`users/${uid}/bills/bill-b`,{billNumber:"bill / 9",supplier:"Secret Supplier"}),
      document(`users/${uid}/bills/bill-a`,{billNumber:"BILL-9",attachmentUrl:"https://secret"}),
      active,conflict
    ]);
    const result=report.perUid[0];
    expect(result.invoices).toMatchObject({totalCount:3,blankReferenceCount:1,nonblankReferenceCount:2,uniqueCanonicalGroups:2});
    expect(result.bills).toMatchObject({collisionGroups:1,recordsInCollisions:2});
    expect(result.expectedBackfillWrites).toEqual({activeClaimsToCreate:1,legacyConflictsToCreate:0});
    expect(result.diagnostics.map(item=>item.code)).toEqual(expect.arrayContaining([
      "blank-reference","legacy-conflict-consistent","unique-source-correct-active-claim"
    ]));
    expect(result.blockers.some(item=>item.code==="canonical-collision-group")).toBe(true);
    expect(result.warnings.some(item=>item.code==="unique-source-missing-claim")).toBe(true);
    const serialized=JSON.stringify(report);
    for(const secret of ["Private Customer","999","private@example.test","Secret Road","Secret Supplier","https://secret","INV-OK","BILL-9"]){
      expect(serialized).not.toContain(secret);
    }
  });

  it("classifies wrong-owner, retired-live, inconsistent conflict, orphan, malformed, namespace and metadata blockers",async()=>{
    const uid="blocked-user";
    const wrong=await registry(uid,"invoice","INV-1",{sourceId:"wrong-owner"});
    const retired=await registry(uid,"bill","BILL-2",{sourceId:"bill-2",state:"retired"});
    const inconsistent=await registry(uid,"invoice","INV-3",{
      sourceId:"__legacy_conflict__",state:"legacy-conflict",conflictingSourceIds:["other-a","other-b"],conflictCount:2
    });
    const orphanActive=await registry(uid,"invoice","ORPHAN-1",{sourceId:"gone"});
    const orphanConflict=await registry(uid,"bill","ORPHAN-2",{
      sourceId:"__legacy_conflict__",state:"legacy-conflict",conflictingSourceIds:["gone-a","gone-b"],conflictCount:2
    });
    const malformed=document(`users/${uid}/referenceKeys/not-the-key`,{
      schemaVersion:999,recordType:"expense",canonicalReference:"bad",sourceId:"x",state:"active"
    });
    const mismatchedId=document(`users/${uid}/referenceKeys/definitely-not-the-derived-key`,{
      schemaVersion:1,recordType:"invoice",canonicalReference:"inv999",sourceId:"x",state:"active"
    });
    const report=await audit([
      document(`users/${uid}/invoices/invoice-1`,{invoiceNo:"INV-1"}),
      document(`users/${uid}/bills/bill-2`,{billNumber:"BILL-2"}),
      document(`users/${uid}/invoices/invoice-3a`,{invoiceNo:"INV-3"}),
      document(`users/${uid}/invoices/invoice-3b`,{invoiceNo:"inv / 3"}),
      wrong,retired,inconsistent,orphanActive,orphanConflict,malformed,mismatchedId,
      document(`users/${uid}/referenceBackfillMigrations/unexpected`,{schemaVersion:2,status:"mystery"})
    ]);
    const codes=new Set(report.blockers.map(item=>item.code));
    for(const code of [
      "active-claim-wrong-source","retired-key-used-by-live-source","legacy-conflict-inconsistent",
      "orphan-active-registry-key","orphan-legacy-conflict-registry-key","malformed-registry-document",
      "namespace-type-mismatch","registry-document-id-mismatch","unexpected-migration-metadata","canonical-collision-group"
    ])expect(codes.has(code)).toBe(true);
    expect(report.readiness.readyForApprovalScan).toBe(false);
  });

  it("keeps stable ordering and hashes independent of adapter return order",async()=>{
    const entries=[
      document("users/z-user/invoices/z",{invoiceNo:"INV-2"}),
      document("users/a-user/bills/a",{billNumber:"BILL-1"}),
      document("users/z-user/invoices/a",{invoiceNo:"INV-1"})
    ];
    const normal=await createProductionReferenceAudit(readOnlyAdapter(entries),{projectId:"demo-simple-books",pageSize:2});
    const reversed=await createProductionReferenceAudit(readOnlyAdapter(entries,{reversePages:true}),{projectId:"demo-simple-books",pageSize:2});
    expect(reversed.census.orderedUids).toEqual(normal.census.orderedUids);
    expect(reversed.hashes).toEqual(normal.hashes);
    expect(reversed.perUid.map(item=>item.hashes)).toEqual(normal.perUid.map(item=>item.hashes));
  });

  it("includes updateTime in source binding and reports drift without generatedAt volatility",async()=>{
    const path="users/drift-user/invoices/source";
    const first=await audit([document(path,{invoiceNo:"INV-1"},"2026-08-20T00:00:00.000Z")]);
    const same=await audit([document(path,{invoiceNo:"INV-1"},"2026-08-20T00:00:00.000Z")]);
    const changed=await audit([document(path,{invoiceNo:"INV-1"},"2026-08-20T00:00:01.000Z")]);
    expect(same.hashes).toEqual(first.hashes);
    expect(changed.perUid[0].hashes.sourceStateHash).not.toBe(first.perUid[0].hashes.sourceStateHash);
    expect(compareAuditReports(first,same)).toMatchObject({hasDrift:false,overallDrift:false});
    expect(compareAuditReports(first,changed)).toMatchObject({hasDrift:true,overallDrift:true,sourceHashDrift:["drift-user"]});
  });

  it("reports added/removed UIDs, count/hash/registry/metadata drift",async()=>{
    const first=await audit([document("users/old/invoices/one",{invoiceNo:"INV-1"}),document("users/shared/bills/one",{billNumber:"B-1"})]);
    const claim=await registry("shared","bill","B-1",{sourceId:"one"});
    const second=await audit([
      document("users/new/invoices/one",{invoiceNo:"INV-NEW"}),
      document("users/shared/bills/one",{billNumber:"B-1"}),
      document("users/shared/bills/two",{billNumber:"B-2"}),claim,
      document("users/shared/referenceBackfillMigrations/phase3c3c-v1",validMetadata({
        status:"incomplete",cutoverReady:false,completedAt:undefined
      }))
    ]);
    const drift=compareAuditReports(first,second);
    expect(drift).toMatchObject({addedUids:["new"],removedUids:["old"],hasDrift:true});
    expect(drift.sourceCountDrift[0].uid).toBe("shared");
    expect(drift.sourceHashDrift).toContain("shared");
    expect(drift.registryHashDrift).toContain("shared");
    expect(drift.metadataHashDrift).toContain("shared");
  });

  it("fails closed for census/read failures without leaking error messages",async()=>{
    const report=await audit([document("users/user/invoices/one",{invoiceNo:"INV-1"})],{
      adapterOptions:{failGroup:"bills",failUserCollection:"referenceKeys"}
    });
    expect(report.census.complete).toBe(false);
    expect(report.readiness.readyForApprovalScan).toBe(false);
    expect(report.scan).toMatchObject({complete:false,status:"incomplete"});
    expect(report.blockers.map(item=>item.code)).toEqual(expect.arrayContaining([
      "uid-discovery-read-failed","incomplete-uid-census","uid-collection-read-failed"
    ]));
    expect(JSON.stringify(report)).not.toMatch(/private|Supplier secret|customer@example/);
  });

  it("stops at explicit read limits without changing stable hashes for generous guard metadata",async()=>{
    const entries=[document("users/limited/invoices/one",{invoiceNo:"INV-1"})];
    const baseline=await createProductionReferenceAudit(readOnlyAdapter(entries),{
      projectId:"demo-simple-books",pageSize:1
    });
    const generous=await createProductionReferenceAudit(readOnlyAdapter(entries),{
      projectId:"demo-simple-books",pageSize:1,
      safetyLimits:{maxDocuments:100,maxPages:100,maxUids:100,maxElapsedMs:100000}
    });
    expect(generous.hashes).toEqual(baseline.hashes);
    const limited=await createProductionReferenceAudit(readOnlyAdapter(entries),{
      projectId:"demo-simple-books",pageSize:1,safetyLimits:{maxPages:1}
    });
    expect(limited.scan).toMatchObject({complete:false,status:"incomplete",stopReason:"safety-limit"});
    expect(limited.readiness.readyForApprovalScan).toBe(false);
    expect(limited.blockers.map(item=>item.code)).toEqual(expect.arrayContaining([
      "audit-safety-limit-exceeded","incomplete-audit-scan"
    ]));
  });

  it("rejects malformed prior audit artifacts",async()=>{
    const report=await audit([]);
    expect(()=>compareAuditReports({},report)).toThrow("compatible production reference audit");
  });
});
