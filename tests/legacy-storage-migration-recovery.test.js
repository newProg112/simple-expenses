import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMigrationPlan,
  objectsEquivalent,
  recordReferencedPath,
  runMigration,
  safeLogValue,
  summarizePlan
} from "../scripts/lib/legacy-storage-migration.mjs";
import {
  assertApplyPlanAllowed,
  createApplyOperations,
  verifyAppliedMigration
} from "../scripts/migrate-legacy-storage-attachments.mjs";

const context = { backupPrefix: "migration-backups/test-run", runId: "test-run" };

afterEach(() => {
  vi.unstubAllGlobals();
});

function sourceObject(recordId, filename) {
  return {
    name: `bills/${recordId}/${filename}`,
    size: "100",
    contentType: "application/pdf",
    md5Hash: `md5-${recordId}`,
    crc32c: `crc-${recordId}`,
    generation: "10",
    metageneration: "1",
    metadata: { firebaseStorageDownloadTokens: `legacy-token-${recordId}` }
  };
}

function firestoreRecord(recordId, filename) {
  const sourcePath = `bills/${recordId}/${filename}`;
  return {
    uid: "user-a",
    recordType: "bills",
    recordId,
    documentName: `projects/test/databases/(default)/documents/users/user-a/bills/${recordId}`,
    updateTime: "2026-08-12T00:00:00Z",
    attachmentName: filename,
    attachmentPath: "",
    attachmentUrl: `https://example.test/o/${encodeURIComponent(sourcePath)}?token=legacy-token-${recordId}`,
    attachmentSize: 100,
    attachmentType: "application/pdf"
  };
}

