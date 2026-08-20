"use strict";

const assert=require("node:assert/strict");
process.env.FIRESTORE_EMULATOR_HOST||="127.0.0.1:8080";
const admin=require("../functions/node_modules/firebase-admin");
const {createLegacyReferenceBackfillService,BACKFILL_VERSION,MIGRATION_COLLECTION}=require("../functions/lib/legacy-reference-backfill-service");
const {createSourceEditService}=require("../functions/lib/source-edit-service");
const {editStateProjection}=require("../functions/lib/source-edit-state");
const {referenceRegistryKey}=require("../functions/lib/reference-registry-key");

const projectId="demo-simple-books";
const stamp=Date.now();
const uid=`backfill-user-${stamp}`;
const otherUid=`backfill-other-${stamp}`;
if(!admin.apps.length)admin.initializeApp({projectId});
const firestore=admin.firestore();
const serverTimestamp=()=>admin.firestore.FieldValue.serverTimestamp();
const backfill=createLegacyReferenceBackfillService({firestore,serverTimestamp});
let nowTick=0;
const edit=createSourceEditService({firestore,serverTimestamp,now:()=>`2026-08-20T12:00:0${++nowTick}.000Z`});

function invoice(reference){return {
  invoiceNo:reference,client:"Legacy Customer",clientEmail:"customer@example.test",clientAddress:"1 Emulator Road",
  paymentTerms:"14 days",dueDate:"2026-09-03",amount:100,vat:20,total:120,
  items:[{description:"Services",amount:100}],status:"Unpaid",date:"20/08/2026",
  recurringInvoice:"No",recurringFrequency:"",nextInvoiceDate:"",reminderDate:"",
  projectId:"",projectName:"",projectReference:"",createdAt:"2026-08-20T10:00:00.000Z"
};}
function bill(reference){return {
  id:"legacy-persisted-id",supplier:"Legacy Supplier",billNumber:reference,billDate:"2026-08-20",dueDate:"2026-09-03",
  category:"Utilities",net:100,vatRate:0.2,vat:20,total:120,status:"Unpaid",notes:"",
  projectId:"",projectName:"",projectReference:"",attachmentName:"",attachmentUrl:"",
  attachmentPath:"",attachmentSize:0,attachmentType:"",createdAt:"2026-08-20T10:00:00.000Z"
};}
function invoiceEdit(source,reference){const {status:_status,createdAt:_createdAt,updatedAt:_updatedAt,...payload}=source;return {...payload,invoiceNo:reference,businessName:"",businessEmail:"",businessWebsite:"",businessVat:""};}
function billEdit(source,reference){const {id:_id,createdAt:_createdAt,updatedAt:_updatedAt,...payload}=source;return {...payload,billNumber:reference};}

async function exerciseEdit(type,collection,sourceId,newReference,requestId){
  const sourceRef=firestore.doc(`users/${uid}/${collection}/${sourceId}`);const before=(await sourceRef.get()).data();
  const input={uid,recordType:type,sourceId,requestId,expectedState:editStateProjection(type,before),payload:type==="invoice"?invoiceEdit(before,newReference):billEdit(before,newReference)};
  const result=await edit(input);assert.equal(result.status,"updated");
  const oldReference=type==="invoice"?before.invoiceNo:before.billNumber;
  const [oldKey,newKey]=await Promise.all([referenceRegistryKey(type,oldReference),referenceRegistryKey(type,newReference)]);
  const [oldClaim,newClaim,source]=await Promise.all([
    firestore.doc(`users/${uid}/referenceKeys/${oldKey.registryDocumentId}`).get(),
    firestore.doc(`users/${uid}/referenceKeys/${newKey.registryDocumentId}`).get(),sourceRef.get()
  ]);
  assert.equal(oldClaim.data().state,"retired");assert.equal(newClaim.data().state,"active");assert.equal(newClaim.data().sourceId,sourceId);
  assert.equal(source.data()[type==="invoice"?"invoiceNo":"billNumber"],newReference);
  if(type==="bill")assert.equal(source.data().id,"legacy-persisted-id");
}

async function main(){
  try{
    const invoiceId="legacy-invoice-alpha";const billId="legacy-bill-alpha";
    await Promise.all([
      firestore.doc(`users/${uid}/invoices/${invoiceId}`).set(invoice("EMU-LEGACY-INV-001")),
      firestore.doc(`users/${uid}/bills/${billId}`).set(bill("EMU-LEGACY-BILL-001")),
      firestore.doc(`users/${otherUid}/invoices/other-invoice`).set(invoice("EMU-OTHER-001"))
    ]);

    const before=(await firestore.collection(`users/${uid}/referenceKeys`).get()).size;
    const dry=await backfill({uid,dryRun:true});
    assert.equal(dry.summary.activeClaimWouldCreate,2);assert.equal((await firestore.collection(`users/${uid}/referenceKeys`).get()).size,before);
    assert.equal((await firestore.collection(`users/${uid}/${MIGRATION_COLLECTION}`).get()).size,0);

    const invoiceSource=(await firestore.doc(`users/${uid}/invoices/${invoiceId}`).get()).data();
    const preBackfillInput={uid,recordType:"invoice",sourceId:invoiceId,requestId:"123e4567-e89b-42d3-a456-426614174000",expectedState:editStateProjection("invoice",invoiceSource),payload:invoiceEdit(invoiceSource,"EMU-SHOULD-FAIL")};
    await assert.rejects(()=>edit(preBackfillInput),error=>error.code==="source-reference-unclaimed");

    const applied=await backfill({uid,dryRun:false});
    assert.equal(applied.summary.activeClaimCreated,2);assert.equal(applied.summary.cutoverReady,true);
    assert.equal((await firestore.collection(`users/${uid}/referenceKeys`).get()).size,2);
    assert.equal((await firestore.collection(`users/${otherUid}/referenceKeys`).get()).size,0);
    const metadata=await firestore.doc(`users/${uid}/${MIGRATION_COLLECTION}/${BACKFILL_VERSION}`).get();
    assert.equal(metadata.data().status,"complete");assert.equal(metadata.data().cutoverReady,true);

    const invoiceKey=await referenceRegistryKey("invoice","EMU-LEGACY-INV-001");const firstClaim=(await firestore.doc(`users/${uid}/referenceKeys/${invoiceKey.registryDocumentId}`).get()).data();
    const rerun=await backfill({uid,dryRun:false});const secondClaim=(await firestore.doc(`users/${uid}/referenceKeys/${invoiceKey.registryDocumentId}`).get()).data();
    assert.equal(rerun.summary.activeClaimAlreadyValid,2);assert.deepEqual(secondClaim,firstClaim);

    await exerciseEdit("invoice","invoices",invoiceId,"EMU-LEGACY-INV-002","223e4567-e89b-42d3-a456-426614174001");
    await exerciseEdit("bill","bills",billId,"EMU-LEGACY-BILL-002","323e4567-e89b-42d3-a456-426614174002");
    console.log("Emulator legacy reference backfill and Phase 3C.3B cutover checks passed.");
  }finally{
    const journals=await firestore.collection("journals").where("userId","==",uid).get();
    await Promise.all([
      firestore.recursiveDelete(firestore.doc(`users/${uid}`)),firestore.recursiveDelete(firestore.doc(`users/${otherUid}`)),
      ...journals.docs.map(document=>document.ref.delete())
    ]);
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
