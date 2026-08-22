import {createRequire} from "node:module";
import {describe, expect, it, vi} from "vitest";

const require = createRequire(import.meta.url);
const {
  ACCOUNT_DELETION_LEASE_MS,
  ACCOUNT_DELETION_MAX_FAILURES,
  ACCOUNT_DELETION_TOMBSTONE_RETENTION_MS,
  createAccountDeletionWorker,
} = require("../functions/lib/account-deletion-worker.js");
const {
  createAccountDeletionGuard,
} = require("../functions/lib/account-deletion-guard.js");

const USER_A = "customer-a";
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const DELETE_FIELD = "__delete_field__";
const clone = (value) => value === undefined ? undefined : structuredClone(value);

class Snapshot {
  constructor(value) {
    this.exists = value !== undefined;
    this.value = clone(value);
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
  get() {
    return Promise.resolve(new Snapshot(this.db.documents.get(this.path)));
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
}

class Transaction {
  constructor(db) {
    this.db = db;
    this.writes = [];
  }
  get(reference) {
    return Promise.resolve(new Snapshot(this.db.documents.get(reference.path)));
  }
  update(reference, data) {
    this.writes.push({kind: "update", reference, data: clone(data)});
  }
  set(reference, data) {
    this.writes.push({kind: "set", reference, data: clone(data)});
  }
  commit() {
    for (const write of this.writes) {
      if (write.kind === "set") {
        this.db.documents.set(write.reference.path, clone(write.data));
        continue;
      }
      const result = {...(clone(this.db.documents.get(write.reference.path)) || {})};
      for (const [key, value] of Object.entries(write.data)) {
        if (value === DELETE_FIELD) delete result[key];
        else result[key] = clone(value);
      }
      this.db.documents.set(write.reference.path, result);
    }
  }
}

class Firestore {
  constructor(entries) {
    this.documents = new Map(Object.entries(entries).map(
        ([path, value]) => [path, clone(value)],
    ));
  }
  collection(path) {
    return new Collection(this, path);
  }
  async runTransaction(callback) {
    const transaction = new Transaction(this);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }
  read(path) {
    return clone(this.documents.get(path));
  }
}

function activeJob(overrides = {}) {
  return {
    schemaVersion: 1,
    uid: USER_A,
    requestId: REQUEST_ID,
    stage: "requested",
    status: "active",
    retryCount: 0,
    lastErrorCode: "",
    ...overrides,
  };
}

function missingAuthError() {
  return Object.assign(new Error("missing"), {code: "auth/user-not-found"});
}

function fixture({job = activeJob(), account = {uid: USER_A}, authExists = true,
  admin = "admin-uid", demo = "uid:demo-uid,email:demo@example.test",
  protectedUids = "protected-uid"} = {}) {
  let clock = new Date("2026-08-21T12:00:00.000Z");
  const entries = {[`accountDeletionJobs/${USER_A}`]: job};
  if (account !== undefined) entries[`users/${USER_A}`] = account;
  const firestore = new Firestore(entries);
  let authPresent = authExists;
  let authDeleteFailures = 0;
  const events = [];
  const failures = {stripe: 0, storage: 0, firestore: 0};
  const auth = {
    getUser: vi.fn(async (uid) => {
      if (!authPresent) throw missingAuthError();
      return {uid, email: `${uid}@example.test`};
    }),
    deleteUser: vi.fn(async () => {
      events.push("auth");
      if (authDeleteFailures) {
        authDeleteFailures -= 1;
        throw new Error("temporary Auth failure");
      }
      if (!authPresent) throw missingAuthError();
      authPresent = false;
    }),
  };
  const stage = (name, action) => async () => {
    events.push(name);
    if (failures[name]) {
      failures[name] -= 1;
      throw new Error(`temporary ${name} failure`);
    }
    if (action) action();
  };
  const source = {
    auth,
    firestore,
    fieldValue: {
      serverTimestamp: () => clock.toISOString(),
      delete: () => DELETE_FIELD,
    },
    timestampFactory: {fromDate: (date) => date},
    adminUidConfiguration: admin,
    demoConfiguration: demo,
    protectedUidConfiguration: protectedUids,
    logger: {info: () => {}, warn: () => {}},
    stripeCleanup: stage("stripe"),
    storageCleanup: stage("storage"),
    firestoreCleanup: stage("firestore", () => {
      firestore.documents.delete(`users/${USER_A}`);
    }),
    now: () => clock,
  };
  return {
    auth,
    events,
    failures,
    firestore,
    setAuthDeleteFailures: (count) => { authDeleteFailures = count; },
    setClock: (date) => { clock = new Date(date); },
    source,
    worker: createAccountDeletionWorker(source),
  };
}

describe("account deletion worker", () => {
  it("rejects untrusted payload shapes and production wiring keeps the trigger private", async () => {
    const {worker} = fixture();
    await expect(worker({data: {uid: USER_A, stage: "auth"}}))
        .rejects.toMatchObject({deletionCode: "account-deletion-task-invalid"});
  });

  it.each([
    ["Demo", {account: {uid: USER_A, demoMode: true}}],
    ["admin", {admin: USER_A}],
    ["protected UID", {protectedUids: USER_A}],
  ])("repeats the %s protection before destructive work", async (_label, options) => {
    const result = fixture(options);
    await expect(result.worker({data: {uid: USER_A}})).rejects.toMatchObject({
      deletionCode: "protected-account",
    });
    expect(result.events).toEqual([]);
    expect(result.firestore.read(`accountDeletionJobs/${USER_A}`)).toMatchObject({
      stage: "requested", retryCount: 1, lastErrorCode: "protected-account",
    });
  });

  it("runs stages in order, deletes Auth last, and replaces the job with a 48-hour tombstone", async () => {
    const result = fixture();
    await expect(result.worker({data: {uid: USER_A}})).resolves.toEqual({
      processed: true, state: "completed",
    });
    expect(result.events).toEqual(["stripe", "storage", "firestore", "auth"]);
    const tombstone = result.firestore.read(`accountDeletionJobs/${USER_A}`);
    expect(tombstone).toMatchObject({
      schemaVersion: 1, uid: USER_A, stage: "completed", status: "completed",
    });
    expect(tombstone.requestId).toBeUndefined();
    expect(tombstone.retryCount).toBeUndefined();
    expect(new Date(tombstone.tombstoneExpiresAt).getTime() -
      new Date(tombstone.completedAt).getTime())
        .toBe(ACCOUNT_DELETION_TOMBSTONE_RETENTION_MS);
    const guard = createAccountDeletionGuard(result.firestore);
    await expect(guard.assertAccountNotDeleting(USER_A)).rejects.toMatchObject({
      details: {reason: "account-deletion-in-progress"},
    });
  });

  it("does not let a duplicate task enter while the first lease is active", async () => {
    const result = fixture();
    let releaseStripe;
    let stripeStarted;
    const started = new Promise((resolve) => { stripeStarted = resolve; });
    result.source.stripeCleanup = async () => {
      result.events.push("stripe");
      stripeStarted();
      await new Promise((resolve) => { releaseStripe = resolve; });
    };
    const worker = createAccountDeletionWorker(result.source);
    const first = worker({data: {uid: USER_A}});
    await started;
    await expect(worker({data: {uid: USER_A}})).rejects.toMatchObject({
      deletionCode: "account-deletion-lease-held",
    });
    releaseStripe();
    await expect(first).resolves.toMatchObject({state: "completed"});
    expect(result.events.filter((event) => event === "stripe")).toHaveLength(1);
  });

  it("recovers an expired lease and checkpoints past completed stages", async () => {
    const expired = new Date("2026-08-21T10:00:00.000Z");
    const result = fixture({job: activeJob({
      stage: "storage",
      leaseToken: "dead-worker",
      leaseExpiresAt: expired,
    })});
    await result.worker({data: {uid: USER_A}});
    expect(result.events).toEqual(["storage", "firestore", "auth"]);
  });

  it("refuses an unexpired lease without incrementing stage failures", async () => {
    const result = fixture({job: activeJob({
      leaseToken: "live-worker",
      leaseExpiresAt: new Date(Date.now() + ACCOUNT_DELETION_LEASE_MS),
    })});
    await expect(result.worker({data: {uid: USER_A}})).rejects.toMatchObject({
      deletionCode: "account-deletion-lease-held",
    });
    expect(result.firestore.read(`accountDeletionJobs/${USER_A}`).retryCount).toBe(0);
    expect(result.events).toEqual([]);
  });

  it.each(["stripe", "storage", "firestore"])(
      "resumes safely after a transient %s-stage crash",
      async (failedStage) => {
        const result = fixture();
        result.failures[failedStage] = 1;
        await expect(result.worker({data: {uid: USER_A}})).rejects.toBeTruthy();
        const jobAfterFailure = result.firestore.read(`accountDeletionJobs/${USER_A}`);
        expect(jobAfterFailure.stage).toBe(failedStage);
        expect(jobAfterFailure.retryCount).toBe(1);
        const eventsBeforeRetry = [...result.events];
        await expect(result.worker({data: {uid: USER_A}})).resolves.toMatchObject({
          state: "completed",
        });
        if (failedStage !== "stripe") {
          expect(result.events.filter((event) => event === "stripe").length)
              .toBe(eventsBeforeRetry.filter((event) => event === "stripe").length);
        }
      },
  );

  it("leaves the job at Auth and retries when Auth deletion fails", async () => {
    const result = fixture();
    result.setAuthDeleteFailures(1);
    await expect(result.worker({data: {uid: USER_A}})).rejects.toMatchObject({
      deletionCode: "auth-cleanup-failed",
    });
    expect(result.firestore.read(`accountDeletionJobs/${USER_A}`)).toMatchObject({
      stage: "auth", status: "active", retryCount: 1,
    });
    await expect(result.worker({data: {uid: USER_A}})).resolves.toMatchObject({
      state: "completed",
    });
    expect(result.events.filter((event) => event === "auth")).toHaveLength(2);
  });

  it("treats an already-missing Auth user as successful completion", async () => {
    const result = fixture({job: activeJob({stage: "auth"}), account: undefined,
      authExists: false});
    await expect(result.worker({data: {uid: USER_A}})).resolves.toMatchObject({
      state: "completed",
    });
    expect(result.firestore.read(`accountDeletionJobs/${USER_A}`).status)
        .toBe("completed");
  });

  it("marks needs_attention after the bounded stage failure threshold", async () => {
    const result = fixture();
    result.failures.stripe = ACCOUNT_DELETION_MAX_FAILURES;
    for (let attempt = 1; attempt < ACCOUNT_DELETION_MAX_FAILURES; attempt += 1) {
      await expect(result.worker({data: {uid: USER_A}})).rejects.toBeTruthy();
    }
    await expect(result.worker({data: {uid: USER_A}})).resolves.toEqual({
      processed: false, state: "needs_attention",
    });
    expect(result.firestore.read(`accountDeletionJobs/${USER_A}`)).toMatchObject({
      stage: "stripe",
      status: "needs_attention",
      retryCount: ACCOUNT_DELETION_MAX_FAILURES,
      lastErrorCode: "account-deletion-failed",
    });
    expect(result.firestore.read(`users/${USER_A}`)).toMatchObject({uid: USER_A});
  });
});
