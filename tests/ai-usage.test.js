import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  RESERVATION_TTL_MS,
  USAGE_TYPES,
  createAiUsageManager,
  getAuthoritativeAiLimit,
  getAuthoritativeInvoiceScanningLimit,
  monthlyAllowanceMessage,
  normalizeUsageCount,
  remainingAllowance,
  resolveAuthoritativePlan,
  usageDocumentPath
} = require("../functions/lib/ai-usage.js");
const { PLAN_IDS } = require("../functions/lib/plan-entitlements.js");

const uid = "usage-test-user";
const accountPath = `users/${uid}`;
const profilePath = `userProfiles/${uid}`;
const monthKey = "2026-07";
const usagePath = `${profilePath}/usage/${monthKey}`;
const now = new Date("2026-07-24T12:00:00.000Z");
const requestIds = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003"
];

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class FakeDocumentSnapshot {
  constructor(value) {
    this.value = value;
    this.exists = value !== undefined;
  }

  data() {
    return clone(this.value);
  }
}

class FakeDocumentReference {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }

  collection(name) {
    return new FakeCollectionReference(this.firestore, `${this.path}/${name}`);
  }
}

class FakeCollectionReference {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }

  doc(id) {
    return new FakeDocumentReference(this.firestore, `${this.path}/${id}`);
  }
}

class FakeTransaction {
  constructor(firestore) {
    this.firestore = firestore;
    this.writes = [];
  }

  async get(reference) {
    return new FakeDocumentSnapshot(this.firestore.documents.get(reference.path));
  }

  set(reference, data, options = {}) {
    this.writes.push({ reference, data: clone(data), options });
  }

  commit() {
    for (const { reference, data, options } of this.writes) {
      const existing = this.firestore.documents.get(reference.path);
      this.firestore.documents.set(
        reference.path,
        options.merge ? { ...(clone(existing) || {}), ...data } : data
      );
    }
  }
}

class FakeFirestore {
  constructor(entries = {}) {
    this.documents = new Map(
      Object.entries(entries).map(([path, data]) => [path, clone(data)])
    );
    this.transactionQueue = Promise.resolve();
  }

  collection(name) {
    return new FakeCollectionReference(this, name);
  }

  runTransaction(callback) {
    const operation = this.transactionQueue.then(async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    });
    this.transactionQueue = operation.catch(() => {});
    return operation;
  }

  read(path) {
    return clone(this.documents.get(path));
  }
}

function createFixture({
  account,
  profile = { currentPlan: "Starter", subscriptionStatus: "" },
  usage,
  clock = now
} = {}) {
  const firestore = new FakeFirestore({
    ...(account === undefined ? {} : { [accountPath]: account }),
    [profilePath]: profile,
    ...(usage === undefined ? {} : { [usagePath]: usage })
  });
  const manager = createAiUsageManager({
    firestore,
    now: () => clock,
    serverTimestamp: () => "server-timestamp"
  });
  return { firestore, manager };
}

