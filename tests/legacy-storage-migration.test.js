import { describe, expect, it, vi } from "vitest";
import {
  MIGRATION_STATUSES,
  buildMigrationPlan,
  destinationPathFor,
  migratePlanItem,
  objectsEquivalent,
  runMigration,
  safeLogValue
} from "../scripts/lib/legacy-storage-migration.mjs";
import {
  detectFirebaseProject,
  parseArguments,
  validateOptions
} from "../scripts/migrate-legacy-storage-attachments.mjs";

function object(name, overrides = {}) {
  return {
    name,
    size: "100",
    contentType: "application/pdf",
    md5Hash: "same-md5",
    crc32c: "same-crc",
    generation: "10",
    metageneration: "1",
    metadata: { firebaseStorageDownloadTokens: "secret-token" },
    ...overrides
  };
}

function record(overrides = {}) {
  return {
    uid: "user-a",
    recordType: "bills",
    recordId: "bill-1",
    documentName: "projects/test/databases/(default)/documents/users/user-a/bills/bill-1",
    updateTime: "2026-08-12T00:00:00Z",
    attachmentName: "receipt.pdf",
    attachmentPath: "",
    attachmentUrl: "https://firebasestorage.googleapis.com/v0/b/test/o/bills%2Fbill-1%2Freceipt.pdf?alt=media&token=secret-token",
    attachmentSize: 100,
    attachmentType: "application/pdf",
    ...overrides
  };
}

