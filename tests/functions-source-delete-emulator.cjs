"use strict";

const assert = require("node:assert/strict");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const admin = require("../functions/node_modules/firebase-admin");
const {editStateProjection} = require("../functions/lib/source-edit-state");
const {referenceRegistryKey} = require("../functions/lib/reference-registry-key");

const projectId = "demo-simple-books";
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const functionsBase = "http://127.0.0.1:5001/demo-simple-books/us-central1";
const stamp = Date.now();
const email = `source-delete-${stamp}@example.test`;
const password = "Emulator-test-123!";
const requestIds = {
  invoiceCreate:"123e4567-e89b-42d3-a456-426614174000",
  billCreate:"223e4567-e89b-42d3-a456-426614174001",
  invoiceDelete:"323e4567-e89b-42d3-a456-426614174002",
  billDelete:"423e4567-e89b-42d3-a456-426614174003",
  reuseCreate:"523e4567-e89b-42d3-a456-426614174004"
};

if (!admin.apps.length) admin.initializeApp({projectId});
const firestore = admin.firestore();

async function jsonRequest(url,options) {
  const response=await fetch(url,options);
  const body=await response.json().catch(()=>({}));
  if(!response.ok || body.error){
    const error=new Error(`${response.status} ${JSON.stringify(body)}`);
    error.body=body;
    throw error;
  }
  return Object.prototype.hasOwnProperty.call(body,"result") ? body.result : body;
}

async function createEmulatorUser() {
  const result=await jsonRequest(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-test-key`,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})
  });
  assert.ok(result.localId);assert.ok(result.idToken);return {uid:result.localId,idToken:result.idToken};
}

function invoke(idToken,name,data) {
  return jsonRequest(`${functionsBase}/${name}`,{
    method:"POST",headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},
    body:JSON.stringify({data})
  });
}

async function waitForProfile(uid,timeoutMs=10000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const snapshot=await firestore.doc(`userProfiles/${uid}`).get();if(snapshot.exists)return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error("Auth-triggered emulator user profile was not created.");}

async function main(){
  let uid="";const journalPaths=[];
  try{
    const user=await createEmulatorUser();uid=user.uid;await waitForProfile(uid);
    const invoiceId=`delete-invoice-${stamp}`;const billId=String(stamp);
    const invoiceNo=`DELETE-INV-${stamp}`;const billNumber=`DELETE-BILL-${stamp}`;
    const invoice={invoiceNo,client:"Delete Customer",clientEmail:"customer@example.test",clientAddress:"1 Road",paymentTerms:"14 days",dueDate:"2026-09-04",amount:100,vat:20,total:120,items:[{description:"Services",amount:100}],status:"Unpaid",date:"21/08/2026",recurringInvoice:"No",recurringFrequency:"",nextInvoiceDate:"",reminderDate:"",projectId:"",projectName:"",projectReference:""};
    const bill={id:stamp,supplier:"Delete Supplier",billNumber,billDate:"2026-08-21",dueDate:"2026-09-04",category:"Utilities",net:100,vatRate:0.2,vat:20,total:120,status:"Unpaid",notes:"",projectId:"",projectName:"",projectReference:"",attachmentName:"",attachmentUrl:"",attachmentPath:"",attachmentSize:0,attachmentType:""};
    await invoke(user.idToken,"createInvoiceWithReference",{sourceId:invoiceId,requestId:requestIds.invoiceCreate,payload:invoice});
    await invoke(user.idToken,"createBillWithReference",{sourceId:billId,requestId:requestIds.billCreate,payload:bill});
    const userRef=firestore.doc(`users/${uid}`);const invoiceRef=userRef.collection("invoices").doc(invoiceId);const billRef=userRef.collection("bills").doc(billId);
    const [invoiceSource,billSource]=await Promise.all([invoiceRef.get(),billRef.get()]);
    const invoiceJournal=`journals/invoice_${encodeURIComponent(uid)}_${encodeURIComponent(invoiceId)}`;const billJournal=`journals/bill_${encodeURIComponent(uid)}_${encodeURIComponent(billId)}`;journalPaths.push(invoiceJournal,billJournal);
    const journalBefore=(await Promise.all([firestore.doc(invoiceJournal).get(),firestore.doc(billJournal).get()])).map(snapshot=>snapshot.data());
    const invoiceDelete={sourceId:invoiceId,requestId:requestIds.invoiceDelete,expectedState:editStateProjection("invoice",invoiceSource.data())};
    const billDelete={sourceId:billId,requestId:requestIds.billDelete,expectedState:editStateProjection("bill",billSource.data())};
    assert.equal((await invoke(user.idToken,"deleteInvoiceWithReference",invoiceDelete)).status,"deleted");
    assert.equal((await invoke(user.idToken,"deleteBillWithReference",billDelete)).status,"deleted");
    assert.equal((await invoke(user.idToken,"deleteInvoiceWithReference",invoiceDelete)).status,"already-deleted");
    assert.equal((await invoke(user.idToken,"deleteBillWithReference",billDelete)).status,"already-deleted");
    const invoiceKey=await referenceRegistryKey("invoice",invoiceNo);const billKey=await referenceRegistryKey("bill",billNumber);
    const [deletedInvoice,deletedBill,invoiceClaim,billClaim,invoiceMarker,billMarker,invoiceJournalAfter,billJournalAfter]=await Promise.all([
      invoiceRef.get(),billRef.get(),userRef.collection("referenceKeys").doc(invoiceKey.registryDocumentId).get(),userRef.collection("referenceKeys").doc(billKey.registryDocumentId).get(),userRef.collection("referenceDeleteRequests").doc(requestIds.invoiceDelete).get(),userRef.collection("referenceDeleteRequests").doc(requestIds.billDelete).get(),firestore.doc(invoiceJournal).get(),firestore.doc(billJournal).get()
    ]);
    assert.equal(deletedInvoice.exists,false);assert.equal(deletedBill.exists,false);
    assert.deepEqual(invoiceClaim.data(),{...invoiceClaim.data(),state:"retired",sourceId:invoiceId,retireRequestId:requestIds.invoiceDelete});
    assert.deepEqual(billClaim.data(),{...billClaim.data(),state:"retired",sourceId:billId,retireRequestId:requestIds.billDelete});
    assert.equal(invoiceMarker.data().operation,"delete");assert.equal(billMarker.data().operation,"delete");
    assert.deepEqual(invoiceJournalAfter.data(),journalBefore[0]);assert.deepEqual(billJournalAfter.data(),journalBefore[1]);
    await assert.rejects(()=>invoke(user.idToken,"createInvoiceWithReference",{sourceId:`replacement-${stamp}`,requestId:requestIds.reuseCreate,payload:invoice}),/retired-reference/);
    console.log("Functions Emulator atomic Invoice/Bill delete, retry, tombstone, and journal semantics passed.");
  }finally{
    if(uid){const cleanup=await Promise.allSettled([firestore.recursiveDelete(firestore.doc(`users/${uid}`)),firestore.doc(`userProfiles/${uid}`).delete(),...journalPaths.map(path=>firestore.doc(path).delete()),admin.auth().deleteUser(uid)]);const failures=cleanup.filter(result=>result.status==="rejected");if(failures.length)throw new AggregateError(failures.map(result=>result.reason),"Emulator integration-test cleanup failed.");}
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