describe("authoritative AI allowances", () => {
  it("uses the Phase 1 Starter and Pro AI limits", () => {
    expect(getAuthoritativeAiLimit({
      currentPlan: "Starter",
      subscriptionStatus: "active"
    })).toBe(10);
    expect(getAuthoritativeAiLimit({
      currentPlan: "Pro",
      subscriptionStatus: "active"
    })).toBe(500);
    expect(getAuthoritativeAiLimit({
      currentPlan: "Pro",
      subscriptionStatus: "trialing"
    })).toBe(500);
    expect(getAuthoritativeInvoiceScanningLimit({
      currentPlan: "Starter",
      subscriptionStatus: "active"
    })).toBe(10);
    expect(getAuthoritativeInvoiceScanningLimit({
      currentPlan: "Pro",
      subscriptionStatus: "active"
    })).toBe(500);
  });

  it("fails missing, unknown, and ineligible billing states to Starter", () => {
    for (const profile of [
      undefined,
      {},
      { currentPlan: "Enterprise", subscriptionStatus: "active" },
      { currentPlan: "Pro", subscriptionStatus: "past_due" },
      { currentPlan: "Pro", subscriptionStatus: "canceled" },
      { currentPlan: "Pro" }
    ]) {
      expect(resolveAuthoritativePlan(profile)).toBe(PLAN_IDS.STARTER);
      expect(getAuthoritativeAiLimit(profile)).toBe(10);
    }
  });

  it("honours only an explicit Pro billing override", () => {
    expect(resolveAuthoritativePlan({
      currentPlan: "Pro",
      subscriptionStatus: "past_due",
      billingOverride: true
    })).toBe(PLAN_IDS.PRO);
    expect(resolveAuthoritativePlan({
      currentPlan: "Starter",
      subscriptionStatus: "active",
      billingOverride: true
    })).toBe(PLAN_IDS.STARTER);
    expect(resolveAuthoritativePlan({
      currentPlan: "Pro",
      subscriptionStatus: "past_due",
      billingOverride: "true"
    })).toBe(PLAN_IDS.STARTER);
  });

  it("uses authoritative demo mode for Pro AI and scanning allowances", async () => {
    expect(resolveAuthoritativePlan(
      { currentPlan: "Starter", subscriptionStatus: "" },
      { demoMode: true }
    )).toBe(PLAN_IDS.PRO);

    const { manager } = createFixture({
      account: { demoMode: true },
      usage: {
        aiAssistantSuccessfulUses: 500,
        invoiceScanningSuccessfulUses: 500
      }
    });
    const aiReservation = await manager.reserve({
      uid,
      requestId: requestIds[0]
    });
    const scanningReservation = await manager.reserve({
      uid,
      requestId: requestIds[1],
      usageType: USAGE_TYPES.INVOICE_SCANNING
    });

    expect(aiReservation).toMatchObject({
      state: "reserved",
      limit: 500,
      effectivePlan: PLAN_IDS.PRO,
      demoMode: true
    });
    expect(scanningReservation).toMatchObject({
      state: "reserved",
      limit: 500,
      effectivePlan: PLAN_IDS.PRO,
      demoMode: true
    });
  });

  it("builds plan-aware allowance messages for both AI features", () => {
    expect(monthlyAllowanceMessage(
      USAGE_TYPES.AI_ASSISTANT,
      PLAN_IDS.STARTER
    )).toBe(
      "You've reached this month's AI Assistant allowance on Starter. " +
      "Upgrade to Pro for a higher monthly allowance."
    );
    expect(monthlyAllowanceMessage(
      USAGE_TYPES.AI_ASSISTANT,
      PLAN_IDS.PRO
    )).toBe(
      "You've reached this month's AI Assistant allowance. " +
      "Your usage will be available again when the monthly allowance resets."
    );
    expect(monthlyAllowanceMessage(
      USAGE_TYPES.INVOICE_SCANNING,
      PLAN_IDS.STARTER
    )).toBe(
      "You've reached this month's document scanning allowance on Starter. " +
      "Upgrade to Pro for a higher monthly allowance."
    );
    expect(monthlyAllowanceMessage(
      USAGE_TYPES.INVOICE_SCANNING,
      PLAN_IDS.PRO
    )).toBe(
      "You've reached this month's document scanning allowance. " +
      "Your usage will be available again when the monthly allowance resets."
    );
  });
});

describe("usage counter safety", () => {
  it("normalises malformed stored values without granting or consuming usage", () => {
    for (const value of [undefined, null, -1, NaN, Infinity, "9", {}, []]) {
      expect(normalizeUsageCount(value)).toBe(0);
    }
    expect(normalizeUsageCount(4.9)).toBe(4);
  });

  it("calculates remaining allowance at and beyond boundaries", () => {
    expect(remainingAllowance(10, 0)).toBe(10);
    expect(remainingAllowance(10, 9, 1)).toBe(0);
    expect(remainingAllowance(10, 10)).toBe(0);
    expect(remainingAllowance(10, 11)).toBe(0);
    expect(remainingAllowance(null, 999999, 999999)).toBeNull();
  });

  it("uses a UTC calendar-month document path", async () => {
    const { manager } = createFixture({
      clock: new Date("2027-01-01T00:30:00+01:00")
    });
    const result = await manager.reserve({ uid, requestId: requestIds[0] });

    expect(result.monthKey).toBe("2026-12");
    expect(usageDocumentPath(uid, result.monthKey))
      .toBe(`userProfiles/${uid}/usage/2026-12`);
  });

  it("starts a fresh allowance from a new UTC month document", async () => {
    const { firestore, manager } = createFixture({
      usage: {
        aiAssistantSuccessfulUses: 10,
        invoiceScanningSuccessfulUses: 10
      },
      clock: new Date("2026-08-01T00:00:00.000Z")
    });
    const result = await manager.reserve({
      uid,
      requestId: requestIds[0]
    });

    expect(result).toMatchObject({ state: "reserved", monthKey: "2026-08" });
    expect(firestore.read(usagePath).aiAssistantSuccessfulUses).toBe(10);
    expect(firestore.read(`${profilePath}/usage/2026-08`))
      .toMatchObject({ aiAssistantSuccessfulUses: 0 });
  });

  it("rejects malformed identifiers before accessing Firestore", async () => {
    const { manager } = createFixture();
    await expect(manager.reserve({ uid, requestId: "not-a-uuid" }))
      .rejects.toThrow("valid request UUID");
    expect(() => usageDocumentPath("bad/uid", monthKey))
      .toThrow("valid Firebase UID");
    expect(() => usageDocumentPath(uid, "July"))
      .toThrow("valid UTC month key");
  });
});

