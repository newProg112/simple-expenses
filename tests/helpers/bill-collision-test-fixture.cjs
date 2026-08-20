"use strict";

const {sha256}=require("../../scripts/lib/production-reference-audit.cjs");
const {recomputeAuditHash}=require("../../scripts/lib/bill-collision-audit-binding.cjs");

function auditFixture(groups,totalBills,overrides={}){
  const uids=[...new Set(groups.map((group)=>group.uid))].sort();
  const report={
    schemaVersion:1,auditVersion:"phase3c3c-step2a-v1",
    projectId:overrides.projectId||"demo-simple-books",databaseId:"(default)",
    scan:{complete:true,status:"complete"},
    census:{complete:true,mode:"complete-census",approvalScopeComplete:true,orderedUids:uids},
    perUid:uids.map((uid)=>({uid,hashes:{combinedAuditHash:sha256(`combined:${uid}`)}})),
    globalTotals:{
      invoices:{totalCount:0,blankReferenceCount:0,nonblankReferenceCount:0,canonicalGroupCount:0,uniqueCanonicalGroups:0,collisionGroups:0,recordsInCollisions:0},
      bills:{totalCount:totalBills,blankReferenceCount:0,nonblankReferenceCount:totalBills,
        canonicalGroupCount:totalBills-groups.reduce((sum,group)=>sum+group.sourceIds.length-1,0),
        uniqueCanonicalGroups:totalBills-groups.reduce((sum,group)=>sum+group.sourceIds.length,0),
        collisionGroups:groups.length,recordsInCollisions:groups.reduce((sum,group)=>sum+group.sourceIds.length,0)},
      registry:{totalReferenceKeys:0,activeCount:0,retiredCount:0,legacyConflictCount:0,malformedInvalidCount:0},
    },
    expectedBackfillWrites:{activeClaimsToCreate:0,legacyConflictsToCreate:groups.length},
    blockers:groups.map((group)=>({
      code:"canonical-collision-group",uid:group.uid,recordType:"bill",
      registryDocumentId:sha256(`registry:${group.reference}`),
      canonicalReferenceHash:sha256(group.reference),sourceIds:[...group.sourceIds],count:group.sourceIds.length,
    })),
    warnings:[],hashes:{censusHash:sha256("fixture-census"),overallAuditHash:""},
  };
  report.hashes.overallAuditHash=recomputeAuditHash(report);
  return report;
}

module.exports={auditFixture};