function createHarness(specifications = [{ recordId: "bill-1", filename: "receipt.pdf" }], interruption = null) {
  const objects = new Map();
  const records = new Map();
  const events = [];
  let interruptionUsed = false;

  for (const specification of specifications) {
    const source = sourceObject(specification.recordId, specification.filename);
    const record = firestoreRecord(specification.recordId, specification.filename);
    objects.set(source.name, source);
    records.set(record.documentName, record);
  }

  function maybeInterrupt(point, sourcePath) {
    if (!interruptionUsed && interruption?.point === point && (!interruption.sourcePath || interruption.sourcePath === sourcePath)) {
      interruptionUsed = true;
      throw new Error(`interrupted:${point}`);
    }
  }

  const operations = {
    async getObject(path) {
      return objects.get(path) || null;
    },
    async getRecord(documentName) {
      return { ...records.get(documentName) };
    },
    assertRecordStillOwnsSource(current, planned, sourcePath, destinationPath) {
      expect(current.documentName).toBe(planned.documentName);
      expect([sourcePath, destinationPath]).toContain(recordReferencedPath(current));
    },
    async recordManifest(event) {
      events.push(event.stage);
      const points = {
        BEFORE: "before-backup",
        BACKUP_VERIFIED: "after-backup",
        COPY_VERIFIED: "after-destination",
        RECORD_VERIFIED: "before-deletion"
      };
      if (points[event.stage]) maybeInterrupt(points[event.stage], event.before.sourcePath);
    },
    async copyForBackup(source, backupPath) {
      const existing = objects.get(backupPath);
      if (existing) {
        if (!objectsEquivalent(source, existing)) throw new Error("backup conflict");
        if (existing.metadata?.firebaseStorageDownloadTokens) {
          existing.metadata = { migrationBackupOf: source.name, migrationRun: context.runId };
        }
        return existing;
      }
      const backup = {
        ...source,
        name: backupPath,
        metadata: { migrationBackupOf: source.name, migrationRun: context.runId }
      };
      objects.set(backupPath, backup);
      return backup;
    },
    async copyForDestination(source, destinationPath, replacementToken, uid) {
      const destination = {
        ...source,
        name: destinationPath,
        metadata: {
          firebaseStorageDownloadTokens: replacementToken,
          ownerUid: uid,
          migratedFrom: source.name,
          migrationRun: context.runId
        }
      };
      objects.set(destinationPath, destination);
      return destination;
    },
    async verifyEquivalent(source, candidate) {
      if (!objectsEquivalent(source, candidate)) throw new Error("not equivalent");
    },
    verifyBackupTokenFree(backup) {
      if (backup.metadata?.firebaseStorageDownloadTokens) throw new Error("backup has token");
    },
    createReplacementToken() {
      return "fresh-replacement-token";
    },
    async ensureDestinationToken(destination, _path, replacementToken, uid, _context, source) {
      const sourceToken = source.metadata?.firebaseStorageDownloadTokens;
      let token = replacementToken || destination.metadata?.firebaseStorageDownloadTokens || "";
      if (!token || token === sourceToken) {
        token = "fresh-replacement-token";
        destination.metadata = {
          ...destination.metadata,
          firebaseStorageDownloadTokens: token,
          ownerUid: uid
        };
      }
      return { destination, replacementToken: token };
    },
    verifyReplacementToken(source, destination, replacementToken) {
      expect(replacementToken).not.toBe(source.metadata?.firebaseStorageDownloadTokens);
      expect(destination.metadata?.firebaseStorageDownloadTokens).toBe(replacementToken);
    },
    destinationDownloadUrl(path, _destination, token) {
      return `https://example.test/o/${encodeURIComponent(path)}?token=${token}`;
    },
    legacyDownloadUrls(source) {
      return [`https://example.test/o/${encodeURIComponent(source.name)}?token=legacy`];
    },
    async updateRecord(currentRecord, update) {
      records.set(currentRecord.documentName, {
        ...records.get(currentRecord.documentName),
        ...update,
        updateTime: "2026-08-12T00:01:00Z"
      });
      const sourcePath = currentRecord.attachmentPath || decodeURIComponent(new URL(currentRecord.attachmentUrl).pathname.split("/o/")[1]);
      maybeInterrupt("after-firestore-update", sourcePath);
    },
    verifyRecordUpdate(updatedRecord, expected) {
      for (const [key, value] of Object.entries(expected)) expect(updatedRecord[key]).toBe(value);
    },
    async verifyReplacementAccess() {},
    async assertDestructiveBoundaryUnchanged({
      source,
      backup,
      destination,
      updatedRecord,
      attachmentUpdate,
      replacementToken
    }) {
      expect(objects.get(backup.name)?.generation).toBe(backup.generation);
      expect(objects.get(destination.name)?.generation).toBe(destination.generation);
      expect(objectsEquivalent(source, objects.get(backup.name))).toBe(true);
      expect(objectsEquivalent(source, objects.get(destination.name))).toBe(true);
      expect(records.get(updatedRecord.documentName)?.updateTime).toBe(updatedRecord.updateTime);
      expect(records.get(updatedRecord.documentName)?.attachmentPath).toBe(attachmentUpdate.attachmentPath);
      expect(objects.get(destination.name)?.metadata?.firebaseStorageDownloadTokens).toBe(replacementToken);
    },
    async removeLegacyObject(source) {
      objects.delete(source.name);
      maybeInterrupt("after-deletion", source.name);
    },
    async verifyLegacyTokensRevoked(_urls, sourcePath) {
      expect(objects.has(sourcePath)).toBe(false);
    }
  };

  function plan() {
    return buildMigrationPlan({ objects: [...objects.values()], records: [...records.values()] });
  }

  async function run() {
    return runMigration({ plan: plan(), apply: true, operations, context });
  }

  function assertFinal() {
    for (const specification of specifications) {
      const sourcePath = `bills/${specification.recordId}/${specification.filename}`;
      const destinationPath = `users/user-a/attachments/bills/${specification.recordId}/${specification.filename}`;
      const backupPath = `${context.backupPrefix}/${sourcePath}`;
      const record = records.get(`projects/test/databases/(default)/documents/users/user-a/bills/${specification.recordId}`);
      expect(objects.has(sourcePath)).toBe(false);
      expect(objects.has(destinationPath)).toBe(true);
      expect(objects.has(backupPath)).toBe(true);
      expect(objects.get(backupPath).metadata?.firebaseStorageDownloadTokens).toBeUndefined();
      expect(objects.get(destinationPath).metadata?.firebaseStorageDownloadTokens).toBe("fresh-replacement-token");
      expect(record.attachmentPath).toBe(destinationPath);
    }
    expect(objects.size).toBe(specifications.length * 2);
  }

  return { assertFinal, events, objects, operations, plan, records, run };
}

