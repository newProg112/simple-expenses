"use strict";

const assert=require("node:assert/strict");
const {createRequire}=require("node:module");
const {resolve}=require("node:path");

process.env.FIRESTORE_EMULATOR_HOST||="127.0.0.1:8080";
const functionsRequire=createRequire(resolve(__dirname,"../functions/package.json"));
const admin=functionsRequire("firebase-admin");
const {FieldPath}=functionsRequire("firebase-admin/firestore");
const {auditFixture}=require("./helpers/bill-collision-test-fixture.cjs");
const {buildCollisionAuditBinding}=require("../scripts/lib/bill-collision-audit-binding.cjs");
const {createBillCollisionDiagnostic}=require("../scripts/lib/bill-collision-diagnostic.cjs");
const {billJournalId,createBillCollisionReadOnlyAdapter}=require("../scripts/lib/bill-collision-read-only-adapter.cjs");

const projectId="demo-simple-books",prefix=`bill-collision-${Date.now()}`;
const uidA=`${prefix}-owner-a`,uidB=`${prefix}-owner-b`;
const ids={exactA:`${prefix}-exact-a`,exactB:`${prefix}-exact-b`,separateA:`${prefix}-separate-a`,separateB:`${prefix}-separate-b`,unique:`${prefix}-unique`};
const paths=Object.fromEntries(Object.entries(ids).map(([key,id])=>[key,`users/${key.startsWith("separate")?uidB:uidA}/bills/${id}`]));
const groups=[
  {uid:uidA,reference:"dup001",sourceIds:[ids.exactA,ids.exactB]},
  {uid:uidB,reference:"sep002",sourceIds:[ids.separateA,ids.separateB]},
];
const audit=auditFixture(groups,5);
const binding=buildCollisionAuditBinding(audit,{expectedAuditHash:audit.hashes.overallAuditHash});

if(!admin.apps.length)admin.initializeApp({projectId});
const firestore=admin.firestore();
const adapter=createBillCollisionReadOnlyAdapter(firestore,FieldPath);

function bill(overrides={}){return {
  billNumber:"DUP-001",supplier:"Private Supplier Limited",billDate:"2026-06-01",dueDate:"2026-07-01",
  category:"Professional Fees",net:100,vatRate:0.2,vat:20,total:120,status:"Unpaid",
  projectId:"private-project-id",projectName:"Secret Project",notes:"Confidential acquisition notes",
  attachmentPath:"users/private/attachments/secret.pdf",attachmentUrl:"https://secret.example/bill.pdf",
  attachmentName:"secret-supplier-bill.pdf",...overrides
};}

async function seed(){
  const batch=firestore.batch();
  batch.set(firestore.doc(`users/${uidA}`),{demoMode:false,privateEmail:"owner-a@example.test"});
  batch.set(firestore.doc(`users/${uidB}`),{demoMode:true,privateEmail:"owner-b@example.test"});
  batch.set(firestore.doc(paths.exactA),bill());
  batch.set(firestore.doc(paths.exactB),bill({billNumber:"dup / 001"}));
  batch.set(firestore.doc(paths.separateA),bill({billNumber:"SEP-002",billDate:"2026-06-03",net:200,vat:40,total:240,status:"Unpaid"}));
  batch.set(firestore.doc(paths.separateB),bill({billNumber:"sep / 002",billDate:"2026-07-14",net:300,vat:60,total:360,status:"Paid",bankSettlement:{version:1,transactionId:"private-bank-transaction",journalId:"private-settlement-journal"}}));
  batch.set(firestore.doc(paths.unique),bill({billNumber:"UNIQUE-003",supplier:"Unique Private Supplier",notes:"Unique secret note"}));
  batch.set(firestore.doc(`journals/${billJournalId(uidA,ids.exactA)}`),{sourceType:"supplierBill",privateDescription:"Secret journal"});
  await batch.commit();
}

