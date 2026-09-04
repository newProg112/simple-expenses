import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const functionsRequire = createRequire(
  new URL("../functions/package.json", import.meta.url)
);
const {HttpsError} = functionsRequire("firebase-functions/v2/https");
const {
  createFounderAnalyticsHandler
} = require("../functions/lib/founder-analytics-handler.js");

const NOW = new Date("2026-09-04T12:00:00.000Z");
const ADMIN_CONFIGURATION = "founder-one,founder-two";
const DEMO_CONFIGURATION = "uid:demo-user,email:demo@example.test";
const SNAPSHOT = Object.freeze({
  schemaVersion: 1,
  generatedAt: NOW.toISOString(),
  overview: Object.freeze({
    totalUsers: 2,
    starterUsers: 1,
    proUsers: 1,
    activePaidSubscriptions: 1,
    estimatedMrrMinorUnits: 1500,
    currency: "GBP"
  }),
  monthlySignups: Object.freeze([
    Object.freeze({ monthKey: "2026-09", count: 2 })
  ]),
  recentActivity: Object.freeze([])
});

function handlerFixture(overrides = {}) {
  const snapshotBuilder = overrides.snapshotBuilder || vi.fn(async () => SNAPSHOT);
  const logger = overrides.logger || { error: vi.fn(), info: vi.fn() };
  const dependencies = {
    auth: { service: "trusted-auth" },
    firestore: { service: "trusted-firestore" },
    adminUidConfiguration: ADMIN_CONFIGURATION,
    demoConfiguration: DEMO_CONFIGURATION,
    proPriceId: "price_pro_test",
    expectedMode: "test",
    timestampFactory: { service: "trusted-timestamp" },
    documentIdField: { service: "trusted-document-id" },
    now: () => NOW,
    snapshotBuilder,
    logger,
    ...overrides
  };
  return {
    dependencies,
    handler: createFounderAnalyticsHandler(dependencies),
    logger,
    snapshotBuilder
  };
}

describe("Founder Analytics callable authorization", () => {
  it("rejects unauthenticated requests before snapshot reads", async () => {
    const {handler, snapshotBuilder} = handlerFixture();

    await expect(handler({data: {activityLimit: 20}}))
      .rejects.toMatchObject({code: "unauthenticated"});
    expect(snapshotBuilder).not.toHaveBeenCalled();
  });

  it("rejects ordinary customers before request validation or snapshot reads", async () => {
    const {handler, snapshotBuilder} = handlerFixture();

    await expect(handler({
      auth: {uid: "ordinary-customer"},
      data: {unknown: true}
    })).rejects.toMatchObject({code: "permission-denied"});
    expect(snapshotBuilder).not.toHaveBeenCalled();
  });

  it("does not allow client-supplied authorization fields to forge access", async () => {
    const {handler, snapshotBuilder} = handlerFixture();

    await expect(handler({
      auth: {uid: "ordinary-customer"},
      data: {uid: "founder-one", admin: true, role: "founder"}
    })).rejects.toMatchObject({code: "permission-denied"});
    expect(snapshotBuilder).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "   ", "bad/uid", "founder-one,,founder-two"])(
    "fails closed for missing or malformed admin configuration: %s",
    async adminUidConfiguration => {
      const {handler, snapshotBuilder} = handlerFixture({adminUidConfiguration});
      await expect(handler({auth: {uid: "founder-one"}, data: {}}))
        .rejects.toMatchObject({code: "failed-precondition"});
      expect(snapshotBuilder).not.toHaveBeenCalled();
    }
  );
});

