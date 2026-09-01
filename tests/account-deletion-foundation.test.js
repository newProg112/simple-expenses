import {createRequire} from "node:module";
import {describe, expect, it, vi} from "vitest";

const require = createRequire(import.meta.url);
const {
  createRequestAccountDeletionHandler,
} = require("../functions/lib/account-deletion-handler.js");
const {
  createAccountDeletionGuard,
} = require("../functions/lib/account-deletion-guard.js");
const {
  createStripeProfileWriter,
} = require("../functions/lib/stripe-profile-writer.js");

const USER_A = "customer-a";
const USER_B = "customer-b";
const REQUEST_A = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_B = "223e4567-e89b-42d3-a456-426614174001";
const NOW = new Date("2026-08-21T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

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
    this.db.readCount += 1;
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
  async get(reference) {
    this.db.readCount += 1;
    return new Snapshot(this.db.documents.get(reference.path));
  }
  create(reference, data) {
    this.writes.push({kind: "create", reference, data: clone(data)});
  }
  set(reference, data, options = {}) {
    this.writes.push({kind: "set", reference, data: clone(data), options});
  }
  commit() {
    for (const write of this.writes) {
      const path = write.reference.path;
      const existing = this.db.documents.get(path);
      if (write.kind === "create" && existing !== undefined) {
        throw new Error("already-exists");
      }
      this.db.documents.set(path, write.options && write.options.merge ?
        {...(clone(existing) || {}), ...write.data} : write.data);
    }
  }
}

class Firestore {
  constructor(entries = {}) {
    this.documents = new Map(Object.entries(entries).map(
        ([path, value]) => [path, clone(value)],
    ));
    this.readCount = 0;
    this.transactionCount = 0;
  }
  collection(name) {
    return new Collection(this, name);
  }
  async runTransaction(callback) {
    this.transactionCount += 1;
    const transaction = new Transaction(this);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }
  read(path) {
    return clone(this.documents.get(path));
  }
}

function request(uid = USER_A, overrides = {}) {
  return {
    auth: uid ? {uid, token: {auth_time: NOW_SECONDS}} : null,
    data: {confirmation: "DELETE", requestId: REQUEST_A},
    ...overrides,
  };
}

function fixture({entries = {}, authUsers = {}, configuration = {}} = {}) {
  const firestore = new Firestore(entries);
  const getUser = vi.fn(async (uid) => {
    const user = authUsers[uid] || {uid, email: `${uid}@example.test`};
    if (user instanceof Error) throw user;
    return user;
  });
  const enqueueDeletionTask = vi.fn(async () => {});
  const handler = createRequestAccountDeletionHandler({
    firestore,
    auth: {getUser},
    fieldValue: {serverTimestamp: () => "server-timestamp"},
    adminUidConfiguration: configuration.admin || "admin-uid",
    demoConfiguration: configuration.demo ||
      "uid:demo-uid,email:demo@example.test",
    protectedUidConfiguration: configuration.protected || "protected-uid",
    enqueueDeletionTask,
    now: () => NOW,
  });
  return {firestore, getUser, enqueueDeletionTask, handler};
}

