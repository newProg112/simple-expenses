import { describe, expect, it, vi } from "vitest";
import {
  MIGRATION_STATUSES,
  buildMigrationPlan
} from "../scripts/lib/legacy-storage-migration.mjs";
import {
  assertCurrentQuarantineScope,
  buildQuarantinePlan,
  createOperations,
  quarantineSummary,
  runQuarantineItem,
  sourceMatchesBaseline
} from "../scripts/quarantine-unresolved-storage-attachments.mjs";

function object(name, overrides = {}) {
  return {
    name,
    size: "100",
    contentType: "application/pdf",
    contentDisposition: "inline; filename=unknown.pdf",
    md5Hash: "same-md5",
    crc32c: "same-crc",
    generation: "10",
    metageneration: "1",
    timeCreated: "2026-08-01T00:00:00Z",
    updated: "2026-08-01T00:00:00Z",
    metadata: { firebaseStorageDownloadTokens: "legacy-token" },
    ...overrides
  };
}

function baselineItem(source) {
  return buildMigrationPlan({ objects: [source], records: [] })[0];
}

function planFor(source, records = [], backup = null, backupPrefix = "migration-quarantine/test-run") {
  const objects = backup ? [source, backup] : [source];
  return buildQuarantinePlan({
    baselineItems: [baselineItem(source)],
    currentPlan: buildMigrationPlan({ objects, records }),
    objects,
    backupPrefix
  });
}

describe("unresolved legacy Storage quarantine planning", () => {
  it("marks an unchanged, unreferenced baseline object ready", () => {
    const source = object("bills/unresolved/unknown.pdf");
    const plan = planFor(source);
    expect(plan).toHaveLength(1);
    expect(plan[0].status).toBe("UNRESOLVED — READY TO QUARANTINE");
    expect(quarantineSummary(plan)).toEqual({ total: 1, ready: 1, alreadyQuarantined: 0, blocked: 0 });
  });

  it("fails closed if source generation or metadata changed", () => {
    const original = object("bills/unresolved/unknown.pdf");
    const changed = object(original.name, { generation: "11" });
    const plan = buildQuarantinePlan({
      baselineItems: [baselineItem(original)],
      currentPlan: buildMigrationPlan({ objects: [changed], records: [] }),
      objects: [changed],
      backupPrefix: "migration-quarantine/test-run"
    });
    expect(plan[0].status).toBe("BLOCKED");
    expect(sourceMatchesBaseline(changed, baselineItem(original).source)).toBe(false);
  });

  it("blocks an object that gained an authoritative Firestore reference", () => {
    const source = object("bills/unresolved/unknown.pdf");
    const record = {
      uid: "user-a",
      recordType: "bills",
      recordId: "unresolved",
      documentName: "projects/test/databases/(default)/documents/users/user-a/bills/unresolved",
      attachmentPath: source.name,
      attachmentUrl: ""
    };
    const plan = planFor(source, [record]);
    expect(plan[0].status).toBe("BLOCKED");
  });

  it("never creates a UID-scoped destination for an unresolved object", () => {
    const source = object("clients/unresolved/unknown.pdf");
    const item = planFor(source)[0];
    expect(item).not.toHaveProperty("destinationPath");
    expect(JSON.stringify(item)).not.toContain("users/");
  });

  it("recognises an absent source with a verified token-free backup as already quarantined", () => {
    const source = object("bills/unresolved/unknown.pdf");
    const backupPath = `migration-quarantine/test-run/${source.name}`;
    const backup = object(backupPath, {
      metadata: { quarantineBackupOf: source.name, quarantineRun: "test-run" }
    });
    const item = buildQuarantinePlan({
      baselineItems: [baselineItem(source)],
      currentPlan: [],
      objects: [backup],
      backupPrefix: "migration-quarantine/test-run"
    })[0];
    expect(item.status).toBe("ALREADY QUARANTINED");
  });

  it("rejects any legacy path outside the approved quarantine baseline", () => {
    const approved = object("bills/unresolved/unknown.pdf");
    const unexpected = object("clients/new-legacy/unknown.pdf");
    expect(() => assertCurrentQuarantineScope({
      baselineItems: [baselineItem(approved)],
      currentPlan: buildMigrationPlan({ objects: [approved, unexpected], records: [] })
    })).toThrow("outside the approved");
  });

  it("allows only missing baseline paths on an explicit retry", () => {
    const approved = object("bills/unresolved/unknown.pdf");
    expect(() => assertCurrentQuarantineScope({
      baselineItems: [baselineItem(approved)],
      currentPlan: [],
      allowCompleted: true
    })).not.toThrow();
    expect(() => assertCurrentQuarantineScope({
      baselineItems: [baselineItem(approved)],
      currentPlan: [],
      allowCompleted: false
    })).toThrow("not exactly");
  });
});

