import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  LIVE_PRO_PRICE_ID,
  TEST_PRO_PRICE_ID,
  assertConfiguredProPrice,
  assertStripeSecretKeyMode,
  runtimeStripeBillingConfiguration,
  validateStripeBillingConfiguration
} = require("../functions/lib/stripe-billing-config.js");
const {
  StripeCheckoutError,
  createStripeCheckoutService
} = require("../functions/lib/stripe-checkout-service.js");
const {
  STRIPE_WEBHOOK_EVENT_TYPES,
  createStripeWebhookProcessor
} = require("../functions/lib/stripe-webhook-processor.js");
const {
  STRIPE_PROFILE_PROJECTION_VERSION,
  createStripeProfileWriter
} = require("../functions/lib/stripe-profile-writer.js");
const {
  stripeTimestampToFirestore
} = require("../functions/lib/stripe-firestore-values.js");
const admin = require("../functions/node_modules/firebase-admin");

const UID = "billing-user";
const NOW = new Date("2026-09-01T12:00:00.000Z");
const testConfiguration = Object.freeze({
  expectedMode: "test",
  proPriceId: TEST_PRO_PRICE_ID,
  checkoutEnabled: true
});

const clone = value => value === undefined ? undefined : structuredClone(value);

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
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }

  collection(name) {
    return new Collection(this.firestore, `${this.path}/${name}`);
  }
}

class Collection {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
  }

  doc(id) {
    return new Reference(this.firestore, `${this.path}/${id}`);
  }
}

class Transaction {
  constructor(firestore) {
    this.firestore = firestore;
    this.writes = [];
  }

  async get(reference) {
    return new Snapshot(this.firestore.documents.get(reference.path));
  }

  set(reference, data, options = {}) {
    this.writes.push({ kind: "set", reference, data: clone(data), options });
  }

  create(reference, data) {
    this.writes.push({ kind: "create", reference, data: clone(data) });
  }

  commit() {
    for (const write of this.writes) {
      const current = this.firestore.documents.get(write.reference.path);
      if (write.kind === "create" && current !== undefined) {
        throw new Error("already-exists");
      }
      this.firestore.documents.set(
        write.reference.path,
        write.options?.merge ? { ...(clone(current) || {}), ...write.data } : write.data
      );
    }
  }
}

class Firestore {
  constructor(entries = {}) {
    this.documents = new Map(
      Object.entries(entries).map(([path, value]) => [path, clone(value)])
    );
    this.transactionQueue = Promise.resolve();
  }

  collection(name) {
    return new Collection(this, name);
  }