describe("legacy Storage migration planning", () => {
  it("maps an authoritative Firestore relationship to the correct UID destination", () => {
    const source = object("bills/bill-1/receipt.pdf");
    const plan = buildMigrationPlan({ objects: [source], records: [record()] });

    expect(plan).toHaveLength(1);
    expect(plan[0].status).toBe(MIGRATION_STATUSES.READY);
    expect(plan[0].references[0].uid).toBe("user-a");
    expect(plan[0].destinationPath).toBe(
      "users/user-a/attachments/bills/bill-1/receipt.pdf"
    );
  });

  it("builds expense and client paths without borrowing another user's UID", () => {
    expect(destinationPathFor(
      { uid: "owner-2", recordType: "expenses", recordId: "expense-9" },
      "scan.png"
    )).toBe("users/owner-2/attachments/expenses/expense-9/scan.png");
    expect(destinationPathFor(
      { uid: "owner-3", recordType: "clients", recordId: "client-4" },
      "agreement.pdf"
    )).toBe("users/owner-3/attachments/clients/client-4/agreement.pdf");
  });

  it("leaves an unknown owner unresolved and reports non-authoritative clues only", () => {
    const source = object("expenses/expense-7/receipt.pdf");
    const unrelatedRecord = record({
      uid: "possible-owner",
      recordType: "expenses",
      recordId: "expense-7",
      attachmentPath: "",
      attachmentUrl: ""
    });
    const plan = buildMigrationPlan({ objects: [source], records: [unrelatedRecord] });

    expect(plan[0].status).toBe(MIGRATION_STATUSES.UNASSIGNED);
    expect(plan[0].references).toEqual([]);
    expect(plan[0].clues.recordIdMatches).toEqual([
      { uid: "possible-owner", documentName: unrelatedRecord.documentName }
    ]);
  });

  it("flags a non-equivalent existing destination as a conflict", () => {
    const source = object("bills/bill-1/receipt.pdf");
    const destination = object(
      "users/user-a/attachments/bills/bill-1/receipt.pdf",
      { md5Hash: "different" }
    );
    const plan = buildMigrationPlan({ objects: [source, destination], records: [record()] });
    expect(plan[0].status).toBe(MIGRATION_STATUSES.CONFLICT);
  });

  it("treats mismatched content metadata as a destination conflict", () => {
    const source = object("bills/bill-1/receipt.pdf");
    const destination = object(
      "users/user-a/attachments/bills/bill-1/receipt.pdf",
      { contentType: "image/png" }
    );
    const plan = buildMigrationPlan({ objects: [source, destination], records: [record()] });
    expect(plan[0].status).toBe(MIGRATION_STATUSES.CONFLICT);
  });

  it("does not accept a destination with missing source content metadata", () => {
    const source = object("bills/bill-1/receipt.pdf");
    const destination = object(
      "users/user-a/attachments/bills/bill-1/receipt.pdf",
      { contentType: "" }
    );
    const plan = buildMigrationPlan({ objects: [source, destination], records: [record()] });
    expect(plan[0].status).toBe(MIGRATION_STATUSES.CONFLICT);
  });

  it("flags a referenced source that is missing", () => {
    const plan = buildMigrationPlan({ objects: [], records: [record()] });
    expect(plan[0].status).toBe(MIGRATION_STATUSES.MISSING_SOURCE);
  });

  it("recognises an already migrated equivalent object and makes a second discovery a no-op", () => {
    const source = object("bills/bill-1/receipt.pdf");
    const destinationPath = "users/user-a/attachments/bills/bill-1/receipt.pdf";
    const destination = object(destinationPath);
    const migratedRecord = record({
      attachmentPath: destinationPath,
      attachmentUrl: `https://firebasestorage.googleapis.com/v0/b/test/o/${encodeURIComponent(destinationPath)}?alt=media&token=new-token`
    });
    const firstPlan = buildMigrationPlan({ objects: [source, destination], records: [migratedRecord] });
    expect(firstPlan[0].status).toBe(MIGRATION_STATUSES.ALREADY_MIGRATED);

    const secondPlan = buildMigrationPlan({ objects: [destination], records: [migratedRecord] });
    expect(secondPlan).toEqual([]);
  });

  it("refuses to assign one source when multiple user records reference it", () => {
    const source = object("bills/bill-1/receipt.pdf");
    const plan = buildMigrationPlan({
      objects: [source],
      records: [record(), record({ uid: "user-b", documentName: "projects/test/databases/(default)/documents/users/user-b/bills/bill-1" })]
    });
    expect(plan[0].status).toBe(MIGRATION_STATUSES.AMBIGUOUS_OWNER);
    expect(plan[0].destinationPath).toBe("");
  });

  it("does not expose token-bearing URLs or token values in normal report data", () => {
    const safe = safeLogValue({
      attachmentUrl: "https://example.test/file?alt=media&token=top-secret",
      metadata: { firebaseStorageDownloadTokens: "top-secret" }
    });
    const printed = JSON.stringify(safe);
    expect(printed).not.toContain("top-secret");
    expect(printed).toContain("%5Bredacted%5D");
  });

  it("treats token-free custom metadata as equivalent when content metadata matches", () => {
    const source = object("bills/bill-1/receipt.pdf");
    const backup = object("migration-backups/run/bills/bill-1/receipt.pdf", {
      metadata: { migrationBackupOf: source.name, migrationRun: "run" }
    });
    expect(objectsEquivalent(source, backup)).toBe(true);
  });
});

