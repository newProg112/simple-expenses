"use strict";

const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");

const projectId = "demo-simple-books";
const scenario = process.argv[2];
const founderUid = "founder-emulator";
const customerUid = "customer-emulator";
const proUid = "pro-emulator";
const demoUid = "demo-emulator";
const password = "Emulator-test-123!";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const functionsHost = process.env.FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const authBase = `http://${authHost}`;
const firestoreBase = `http://${firestoreHost}/v1/projects/${projectId}` +
  "/databases/(default)/documents";
const callableUrl = `http://${functionsHost}/${projectId}/us-central1/` +
  "getFounderAnalyticsSnapshot";
const demoActivityTime = "2026-09-04T12:30:00.000Z";
const visibleActivity = Object.freeze(Array.from({length: 21}, (_, index) => ({
  createdAt: new Date(Date.UTC(2026, 8, 4, 12, 20 - index)).toISOString(),
  displayEmail: index === 1 ? null : "customer@example.test",
  eventType: index === 1 ? "ai_question_asked" : "invoice_created",
  id: `visible-activity-${String(index).padStart(2, "0")}`,
})));

function assertLocalEmulatorHost(value, name) {
  assert.match(value || "", /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/, `${name} must be local.`);
}

assert.ok(["valid", "missing", "malformed"].includes(scenario));
assertLocalEmulatorHost(authHost, "Auth emulator host");
assertLocalEmulatorHost(firestoreHost, "Firestore emulator host");
assertLocalEmulatorHost(functionsHost, "Functions emulator host");
assertLocalEmulatorHost(process.env.FIREBASE_EMULATOR_HUB, "Emulator hub");
assert.equal(process.env.GCLOUD_PROJECT, projectId);

if (!admin.apps.length) admin.initializeApp({projectId});
const auth = admin.auth();
const firestore = admin.firestore();

async function jsonResponse(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return {body, status: response.status};
}

async function createUser(uid, email) {
  await auth.createUser({uid, email, password, emailVerified: true});
  return signIn(email);
}

async function signIn(email) {
  const {body, status} = await jsonResponse(
      `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword` +
        "?key=emulator-test-key",
      {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({email, password, returnSecureToken: true}),
      },
  );
  assert.equal(status, 200, JSON.stringify(body));
  assert.ok(body.idToken);
  return {email, idToken: body.idToken, uid: body.localId};
}

async function invokeCallable(idToken, data) {
  const headers = {"Content-Type": "application/json"};
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  return jsonResponse(callableUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({data}),
  });
}

function assertCallableError(response, status) {
  assert.ok(response.status >= 400, JSON.stringify(response.body));
  assert.equal(response.body.error && response.body.error.status, status);
  return response.body.error;
}