describe("transaction-safe reservations", () => {
  it.each([
    {
      label: "Starter AI Assistant use 10",
      profile: { currentPlan: "Starter", subscriptionStatus: "active" },
      usageType: USAGE_TYPES.AI_ASSISTANT,
      counter: "aiAssistantSuccessfulUses",
      belowLimit: 9,
      limit: 10
    },
    {
      label: "Pro AI Assistant use 500",
      profile: { currentPlan: "Pro", subscriptionStatus: "active" },
      usageType: USAGE_TYPES.AI_ASSISTANT,
      counter: "aiAssistantSuccessfulUses",
      belowLimit: 499,
      limit: 500
    },
    {
      label: "Starter document scan 10",
      profile: { currentPlan: "Starter", subscriptionStatus: "active" },
      usageType: USAGE_TYPES.INVOICE_SCANNING,
      counter: "invoiceScanningSuccessfulUses",
      belowLimit: 9,
      limit: 10
    },
    {
      label: "Pro document scan 500",
      profile: { currentPlan: "Pro", subscriptionStatus: "active" },
      usageType: USAGE_TYPES.INVOICE_SCANNING,
      counter: "invoiceScanningSuccessfulUses",
      belowLimit: 499,
      limit: 500
    }
  ])("allows $label, then rejects the next request without incrementing", async ({
    profile,
    usageType,
    counter,
    belowLimit,
    limit
  }) => {
    const { firestore, manager } = createFixture({
      profile,
      usage: { [counter]: belowLimit }
    });
    const allowed = await manager.reserve({
      uid,
      requestId: requestIds[0],
      usageType
    });
    await manager.finalize({
      uid,
      requestId: requestIds[0],
      usageType,
      ...allowed
    });
    const rejected = await manager.reserve({
      uid,
      requestId: requestIds[1],
      usageType
    });

    expect(allowed).toMatchObject({ state: "reserved", limit });
    expect(firestore.read(usagePath)[counter]).toBe(limit);
    expect(rejected).toMatchObject({ state: "limit-reached", limit });
    const stored = firestore.read(usagePath);
    expect(stored[counter]).toBe(limit);
    const reservationField = usageType === USAGE_TYPES.AI_ASSISTANT
      ? "aiAssistantReservations"
      : "invoiceScanningReservations";
    expect(stored[reservationField]).not.toHaveProperty(requestIds[1]);
  });

  it("allows only one concurrent request to reserve the final Starter use", async () => {
    const { manager } = createFixture({
      usage: { aiAssistantSuccessfulUses: 9 }
    });

    const results = await Promise.all([
      manager.reserve({ uid, requestId: requestIds[0] }),
      manager.reserve({ uid, requestId: requestIds[1] })
    ]);

    expect(results.map(({ state }) => state).sort())
      .toEqual(["limit-reached", "reserved"]);
  });

  it("continues reserving above the allowance while enforcement is disabled", async () => {
    const { firestore, manager } = createFixture({
      usage: { aiAssistantSuccessfulUses: 10 }
    });

    const reservation = await manager.reserve({
      uid,
      requestId: requestIds[0],
      enforceLimit: false
    });
    await manager.finalize({
      uid,
      requestId: requestIds[0],
      ...reservation
    });

    expect(reservation.state).toBe("reserved");
    expect(firestore.read(usagePath).aiAssistantSuccessfulUses).toBe(11);
  });

  it("finalises a successful request exactly once across retries", async () => {
    const { firestore, manager } = createFixture();
    const reservation = await manager.reserve({
      uid,
      requestId: requestIds[0]
    });

    const first = await manager.finalize({
      uid,
      requestId: requestIds[0],
      ...reservation
    });
    const retry = await manager.finalize({
      uid,
      requestId: requestIds[0],
      ...reservation
    });
    const repeatedRequest = await manager.reserve({
      uid,
      requestId: requestIds[0]
    });

    expect(first).toEqual({ counted: true, successfulUses: 1 });
    expect(retry).toEqual({ counted: false, successfulUses: 1 });
    expect(repeatedRequest.state).toBe("completed");
    expect(usageDocumentPath(uid, reservation.monthKey)).toBe(usagePath);
    expect(firestore.read(usagePath)).toEqual({
      aiAssistantSuccessfulUses: 1,
      invoiceScanningSuccessfulUses: 0,
      aiAssistantReservations: {},
      aiAssistantCompletedRequests: {
        [requestIds[0]]: now.getTime()
      },
      invoiceScanningReservations: {},
      invoiceScanningCompletedRequests: {},
      updatedAt: "server-timestamp"
    });
  });

  it("finalises a successful invoice scan exactly once", async () => {
    const { firestore, manager } = createFixture();
    const reservation = await manager.reserve({
      uid,
      requestId: requestIds[0],
      enforceLimit: false,
      usageType: USAGE_TYPES.INVOICE_SCANNING
    });

    const first = await manager.finalize({
      uid,
      requestId: requestIds[0],
      usageType: USAGE_TYPES.INVOICE_SCANNING,
      ...reservation
    });
    const retry = await manager.finalize({
      uid,
      requestId: requestIds[0],
      usageType: USAGE_TYPES.INVOICE_SCANNING,
      ...reservation
    });
    const stored = firestore.read(usagePath);

    expect(first).toEqual({ counted: true, successfulUses: 1 });
    expect(retry).toEqual({ counted: false, successfulUses: 1 });
    expect(stored.aiAssistantSuccessfulUses).toBe(0);
    expect(stored.invoiceScanningSuccessfulUses).toBe(1);
    expect(stored.invoiceScanningReservations).toEqual({});
    expect(stored.invoiceScanningCompletedRequests).toEqual({
      [requestIds[0]]: now.getTime()
    });
  });

  it("releases a failed invoice scan without counting it", async () => {
    const { firestore, manager } = createFixture();
    const reservation = await manager.reserve({
      uid,
      requestId: requestIds[0],
      enforceLimit: false,
      usageType: USAGE_TYPES.INVOICE_SCANNING
    });
    await manager.release({
      uid,
      requestId: requestIds[0],
      usageType: USAGE_TYPES.INVOICE_SCANNING,
      ...reservation
    });

    expect(firestore.read(usagePath).invoiceScanningSuccessfulUses).toBe(0);
  });

  it("releases a failed request without consuming its allowance", async () => {
    const { firestore, manager } = createFixture({
      usage: { aiAssistantSuccessfulUses: 9 }
    });
    const reservation = await manager.reserve({
      uid,
      requestId: requestIds[0]
    });
    const released = await manager.release({
      uid,
      requestId: requestIds[0],
      ...reservation
    });
    const replacement = await manager.reserve({
      uid,
      requestId: requestIds[1]
    });

    expect(released.released).toBe(true);
    expect(replacement.state).toBe("reserved");
    expect(firestore.read(usagePath).aiAssistantSuccessfulUses).toBe(9);
  });

  it("cleans up expired reservations opportunistically", async () => {
    const expiredAt = now.getTime() - 1;
    const { firestore, manager } = createFixture({
      usage: {
        aiAssistantSuccessfulUses: 9,
        aiAssistantReservations: {
          [requestIds[0]]: {
            reservedAtMillis: expiredAt - RESERVATION_TTL_MS,
            expiresAtMillis: expiredAt
          }
        }
      }
    });
    const result = await manager.reserve({
      uid,
      requestId: requestIds[1]
    });

    expect(result.state).toBe("reserved");
    expect(firestore.read(usagePath).aiAssistantReservations)
      .not.toHaveProperty(requestIds[0]);
  });

  it("does not trust caller-supplied plan or usage values", async () => {
    const { manager } = createFixture({
      usage: { aiAssistantSuccessfulUses: 9 }
    });
    const first = await manager.reserve({
      uid,
      requestId: requestIds[0],
      currentPlan: "Pro",
      aiAssistantSuccessfulUses: 0
    });
    const second = await manager.reserve({
      uid,
      requestId: requestIds[1],
      currentPlan: "Pro",
      aiAssistantSuccessfulUses: 0
    });

    expect(first.state).toBe("reserved");
    expect(second.state).toBe("limit-reached");
    expect(first.limit).toBe(10);
  });

  it("stores only counters and bounded request metadata, never business content", async () => {
    const { firestore, manager } = createFixture();
    const reservation = await manager.reserve({
      uid,
      requestId: requestIds[2],
      question: "Private prompt",
      answer: "Private response",
      businessSummary: { customer: "Private customer" }
    });
    await manager.finalize({
      uid,
      requestId: requestIds[2],
      ...reservation
    });

    const stored = firestore.read(usagePath);
    expect(Object.keys(stored).sort()).toEqual([
      "aiAssistantCompletedRequests",
      "aiAssistantReservations",
      "aiAssistantSuccessfulUses",
      "invoiceScanningCompletedRequests",
      "invoiceScanningReservations",
      "invoiceScanningSuccessfulUses",
      "updatedAt"
    ]);
    expect(JSON.stringify(stored)).not.toMatch(
      /Private prompt|Private response|Private customer/
    );
  });
});