async function fixtureSnapshot(){
  const documentPaths=[`users/${uidA}`,`users/${uidB}`,...Object.values(paths),`journals/${billJournalId(uidA,ids.exactA)}`];
  const result={};
  for(const path of documentPaths){const snapshot=await firestore.doc(path).get();result[path]={exists:snapshot.exists,data:snapshot.exists?snapshot.data():null,updateTime:snapshot.exists?snapshot.updateTime.toDate().toISOString():null};}
  return result;
}

async function main(){
  const driftId=`${prefix}-drift`;
  try{
    await seed();
    const before=await fixtureSnapshot();
    const report=await createBillCollisionDiagnostic(adapter,binding);
    const after=await fixtureSnapshot();
    assert.deepEqual(after,before,"The diagnostic changed emulator fixture data.");
    assert.equal(report.artifact.status,"complete");assert.equal(report.drift.status,"none");
    assert.equal(report.observed.billCount,5);assert.equal(report.observed.collisionGroups,2);assert.equal(report.observed.collisionRecords,4);
    assert.equal(report.groups.length,2,"Unique Bills appeared in completed collision detail.");

    const exact=report.groups.find((group)=>group.groupHash===binding.groups.find((group)=>group.uid===uidA).groupHash);
    const separate=report.groups.find((group)=>group.groupHash===binding.groups.find((group)=>group.uid===uidB).groupHash);
    assert.equal(exact.classification,"likely-exact-duplicate");
    assert.equal(exact.relationships.allComparisonFieldsEquivalent,true);
    assert.equal(exact.relationships.rawReferenceText,"different");
    assert.equal(exact.relationships.grossAmount,"same");
    assert.equal(exact.members.filter((member)=>member.accountingJournalExists).length,1);
    assert.equal(exact.demoContext,"non-demo-account");
    assert.equal(separate.classification,"likely-legitimate-same-reference-separate-bills");
    assert.equal(separate.relationships.grossAmount,"different");
    assert.equal(separate.relationships.billDate,"different");
    assert.equal(separate.relationships.billDateSpread,"over-thirty-one-days");
    assert.equal(separate.relationships.status,"different");
    assert.equal(separate.members.some((member)=>member.bankSettled),true);
    assert.equal(separate.demoContext,"demo-account");
    assert.deepEqual(report.metrics,{
      documentsRead:15,readOperations:4,queryPages:1,referenceCensusDocuments:5,
      collisionDetailDocuments:4,demoAccountDocuments:2,accountingJournalDocuments:4
    });

    const serialized=JSON.stringify(report);
    const secrets=[
      uidA,uidB,...Object.values(ids),...Object.values(paths),"DUP-001","dup / 001","SEP-002","sep / 002","UNIQUE-003",
      "Private Supplier Limited","Unique Private Supplier","Confidential acquisition notes","Unique secret note",
      "private-project-id","Secret Project","secret-supplier-bill.pdf","https://secret.example/bill.pdf",
      "private-bank-transaction","private-settlement-journal","owner-a@example.test","owner-b@example.test","Secret journal"
    ];
    for(const secret of secrets)assert.equal(serialized.includes(secret),false,`Sensitive value leaked: ${secret}`);

    await firestore.doc(`users/${uidA}/bills/${driftId}`).set(bill({billNumber:"DUP 001",supplier:"Drift Secret"}));
    const drift=await createBillCollisionDiagnostic(adapter,binding);
    assert.equal(drift.artifact.status,"incomplete");assert.equal(drift.drift.status,"detected");
    assert.equal(drift.scan.stopReason,"collision-membership-drift");assert.deepEqual(drift.groups,[]);

    console.log("Bill collision privacy-safe diagnostic emulator integration passed.");
  }finally{
    await Promise.all([
      firestore.recursiveDelete(firestore.doc(`users/${uidA}`)),firestore.recursiveDelete(firestore.doc(`users/${uidB}`)),
      firestore.doc(`journals/${billJournalId(uidA,ids.exactA)}`).delete(),
    ]);
  }
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
