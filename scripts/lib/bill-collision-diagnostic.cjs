"use strict";

const {
  BILL_COLLISION_LIMITS,
} = require("./bill-collision-diagnostic-config.cjs");

const DIAGNOSTIC_SCHEMA_VERSION = 1;
const DIAGNOSTIC_VERSION = "phase3c3c-step2d1-v1";
const SAFE_ERROR_CODES = new Map([
  ["7","permission-denied"],["16","unauthenticated"],["4","network-timeout"],["14","unavailable"],
  ["3","invalid-query"],["8","resource-exhausted"],["permission-denied","permission-denied"],
  ["unauthenticated","unauthenticated"],["deadline-exceeded","network-timeout"],
  ["unavailable","unavailable"],["invalid-argument","invalid-query"],["resource-exhausted","resource-exhausted"],
]);

function safeError(error) {
  const code=String(error?.code??error?.status??"").trim().toLowerCase().replaceAll("_","-");
  return Object.freeze({code:"bill-collision-diagnostic-read-failed",errorCategory:SAFE_ERROR_CODES.get(code)||"unknown"});
}

function base(binding) {
  return {
    schemaVersion:DIAGNOSTIC_SCHEMA_VERSION,
    diagnosticVersion:DIAGNOSTIC_VERSION,
    projectId:binding.projectId,
    databaseId:binding.databaseId,
    scope:{
      recordType:"bill",collisionGroupsOnly:true,
      consistencyPass:"bill-reference-fields-only",
      detailReads:"verified-collision-members-only",
    },
    safetyLimits:{...BILL_COLLISION_LIMITS},
    binding:{
      priorAuditHash:binding.priorAuditHash,
      collisionManifestHash:binding.collisionManifestHash,
      expected:{
        billCount:binding.totalBills,collisionGroups:binding.collisionGroups,
        collisionRecords:binding.collisionRecords,collisionGroupSizes:[...binding.collisionGroupSizes],
      },
    },
  };
}

async function createBillCollisionDiagnostic(adapter,binding) {
  if(!adapter||Object.keys(adapter).join(",")!=="readCollisionEvidence"||typeof adapter.readCollisionEvidence!=="function"){
    throw new TypeError("An exact Bill collision read-only adapter is required.");
  }
  const report=base(binding);
  let evidence;
  try{evidence=await adapter.readCollisionEvidence(binding);}catch(error){
    return Object.freeze({
      ...report,scan:{complete:false,status:"incomplete",stopReason:"read-failure"},
      observed:null,drift:{status:"unknown"},groups:[],blockers:["read-failed"],warnings:[],
      failure:safeError(error),metrics:{documentsRead:0,readOperations:0,queryPages:0},
      artifact:{status:"incomplete"}
    });
  }
  if(!evidence||evidence.complete!==true){
    const reason=String(evidence?.reason||"incomplete-read");
    const drift=reason==="collision-membership-drift"||reason==="bill-reference-census-cap-reached"||
      reason==="unexpected-bill-document-path"?"detected":"unknown";
    return Object.freeze({
      ...report,scan:{complete:false,status:"incomplete",stopReason:reason},
      observed:evidence?.observed||null,drift:{status:drift},groups:[],
      blockers:[reason],warnings:[],metrics:evidence?.metrics||{documentsRead:0,readOperations:0,queryPages:0},
      artifact:{status:"incomplete"}
    });
  }
  const warnings=[];
  for(const group of evidence.groups){
    if(group.demoContext==="demo-account")warnings.push(Object.freeze({code:"collision-group-on-demo-account",groupHash:group.groupHash}));
    if(group.classification==="ambiguous")warnings.push(Object.freeze({code:"ambiguous-collision-group",groupHash:group.groupHash}));
  }
  return Object.freeze({
    ...report,scan:{complete:true,status:"complete",stopReason:null},
    observed:evidence.observed,drift:{status:"none"},groups:evidence.groups,
    blockers:[],warnings:Object.freeze(warnings),metrics:evidence.metrics,artifact:{status:"complete"}
  });
}

module.exports=Object.freeze({
  DIAGNOSTIC_SCHEMA_VERSION,DIAGNOSTIC_VERSION,createBillCollisionDiagnostic
});
