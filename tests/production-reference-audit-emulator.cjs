"use strict";

const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const {createRequire} = require("node:module");
const {resolve} = require("node:path");

process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:8080";
const functionsRequire = createRequire(resolve(__dirname, "../functions/package.json"));
const admin = functionsRequire("firebase-admin");
const {FieldPath} = functionsRequire("firebase-admin/firestore");
const {
  compareAuditReports,
  createProductionReferenceAudit,
} = require("../scripts/lib/production-reference-audit.cjs");
const {createReadOnlyFirestoreAdapter} = require("../scripts/lib/read-only-firestore-adapter.cjs");
const {referenceRegistryKey} = require("../functions/lib/reference-registry-key");

const projectId = "demo-simple-books";
const stamp = Date.now();
const prefix = `reference-audit-${stamp}`;
const uids = {
  legacy: `${prefix}-legacy-no-parent`,
  valid: `${prefix}-valid`,
  incompatible: `${prefix}-incompatible`,
  conflicts: `${prefix}-conflicts`,
  orphan: `${prefix}-orphan`,
};
if (!admin.apps.length) admin.initializeApp({projectId});
const firestore = admin.firestore();
const adapter = createReadOnlyFirestoreAdapter(firestore, FieldPath);

function source(path, data) {
  return {path, data};
}

function validMetadata(overrides = {}) {
  return {
    schemaVersion: 1, migrationVersion: "phase3c3c-v1", status: "incomplete", cutoverReady: false,
    scanned: 0, blankSkipped: 0, activeClaimCreated: 0, activeClaimAlreadyValid: 0,
    legacyConflictCreated: 0, legacyConflictAlreadyValid: 0, incompatibleExistingRegistry: 0,
    sourceChangedDuringApply: 0, migrationErrors: 0, collisionGroups: 0,
    lastRunAt: "2026-08-20T12:00:00.000Z", ...overrides,
  };
}

async function registry(uid, recordType, reference, data) {
  const key = await referenceRegistryKey(recordType, reference);
  return source(`users/${uid}/referenceKeys/${key.registryDocumentId}`, {
    schemaVersion: 1,
    recordType,
    canonicalReference: key.canonicalReference,
    claimedAt: "historical",
    retiredAt: null,
    ...data,
  });
}

async function seedFixtures() {
  const fixtures = [
    source(`users/${uids.legacy}/invoices/invoice-unique`, {invoiceNo: "EMU-INV-001", client: "Must not leak"}),
    source(`users/${uids.legacy}/bills/bill-unique-alpha`, {billNumber: "EMU-BILL-001", supplier: "Must not leak"}),
    source(`users/${uids.legacy}/invoices/invoice-blank`, {invoiceNo: "", amount: 12345}),
    source(`users/${uids.valid}/invoices/invoice-valid`, {invoiceNo: "EMU-VALID-001"}),
    source(`users/${uids.incompatible}/invoices/invoice-wrong`, {invoiceNo: "EMU-WRONG-001"}),
    source(`users/${uids.incompatible}/bills/bill-retired`, {billNumber: "EMU-RETIRED-001"}),
    source(`users/${uids.conflicts}/invoices/collision-a`, {invoiceNo: "EMU-COLLIDE-001"}),
    source(`users/${uids.conflicts}/invoices/collision-b`, {invoiceNo: "emu / collide / 001"}),
    source(`users/${uids.conflicts}/bills/inconsistent-a`, {billNumber: "EMU-INCONSISTENT-001"}),
    source(`users/${uids.conflicts}/bills/inconsistent-b`, {billNumber: "emu inconsistent 001"}),
    source(`users/${uids.orphan}/referenceKeys/malformed-document`, {
      schemaVersion: 999, recordType: "expense", canonicalReference: "bad", sourceId: "bad", state: "active",
    }),
    source(`users/${uids.orphan}/referenceBackfillMigrations/phase3c3c-v1`, validMetadata()),
    await registry(uids.valid, "invoice", "EMU-VALID-001", {sourceId: "invoice-valid", state: "active"}),
    await registry(uids.incompatible, "invoice", "EMU-WRONG-001", {sourceId: "other-source", state: "active"}),
    await registry(uids.incompatible, "bill", "EMU-RETIRED-001", {sourceId: "bill-retired", state: "retired"}),
    await registry(uids.conflicts, "invoice", "EMU-COLLIDE-001", {
      sourceId: "__legacy_conflict__", state: "legacy-conflict",
      conflictingSourceIds: ["collision-a", "collision-b"], conflictCount: 2,
    }),
    await registry(uids.conflicts, "bill", "EMU-INCONSISTENT-001", {
      sourceId: "__legacy_conflict__", state: "legacy-conflict",
      conflictingSourceIds: ["wrong-a", "wrong-b"], conflictCount: 2,
    }),
    await registry(uids.orphan, "invoice", "EMU-ORPHAN-ACTIVE", {sourceId: "gone", state: "active"}),
    await registry(uids.orphan, "bill", "EMU-ORPHAN-CONFLICT", {
      sourceId: "__legacy_conflict__", state: "legacy-conflict",
      conflictingSourceIds: ["gone-a", "gone-b"], conflictCount: 2,
    }),
  ];
  const batch = firestore.batch();
  for (const fixture of fixtures) batch.set(firestore.doc(fixture.path), fixture.data);
  await batch.commit();
}

async function snapshotFixtureDocuments() {
  const results = {};
  for (const uid of Object.values(uids)) {
    for (const collectionName of ["invoices", "bills", "referenceKeys", "referenceBackfillMigrations"]) {
      const snapshot = await firestore.collection(`users/${uid}/${collectionName}`).get();
      for (const document of snapshot.docs) {
        results[document.ref.path] = {data: document.data(), updateTime: document.updateTime.toDate().toISOString()};
      }
    }
  }
  return results;
}

