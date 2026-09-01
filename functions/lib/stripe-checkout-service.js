/* eslint-disable max-len, require-jsdoc */

"use strict";

const crypto = require("node:crypto");
const {assertStripeObjectMode} = require("./stripe-billing-config");
const {
  assertCustomerRelationship,
  assertUidMetadata,
  objectId,
  retrieveOwnedCustomer,
  retrieveOwnedSubscription,
  subscriptionCustomerId,
  subscriptionUsesConfiguredPrice,
} = require("./stripe-object-validation");

const CHECKOUT_LEASE_MS = 30 * 1000;
const TERMINAL_RETRY_STATUSES = new Set(["canceled", "incomplete_expired"]);

class StripeCheckoutError extends Error {
  constructor(code, message, httpStatus = 409) {
    super(message);
    this.name = "StripeCheckoutError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function checkoutIdempotencyKey(uid, billingConfiguration, generation) {
  const digest = crypto.createHash("sha256")
      .update(`${billingConfiguration.expectedMode}:${uid}:${billingConfiguration.proPriceId}:${generation}`)
      .digest("hex");
  return `simple-books-checkout-${digest}`;
}

function checkoutStateReference(firestore, uid) {
  return firestore.collection("userProfiles").doc(uid)
      .collection("billing").doc("checkout");
}

async function ownedReusableCustomer(stripe, profile, uid, billingConfiguration) {
  if (!profile || profile.stripeMode !== billingConfiguration.expectedMode) {
    return "";
  }
  const customerId = objectId(profile.stripeCustomerId);
  const subscriptionId = objectId(profile.stripeSubscriptionId);
  if (subscriptionId) {
    const subscription = await retrieveOwnedSubscription(
        stripe, subscriptionId, uid, billingConfiguration,
    );
    if (!TERMINAL_RETRY_STATUSES.has(String(subscription.status || ""))) {
      throw new StripeCheckoutError(
          "existing-subscription",
          "An existing subscription must be managed before starting checkout.",
      );
    }
    return subscriptionCustomerId(subscription);
  }
  if (!customerId) return "";
  await retrieveOwnedCustomer(
      stripe, customerId, uid, billingConfiguration,
      {requireDirectOwnership: true},
  );
  return customerId;
}

function stateMatchesConfiguration(state, billingConfiguration) {
  return state && state.stripeMode === billingConfiguration.expectedMode &&
    state.stripePriceId === billingConfiguration.proPriceId;
}

async function acquireLease({firestore, uid, billingConfiguration, fieldValue, timestampFactory, now, leaseToken}) {
  const reference = checkoutStateReference(firestore, uid);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const stored = snapshot.exists ? snapshot.data() || {} : {};
    const state = stateMatchesConfiguration(stored, billingConfiguration) ? stored : {};
    const nowMillis = now.getTime();
    if (state.sessionId && timestampMillis(state.sessionExpiresAt) > nowMillis + 5000) {
      return {state: "candidate", sessionId: state.sessionId};
    }
    if (timestampMillis(state.leaseExpiresAt) > nowMillis) {
      throw new StripeCheckoutError(
          "checkout-in-progress",
          "Checkout is already being prepared. Please try again shortly.",
      );
    }
    const expiredSession = Boolean(state.sessionId);
    const generation = Math.max(1, Number(state.generation || 0) +
      (expiredSession || !state.generation ? 1 : 0));
    transaction.set(reference, {
      stripeMode: billingConfiguration.expectedMode,
      stripePriceId: billingConfiguration.proPriceId,
      generation,
      leaseToken,
      leaseExpiresAt: timestampFactory.fromDate(
          new Date(nowMillis + CHECKOUT_LEASE_MS),
      ),
      ...(expiredSession ? {
        sessionId: null,
        sessionUrl: null,
        sessionExpiresAt: null,
      } : {}),
      updatedAt: fieldValue.serverTimestamp(),
    }, {merge: true});
    return {state: "acquired", generation, reference};
  });
}

async function invalidateCandidate({firestore, uid, sessionId, fieldValue}) {
  const reference = checkoutStateReference(firestore, uid);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const state = snapshot.exists ? snapshot.data() || {} : {};
    if (state.sessionId !== sessionId) return;
    transaction.set(reference, {
      sessionId: null,
      sessionUrl: null,
      sessionExpiresAt: null,
      generation: Math.max(1, Number(state.generation || 0) + 1),
      updatedAt: fieldValue.serverTimestamp(),
    }, {merge: true});
  });
}

async function releaseLease({firestore, uid, leaseToken, fieldValue}) {
  const reference = checkoutStateReference(firestore, uid);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const state = snapshot.exists ? snapshot.data() || {} : {};
    if (state.leaseToken !== leaseToken) return;
    transaction.set(reference, {
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: fieldValue.serverTimestamp(),
    }, {merge: true});
  });
}

