"use strict";

const assert = require("node:assert/strict");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const admin = require("../functions/node_modules/firebase-admin");
const {referenceRegistryKey} = require("../functions/lib/reference-registry-key");

const projectId = "simple-books-office";
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const functionsBase = "http://127.0.0.1:5001/simple-books-office/us-central1";
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const sourceId = `emulator-invoice-${Date.now()}`;
const invoiceNo = `EMU-${Date.now()}`;
const email = `source-create-${Date.now()}@example.test`;
const password = "Emulator-test-123!";

if (!admin.apps.length) admin.initializeApp({projectId});
const firestore = admin.firestore();

async function jsonRequest(url,options) {
  const response = await fetch(url,options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function createEmulatorUser() {
  const result = await jsonRequest(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-test-key`,
    {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({email,password,returnSecureToken:true})
    }
  );
  assert.ok(result.localId,"Auth Emulator did not return a UID.");
  assert.ok(result.idToken,"Auth Emulator did not return an ID token.");
  return {uid:result.localId,idToken:result.idToken};
}

async function invokeCreate(idToken,payload) {
  const body = await jsonRequest(
    `${functionsBase}/createInvoiceWithReference`,
    {
      method:"POST",
      headers:{
        Authorization:`Bearer ${idToken}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({data:{sourceId,requestId,payload}})
    }
  );
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}

async function waitForProfile(uid,timeoutMs = 10000) {
  const deadline=Date.now() + timeoutMs;
  while(Date.now() < deadline){
    const snapshot=await firestore.doc(`userProfiles/${uid}`).get();
    if(snapshot.exists) return snapshot;
    await new Promise(resolve => setTimeout(resolve,100));
  }
  throw new Error("Auth-triggered emulator user profile was not created.");
}

async function main() {
  let uid="";
  let journalPath="";
  try{
    const user=await createEmulatorUser();
    uid=user.uid;
    const profile=await waitForProfile(uid);
    assert.equal(profile.data().currentPlan,"Starter");
    assert.equal(typeof profile.data().createdAt?.toDate,"function");

    const payload={
      invoiceNo,
      client:"Emulator Integration Customer",
      clientEmail:"customer@example.test",
      clientAddress:"1 Emulator Road",
      paymentTerms:"14 days",
      dueDate:"2026-09-03",
      amount:100,
      vat:20,
      total:120,
      items:[{description:"Bookkeeping services",amount:100}],
      status:"Unpaid",
      date:"20/08/2026",
      recurringInvoice:"No",
      recurringFrequency:"",
      nextInvoiceDate:"",
      reminderDate:"",
      projectId:"",
      projectName:"",
      projectReference:""
    };

    const first=await invokeCreate(user.idToken,payload);
    assert.equal(first.status,"created");
    assert.equal(first.sourceId,sourceId);

    const key=await referenceRegistryKey("invoice",invoiceNo);
    journalPath=`journals/invoice_${encodeURIComponent(uid)}_${encodeURIComponent(sourceId)}`;
    const userRef=firestore.doc(`users/${uid}`);
    const [invoices,claims,requests,journals]=await Promise.all([
      userRef.collection("invoices").get(),
      userRef.collection("referenceKeys").get(),
      userRef.collection("referenceCreateRequests").get(),
      firestore.collection("journals").where("userId","==",uid).get()
    ]);
    assert.equal(invoices.size,1);
    assert.equal(claims.size,1);
    assert.equal(requests.size,1);
    assert.equal(journals.size,1);
    assert.equal(invoices.docs[0].id,sourceId);
    assert.equal(claims.docs[0].id,key.registryDocumentId);
    assert.equal(requests.docs[0].id,requestId);
    assert.equal(journals.docs[0].ref.path,journalPath);

    const second=await invokeCreate(user.idToken,payload);
    assert.equal(second.status,"already-created");
    const [retryInvoices,retryClaims,retryRequests,retryJournals]=await Promise.all([
      userRef.collection("invoices").get(),
      userRef.collection("referenceKeys").get(),
      userRef.collection("referenceCreateRequests").get(),
      firestore.collection("journals").where("userId","==",uid).get()
    ]);
    assert.equal(retryInvoices.size,1);
    assert.equal(retryClaims.size,1);
    assert.equal(retryRequests.size,1);
    assert.equal(retryJournals.size,1);
    console.log("Functions Emulator atomic Invoice create and timestamp wiring passed.");
  } finally {
    if(uid){
      const cleanup=await Promise.allSettled([
        firestore.recursiveDelete(firestore.doc(`users/${uid}`)),
        firestore.doc(`userProfiles/${uid}`).delete(),
        journalPath ? firestore.doc(journalPath).delete() : Promise.resolve(),
        admin.auth().deleteUser(uid)
      ]);
      const failures=cleanup.filter(result => result.status === "rejected");
      if(failures.length){
        throw new AggregateError(
          failures.map(result => result.reason),
          "Emulator integration-test cleanup failed."
        );
      }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode=1;
});