describe("legacy Storage migration interruption recovery", () => {
  it("completes a completely fresh migration", async () => {
    const harness = createHarness();
    await harness.run();
    harness.assertFinal();
    expect(harness.plan()).toEqual([]);
  });

  it.each([
    "before-backup",
    "after-backup",
    "after-destination",
    "after-firestore-update",
    "before-deletion",
    "after-deletion"
  ])("converges safely when rerun after interruption at %s", async point => {
    const harness = createHarness(undefined, { point });
    await expect(harness.run()).rejects.toThrow(`interrupted:${point}`);
    await harness.run();
    harness.assertFinal();
  });

  it("rotates a legacy token found on a destination from an older partial copy", async () => {
    const harness = createHarness();
    const source = harness.objects.get("bills/bill-1/receipt.pdf");
    harness.objects.set("users/user-a/attachments/bills/bill-1/receipt.pdf", {
      ...source,
      name: "users/user-a/attachments/bills/bill-1/receipt.pdf"
    });
    await harness.run();
    harness.assertFinal();
  });

  it("sanitizes a token-bearing backup left by an older interrupted copy", async () => {
    const harness = createHarness();
    const source = harness.objects.get("bills/bill-1/receipt.pdf");
    harness.objects.set("migration-backups/test-run/bills/bill-1/receipt.pdf", {
      ...source,
      name: "migration-backups/test-run/bills/bill-1/receipt.pdf"
    });
    await harness.run();
    harness.assertFinal();
  });

  it("resumes a batch after one item completes and the next is interrupted", async () => {
    const specifications = [
      { recordId: "bill-1", filename: "receipt-1.pdf" },
      { recordId: "bill-2", filename: "receipt-2.pdf" }
    ];
    const harness = createHarness(specifications, {
      point: "after-backup",
      sourcePath: "bills/bill-2/receipt-2.pdf"
    });
    await expect(harness.run()).rejects.toThrow("interrupted:after-backup");
    expect(harness.objects.has("bills/bill-1/receipt-1.pdf")).toBe(false);
    expect(harness.objects.has("bills/bill-2/receipt-2.pdf")).toBe(true);

    await harness.run();
    harness.assertFinal();
  });

  it("never invokes write operations for unresolved objects", async () => {
    const unresolvedSource = sourceObject("unassigned", "unknown.pdf");
    const plan = buildMigrationPlan({ objects: [unresolvedSource], records: [] });
    const operations = new Proxy({}, {
      get() {
        return vi.fn(() => { throw new Error("unresolved write invoked"); });
      }
    });
    const result = await runMigration({ plan, apply: true, operations, context });
    expect(result.results).toEqual([{
      sourcePath: unresolvedSource.name,
      status: "SKIPPED",
      reason: "UNASSIGNED — REQUIRES REVIEW"
    }]);
  });
});

describe("legacy Storage copy metadata safety", () => {
  it("sets token-free backup metadata in the atomic rewrite request", async () => {
    const source = {
      ...sourceObject("bill-1", "receipt.pdf"),
      contentDisposition: "inline; filename=receipt.pdf"
    };
    const requests = [];
    const client = {
      request: vi.fn(async (url, options = {}) => {
        requests.push({ url: String(url), options });
        if (!options.method) return null;
        const metadata = JSON.parse(options.body).metadata;
        return { done: true, resource: { ...source, name: "backup", metadata } };
      })
    };
    const operations = createApplyOperations({
      client,
      options: {
        bucket: "test-bucket",
        project: "test",
        manifest: "C:\\private\\manifest.json",
        backupPrefix: context.backupPrefix
      },
      objectsByPath: new Map()
    });
    const backup = await operations.copyForBackup(source, `${context.backupPrefix}/${source.name}`, context);
    const rewriteBody = JSON.parse(requests.find(request => request.options.method === "POST").options.body);
    expect(rewriteBody.metadata.firebaseStorageDownloadTokens).toBeUndefined();
    expect(rewriteBody.contentType).toBe("application/pdf");
    expect(rewriteBody.contentDisposition).toBe("inline; filename=receipt.pdf");
    expect(backup.metadata.firebaseStorageDownloadTokens).toBeUndefined();
  });

  it("repairs and then reuses the token-free backup created by the failed first run", async () => {
    const source = {
      ...sourceObject("bill-1", "receipt.pdf"),
      contentDisposition: "inline; filename=receipt.pdf"
    };
    const backupPath = `${context.backupPrefix}/${source.name}`;
    let backup = {
      ...source,
      name: backupPath,
      contentType: "",
      contentDisposition: "",
      metadata: { migrationBackupOf: source.name, migrationRun: context.runId }
    };
    const requests = [];
    const client = {
      request: vi.fn(async (_url, options = {}) => {
        requests.push(options);
        if (!options.method) return backup;
        if (options.method !== "PATCH") throw new Error("unexpected write");
        const resource = JSON.parse(options.body);
        backup = { ...backup, ...resource, metageneration: "2" };
        return backup;
      })
    };
    const operations = createApplyOperations({
      client,
      options: {
        bucket: "test-bucket",
        project: "test",
        manifest: "C:\\private\\manifest.json",
        backupPrefix: context.backupPrefix
      },
      objectsByPath: new Map()
    });

    const repaired = await operations.copyForBackup(source, backupPath, context);
    expect(repaired.contentType).toBe("application/pdf");
    expect(repaired.contentDisposition).toBe("inline; filename=receipt.pdf");
    expect(repaired.metadata.firebaseStorageDownloadTokens).toBeUndefined();
    expect(objectsEquivalent(source, repaired)).toBe(true);

    const reused = await operations.copyForBackup(source, backupPath, context);
    expect(reused).toBe(repaired);
    expect(requests.filter(options => options.method === "PATCH")).toHaveLength(1);
  });

  it("uses a fresh destination token in the atomic rewrite request", async () => {
    const source = sourceObject("bill-1", "receipt.pdf");
    const requests = [];
    const client = {
      request: vi.fn(async (url, options = {}) => {
        requests.push({ url: String(url), options });
        const metadata = JSON.parse(options.body).metadata;
        return { done: true, resource: { ...source, name: "destination", metadata } };
      })
    };
    const operations = createApplyOperations({
      client,
      options: {
        bucket: "test-bucket",
        project: "test",
        manifest: "C:\\private\\manifest.json",
        backupPrefix: context.backupPrefix
      },
      objectsByPath: new Map()
    });
    await operations.copyForDestination(source, "users/user-a/attachments/bills/bill-1/receipt.pdf", "new-token", "user-a", context);
    const rewriteBody = JSON.parse(requests.find(request => request.options.method === "POST").options.body);
    expect(rewriteBody.metadata.firebaseStorageDownloadTokens).toBe("new-token");
    expect(rewriteBody.metadata.firebaseStorageDownloadTokens).not.toBe(source.metadata.firebaseStorageDownloadTokens);
  });
});

