import {createRequire} from "node:module";
import {describe, expect, it} from "vitest";

const require = createRequire(import.meta.url);
const {
  addReferencedPaths,
  createStorageAccountDeletionService,
} = require("../functions/lib/account-deletion-storage.js");

const USER_A = "customer-a";

function storageFixture(names, account = {}) {
  const objects = new Set(names);
  const failureCounts = new Map();
  const bucket = {
    getFiles: async ({prefix, maxResults}) => [
      [...objects].filter((name) => name.startsWith(prefix))
          .slice(0, maxResults).map((name) => ({name})),
    ],
    file: (name) => ({
      delete: async () => {
        const remainingFailures = failureCounts.get(name) || 0;
        if (remainingFailures) {
          failureCounts.set(name, remainingFailures - 1);
          throw new Error("temporary storage error");
        }
        objects.delete(name);
      },
      getMetadata: async () => {
        if (!objects.has(name)) throw Object.assign(new Error("missing"), {code: 404});
        return [{name}];
      },
    }),
  };
  const rootReference = {
    get: async () => ({exists: true, data: () => account}),
    listCollections: async () => [],
  };
  const firestore = {
    collection: () => ({doc: () => rootReference}),
  };
  return {
    objects,
    failOnce: (name) => failureCounts.set(name, 1),
    service: createStorageAccountDeletionService({bucket, firestore}),
  };
}

describe("Storage account deletion", () => {
  it("discovers only allow-listed path fields, including nested references", () => {
    const paths = new Set();
    addReferencedPaths({
      attachmentPath: " legacy/a.pdf ",
      nested: [{logoPath: "/legacy/logo.png"}],
      arbitraryPath: "legacy/not-owned.txt",
      attachmentUrl: "https://example.test/file",
    }, paths);
    expect([...paths].sort()).toEqual(["legacy/a.pdf", "legacy/logo.png"]);
  });

  it("deletes every canonical object over multiple pages, including unknown paths", async () => {
    const canonical = Array.from({length: 205}, (_, index) =>
      `users/${USER_A}/unknown/${index}.bin`);
    const fixture = storageFixture([...canonical, "users/customer-b/keep.pdf"]);
    await expect(fixture.service(USER_A)).resolves.toMatchObject({
      deletedCanonicalObjects: 205,
    });
    expect([...fixture.objects]).toEqual(["users/customer-b/keep.pdf"]);
  });

  it("deletes a proven non-UID legacy reference but leaves ambiguous legacy objects", async () => {
    const fixture = storageFixture([
      "legacy/proven.pdf",
      "legacy/ambiguous.pdf",
      "users/customer-b/not-a.pdf",
    ], {
      attachmentPath: "legacy/proven.pdf",
      companyLogoPath: "users/customer-b/not-a.pdf",
    });
    await fixture.service(USER_A);
    expect(fixture.objects.has("legacy/proven.pdf")).toBe(false);
    expect(fixture.objects.has("legacy/ambiguous.pdf")).toBe(true);
    expect(fixture.objects.has("users/customer-b/not-a.pdf")).toBe(true);
  });

  it("treats missing referenced objects as success", async () => {
    const fixture = storageFixture([], {attachmentPath: "legacy/missing.pdf"});
    await expect(fixture.service(USER_A)).resolves.toMatchObject({
      deletedLegacyObjects: 1,
    });
  });

  it("retries safely after a partial deletion failure", async () => {
    const failing = `users/${USER_A}/attachments/fail.pdf`;
    const fixture = storageFixture([
      failing,
      `users/${USER_A}/attachments/deleted-first.pdf`,
    ]);
    fixture.failOnce(failing);
    await expect(fixture.service(USER_A)).rejects.toMatchObject({
      deletionCode: "storage-cleanup-failed",
    });
    await expect(fixture.service(USER_A)).resolves.toMatchObject({
      deletedCanonicalObjects: 1,
    });
    expect(fixture.objects.size).toBe(0);
  });
});