async function persistSession({firestore, uid, leaseToken, session, billingConfiguration, fieldValue, timestampFactory}) {
  const reference = checkoutStateReference(firestore, uid);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const state = snapshot.exists ? snapshot.data() || {} : {};
    if (state.leaseToken !== leaseToken ||
      !stateMatchesConfiguration(state, billingConfiguration)) {
      throw new StripeCheckoutError(
          "checkout-state-conflict",
          "Checkout state changed before the session could be saved.",
          500,
      );
    }
    transaction.set(reference, {
      sessionId: session.id,
      sessionUrl: session.url,
      sessionExpiresAt: timestampFactory.fromDate(
          new Date(Number(session.expires_at) * 1000),
      ),
      customerId: objectId(session.customer) || null,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: fieldValue.serverTimestamp(),
    }, {merge: true});
  });
}

async function validateReusableSession(stripe, sessionId, uid, customerId, billingConfiguration, now) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price", "subscription"],
  });
  assertStripeObjectMode(session, billingConfiguration, "checkout-session");
  assertUidMetadata(session, uid, "checkout session");
  if (session.mode !== "subscription") return null;
  const items = session.line_items && Array.isArray(session.line_items.data) ?
    session.line_items.data : [];
  const priceMatches = items.length === 1 &&
    objectId(items[0] && items[0].price) === billingConfiguration.proPriceId &&
    Number(items[0] && items[0].quantity || 1) === 1;
  if (!priceMatches) return null;
  if (session.status === "complete" && session.subscription) {
    const subscriptionId = objectId(session.subscription);
    const subscription = typeof session.subscription === "object" ?
      session.subscription : await retrieveOwnedSubscription(
          stripe, subscriptionId, uid, billingConfiguration,
      );
    assertStripeObjectMode(subscription, billingConfiguration, "subscription");
    assertUidMetadata(subscription, uid, "subscription");
    assertCustomerRelationship(subscription, objectId(session.customer));
    if (!subscriptionUsesConfiguredPrice(subscription, billingConfiguration)) {
      return null;
    }
    throw new StripeCheckoutError(
        "existing-subscription",
        "Checkout has already completed for this subscription.",
    );
  }
  if (session.status !== "open" || Number(session.expires_at) * 1000 <= now.getTime()) {
    return null;
  }
  const sessionCustomerId = objectId(session.customer);
  if (sessionCustomerId && sessionCustomerId !== customerId) return null;
  return session;
}

function createStripeCheckoutService(options = {}) {
  const {stripe, firestore, billingConfiguration, fieldValue, timestampFactory} = options;
  if (!stripe || !firestore || !billingConfiguration || !fieldValue ||
    !timestampFactory || typeof firestore.runTransaction !== "function") {
    throw new TypeError("Stripe checkout dependencies are incomplete.");
  }
  const nowProvider = options.now || (() => new Date());

  return async function createOrReuseCheckout({uid, profile, successUrl, cancelUrl}) {
    if (!billingConfiguration.checkoutEnabled) {
      throw new StripeCheckoutError(
          "checkout-disabled",
          "Checkout is temporarily unavailable.",
          503,
      );
    }
    const customerId = await ownedReusableCustomer(
        stripe, profile, uid, billingConfiguration,
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const now = new Date(nowProvider());
      const leaseToken = crypto.randomUUID();
      const lease = await acquireLease({
        firestore, uid, billingConfiguration, fieldValue,
        timestampFactory, now, leaseToken,
      });
      if (lease.state === "candidate") {
        const session = await validateReusableSession(
            stripe, lease.sessionId, uid, customerId,
            billingConfiguration, now,
        );
        if (session) return {session, reused: true};
        await invalidateCandidate({
          firestore, uid, sessionId: lease.sessionId, fieldValue,
        });
        continue;
      }
      try {
        const session = await stripe.checkout.sessions.create({
          mode: "subscription",
          line_items: [{price: billingConfiguration.proPriceId, quantity: 1}],
          success_url: successUrl,
          cancel_url: cancelUrl,
          client_reference_id: uid,
          metadata: {firebaseUid: uid},
          subscription_data: {metadata: {firebaseUid: uid}},
          ...(customerId ? {customer: customerId} : {}),
        }, {
          idempotencyKey: checkoutIdempotencyKey(
              uid, billingConfiguration, lease.generation,
          ),
        });
        assertStripeObjectMode(session, billingConfiguration, "checkout-session");
        assertUidMetadata(session, uid, "checkout session");
        if (!session.id || !session.url || !Number(session.expires_at)) {
          throw new StripeCheckoutError(
              "checkout-session-invalid",
              "Stripe returned an incomplete Checkout Session.",
              500,
          );
        }
        if (objectId(session.customer) && objectId(session.customer) !== customerId) {
          throw new StripeCheckoutError(
              "checkout-customer-invalid",
              "Stripe Checkout returned an unexpected customer.",
              500,
          );
        }
        await persistSession({
          firestore, uid, leaseToken, session, billingConfiguration,
          fieldValue, timestampFactory,
        });
        return {session, reused: false};
      } catch (error) {
        await releaseLease({firestore, uid, leaseToken, fieldValue});
        throw error;
      }
    }
    throw new StripeCheckoutError(
        "checkout-session-unavailable",
        "Checkout could not be prepared safely.",
        503,
    );
  };
}

module.exports = {
  CHECKOUT_LEASE_MS,
  StripeCheckoutError,
  acquireLease,
  checkoutIdempotencyKey,
  checkoutStateReference,
  createStripeCheckoutService,
  ownedReusableCustomer,
  timestampMillis,
  validateReusableSession,
};