function approvedBaseline() {
  const objects = [];
  const records = [];
  for (let index = 1; index <= 26; index += 1) {
    const recordId = `linked-${index}`;
    const filename = `receipt-${index}.pdf`;
    objects.push(sourceObject(recordId, filename));
    records.push(firestoreRecord(recordId, filename));
  }
  for (let index = 1; index <= 19; index += 1) {
    objects.push(sourceObject(`unresolved-${index}`, `unknown-${index}.pdf`));
  }
  const plan = buildMigrationPlan({ objects, records });
  return { objects, plan, records, summary: summarizePlan(plan) };
}

function writeManifest(value) {
  const directory = mkdtempSync(join(tmpdir(), "simple-books-migration-test-"));
  const path = join(directory, "manifest.json");
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
}

describe("approved apply-plan locking", () => {
  it("accepts only the exact 45/26/19 initial plan", () => {
    const baseline = approvedBaseline();
    const manifest = join(tmpdir(), `not-created-${Date.now()}.json`);
    expect(() => assertApplyPlanAllowed({
      options: {
        manifest,
        project: "simple-books-office",
        bucket: "simple-books-office.firebasestorage.app",
        backupPrefix: context.backupPrefix
      },
      plan: baseline.plan,
      summary: baseline.summary
    })).not.toThrow();

    const driftedPlan = baseline.plan.slice(1);
    expect(() => assertApplyPlanAllowed({
      options: {
        manifest,
        project: "simple-books-office",
        bucket: "simple-books-office.firebasestorage.app",
        backupPrefix: context.backupPrefix
      },
      plan: driftedPlan,
      summary: summarizePlan(driftedPlan)
    })).toThrow("approved 45/26/19");
  });

  it("allows a retry only when it is a safe subset of the original plan", () => {
    const baseline = approvedBaseline();
    const manifest = writeManifest({
      schemaVersion: 1,
      project: "simple-books-office",
      bucket: "simple-books-office.firebasestorage.app",
      backupPrefix: context.backupPrefix,
      events: [{ stage: "RUN_PLAN", summary: baseline.summary, plan: safeLogValue(baseline.plan) }]
    });
    const partialObjects = baseline.objects.filter(object => object.name !== "bills/linked-1/receipt-1.pdf");
    const partialRecords = baseline.records.map(current => current.recordId === "linked-1"
      ? {
          ...current,
          attachmentPath: "users/user-a/attachments/bills/linked-1/receipt-1.pdf",
          attachmentUrl: "https://example.test/o/users%2Fuser-a%2Fattachments%2Fbills%2Flinked-1%2Freceipt-1.pdf?token=new-token"
        }
      : current);
    const retryPlan = buildMigrationPlan({ objects: partialObjects, records: partialRecords });
    expect(() => assertApplyPlanAllowed({
      options: {
        manifest,
        project: "simple-books-office",
        bucket: "simple-books-office.firebasestorage.app",
        backupPrefix: context.backupPrefix
      },
      plan: retryPlan,
      summary: summarizePlan(retryPlan)
    })).not.toThrow();

    const unexpected = sourceObject("new-object", "unexpected.pdf");
    const driftedPlan = buildMigrationPlan({ objects: [...partialObjects, unexpected], records: partialRecords });
    expect(() => assertApplyPlanAllowed({
      options: {
        manifest,
        project: "simple-books-office",
        bucket: "simple-books-office.firebasestorage.app",
        backupPrefix: context.backupPrefix
      },
      plan: driftedPlan,
      summary: summarizePlan(driftedPlan)
    })).toThrow("drifted");
  });
});