describe("legacy Storage migration execution safety", () => {
  function readyItem() {
    return buildMigrationPlan({
      objects: [object("bills/bill-1/receipt.pdf")],
      records: [record()]
    })[0];
  }

  it("performs no writes in dry-run mode", async () => {
    const writes = new Proxy({}, {
      get() {
        return () => { throw new Error("A write operation was called during dry run."); };
      }
    });
    const result = await runMigration({ plan: [readyItem()], apply: false, operations: writes });
    expect(result.mode).toBe("DRY_RUN");
    expect(result.summary.linkedReady).toBe(1);
  });

  it("does not update Firestore when copy verification fails", async () => {
    const source = object("bills/bill-1/receipt.pdf");
    const currentRecord = record();
    const operations = executionOperations(source, currentRecord);
    operations.verifyEquivalent = vi.fn().mockRejectedValue(new Error("copy mismatch"));

    await expect(migratePlanItem(readyItem(), operations, executionContext()))
      .rejects.toThrow("copy mismatch");
    expect(operations.updateRecord).not.toHaveBeenCalled();
    expect(operations.removeLegacyObject).not.toHaveBeenCalled();
  });

  it("backs up and verifies the copy before Firestore, then verifies Firestore before removal", async () => {
    const source = object("bills/bill-1/receipt.pdf");
    const currentRecord = record();
    const calls = [];
    const operations = executionOperations(source, currentRecord, calls);

    const result = await migratePlanItem(readyItem(), operations, executionContext());

    expect(result.status).toBe("MIGRATED");
    expect(calls).toEqual([
      "manifest:BEFORE",
      "backup",
      "verify:backup",
      "verify:backup-token-free",
      "manifest:BACKUP_VERIFIED",
      "copy",
      "verify:destination",
      "token",
      "verify:replacement-token",
      "manifest:COPY_VERIFIED",
      "update-record",
      "get-updated-record",
      "verify-record",
      "verify-new-url",
      "manifest:RECORD_VERIFIED",
      "final-boundary-check",
      "remove-source",
      "verify-old-token",
      "manifest:COMPLETE"
    ]);
    expect(calls.indexOf("remove-source")).toBeGreaterThan(calls.indexOf("verify-record"));
    expect(calls.indexOf("remove-source")).toBeGreaterThan(calls.indexOf("verify-new-url"));
  });

  it("keeps the legacy object when replacement access cannot be verified", async () => {
    const source = object("bills/bill-1/receipt.pdf");
    const operations = executionOperations(source, record());
    operations.verifyReplacementAccess = vi.fn().mockRejectedValue(new Error("replacement inaccessible"));

    await expect(migratePlanItem(readyItem(), operations, executionContext()))
      .rejects.toThrow("replacement inaccessible");
    expect(operations.removeLegacyObject).not.toHaveBeenCalled();
    expect(operations.verifyLegacyTokensRevoked).not.toHaveBeenCalled();
  });

  it("keeps the legacy object when the final concurrency boundary changed", async () => {
    const operations = executionOperations(object("bills/bill-1/receipt.pdf"), record());
    operations.assertDestructiveBoundaryUnchanged = vi.fn()
      .mockRejectedValue(new Error("destination changed"));

    await expect(migratePlanItem(readyItem(), operations, executionContext()))
      .rejects.toThrow("destination changed");
    expect(operations.removeLegacyObject).not.toHaveBeenCalled();
  });
});

describe("legacy Storage migration apply guards", () => {
  function validApplyArguments() {
    return [
      "--apply",
      "--project", "simple-books-office",
      "--confirm-project", "simple-books-office",
      "--manifest", "C:\\private\\simple-books\\legacy-storage-apply.json",
      "--backup-prefix", "migration-backups/approved-run"
    ];
  }

  it("defaults to read-only mode when --apply is omitted", () => {
    const options = parseArguments(["--project", "simple-books-office"]);
    expect(options.apply).toBe(false);
    expect(() => validateOptions(options, "different-project")).not.toThrow();
  });

  it("requires --project to be explicit in apply mode", () => {
    const argumentsWithoutProject = validApplyArguments();
    argumentsWithoutProject.splice(1, 2);
    const options = parseArguments(argumentsWithoutProject);
    expect(() => validateOptions(options, "simple-books-office"))
      .toThrow("explicit --project");
  });

  it("refuses a missing or unexpected explicit project", () => {
    const missingProject = parseArguments(["--apply", "--project"]);
    expect(() => validateOptions(missingProject, "simple-books-office"))
      .toThrow("Refusing unexpected Firebase project: (missing)");

    const unexpectedArguments = validApplyArguments();
    unexpectedArguments[2] = "different-project";
    const unexpected = parseArguments(unexpectedArguments);
    expect(() => validateOptions(unexpected, "simple-books-office"))
      .toThrow("Refusing unexpected Firebase project: different-project");
  });

  it("requires an exact confirmation matching the project", () => {
    const missing = parseArguments(validApplyArguments().filter((_, index) => ![3, 4].includes(index)));
    expect(() => validateOptions(missing, "simple-books-office"))
      .toThrow("--confirm-project simple-books-office");

    const mismatchedArguments = validApplyArguments();
    mismatchedArguments[4] = "different-project";
    const mismatched = parseArguments(mismatchedArguments);
    expect(() => validateOptions(mismatched, "simple-books-office"))
      .toThrow("--confirm-project simple-books-office");
  });

  it("refuses a detected Firebase project mismatch", () => {
    const options = parseArguments(validApplyArguments());
    expect(() => validateOptions(options, "different-project"))
      .toThrow("Refusing detected Firebase project");
  });

  it("detects the expected Firebase project from the repository", () => {
    expect(detectFirebaseProject()).toBe("simple-books-office");
  });

  it("refuses to write the sensitive manifest inside the Hosting root", () => {
    const argumentsInsideRepository = validApplyArguments();
    argumentsInsideRepository[6] = "migration-private/legacy-storage-apply.json";
    const options = parseArguments(argumentsInsideRepository);
    expect(() => validateOptions(options, "simple-books-office"))
      .toThrow("outside the repository and its public Hosting root");
  });

  it("applies the same project and external-manifest guards to read-only verification", () => {
    const options = parseArguments([
      "--verify",
      "--project", "simple-books-office",
      "--confirm-project", "simple-books-office",
      "--manifest", "C:\\private\\simple-books\\legacy-storage-apply.json"
    ]);
    expect(options.verify).toBe(true);
    expect(options.apply).toBe(false);
    expect(() => validateOptions(options, "simple-books-office")).not.toThrow();
    expect(() => validateOptions(options, "different-project"))
      .toThrow("Refusing detected Firebase project");
  });

  it("refuses simultaneous apply and verification modes", () => {
    const options = parseArguments([...validApplyArguments(), "--verify"]);
    expect(() => validateOptions(options, "simple-books-office"))
      .toThrow("either --apply or --verify");
  });
});

