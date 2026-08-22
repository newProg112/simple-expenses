import {createRequire} from "node:module";
import {describe, expect, it} from "vitest";

const require = createRequire(import.meta.url);
const {
  createFirestoreAccountDeletionService,
} = require("../functions/lib/account-deletion-firestore.js");

const USER_A = "customer-a";
const USER_B = "customer-b";
const clone = (value) => value === undefined ? undefined : structuredClone(value);

class Snapshot {
  constructor(db, path, value) {
    this.db = db;
    this.path = path;
    this.exists = value !== undefined;
    this.value = clone(value);
    this.ref = new Reference(db, path);
  }
  data() {
    return clone(this.value);
  }
}

class Reference {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }
  async get() {
    return new Snapshot(this.db, this.path, this.db.documents.get(this.path));
  }
  async listCollections() {
    const prefix = `${this.path}/`;
    const collectionPaths = new Set();
    for (const path of this.db.documents.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length).split("/");
      if (rest.length >= 2) collectionPaths.add(`${this.path}/${rest[0]}`);
    }
    return [...collectionPaths].map((path) => new Collection(this.db, path));
  }
  async delete() {
    this.db.events.push(`delete:${this.path}`);
    this.db.documents.delete(this.path);
  }
}

class Query {
  constructor(db, collectionPath, field, value, maximum = Infinity) {
    this.db = db;
    this.collectionPath = collectionPath;
    this.field = field;
    this.value = value;
    this.maximum = maximum;
  }
  limit(maximum) {
    return new Query(this.db, this.collectionPath, this.field, this.value, maximum);
  }
  async get() {
    const prefix = `${this.collectionPath}/`;
    const docs = [];
    for (const [path, data] of this.db.documents) {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) continue;
      if (data && data[this.field] === this.value) {
        docs.push(new Snapshot(this.db, path, data));
      }
      if (docs.length >= this.maximum) break;
    }
    return {docs, empty: docs.length === 0, size: docs.length};
  }
}

class Collection {
  constructor(db, path) {
    this.db = db;
    this.path = path;
  }
  doc(id) {
    return new Reference(this.db, `${this.path}/${id}`);
  }
  where(field, _operator, value) {
    return new Query(this.db, this.path, field, value);
  }
}

class Firestore {
  constructor(entries = {}) {
    this.documents = new Map(Object.entries(entries).map(
        ([path, value]) => [path, clone(value)],
    ));
    this.events = [];
    this.failRecursivePath = "";
    this.batchCommitCount = 0;
    this.failBatchCommitNumber = 0;
  }
  collection(path) {
    return new Collection(this, path);
  }
  batch() {
    const deletes = [];
    return {
      delete: (reference) => deletes.push(reference.path),
      commit: async () => {
        this.batchCommitCount += 1;
        for (const path of deletes) this.documents.delete(path);
        this.events.push(`batch:${deletes.length}`);
        if (this.batchCommitCount === this.failBatchCommitNumber) {
          throw new Error("unknown batch acknowledgement");
        }
      },
    };
  }
  async recursiveDelete(reference) {
    this.events.push(`recursive:${reference.path}`);
    if (this.failRecursivePath === reference.path) {
      this.failRecursivePath = "";
      throw new Error("temporary Firestore error");
    }
    const prefix = `${reference.path}/`;
    for (const path of [...this.documents.keys()]) {
      if (path === reference.path || path.startsWith(prefix)) this.documents.delete(path);
    }
  }
}

describe("Firestore account deletion", () => {
  it("recursively removes unknown user data, profile usage, and all UID-owned secondary data", async () => {
    const entries = {
      [`users/${USER_A}`]: {uid: USER_A, deletionInProgress: true},
      [`users/${USER_A}/unknown/doc-1`]: {value: 1},
      [`users/${USER_A}/unknown/doc-1/nested/doc-2`]: {value: 2},
      [`users/${USER_A}/invoices/invoice-1`]: {total: 10},
      [`userProfiles/${USER_A}`]: {currentPlan: "Pro"},
      [`userProfiles/${USER_A}/usage/2026-08`]: {count: 2},
      [`adminActivityEvents/a`]: {uid: USER_A},
      [`demoAnalyticsEvents/a`]: {uid: USER_A},
      [`adminUserNotes/${USER_A}`]: {notes: "private"},
      [`adminUserNotes/${USER_A}/history/1`]: {notes: "old"},
      [`users/${USER_B}`]: {uid: USER_B},
      [`users/${USER_B}/unknown/keep`]: {value: 9},
      [`userProfiles/${USER_B}`]: {currentPlan: "Starter"},
      [`journals/b`]: {userId: USER_B},
      [`adminActivityEvents/b`]: {uid: USER_B},
    };
    for (let index = 0; index < 505; index += 1) {
      entries[`journals/a-${index}`] = {userId: USER_A};
    }
    const firestore = new Firestore(entries);
    const service = createFirestoreAccountDeletionService({firestore});
    await expect(service(USER_A)).resolves.toMatchObject({
      deletedUserCollections: 2,
      deletedSecondaryDocuments: 507,
    });
    expect([...firestore.documents.keys()].sort()).toEqual([
      "adminActivityEvents/b",
      "journals/b",
      `userProfiles/${USER_B}`,
      `users/${USER_B}`,
      `users/${USER_B}/unknown/keep`,
    ].sort());
    expect(firestore.events.filter((event) => event.startsWith("batch:")))
        .toContain("batch:200");
    expect(firestore.events.at(-1)).toBe(`delete:users/${USER_A}`);
  });

  it("succeeds when roots and secondary documents are already missing", async () => {
    const firestore = new Firestore();
    const service = createFirestoreAccountDeletionService({firestore});
    await expect(service(USER_A)).resolves.toEqual({
      deletedUserCollections: 0,
      deletedSecondaryDocuments: 0,
    });
  });

  it("retries safely after a partial recursive deletion", async () => {
    const firestore = new Firestore({
      [`users/${USER_A}`]: {uid: USER_A},
      [`users/${USER_A}/first/1`]: {value: 1},
      [`users/${USER_A}/second/2`]: {value: 2},
      [`journals/a`]: {userId: USER_A},
    });
    firestore.failRecursivePath = `users/${USER_A}/second`;
    const service = createFirestoreAccountDeletionService({firestore});
    await expect(service(USER_A)).rejects.toMatchObject({
      deletionCode: "firestore-cleanup-failed",
    });
    expect(firestore.documents.has(`users/${USER_A}/first/1`)).toBe(false);
    await expect(service(USER_A)).resolves.toBeTruthy();
    expect(firestore.documents.size).toBe(0);
  });

  it("retries safely after journal pages were partially committed", async () => {
    const entries = {[`users/${USER_A}`]: {uid: USER_A}};
    for (let index = 0; index < 401; index += 1) {
      entries[`journals/a-${index}`] = {userId: USER_A};
    }
    const firestore = new Firestore(entries);
    firestore.failBatchCommitNumber = 2;
    const service = createFirestoreAccountDeletionService({firestore});
    await expect(service(USER_A)).rejects.toMatchObject({
      deletionCode: "firestore-cleanup-failed",
    });
    expect([...firestore.documents.keys()].filter((path) =>
      path.startsWith("journals/"))).toHaveLength(1);
    await expect(service(USER_A)).resolves.toBeTruthy();
    expect(firestore.documents.size).toBe(0);
  });
});