function completedMigrationFixture() {
  const baseline = approvedBaseline();
  const objects = baseline.objects.filter(object => object.name.includes("unresolved-"));
  const records = [];
  const events = [{ stage: "RUN_PLAN", summary: baseline.summary, plan: safeLogValue(baseline.plan) }];
  for (const item of baseline.plan.filter(item => item.status.startsWith("LINKED"))) {
    const source = baseline.objects.find(object => object.name === item.source.path);
    const originalRecord = baseline.records.find(record => record.documentName === item.references[0].documentName);
    const backupPath = `${context.backupPrefix}/${source.name}`;
    const destinationPath = item.destinationPath;
    const newToken = `new-token-${originalRecord.recordId}`;
    objects.push({ ...source, name: backupPath, metadata: {} });
    objects.push({
      ...source,
      name: destinationPath,
      metadata: { firebaseStorageDownloadTokens: newToken, ownerUid: originalRecord.uid }
    });
    records.push({
      ...originalRecord,
      attachmentPath: destinationPath,
      attachmentUrl: `https://example.test/o/${encodeURIComponent(destinationPath)}?token=${newToken}`
    });
    events.push({
      stage: "BEFORE",
      before: { source, record: originalRecord, sourcePath: source.name, destinationPath, backupPath }
    });
    events.push({ stage: "COMPLETE", before: { sourcePath: source.name } });
  }
  const manifest = writeManifest({
    schemaVersion: 1,
    project: "simple-books-office",
    bucket: "simple-books-office.firebasestorage.app",
    backupPrefix: context.backupPrefix,
    events
  });
  const plan = buildMigrationPlan({ objects, records });
  return { baseline, manifest, objects, plan, records, summary: summarizePlan(plan) };
}

describe("post-apply read-only verification", () => {
  it("verifies all 26 migrated records and all 19 untouched unresolved objects", async () => {
    const fixture = completedMigrationFixture();
    vi.stubGlobal("fetch", vi.fn(async url => ({
      status: String(url).includes("new-token-") ? 206 : 404
    })));
    const result = await verifyAppliedMigration({
      options: {
        manifest: fixture.manifest,
        project: "simple-books-office",
        bucket: "simple-books-office.firebasestorage.app"
      },
      objects: fixture.objects,
      records: fixture.records,
      plan: fixture.plan,
      summary: fixture.summary
    });
    expect(result).toMatchObject({
      status: "PASS",
      migratedObjectsVerified: 26,
      FirestoreRecordsVerified: 26,
      replacementUrlsVerified: 26,
      legacyObjectsWithTokensRevoked: 26,
      legacyTokenUrlsRevoked: 26,
      unresolvedObjectsUntouched: 19,
      errors: 0
    });
  });

  it("fails verification if an unresolved object's metadata changed", async () => {
    const fixture = completedMigrationFixture();
    const unresolved = fixture.objects.find(object => object.name.includes("unresolved-1/"));
    unresolved.metageneration = "2";
    vi.stubGlobal("fetch", vi.fn(async url => ({
      status: String(url).includes("new-token-") ? 206 : 404
    })));
    await expect(verifyAppliedMigration({
      options: {
        manifest: fixture.manifest,
        project: "simple-books-office",
        bucket: "simple-books-office.firebasestorage.app"
      },
      objects: fixture.objects,
      records: fixture.records,
      plan: fixture.plan,
      summary: fixture.summary
    })).rejects.toThrow("metageneration changed");
  });
});