  runTransaction(callback) {
    const operation = this.transactionQueue.then(async () => {
      const transaction = new Transaction(this);
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

function customer(overrides = {}) {
  return {
    id: "cus_owned",
    livemode: false,
    metadata: { firebaseUid: UID },
    ...overrides
  };
}

function subscription(overrides = {}) {
  return {
    id: "sub_owned",
    customer: "cus_owned",
    created: 100,
    livemode: false,
    metadata: { firebaseUid: UID },
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [{ price: { id: TEST_PRO_PRICE_ID }, quantity: 1 }]
    },
    ...overrides
  };
}

function checkoutFixture({ configuration = testConfiguration, clock = NOW } = {}) {
  const firestore = new Firestore();
  const sessions = new Map();
  const subscriptions = new Map([["sub_owned", subscription()]]);
  const customers = new Map([["cus_owned", customer()]]);
  const calls = { create: [], retrieveSession: [], retrieveSubscription: [], retrieveCustomer: [] };
  let now = new Date(clock);
  let sessionSequence = 0;
  let createImplementation;
  const stripe = {
    checkout: { sessions: {
      create: vi.fn(async (parameters, options) => {
        calls.create.push({ parameters, options });
        if (createImplementation) return createImplementation(parameters, options);
        sessionSequence += 1;
        const value = {
          id: `cs_test_${sessionSequence}`,
          url: `https://checkout.stripe.test/${sessionSequence}`,
          expires_at: Math.floor(now.getTime() / 1000) + 3600,
          livemode: false,
          mode: "subscription",
          status: "open",
          customer: parameters.customer || null,
          metadata: { firebaseUid: UID },
          line_items: { data: [{ price: { id: TEST_PRO_PRICE_ID }, quantity: 1 }] }
        };
        sessions.set(value.id, value);
        return value;
      }),
      retrieve: vi.fn(async id => {
        calls.retrieveSession.push(id);
        return sessions.get(id);
      })
    } },
    subscriptions: {
      retrieve: vi.fn(async id => {
        calls.retrieveSubscription.push(id);
        return subscriptions.get(id);
      })
    },
    customers: {
      retrieve: vi.fn(async id => {
        calls.retrieveCustomer.push(id);
        return customers.get(id);
      })
    }
  };
  const service = createStripeCheckoutService({
    stripe,
    firestore,
    billingConfiguration: configuration,
    fieldValue: { serverTimestamp: () => "server-timestamp" },
    timestampFactory: { fromDate: value => value },
    now: () => now
  });
  return {
    calls,
    customers,
    firestore,
    service,
    sessions,
    stripe,
    subscriptions,
    advance(milliseconds) { now = new Date(now.getTime() + milliseconds); },
    setCreateImplementation(value) { createImplementation = value; }
  };
}

describe("Stripe billing configuration", () => {
  it("converts Stripe timestamps outside the bound Admin Firestore namespace", () => {
    const emulatorStyleFirestore = admin.firestore.bind(admin);
    expect(emulatorStyleFirestore.Timestamp).toBeUndefined();

    const converted = stripeTimestampToFirestore(1_725_192_000);
    expect(converted.toMillis()).toBe(1_725_192_000_000);
    expect(stripeTimestampToFirestore(0)).toBeNull();
  });

  it("keeps webhook profile and activity wiring off bound Admin statics", () => {
    const source = readFileSync(
      new URL("../functions/index.js", import.meta.url),
      "utf8"
    );
    const profileStart = source.indexOf("async function updateSubscriptionProfile(");
    const webhookEnd = source.indexOf("const {\n  askBusinessAssistantPreview", profileStart);
    const webhookBillingWiring = source.slice(profileStart, webhookEnd);

    expect(profileStart).toBeGreaterThan(-1);
    expect(webhookEnd).toBeGreaterThan(profileStart);
    expect(webhookBillingWiring).not.toContain("admin.firestore.FieldValue");
    expect(webhookBillingWiring).not.toContain("admin.firestore.Timestamp");
    expect(webhookBillingWiring).toContain("fieldValue: FieldValue");
  });

  it("wires the checkout caller with emulator-safe Firestore value types", () => {
    const source = readFileSync(
      new URL("../functions/index.js", import.meta.url),
      "utf8"
    );
    const checkoutStart = source.indexOf("const checkout = createStripeCheckoutService({");
    const checkoutEnd = source.indexOf("if (!configuration.checkoutEnabled)", checkoutStart);
    const checkoutWiring = source.slice(checkoutStart, checkoutEnd);

    expect(checkoutStart).toBeGreaterThan(-1);
    expect(checkoutEnd).toBeGreaterThan(checkoutStart);
    expect(checkoutWiring).toContain("fieldValue: FieldValue");
    expect(checkoutWiring).toContain("timestampFactory: Timestamp");
    expect(checkoutWiring).not.toContain("admin.firestore.FieldValue");
    expect(checkoutWiring).not.toContain("admin.firestore.Timestamp");
  });

  it("does not retain verbose Stripe billing-field logging", () => {
    const source = readFileSync(
      new URL("../functions/index.js", import.meta.url),
      "utf8"
    );
    expect(source).not.toContain("Stripe subscription period end values");
    expect(source).not.toContain("Writing subscription billing fields");
  });

  it("keeps checkout disabled by default and requires the exact live price", () => {
    expect(runtimeStripeBillingConfiguration({})).toEqual({
      expectedMode: "test",
      proPriceId: TEST_PRO_PRICE_ID,
      checkoutEnabled: false
    });
    expect(runtimeStripeBillingConfiguration({
      STRIPE_EXPECTED_MODE: "live",
      STRIPE_PRO_PRICE_ID: LIVE_PRO_PRICE_ID,
      STRIPE_CHECKOUT_ENABLED: "false"
    })).toEqual({
      expectedMode: "live",
      proPriceId: LIVE_PRO_PRICE_ID,
      checkoutEnabled: false
    });
    expect(() => validateStripeBillingConfiguration({
      expectedMode: "live",
      proPriceId: TEST_PRO_PRICE_ID
    })).toThrowError(expect.objectContaining({ reason: "live-price-mismatch" }));
  });

  it("fails closed for secret, object, and price detail mismatches", () => {
    expect(() => assertStripeSecretKeyMode("sk_live_example", testConfiguration))
      .toThrowError(expect.objectContaining({ reason: "secret-key-mode-mismatch" }));
    expect(() => assertConfiguredProPrice({
      id: TEST_PRO_PRICE_ID,
      livemode: false,
      active: true,
      type: "recurring",
      currency: "gbp",
      unit_amount: 1400,
      recurring: { interval: "month", interval_count: 1 }
    }, testConfiguration)).toThrowError(
      expect.objectContaining({ reason: "pro-price-details-mismatch" })
    );
  });
});

describe("Stripe Checkout concurrency and ownership", () => {
  const request = {
    uid: UID,
    profile: {},
    successUrl: "https://simple-books.co.uk/account.html?checkout=success",
    cancelUrl: "https://simple-books.co.uk/account.html?checkout=cancelled"
  };

  it("enforces the checkout kill switch before calling Stripe", async () => {
    const fixture = checkoutFixture({
      configuration: { ...testConfiguration, checkoutEnabled: false }
    });
    await expect(fixture.service(request)).rejects.toMatchObject({
      code: "checkout-disabled",
      httpStatus: 503
    });
    expect(fixture.calls.create).toHaveLength(0);
  });

  it("reuses the same owned open session for a repeated request", async () => {
    const fixture = checkoutFixture();
    const first = await fixture.service(request);
    const second = await fixture.service(request);
    expect(first.reused).toBe(false);
    expect(second).toMatchObject({ reused: true, session: { id: first.session.id } });
    expect(fixture.calls.create).toHaveLength(1);
    expect(fixture.calls.retrieveSession).toEqual([first.session.id]);
  });

  it("rejects a concurrent request while session creation holds the lease", async () => {
    const fixture = checkoutFixture();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    fixture.setCreateImplementation(async parameters => {
      await gate;
      const value = {
        id: "cs_test_concurrent",
        url: "https://checkout.stripe.test/concurrent",
        expires_at: Math.floor(NOW.getTime() / 1000) + 3600,
        livemode: false,
        mode: "subscription",
        status: "open",
        customer: parameters.customer || null,
        metadata: { firebaseUid: UID }
      };
      fixture.sessions.set(value.id, value);
      return value;
    });
    const first = fixture.service(request);
    while (fixture.calls.create.length === 0) await Promise.resolve();
    await expect(fixture.service(request)).rejects.toMatchObject({
      code: "checkout-in-progress"
    });
    release();
    await expect(first).resolves.toMatchObject({ reused: false });
    expect(fixture.calls.create).toHaveLength(1);
  });

  it("allows a fresh idempotency generation after session expiry", async () => {
    const fixture = checkoutFixture();
    const first = await fixture.service(request);
    fixture.advance(2 * 60 * 60 * 1000);
    const second = await fixture.service(request);
    expect(second.reused).toBe(false);
    expect(second.session.id).not.toBe(first.session.id);
    expect(fixture.calls.create).toHaveLength(2);
    expect(fixture.calls.create[0].options.idempotencyKey)
      .not.toBe(fixture.calls.create[1].options.idempotencyKey);
  });

  it("uses a fresh generation when Stripe expires a session before the stored deadline", async () => {
    const fixture = checkoutFixture();
    const first = await fixture.service(request);
    fixture.sessions.get(first.session.id).status = "expired";
    const second = await fixture.service(request);
    expect(second.reused).toBe(false);
    expect(second.session.id).not.toBe(first.session.id);
    expect(fixture.calls.create).toHaveLength(2);
    expect(fixture.calls.create[0].options.idempotencyKey)
      .not.toBe(fixture.calls.create[1].options.idempotencyKey);
  });

  it("never passes unmarked legacy Stripe IDs to the configured account", async () => {
    const fixture = checkoutFixture();
    await fixture.service({
      ...request,
      profile: {
        stripeCustomerId: "cus_legacy",
        stripeSubscriptionId: "sub_legacy"
      }
    });
    expect(fixture.calls.retrieveCustomer).toEqual([]);
    expect(fixture.calls.retrieveSubscription).toEqual([]);
    expect(fixture.calls.create[0].parameters).not.toHaveProperty("customer");
  });

  it("blocks checkout for an owned nonterminal subscription", async () => {
    const fixture = checkoutFixture();
    await expect(fixture.service({
      ...request,
      profile: {
        stripeMode: "test",
        stripeCustomerId: "cus_owned",
        stripeSubscriptionId: "sub_owned"
      }
    })).rejects.toMatchObject({ code: "existing-subscription" });
    expect(fixture.calls.retrieveSubscription).toEqual(["sub_owned"]);
    expect(fixture.calls.create).toHaveLength(0);
  });

  it("does not reuse a customer whose UID metadata belongs to another user", async () => {
    const fixture = checkoutFixture();
    fixture.customers.set("cus_owned", customer({
      metadata: { firebaseUid: "another-user" }
    }));
    await expect(fixture.service({
      ...request,
      profile: { stripeMode: "test", stripeCustomerId: "cus_owned" }
    })).rejects.toMatchObject({ code: "stripe-ownership-invalid" });
    expect(fixture.calls.create).toHaveLength(0);
  });
});

function webhookFixture(overrides = {}) {
  const canonicalSubscription = overrides.subscription || subscription();
  const canonicalCustomer = overrides.customer || customer();
  const updateProfile = overrides.updateProfile || vi.fn(async () => ({
    updated: true,
    reason: "updated"
  }));
  const stripe = {
    subscriptions: {
      retrieve: vi.fn(async () => canonicalSubscription)
    },
    customers: {
      retrieve: vi.fn(async () => canonicalCustomer)
    }
  };
  const processor = createStripeWebhookProcessor({
    stripe,
    billingConfiguration: testConfiguration,
    updateProfile,
    billingDetails: vi.fn(async () => ({
      subscriptionCurrentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
      paymentMethodBrand: "visa",
      paymentMethodLast4: "4242"
    }))
  });
  return { processor, stripe, updateProfile };
}

function subscriptionEvent(type = "customer.subscription.updated", object = subscription()) {
  return {
    id: `evt_${type.replaceAll(/[^A-Za-z0-9]/g, "")}`,
    type,
    created: 200,
    livemode: false,
    data: { object }
  };
}

describe("Stripe webhook validation and retryability", () => {
  it("declares only the required event types", () => {
    expect(STRIPE_WEBHOOK_EVENT_TYPES).toEqual([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted"
    ]);
  });

  it("rejects a live event in test mode before updating Firestore", async () => {
    const fixture = webhookFixture();
    const event = subscriptionEvent();
    event.livemode = true;
    await expect(fixture.processor(event)).rejects.toMatchObject({
      reason: "event-mode-mismatch"
    });
    expect(fixture.updateProfile).not.toHaveBeenCalled();
  });

  it("uses the canonical current subscription to resist reordered events", async () => {
    const fixture = webhookFixture({
      subscription: subscription({ status: "active", cancel_at_period_end: true })
    });
    const staleEventObject = subscription({ status: "past_due" });
    const result = await fixture.processor(subscriptionEvent(
      "customer.subscription.updated",
      staleEventObject
    ));
    expect(result.subscriptionStatus).toBe("active");
    expect(fixture.updateProfile).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        subscriptionStatus: "active",
        cancelAtPeriodEnd: true,
        stripeMode: "test",
        stripePriceId: TEST_PRO_PRICE_ID
      }),
      expect.objectContaining({ eventId: expect.stringMatching(/^evt_/) })
    );
  });

  it("projects a separate scheduled cancellation date", async () => {
    const cancelAt = 1_780_519_540;
    const fixture = webhookFixture({
      subscription: subscription({
        status: "active",
        cancel_at_period_end: false,
        cancel_at: cancelAt
      })
    });
    fixture.processor = createStripeWebhookProcessor({
      stripe: fixture.stripe,
      billingConfiguration: testConfiguration,
      updateProfile: fixture.updateProfile,
      billingDetails: vi.fn(async (_stripe, canonicalSubscription) => ({
        subscriptionCancelAt: canonicalSubscription.cancel_at
      }))
    });

    await fixture.processor(subscriptionEvent());
    expect(fixture.updateProfile).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({
        subscriptionStatus: "active",
        cancelAtPeriodEnd: false,
        subscriptionCancelAt: cancelAt
      }),
      expect.any(Object)
    );
  });