describe("requestAccountDeletion", () => {
  it("rejects unauthenticated calls before any database or Auth read", async () => {
    const {firestore, getUser, handler} = fixture();
    await expect(handler(request(""))).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(getUser).not.toHaveBeenCalled();
    expect(firestore.readCount).toBe(0);
    expect(firestore.transactionCount).toBe(0);
  });

  it("requires exact confirmation, a UUID, and no extra request fields", async () => {
    const {handler} = fixture();
    await expect(handler(request(USER_A, {
      data: {confirmation: "delete", requestId: REQUEST_A},
    }))).rejects.toMatchObject({code: "invalid-argument"});
    await expect(handler(request(USER_A, {
      data: {confirmation: "DELETE", requestId: "not-a-uuid"},
    }))).rejects.toMatchObject({code: "invalid-argument"});
    await expect(handler(request(USER_A, {
      data: {confirmation: "DELETE", requestId: REQUEST_A, email: "x@y.z"},
    }))).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("requires authentication no older than five minutes", async () => {
    const {handler} = fixture();
    await expect(handler(request(USER_A, {
      auth: {uid: USER_A, token: {auth_time: NOW_SECONDS - 301}},
    }))).rejects.toMatchObject({
      code: "failed-precondition",
      details: {reason: "recent-authentication-required"},
    });
  });

  it.each([
    ["admin UID", "admin-uid", {}, {}],
    ["protected UID", "protected-uid", {}, {}],
    ["demo UID", "demo-uid", {}, {}],
    ["demo email", USER_A, {}, {[USER_A]: {uid: USER_A, email: "DEMO@example.test"}}],
    ["demo marker", USER_A, {demoMode: true}, {}],
    ["protected marker", USER_A, {deletionProtected: true}, {}],
  ])("rejects a protected %s", async (_label, uid, account, authUsers) => {
    const {handler} = fixture({
      entries: {[`users/${uid}`]: account},
      authUsers,
    });
    await expect(handler(request(uid))).rejects.toMatchObject({
      code: "permission-denied",
      details: {reason: "protected-account"},
    });
  });

  it("fails closed when any protected-account configuration is missing", async () => {
    const {handler} = fixture({configuration: {protected: " "}});
    await expect(handler(request())).rejects.toMatchObject({
      code: "failed-precondition",
      details: {reason: "protected-account-configuration-invalid"},
    });
  });

  it("creates one minimal job and a server-owned root barrier", async () => {
    const {firestore, enqueueDeletionTask, handler} = fixture({
      entries: {[`users/${USER_A}`]: {uid: USER_A, businessName: "Private Ltd"}},
    });
    await expect(handler(request())).resolves.toEqual({
      accepted: true,
      resumed: false,
      stage: "requested",
      status: "active",
    });
    const job = firestore.read(`accountDeletionJobs/${USER_A}`);
    expect(job).toEqual({
      schemaVersion: 1,
      uid: USER_A,
      requestId: REQUEST_A,
      stage: "requested",
      status: "active",
      retryCount: 0,
      requestedAt: "server-timestamp",
      updatedAt: "server-timestamp",
      lastErrorCode: "",
    });
    expect(JSON.stringify(job)).not.toContain("Private Ltd");
    expect(firestore.read(`users/${USER_A}`)).toMatchObject({
      businessName: "Private Ltd",
      deletionInProgress: true,
      accountDeletionState: "requested",
    });
    expect(enqueueDeletionTask).toHaveBeenCalledWith(USER_A);
  });

  it("resumes the original job idempotently without replacing its request ID", async () => {
    const {firestore, enqueueDeletionTask, handler} = fixture({
      entries: {
        [`users/${USER_A}`]: {uid: USER_A, deletionInProgress: true},
        [`accountDeletionJobs/${USER_A}`]: {
          schemaVersion: 1, uid: USER_A, requestId: REQUEST_A,
          stage: "stripe", status: "active", retryCount: 1,
        },
      },
    });
    const result = await handler(request(USER_A, {
      data: {confirmation: "DELETE", requestId: REQUEST_B},
    }));
    expect(result).toEqual({
      accepted: true, resumed: true, stage: "stripe", status: "active",
    });
    expect(firestore.read(`accountDeletionJobs/${USER_A}`).requestId)
        .toBe(REQUEST_A);
    expect(enqueueDeletionTask).toHaveBeenCalledWith(USER_A);
  });

  it("keeps the durable job when task enqueueing fails so a retry can resume it", async () => {
    const {firestore, enqueueDeletionTask, handler} = fixture();
    enqueueDeletionTask.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(handler(request())).rejects.toMatchObject({
      code: "unavailable",
      details: {reason: "account-deletion-enqueue-failed"},
    });
    expect(firestore.read(`accountDeletionJobs/${USER_A}`)).toMatchObject({
      uid: USER_A,
      stage: "requested",
      status: "active",
    });
  });
});

describe("deletion barrier", () => {
  it("blocks User A without affecting User B", async () => {
    const firestore = new Firestore({
      [`users/${USER_A}`]: {deletionInProgress: true},
      [`users/${USER_B}`]: {deletionInProgress: false},
      [`accountDeletionJobs/${USER_A}`]: {status: "active"},
    });
    const guard = createAccountDeletionGuard(firestore);
    await expect(guard.assertAccountNotDeleting(USER_A)).rejects.toMatchObject({
      code: "failed-precondition",
    });
    await expect(guard.assertAccountNotDeleting(USER_B)).resolves.toBeUndefined();
  });

  it("prevents Stripe webhook profile resurrection during deletion", async () => {
    const firestore = new Firestore({
      [`users/${USER_A}`]: {deletionInProgress: true},
      [`accountDeletionJobs/${USER_A}`]: {status: "active"},
    });
    const writer = createStripeProfileWriter({
      firestore,
      auth: {getUser: async (uid) => ({uid})},
      fieldValue: {serverTimestamp: () => "server-timestamp"},
      logger: {warn: () => {}},
      billingConfiguration: {
        expectedMode: "test",
        proPriceId: "price_active",
      },
    });
    await expect(writer(USER_A, {
      subscriptionStatus: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      stripePriceId: "price_1",
    })).resolves.toEqual({
      updated: false, reason: "account-deletion-in-progress",
    });
    expect(firestore.read(`userProfiles/${USER_A}`)).toBeUndefined();
  });

  it("prevents Stripe resurrection when the Auth user no longer exists", async () => {
    const firestore = new Firestore({});
    const missing = Object.assign(new Error("missing"), {
      code: "auth/user-not-found",
    });
    const writer = createStripeProfileWriter({
      firestore,
      auth: {getUser: async () => { throw missing; }},
      fieldValue: {serverTimestamp: () => "server-timestamp"},
      logger: {warn: () => {}},
    });
    await expect(writer(USER_A, {})).resolves.toEqual({
      updated: false, reason: "auth-user-not-found",
    });
    expect(firestore.read(`userProfiles/${USER_A}`)).toBeUndefined();
  });

  it("preserves normal Stripe profile updates for an active Auth user", async () => {
    const firestore = new Firestore({
      [`users/${USER_A}`]: {uid: USER_A, deletionInProgress: false},
    });
    const writer = createStripeProfileWriter({
      firestore,
      auth: {getUser: async (uid) => ({uid})},
      fieldValue: {serverTimestamp: () => "server-timestamp"},
      logger: {warn: () => {}},
      billingConfiguration: {
        expectedMode: "test",
        proPriceId: "price_active",
      },
    });
    await expect(writer(USER_A, {
      subscriptionStatus: "active",
      stripeCustomerId: "cus_active",
      stripeSubscriptionId: "sub_active",
      stripePriceId: "price_active",
      stripeMode: "test",
      paymentMethodBrand: "visa",
      paymentMethodLast4: "4242",
    })).resolves.toEqual({updated: true, reason: "updated"});
    expect(firestore.read(`userProfiles/${USER_A}`)).toMatchObject({
      currentPlan: "Pro",
      subscriptionStatus: "active",
      stripeCustomerId: "cus_active",
      stripeSubscriptionId: "sub_active",
      stripePriceId: "price_active",
    });
  });
});