async function waitForProfiles(expected, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const profiles = await firestore.collection("userProfiles").get();
    if (profiles.size >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Auth-triggered profiles did not settle.");
}

async function clearCollection(name) {
  const snapshot = await firestore.collection(name).get();
  await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
}

function monthRange(generatedAt) {
  const end = new Date(generatedAt);
  return Array.from({length: 12}, (_, index) => {
    const date = new Date(Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth() - (11 - index),
        1,
    ));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function expectedActivity(limit) {
  return visibleActivity.slice(0, limit).map((event) => ({
    eventType: event.eventType,
    createdAt: event.createdAt,
    summary: event.eventType === "ai_question_asked" ?
      "The AI Assistant returned a successful answer." :
      "An invoice was successfully created.",
    displayEmail: event.displayEmail,
  }));
}

function assertExactSnapshot(snapshot, activityCount) {
  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    generatedAt: snapshot.generatedAt,
    overview: {
      totalUsers: 2,
      starterUsers: 1,
      proUsers: 1,
      activePaidSubscriptions: 1,
      estimatedMrrMinorUnits: 1500,
      currency: "GBP",
    },
    monthlySignups: monthRange(snapshot.generatedAt).map((monthKey, index) => ({
      monthKey,
      count: index === 11 ? 2 : 0,
    })),
    recentActivity: expectedActivity(activityCount),
  });
  assert.equal(new Date(snapshot.generatedAt).toISOString(), snapshot.generatedAt);

  const serialized = JSON.stringify(snapshot);
  for (const privateValue of [
    founderUid,
    customerUid,
    proUid,
    demoUid,
    "visible-activity-00",
    "visible-activity-01",
    "cus_emulator_private",
    "sub_emulator_private",
    "price_1TnLTCJmLqrFk5SqusEJiIhu",
    "raw-metadata-must-not-escape",
    "private-note-must-not-escape",
  ]) {
    assert.ok(!serialized.includes(privateValue), `Response leaked ${privateValue}.`);
  }
  for (const forbiddenKey of [
    "uid", "id", "documentId", "stripeCustomerId", "stripeSubscriptionId",
    "stripePriceId", "stripeMode", "metadata", "privateNote", "plan",
  ]) {
    assert.ok(!serialized.includes(`\"${forbiddenKey}\":`), `Response leaked ${forbiddenKey}.`);
  }
}

async function assertFirestoreReadDenied(idToken, path, identity) {
  const response = await fetch(`${firestoreBase}/${path}`, {
    headers: {Authorization: `Bearer ${idToken}`},
  });
  assert.equal(response.status, 403, `${identity} unexpectedly read ${path}.`);
}

async function seedValidData() {
  const [founder, customer, pro, demo] = await Promise.all([
    createUser(founderUid, "founder@example.test"),
    createUser(customerUid, "customer@example.test"),
    createUser(proUid, "pro@example.test"),
    createUser(demoUid, "demo@example.test"),
  ]);
  await waitForProfiles(4);
  await new Promise((resolve) => setTimeout(resolve, 6000));

  const timestamp = (value) => admin.firestore.Timestamp.fromDate(new Date(value));
  await Promise.all([
    firestore.doc(`users/${founderUid}`).set({demoMode: false}),
    firestore.doc(`users/${customerUid}`).set({demoMode: false}),
    firestore.doc(`users/${proUid}`).set({demoMode: false}),
    firestore.doc(`users/${demoUid}`).set({demoMode: true}),
    firestore.doc(`userProfiles/${customerUid}`).set({
      currentPlan: "Starter",
      privateNote: "private-note-must-not-escape",
    }, {merge: true}),
    firestore.doc(`userProfiles/${proUid}`).set({
      currentPlan: "Pro",
      subscriptionStatus: "active",
      billingOverride: false,
      stripeCustomerId: "cus_emulator_private",
      stripeSubscriptionId: "sub_emulator_private",
      stripePriceId: "price_1TnLTCJmLqrFk5SqusEJiIhu",
      stripeMode: "test",
      privateNote: "private-note-must-not-escape",
    }, {merge: true}),
    firestore.doc(`userProfiles/${demoUid}`).set({
      currentPlan: "Pro",
      subscriptionStatus: "active",
      billingOverride: false,
      stripeCustomerId: "cus_demo_private",
      stripeSubscriptionId: "sub_demo_private",
      stripePriceId: "price_1TnLTCJmLqrFk5SqusEJiIhu",
      stripeMode: "test",
    }, {merge: true}),
    firestore.doc(`adminUserNotes/${customerUid}`).set({
      note: "private-note-must-not-escape",
    }),
  ]);
  await clearCollection("adminActivityEvents");
  await Promise.all([
    firestore.doc("adminActivityEvents/demo-document-id").set({
      eventType: "invoice_created",
      createdAt: timestamp(demoActivityTime),
      uid: demoUid,
      displayEmail: "demo@example.test",
      metadata: {secret: "raw-metadata-must-not-escape"},
    }),
    ...visibleActivity.map((event, index) =>
      firestore.doc(`adminActivityEvents/${event.id}`).set({
        eventType: event.eventType,
        createdAt: timestamp(event.createdAt),
        uid: customerUid,
        ...(event.displayEmail ? {displayEmail: "CUSTOMER@example.test"} : {}),
        plan: "Starter",
        summary: "untrusted-summary-must-not-escape",
        metadata: {secret: "raw-metadata-must-not-escape"},
        ...(index === 0 ? {
          stripeCustomerId: "cus_emulator_private",
          privateNote: "private-note-must-not-escape",
        } : {}),
      })),
  ]);
  return {customer, demo, founder, pro};
}

async function runValidScenario() {
  const unauthenticated = await invokeCallable(null, {});
  assertCallableError(unauthenticated, "UNAUTHENTICATED");

  const identities = await seedValidData();
  const denied = await invokeCallable(identities.customer.idToken, {});
  assertCallableError(denied, "PERMISSION_DENIED");

  for (const data of [
    {activityLimit: 0},
    {activityLimit: 31},
    {activityLimit: 1.5},
    {activityLimit: "20"},
    {unknown: true},
    {uid: founderUid, admin: true, role: "founder"},
  ]) {
    const invalid = await invokeCallable(identities.founder.idToken, data);
    assertCallableError(invalid, "INVALID_ARGUMENT");
  }

  const defaultResponse = await invokeCallable(identities.founder.idToken, {});
  assert.equal(defaultResponse.status, 200, JSON.stringify(defaultResponse.body));
  assertExactSnapshot(defaultResponse.body.result, 20);

  const minimum = await invokeCallable(
      identities.founder.idToken,
      {activityLimit: 1},
  );
  assert.equal(minimum.status, 200, JSON.stringify(minimum.body));
  assert.equal(minimum.body.result.recentActivity.length, 1);
  assert.deepEqual(
      minimum.body.result.recentActivity[0],
      defaultResponse.body.result.recentActivity[0],
  );

  const maximum = await invokeCallable(
      identities.founder.idToken,
      {activityLimit: 30},
  );
  assert.equal(maximum.status, 200, JSON.stringify(maximum.body));
  assertExactSnapshot(maximum.body.result, 21);

  for (const [identity, token] of [
    ["ordinary customer", identities.customer.idToken],
    ["allow-listed founder", identities.founder.idToken],
  ]) {
    await assertFirestoreReadDenied(
        token,
        "adminActivityEvents/visible-activity-00",
        identity,
    );
    await assertFirestoreReadDenied(
        token,
        `adminUserNotes/${customerUid}`,
        identity,
    );
  }

  console.log("Founder Analytics valid callable and Firestore-denial scenario passed.");
}

async function runInvalidConfigurationScenario() {
  const founder = await createUser(founderUid, "founder@example.test");
  const response = await invokeCallable(founder.idToken, {});
  const error = assertCallableError(response, "FAILED_PRECONDITION");
  assert.equal(error.message, "Founder Analytics are not configured.");
  const serialized = JSON.stringify(response.body);
  assert.ok(!serialized.includes(founderUid));
  assert.ok(!serialized.includes("unexpected"));
  assert.ok(!serialized.includes("SIMPLE_BOOKS_ADMIN_UIDS"));
  console.log(`Founder Analytics ${scenario} configuration fails closed.`);
}

const run = scenario === "valid" ?
  runValidScenario : runInvalidConfigurationScenario;
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