describe("Founder Analytics callable request contract", () => {
  it.each([
    [undefined, 20],
    [null, 20],
    [{}, 20],
    [{activityLimit: 1}, 1],
    [{activityLimit: 30}, 30]
  ])("accepts request data %j with activity limit %i", async (data, expectedLimit) => {
    const {handler, snapshotBuilder} = handlerFixture();

    await expect(handler({auth: {uid: "founder-two"}, data})).resolves.toBe(SNAPSHOT);
    expect(snapshotBuilder).toHaveBeenCalledWith(expect.objectContaining({
      activityLimit: expectedLimit
    }));
  });

  it.each([
    [],
    [20],
    "",
    20,
    {uid: "founder-one"},
    {admin: true},
    {role: "founder"},
    {activityLimit: 20, extra: true}
  ])("rejects arrays, primitives, and unknown fields: %j", async data => {
    const {handler, snapshotBuilder} = handlerFixture();

    await expect(handler({auth: {uid: "founder-one"}, data}))
      .rejects.toMatchObject({code: "invalid-argument"});
    expect(snapshotBuilder).not.toHaveBeenCalled();
  });

  it.each([0, 31, -1, 1.5, "20", true, false])(
    "rejects invalid activityLimit %j",
    async activityLimit => {
      const {handler, snapshotBuilder} = handlerFixture();
      await expect(handler({
        auth: {uid: "founder-one"},
        data: {activityLimit}
      })).rejects.toMatchObject({code: "invalid-argument"});
      expect(snapshotBuilder).not.toHaveBeenCalled();
    }
  );

  it("passes only trusted dependencies and validated input to the snapshot layer", async () => {
    const {dependencies, handler, snapshotBuilder} = handlerFixture();
    const result = await handler({
      auth: {uid: "founder-one", token: {admin: false}},
      data: {activityLimit: 7}
    });

    expect(result).toBe(SNAPSHOT);
    expect(snapshotBuilder).toHaveBeenCalledOnce();
    expect(snapshotBuilder).toHaveBeenCalledWith({
      auth: dependencies.auth,
      firestore: dependencies.firestore,
      adminUidConfiguration: ADMIN_CONFIGURATION,
      demoConfiguration: DEMO_CONFIGURATION,
      proPriceId: "price_pro_test",
      expectedMode: "test",
      activityLimit: 7,
      timestampFactory: dependencies.timestampFactory,
      documentIdField: dependencies.documentIdField,
      now: NOW
    });
    expect(snapshotBuilder.mock.calls[0][0]).not.toHaveProperty("uid");
    expect(snapshotBuilder.mock.calls[0][0]).not.toHaveProperty("role");
    expect(Object.keys(result)).toEqual([
      "schemaVersion", "generatedAt", "overview", "monthlySignups", "recentActivity"
    ]);
  });
});

describe("Founder Analytics callable error boundary", () => {
  it("maps unexpected failures to a generic internal response without private details", async () => {
    const privateError = new Error("users/private-uid cus_private secret-value");
    privateError.code = "snapshot-build-failed";
    const logger = {error: vi.fn(), info: vi.fn()};
    const {handler} = handlerFixture({
      logger,
      snapshotBuilder: vi.fn(async () => {
        throw privateError;
      })
    });

    let received;
    try{
      await handler({auth: {uid: "founder-one"}, data: {}});
    }catch(error){
      received = error;
    }
    expect(received).toMatchObject({
      code: "internal",
      message: "Founder Analytics could not be loaded."
    });
    expect(received.message).not.toMatch(/private-uid|cus_private|secret-value|users\//);
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(
      /private-uid|cus_private|secret-value|users\//
    );
  });

  it("preserves intentional callable errors from the snapshot boundary", async () => {
    const intentional = new HttpsError("resource-exhausted", "Try again later.");
    const {handler} = handlerFixture({
      snapshotBuilder: vi.fn(async () => {
        throw intentional;
      })
    });

    await expect(handler({auth: {uid: "founder-one"}, data: {}}))
      .rejects.toBe(intentional);
  });
});

describe("Founder Analytics callable export wiring", () => {
  it("registers the backend-only callable with the existing admin runtime and secrets", () => {
    const source = readFileSync(
      new URL("../functions/index.js", import.meta.url),
      "utf8"
    );
    expect(source).toContain(
      'createFounderAnalyticsHandler,\n} = require("./lib/founder-analytics-handler")'
    );
    const start = source.indexOf("exports.getFounderAnalyticsSnapshot = onCall(");
    const end = source.indexOf("exports.logActivityEvent = onCall(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const wiring = source.slice(start, end);

    expect(wiring).toContain('region: "us-central1"');
    expect(wiring).toContain("maxInstances: 2");
    expect(wiring).toContain("timeoutSeconds: 60");
    expect(wiring).toContain('memory: "256MiB"');
    expect(wiring).toContain("secrets: [adminUidsSecret, demoIdentifiersSecret]");
    expect(wiring).toContain("adminUidConfiguration: adminUidsSecret.value()");
    expect(wiring).toContain("demoConfiguration: demoIdentifiersSecret.value()");
    expect(wiring).toContain("auth: admin.auth()");
    expect(wiring).toContain("firestore: admin.firestore()");
    expect(wiring).toContain("timestampFactory: Timestamp");
    expect(wiring).toContain("documentIdField: FieldPath.documentId()");
    expect(wiring).not.toContain("enforceAppCheck");
  });
});