function executionContext() {
  return { backupPrefix: "migration-backups/test-run", runId: "test-run" };
}

function executionOperations(source, currentRecord, calls = []) {
  const destination = object("users/user-a/attachments/bills/bill-1/receipt.pdf", {
    metadata: { firebaseStorageDownloadTokens: "new-token", ownerUid: "user-a" }
  });
  const backup = object(`migration-backups/test-run/${source.name}`, { metadata: {} });
  let getRecordCount = 0;
  return {
    getObject: vi.fn(async path => path === source.name ? source : null),
    getRecord: vi.fn(async () => {
      getRecordCount += 1;
      if (getRecordCount === 1) return currentRecord;
      calls.push("get-updated-record");
      return {
        ...currentRecord,
        attachmentPath: destination.name,
        attachmentUrl: "https://example.test/new?token=new-token",
        attachmentSize: 100,
        attachmentType: "application/pdf"
      };
    }),
    assertRecordStillOwnsSource: vi.fn(),
    recordManifest: vi.fn(async event => calls.push(`manifest:${event.stage}`)),
    copyForBackup: vi.fn(async () => { calls.push("backup"); return backup; }),
    copyForDestination: vi.fn(async () => { calls.push("copy"); return destination; }),
    verifyEquivalent: vi.fn(async (_original, candidate) => calls.push(candidate === backup ? "verify:backup" : "verify:destination")),
    verifyBackupTokenFree: vi.fn(() => calls.push("verify:backup-token-free")),
    createReplacementToken: vi.fn(() => "new-token"),
    ensureDestinationToken: vi.fn(async candidate => {
      calls.push("token");
      return { destination: candidate, replacementToken: "new-token" };
    }),
    verifyReplacementToken: vi.fn(() => calls.push("verify:replacement-token")),
    destinationDownloadUrl: vi.fn(() => "https://example.test/new?token=new-token"),
    legacyDownloadUrls: vi.fn(() => ["https://example.test/old?token=old-token"]),
    updateRecord: vi.fn(async () => calls.push("update-record")),
    verifyRecordUpdate: vi.fn(() => calls.push("verify-record")),
    verifyReplacementAccess: vi.fn(async () => calls.push("verify-new-url")),
    assertDestructiveBoundaryUnchanged: vi.fn(async () => calls.push("final-boundary-check")),
    removeLegacyObject: vi.fn(async () => calls.push("remove-source")),
    verifyLegacyTokensRevoked: vi.fn(async () => calls.push("verify-old-token"))
  };
}
