import {createRequire} from "node:module";
import {describe, expect, it} from "vitest";

const require = createRequire(import.meta.url);
const {
  TERMINAL_SUBSCRIPTION_STATUSES,
  createStripeAccountDeletionService,
  listAll,
} = require("../functions/lib/account-deletion-stripe.js");

const USER_A = "customer-a";
const USER_B = "customer-b";

function paged(values, parameters) {
  const start = parameters.starting_after ?
    values.findIndex((entry) => entry.id === parameters.starting_after) + 1 : 0;
  const data = values.slice(start, start + (parameters.limit || 100));
  return {data, has_more: start + data.length < values.length};
}

function stripeFixture({customers = [], subscriptions = [], sessions = []} = {}) {
  customers.forEach((value) => { value.livemode ??= false; });
  subscriptions.forEach((value) => { value.livemode ??= false; });
  sessions.forEach((value) => { value.livemode ??= false; });
  const calls = {cancel: [], expire: []};
  let cancellationFailures = 0;
  let keepSubscriptionLive = false;
  const stripe = {
    customers: {
      list: async (parameters) => paged(customers, parameters),
    },
    subscriptions: {
      list: async (parameters) => paged(subscriptions.filter((subscription) =>
        !parameters.customer || subscription.customer === parameters.customer), parameters),
      retrieve: async (id) => {
        const subscription = subscriptions.find((entry) => entry.id === id);
        if (!subscription) throw Object.assign(new Error("missing"), {code: "resource_missing"});
        return subscription;
      },
      cancel: async (id, _parameters, options) => {
        calls.cancel.push({id, key: options.idempotencyKey});
        if (cancellationFailures > 0) {
          cancellationFailures -= 1;
          throw new Error("temporary Stripe failure");
        }
        const subscription = subscriptions.find((entry) => entry.id === id);
        if (subscription && !keepSubscriptionLive) subscription.status = "canceled";
      },
    },
    checkout: {sessions: {
      list: async (parameters) => paged(sessions, parameters),
      expire: async (id, _parameters, options) => {
        calls.expire.push({id, key: options.idempotencyKey});
        const session = sessions.find((entry) => entry.id === id);
        if (session) session.status = "expired";
      },
    }},
  };
  const profiles = new Map();
  const firestore = {
    collection: () => ({
      doc: (uid) => ({
        get: async () => ({
          exists: profiles.has(uid),
          data: () => profiles.get(uid),
        }),
      }),
    }),
  };
  return {
    calls,
    profiles,
    service: createStripeAccountDeletionService({
      stripe,
      firestore,
      billingConfiguration: {
        expectedMode: "test",
        proPriceId: "price_test_pro",
        checkoutEnabled: true,
      },
    }),
    failCancellationOnce: () => { cancellationFailures = 1; },
    keepSubscriptionLive: () => { keepSubscriptionLive = true; },
  };
}

describe("Stripe account deletion", () => {
  it("paginates complete Stripe list results", async () => {
    const values = Array.from({length: 205}, (_, index) => ({id: `item_${index}`}));
    const listed = await listAll(async (parameters) => paged(values, parameters));
    expect(listed).toHaveLength(205);
    expect(listed.at(-1).id).toBe("item_204");
  });

  it.each(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"])(
      "cancels and verifies a %s subscription",
      async (status) => {
        const fixture = stripeFixture({subscriptions: [{
          id: `sub_${status}`, status, customer: "cus_a",
          metadata: {firebaseUid: USER_A},
        }]});
        await expect(fixture.service(USER_A)).resolves.toMatchObject({
          subscriptionsReconciled: 1,
        });
        expect(fixture.calls.cancel).toHaveLength(1);
        expect(fixture.calls.cancel[0].key).toMatch(/^simple-books-delete-cancel-subscription-/);
      },
  );

  it.each([...TERMINAL_SUBSCRIPTION_STATUSES])(
      "accepts terminal subscription status %s without cancellation",
      async (status) => {
        const fixture = stripeFixture({subscriptions: [{
          id: `sub_${status}`, status, metadata: {firebaseUid: USER_A},
        }]});
        await fixture.service(USER_A);
        expect(fixture.calls.cancel).toHaveLength(0);
      },
  );

  it("finds multiple customers/subscriptions and expires an open Checkout Session", async () => {
    const fixture = stripeFixture({
      customers: [
        {id: "cus_a1", metadata: {firebaseUid: USER_A}},
        {id: "cus_a2", metadata: {firebaseUid: USER_A}},
      ],
      subscriptions: [
        {id: "sub_a1", customer: "cus_a1", status: "active", metadata: {}},
        {id: "sub_a2", customer: "cus_a2", status: "trialing", metadata: {}},
      ],
      sessions: [{
        id: "cs_a", customer: "cus_a2", status: "open",
        client_reference_id: USER_A,
      }],
    });
    await fixture.service(USER_A);
    expect(fixture.calls.cancel.map((call) => call.id).sort())
        .toEqual(["sub_a1", "sub_a2"]);
    expect(fixture.calls.expire.map((call) => call.id)).toEqual(["cs_a"]);
  });

  it("uses stored IDs as discovery evidence and retries a partial cancellation safely", async () => {
    const fixture = stripeFixture({subscriptions: [
      {id: "sub_stored", customer: "cus_stored", status: "active", metadata: {}},
    ]});
    fixture.profiles.set(USER_A, {
      stripeCustomerId: "cus_stored",
      stripeSubscriptionId: "sub_stored",
      stripeMode: "test",
    });
    fixture.failCancellationOnce();
    await expect(fixture.service(USER_A)).rejects.toMatchObject({
      deletionCode: "stripe-cleanup-failed",
    });
    await expect(fixture.service(USER_A)).resolves.toMatchObject({
      subscriptionsReconciled: 1,
    });
    expect(fixture.calls.cancel).toHaveLength(2);
    expect(fixture.calls.cancel[0].key).toBe(fixture.calls.cancel[1].key);
  });

  it("does not report success while re-query still finds a live subscription", async () => {
    const fixture = stripeFixture({subscriptions: [{
      id: "sub_stubborn", status: "active", metadata: {firebaseUid: USER_A},
    }]});
    fixture.keepSubscriptionLive();
    await expect(fixture.service(USER_A)).rejects.toMatchObject({
      deletionCode: "stripe-reconciliation-incomplete",
    });
  });

  it("never changes User B resources while deleting User A", async () => {
    const fixture = stripeFixture({
      customers: [{id: "cus_b", metadata: {firebaseUid: USER_B}}],
      subscriptions: [{
        id: "sub_b", customer: "cus_b", status: "active",
        metadata: {firebaseUid: USER_B},
      }],
      sessions: [{
        id: "cs_b", customer: "cus_b", status: "open",
        client_reference_id: USER_B,
      }],
    });
    await fixture.service(USER_A);
    expect(fixture.calls.cancel).toEqual([]);
    expect(fixture.calls.expire).toEqual([]);
  });
});