describe("unresolved legacy Storage quarantine execution", () => {
  function readyItem() {
    return planFor(object("bills/unresolved/unknown.pdf"))[0];
  }

  function operations(calls = []) {
    const source = object("bills/unresolved/unknown.pdf");
    const backup = object(`migration-quarantine/test-run/${source.name}`, { metadata: {} });
    return {
      getObject: vi.fn(async () => source),
      assertSource: vi.fn(() => calls.push("source")),
      assertUnreferenced: vi.fn(async () => calls.push("unreferenced")),
      recordManifest: vi.fn(async event => calls.push(`manifest:${event.stage}`)),
      copyBackup: vi.fn(async () => { calls.push("copy"); return backup; }),
      verifyBackup: vi.fn(() => calls.push("verify-backup")),
      assertDeletionBoundary: vi.fn(async () => calls.push("boundary")),
      legacyDownloadUrls: vi.fn(() => ["https://example.test/old?token=secret"]),
      deleteSource: vi.fn(async () => calls.push("delete")),
      verifyDeleted: vi.fn(async () => calls.push("verify-deleted")),
      resumeQuarantined: vi.fn(async item => ({ sourcePath: item.sourcePath, status: "ALREADY QUARANTINED" }))
    };
  }

  it("verifies a token-free backup and final boundary before deletion", async () => {
    const calls = [];
    const result = await runQuarantineItem(readyItem(), operations(calls));
    expect(result.status).toBe("QUARANTINED");
    expect(calls).toEqual([
      "source",
      "unreferenced",
      "manifest:BEFORE",
      "copy",
      "verify-backup",
      "manifest:BACKUP_VERIFIED",
      "boundary",
      "delete",
      "verify-deleted",
      "manifest:COMPLETE"
    ]);
  });

  it("does not delete when backup verification fails", async () => {
    const ops = operations();
    ops.verifyBackup = vi.fn(() => { throw new Error("backup mismatch"); });
    await expect(runQuarantineItem(readyItem(), ops)).rejects.toThrow("backup mismatch");
    expect(ops.assertDeletionBoundary).not.toHaveBeenCalled();
    expect(ops.deleteSource).not.toHaveBeenCalled();
  });

  it("does not delete if Firestore changes at the final boundary", async () => {
    const ops = operations();
    ops.assertDeletionBoundary = vi.fn().mockRejectedValue(new Error("now referenced"));
    await expect(runQuarantineItem(readyItem(), ops)).rejects.toThrow("now referenced");
    expect(ops.deleteSource).not.toHaveBeenCalled();
  });

  it("resumes verification instead of copying or deleting an already quarantined item", async () => {
    const source = object("bills/unresolved/unknown.pdf");
    const backup = object(`migration-quarantine/test-run/${source.name}`, { metadata: {} });
    const item = buildQuarantinePlan({
      baselineItems: [baselineItem(source)],
      currentPlan: [],
      objects: [backup],
      backupPrefix: "migration-quarantine/test-run"
    })[0];
    const ops = operations();
    await runQuarantineItem(item, ops);
    expect(ops.resumeQuarantined).toHaveBeenCalledOnce();
    expect(ops.copyBackup).not.toHaveBeenCalled();
    expect(ops.deleteSource).not.toHaveBeenCalled();
  });
});

describe("quarantine backup metadata", () => {
  it("creates the backup atomically without a Firebase token and preserves content metadata", async () => {
    const source = object("bills/unresolved/unknown.pdf");
    const requests = [];
    const client = {
      request: vi.fn(async (_url, options = {}) => {
        requests.push(options);
        if (!options.method) return null;
        const resource = JSON.parse(options.body);
        return { done: true, resource: { ...source, ...resource, name: "backup" } };
      })
    };
    const ops = createOperations({
      client,
      options: {
        project: "simple-books-office",
        bucket: "simple-books-office.firebasestorage.app",
        manifest: "C:\\private\\quarantine.json",
        backupPrefix: "migration-quarantine/test-run"
      },
      records: [],
      recordManifest: vi.fn()
    });
    const backup = await ops.copyBackup(source, `migration-quarantine/test-run/${source.name}`);
    const body = JSON.parse(requests.find(options => options.method === "POST").body);
    expect(body.contentType).toBe("application/pdf");
    expect(body.contentDisposition).toBe(source.contentDisposition);
    expect(body.metadata.firebaseStorageDownloadTokens).toBeUndefined();
    expect(backup.metadata.firebaseStorageDownloadTokens).toBeUndefined();
  });
});