function result(report, uid) {
  const found = report.perUid.find((entry) => entry.uid === uid);
  assert.ok(found, `Missing audit result for ${uid}`);
  return found;
}

async function main() {
  try {
    await seedFixtures();
    const parent = await firestore.doc(`users/${uids.legacy}`).get();
    assert.equal(parent.exists, false, "The parentless UID fixture unexpectedly has a parent document.");
    const before = await snapshotFixtureDocuments();
    const first = await createProductionReferenceAudit(adapter, {projectId, pageSize: 1});
    const second = await createProductionReferenceAudit(adapter, {projectId, pageSize: 1});
    const after = await snapshotFixtureDocuments();

    for (const uid of Object.values(uids)) assert.ok(first.census.orderedUids.includes(uid));
    assert.equal(first.census.complete, true);
    assert.ok(first.metrics.pagesFetched > 20, "Page size 1 did not exercise multiple pages.");
    assert.deepEqual(after, before, "The read-only audit changed emulator fixtures.");
    assert.deepEqual(second.hashes, first.hashes, "Stable audit hashes changed without a fixture mutation.");
    assert.deepEqual(second.perUid.map((entry) => entry.hashes), first.perUid.map((entry) => entry.hashes));

    const legacy = result(first, uids.legacy);
    assert.deepEqual(legacy.invoices, {
      totalCount: 2, blankReferenceCount: 1, nonblankReferenceCount: 1,
      canonicalGroupCount: 1, uniqueCanonicalGroups: 1, collisionGroups: 0, recordsInCollisions: 0,
    });
    assert.equal(legacy.bills.totalCount, 1);
    assert.equal(legacy.expectedBackfillWrites.activeClaimsToCreate, 2);
    assert.equal(legacy.readyForApprovalScan, true);

    const valid = result(first, uids.valid);
    assert.ok(valid.diagnostics.some((entry) => entry.code === "unique-source-correct-active-claim"));
    assert.equal(valid.expectedBackfillWrites.activeClaimsToCreate, 0);

    const incompatibleCodes = new Set(result(first, uids.incompatible).blockers.map((entry) => entry.code));
    assert.ok(incompatibleCodes.has("active-claim-wrong-source"));
    assert.ok(incompatibleCodes.has("retired-key-used-by-live-source"));

    const conflictResult = result(first, uids.conflicts);
    const conflictCodes = new Set(conflictResult.blockers.map((entry) => entry.code));
    assert.ok(conflictCodes.has("canonical-collision-group"));
    assert.ok(conflictCodes.has("legacy-conflict-inconsistent"));
    assert.ok(conflictResult.diagnostics.some((entry) => entry.code === "legacy-conflict-consistent"));

    const orphanCodes = new Set(result(first, uids.orphan).blockers.map((entry) => entry.code));
    assert.ok(orphanCodes.has("orphan-active-registry-key"));
    assert.ok(orphanCodes.has("orphan-legacy-conflict-registry-key"));
    assert.ok(orphanCodes.has("malformed-registry-document"));
    assert.equal(result(first, uids.orphan).migrationMetadata.presence, true);

    const serialized = JSON.stringify(first);
    assert.equal(serialized.includes("Must not leak"), false);
    assert.equal(serialized.includes("EMU-INV-001"), false);

    const cli = spawnSync(process.execPath, [
      resolve(__dirname, "../scripts/audit-production-reference-registry.cjs"),
      "--project", projectId, "--uid", uids.valid, "--page-size", "1",
    ], {encoding: "utf8", env: process.env, maxBuffer: 5 * 1024 * 1024});
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    assert.match(cli.stderr, /STRICTLY READ ONLY/);
    assert.match(cli.stderr, /SINGLE UID DIAGNOSTIC/);
    const cliReport = JSON.parse(cli.stdout);
    assert.equal(cliReport.census.mode, "explicit-uid");
    assert.equal(cliReport.census.approvalScopeComplete, false);
    assert.equal(cliReport.readiness.readyForApprovalScan, false);
    assert.equal(cliReport.scan.complete, true);
    assert.equal(cliReport.artifact.status, "complete");
    assert.deepEqual(cliReport.census.orderedUids, [uids.valid]);
    assert.equal(cliReport.perUid[0].hashes.combinedAuditHash, valid.hashes.combinedAuditHash);

    await firestore.doc(`users/${uids.legacy}/invoices/invoice-unique`).update({invoiceNo: "EMU-INV-002"});
    const changed = await createProductionReferenceAudit(adapter, {projectId, uid: uids.legacy, pageSize: 1});
    const baselineSingle = await createProductionReferenceAudit(adapter, {projectId, uid: uids.legacy, pageSize: 1});
    assert.deepEqual(changed.hashes, baselineSingle.hashes);
    const previousSingle = {
      ...first,
      perUid: [result(first, uids.legacy)],
      hashes: {...first.hashes, overallAuditHash: result(first, uids.legacy).hashes.combinedAuditHash},
    };
    const drift = compareAuditReports(previousSingle, changed);
    assert.equal(drift.hasDrift, true);
    assert.deepEqual(drift.sourceHashDrift, [uids.legacy]);
    assert.equal(result(first, uids.valid).hashes.sourceStateHash, result(second, uids.valid).hashes.sourceStateHash,
        "A different UID changed across isolated reruns.");

    console.log("Production reference read-only census/audit emulator integration passed.");
  } finally {
    await Promise.all(Object.values(uids).map((uid) => firestore.recursiveDelete(firestore.doc(`users/${uid}`))));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