  it("rejects checkout customer/subscription ownership mismatches", async () => {
    const fixture = webhookFixture();
    const event = {
      id: "evt_checkoutownership",
      type: "checkout.session.completed",
      created: 200,
      livemode: false,
      data: { object: {
        id: "cs_owned",
        livemode: false,
        mode: "subscription",
        customer: "cus_other",
        subscription: "sub_owned",
        client_reference_id: UID,
        metadata: { firebaseUid: UID }
      } }
    };
    await expect(fixture.processor(event)).rejects.toMatchObject({
      code: "stripe-ownership-invalid"
    });
    expect(fixture.updateProfile).not.toHaveBeenCalled();
  });

  it("records a non-qualifying price so the writer can revoke Pro", async () => {
    const fixture = webhookFixture({
      subscription: subscription({
        items: { data: [{ price: { id: "price_wrong" }, quantity: 1 }] }
      })
    });
    const result = await fixture.processor(subscriptionEvent());
    expect(result.configuredPrice).toBe(false);
    expect(fixture.updateProfile).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({ stripePriceId: "price_wrong" }),
      expect.any(Object)
    );
  });

  it("does not qualify a non-unit quantity of the configured price", async () => {
    const fixture = webhookFixture({
      subscription: subscription({
        items: { data: [{ price: { id: TEST_PRO_PRICE_ID }, quantity: 2 }] }
      })
    });
    const result = await fixture.processor(subscriptionEvent());
    expect(result.configuredPrice).toBe(false);
    expect(fixture.updateProfile).toHaveBeenCalledWith(
      UID,
      expect.objectContaining({ stripePriceId: "" }),
      expect.any(Object)
    );
  });

  it("leaves failed processing retryable", async () => {
    const updateProfile = vi.fn()
      .mockRejectedValueOnce(new Error("temporary Firestore failure"))
      .mockResolvedValueOnce({ updated: true, reason: "updated" });
    const fixture = webhookFixture({ updateProfile });
    const event = subscriptionEvent();
    await expect(fixture.processor(event)).rejects.toThrow("temporary Firestore failure");
    await expect(fixture.processor(event)).resolves.toMatchObject({ handled: true });
    expect(updateProfile).toHaveBeenCalledTimes(2);
  });
});

