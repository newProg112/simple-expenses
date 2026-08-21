"use strict";

const assert = require("node:assert/strict");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= "127.0.0.1:9099";

const admin = require("../functions/node_modules/firebase-admin");
const {referenceRegistryKey} = require("../functions/lib/reference-registry-key");

const projectId = "demo-simple-books";
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const functionsBase = `http://127.0.0.1:5001/${projectId}/us-central1`;
const stamp = Date.now();
const email = `demo-reset-${stamp}@example.test`;
const password = "Emulator-test-123!";

if(!admin.apps.length) admin.initializeApp({projectId});
const firestore = admin.firestore();

async function jsonRequest(url, options){
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if(!response.ok || body.error){
    throw new Error(`${response.status} ${JSON.stringify(body)}`);
  }
  return Object.prototype.hasOwnProperty.call(body, "result") ? body.result : body;
}

async function createEmulatorUser(){
  const result = await jsonRequest(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-test-key`,
    {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({email, password, returnSecureToken: true})
    }
  );
  assert.ok(result.localId);
  assert.ok(result.idToken);
  return {uid: result.localId, idToken: result.idToken};
}

function invokeReset(idToken){
  return jsonRequest(`${functionsBase}/resetDemoEnvironment`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({data: {}})
  });
}

async function assertProtectedDemoState(uid){
  const userRef = firestore.doc(`users/${uid}`);
  const [invoices, bills, claims, createRequests, editRequests, deleteRequests, journals] =
    await Promise.all([
      userRef.collection("invoices").get(),
      userRef.collection("bills").get(),
      userRef.collection("referenceKeys").get(),
      userRef.collection("referenceCreateRequests").get(),
      userRef.collection("referenceEditRequests").get(),
      userRef.collection("referenceDeleteRequests").get(),
      firestore.collection("journals").where("userId", "==", uid).get()
    ]);

  assert.equal(invoices.size, 25);
  assert.equal(bills.size, 18);
  assert.equal(claims.size, 43);
  assert.equal(createRequests.size, 0);
  assert.equal(editRequests.size, 0);
  assert.equal(deleteRequests.size, 0);
  assert.equal(journals.size, 78);

  for(const [recordType, snapshot, referenceField] of [
    ["invoice", invoices, "invoiceNo"],
    ["bill", bills, "billNumber"]
  ]){
    for(const source of snapshot.docs){
      const key = await referenceRegistryKey(recordType, source.data()[referenceField]);
      const claim = claims.docs.find(document => document.id === key.registryDocumentId);
      assert.ok(claim, `${recordType} ${source.id} must have a registry claim.`);
      assert.equal(claim.data().recordType, recordType);
      assert.equal(claim.data().canonicalReference, key.canonicalReference);
      assert.equal(claim.data().sourceId, source.id);
      assert.equal(claim.data().state, "active");
      assert.equal(claim.data().retiredAt, null);
    }
  }

  return {invoices, bills, claims};
}

async function main(){
  let uid = "";
  try{
    const user = await createEmulatorUser();
    uid = user.uid;
    const userRef = firestore.doc(`users/${uid}`);
    await userRef.set({demoMode: true, email}, {merge: true});

    const first = await invokeReset(user.idToken);
    assert.equal(first.seedVersion, 2);
    assert.equal(first.referenceClaims, 43);
    const firstState = await assertProtectedDemoState(uid);

    const firstClaim = firstState.claims.docs[0];
    await Promise.all([
      firstClaim.ref.update({state: "retired", retiredAt: new Date()}),
      userRef.collection("referenceCreateRequests").doc("stale-create").set({stale: true}),
      userRef.collection("referenceEditRequests").doc("stale-edit").set({stale: true}),
      userRef.collection("referenceDeleteRequests").doc("stale-delete").set({stale: true}),
      userRef.collection("referenceKeys").doc("stale-claim").set({stale: true})
    ]);

    const second = await invokeReset(user.idToken);
    assert.equal(second.seedVersion, 2);
    assert.equal(second.referenceClaims, 43);
    await assertProtectedDemoState(uid);
    console.log("Functions Emulator repeatable Demo reset and active reference claims passed.");
  }finally{
    if(uid){
      const journals = await firestore.collection("journals").where("userId", "==", uid).get();
      const cleanup = await Promise.allSettled([
        firestore.recursiveDelete(firestore.doc(`users/${uid}`)),
        firestore.doc(`userProfiles/${uid}`).delete(),
        ...journals.docs.map(document => document.ref.delete()),
        admin.auth().deleteUser(uid)
      ]);
      const failures = cleanup.filter(result => result.status === "rejected");
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
  process.exitCode = 1;
});
