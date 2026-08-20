import {createRequire} from "node:module";
import {describe,expect,it} from "vitest";

const require=createRequire(import.meta.url);
const {auditFixture}=require("./helpers/bill-collision-test-fixture.cjs");
const {
  buildCollisionAuditBinding,recomputeAuditHash
}=require("../scripts/lib/bill-collision-audit-binding.cjs");
const {createBillCollisionDiagnostic}=require("../scripts/lib/bill-collision-diagnostic.cjs");
const {BILL_COLLISION_LIMITS,BILL_DETAIL_FIELDS}=require("../scripts/lib/bill-collision-diagnostic-config.cjs");
const {createProductionReferenceAudit}=require("../scripts/lib/production-reference-audit.cjs");

const groups=[
  {uid:"fixture-user-a",reference:"supplier ref one",sourceIds:["bill-a","bill-b"]},
  {uid:"fixture-user-b",reference:"supplier ref two",sourceIds:["bill-c","bill-d","bill-e"]},
];

describe("Bill collision audit binding",()=>{
  it("verifies audit integrity and constructs only privacy-safe public hashes",()=>{
    const audit=auditFixture(groups,6);
    expect(recomputeAuditHash(audit)).toBe(audit.hashes.overallAuditHash);
    const binding=buildCollisionAuditBinding(audit,{expectedAuditHash:audit.hashes.overallAuditHash});
    expect(binding).toMatchObject({totalBills:6,collisionGroups:2,collisionRecords:5,collisionGroupSizes:[2,3]});
    expect(binding.collisionManifestHash).toMatch(/^[a-f\d]{64}$/);
    const safe=JSON.stringify({
      priorAuditHash:binding.priorAuditHash,collisionManifestHash:binding.collisionManifestHash,
      groups:binding.groups.map((group)=>({groupHash:group.groupHash,sourceHashes:group.sources.map((source)=>source.sourceHash)}))
    });
    for(const secret of ["fixture-user-a","fixture-user-b","supplier ref one","bill-a","bill-e"]){
      expect(safe).not.toContain(secret);
    }
  });

  it("rejects tampering, incomplete audits, and mismatched explicit hashes",()=>{
    const audit=auditFixture(groups,6);
    expect(()=>buildCollisionAuditBinding({...audit,globalTotals:{...audit.globalTotals,bills:{...audit.globalTotals.bills,totalCount:7}}},{
      expectedAuditHash:audit.hashes.overallAuditHash
    })).toThrow("integrity");
    expect(()=>buildCollisionAuditBinding({...audit,scan:{complete:false}},{expectedAuditHash:audit.hashes.overallAuditHash}))
      .toThrow("complete approval-scope");
    expect(()=>buildCollisionAuditBinding(audit,{expectedAuditHash:"0".repeat(64)})).toThrow("does not match");
  });

  it("recomputes Step 2C.1 hashes using the privacy-reduced unexpected-path warning state",async()=>{
    const empty=()=>Promise.resolve({documents:[],nextCursor:null});
    const adapter=Object.freeze({
      readCollectionGroupPage(collection){
        return collection==="invoices"?Promise.resolve({documents:[{
          id:"private-id",path:"invoices/private-id",updateTime:null,data:{invoiceNo:"PRIVATE-REF"}
        }],nextCursor:null}):empty();
      },
      readUserCollectionPage:empty,
    });
    const report=await createProductionReferenceAudit(adapter,{projectId:"demo-simple-books"});
    expect(report.warnings[0]).toMatchObject({pathShape:"top-level-collection",segmentCount:2});
    expect(recomputeAuditHash(report)).toBe(report.hashes.overallAuditHash);
  });
});

describe("Bill collision diagnostic service",()=>{
  const audit=auditFixture(groups,6);
  const binding=buildCollisionAuditBinding(audit,{expectedAuditHash:audit.hashes.overallAuditHash});
  const safeGroup={
    groupHash:binding.groups[0].groupHash,recordCount:2,demoContext:"non-demo-account",
    classification:"likely-exact-duplicate",classificationIsAdvisory:true,comparisonDataComplete:true,
    members:binding.groups[0].sources.map((source)=>({
      sourceHash:source.sourceHash,status:"unpaid",bankSettled:false,hasAttachment:false,
      hasProjectAllocation:false,accountingJournalExists:true
    })),relationships:{grossAmount:"same",billDate:"same",allComparisonFieldsEquivalent:true}
  };

  it("creates a small complete artifact from safe evidence",async()=>{
    const adapter=Object.freeze({readCollisionEvidence:async()=>({
      complete:true,reason:null,
      observed:{billCount:6,collisionGroups:2,collisionRecords:5,collisionGroupSizes:[2,3],collisionManifestHash:binding.collisionManifestHash},
      groups:[safeGroup],metrics:{documentsRead:16,readOperations:4,queryPages:1}
    })});
    const report=await createBillCollisionDiagnostic(adapter,binding);
    expect(report.scan).toEqual({complete:true,status:"complete",stopReason:null});
    expect(report.artifact.status).toBe("complete");
    expect(report.groups[0].classification).toBe("likely-exact-duplicate");
    expect(report.safetyLimits).toEqual(BILL_COLLISION_LIMITS);
  });

  it("fails closed for drift, partial reads, errors, and expanded adapters",async()=>{
    for(const reason of ["collision-membership-drift","collision-detail-partial-read"]){
      const report=await createBillCollisionDiagnostic(Object.freeze({readCollisionEvidence:async()=>({
        complete:false,reason,observed:{collisionGroups:99},metrics:{documentsRead:1,readOperations:1,queryPages:1}
      })}),binding);
      expect(report.artifact.status).toBe("incomplete");
      expect(report.groups).toEqual([]);
    }
    const error=await createBillCollisionDiagnostic(Object.freeze({readCollisionEvidence:async()=>{
      throw Object.assign(new Error("Private Supplier / bearer token"),{code:7});
    }}),binding);
    expect(error.failure).toEqual({code:"bill-collision-diagnostic-read-failed",errorCategory:"permission-denied"});
    expect(JSON.stringify(error)).not.toMatch(/Private Supplier|bearer token/);
    await expect(createBillCollisionDiagnostic({...Object.freeze({readCollisionEvidence:async()=>({})}),set(){}},binding))
      .rejects.toThrow("exact Bill collision read-only adapter");
  });

  it("uses only the explicitly reviewed Bill projection",()=>{
    expect(BILL_DETAIL_FIELDS).toEqual([
      "billNumber","invoiceNumber","supplier","billDate","dueDate","category","net","vatRate","vat","total",
      "status","projectId","attachmentPath","attachmentUrl","attachmentName","bankSettlement"
    ]);
    for(const forbidden of ["notes","projectName","projectReference","attachmentSize","attachmentType"]){
      expect(BILL_DETAIL_FIELDS).not.toContain(forbidden);
    }
  });
});