function profileWriterFixture(profile = {}) {
  const firestore = new Firestore({
    [`users/${UID}`]: { uid: UID },
    [`userProfiles/${UID}`]: profile
  });
  const writer = createStripeProfileWriter({
    firestore,
    auth: { getUser: vi.fn(async () => ({ uid: UID })) },
    fieldValue: { serverTimestamp: () => "server-timestamp" },
    billingConfiguration: testConfiguration,
    logger: { warn: vi.fn() }
  });
  return { firestore, writer };
}

function profileUpdate(overrides = {}) {
  return {
    subscriptionStatus: "active",
    stripeCustomerId: "cus_owned",
    stripeSubscriptionId: "sub_owned",
    stripeSubscriptionCreated: 100,
    stripePriceId: TEST_PRO_PRICE_ID,
    stripeMode: "test",
    cancelAtPeriodEnd: false,
    subscriptionCancelAt: null,
    ...overrides
  };
}

describe("durable webhook profile updates", () => {
  it("processes duplicate concurrent event deliveries exactly once", async () => {
    const fixture = profileWriterFixture();
    const results = await Promise.all([
      fixture.writer(UID, profileUpdate(), { eventId: "evt_duplicate" }),
      fixture.writer(UID, profileUpdate(), { eventId: "evt_duplicate" })
    ]);
    expect(results).toEqual(expect.arrayContaining([
      { updated: true, reason: "updated" },
      { updated: false, reason: "duplicate-event" }
    ]));
    expect(fixture.firestore.read(`stripeWebhookEvents/evt_duplicate`))
      .toMatchObject({
        uid: UID,
        result: "updated",
        profileProjectionVersion: STRIPE_PROFILE_PROJECTION_VERSION
      });
  });

  it("reprojects one legacy receipt and then remains idempotent", async () => {
    const fixture = profileWriterFixture();
    fixture.firestore.documents.set("stripeWebhookEvents/evt_legacy", {
      uid: UID,
      result: "updated",
      processedAt: "old-server-timestamp"
    });
    const cancellationDate = new Date("2026-10-03T20:45:40.000Z");

    await expect(fixture.writer(UID, profileUpdate({
      subscriptionCancelAt: cancellationDate
    }), {eventId: "evt_legacy"})).resolves.toEqual({
      updated: true,
      reason: "updated"
    });
    await expect(fixture.writer(UID, profileUpdate({
      subscriptionCancelAt: cancellationDate
    }), {eventId: "evt_legacy"})).resolves.toEqual({
      updated: false,
      reason: "duplicate-event"
    });
    expect(fixture.firestore.read(`userProfiles/${UID}`)).toMatchObject({
      currentPlan: "Pro",
      subscriptionStatus: "active",
      subscriptionCancelAt: cancellationDate
    });
  });

  it("ignores an older different subscription after a newer one is stored", async () => {
    const fixture = profileWriterFixture();
    await fixture.writer(UID, profileUpdate({
      stripeSubscriptionId: "sub_new",
      stripeSubscriptionCreated: 200
    }), { eventId: "evt_new" });
    await expect(fixture.writer(UID, profileUpdate({
      subscriptionStatus: "canceled",
      stripeSubscriptionId: "sub_old",
      stripeSubscriptionCreated: 100
    }), { eventId: "evt_old" })).resolves.toEqual({
      updated: false,
      reason: "stale-subscription"
    });
    expect(fixture.firestore.read(`userProfiles/${UID}`))
      .toMatchObject({ currentPlan: "Pro", stripeSubscriptionId: "sub_new" });
  });

  it.each([
    ["cancellation", { subscriptionStatus: "canceled" }],
    ["non-qualifying price", { stripePriceId: "price_wrong" }],
    ["mode mismatch", { stripeMode: "live" }]
  ])("revokes paid Pro after %s", async (_label, overrides) => {
    const fixture = profileWriterFixture();
    await fixture.writer(UID, profileUpdate(), { eventId: "evt_grant" });
    await fixture.writer(UID, profileUpdate(overrides), {
      eventId: `evt_revoke${_label.replaceAll(/[^A-Za-z0-9]/g, "")}`
    });
    expect(fixture.firestore.read(`userProfiles/${UID}`).currentPlan).toBe("Starter");
  });

  it("preserves a valid explicit override when Stripe becomes ineligible", async () => {
    const fixture = profileWriterFixture({
      currentPlan: "Pro",
      billingOverride: true
    });
    await fixture.writer(UID, profileUpdate({ subscriptionStatus: "canceled" }), {
      eventId: "evt_override"
    });
    expect(fixture.firestore.read(`userProfiles/${UID}`).currentPlan).toBe("Pro");
  });
});
