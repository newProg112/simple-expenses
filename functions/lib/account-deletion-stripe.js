/* eslint-disable max-len, require-jsdoc */

"use strict";

const crypto = require("node:crypto");
const {AccountDeletionError} = require("./account-deletion-error");

const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

function objectId(value) {
  if (typeof value === "string") return value;
  return value && typeof value.id === "string" ? value.id : "";
}

function metadataUid(value) {
  return String(value && value.metadata && value.metadata.firebaseUid || "");
}

function belongsDirectlyToUid(value, uid) {
  return metadataUid(value) === uid ||
    String(value && value.client_reference_id || "") === uid;
}

function idempotencyKey(uid, action, id) {
  return `simple-books-delete-${action}-${crypto.createHash("sha256")
      .update(`${uid}:${id}`).digest("hex").slice(0, 32)}`;
}

async function listAll(list, parameters = {}) {
  const results = [];
  let startingAfter;
  let hasMore = true;
  while (hasMore) {
    const page = await list({
      ...parameters,
      limit: 100,
      ...(startingAfter ? {starting_after: startingAfter} : {}),
    });
    const data = Array.isArray(page && page.data) ? page.data : [];
    results.push(...data);
    hasMore = Boolean(page && page.has_more);
    if (!hasMore) break;
    if (!data.length || !objectId(data[data.length - 1])) {
      throw new AccountDeletionError("stripe-pagination-invalid");
    }
    startingAfter = objectId(data[data.length - 1]);
  }
  return results;
}

function addStoredIdentifiers(profile, customers, subscriptions) {
  const customerId = objectId(profile && profile.stripeCustomerId);
  const subscriptionId = objectId(profile && profile.stripeSubscriptionId);
  if (customerId) customers.add(customerId);
  if (subscriptionId) subscriptions.add(subscriptionId);
}

async function discoverStripeResources(stripe, uid, profile = {}) {
  const customerIds = new Set();
  const subscriptionIds = new Set();
  const sessionsById = new Map();
  const subscriptionsById = new Map();
  addStoredIdentifiers(profile, customerIds, subscriptionIds);

  const [customers, subscriptions, sessions] = await Promise.all([
    listAll((parameters) => stripe.customers.list(parameters)),
    listAll((parameters) => stripe.subscriptions.list({status: "all", ...parameters})),
    listAll((parameters) => stripe.checkout.sessions.list(parameters)),
  ]);

  for (const customer of customers) {
    if (belongsDirectlyToUid(customer, uid)) customerIds.add(objectId(customer));
  }
  for (const subscription of subscriptions) {
    const customerId = objectId(subscription.customer);
    if (belongsDirectlyToUid(subscription, uid) || customerIds.has(customerId)) {
      subscriptionIds.add(objectId(subscription));
      subscriptionsById.set(objectId(subscription), subscription);
      if (customerId) customerIds.add(customerId);
    }
  }
  for (const session of sessions) {
    const customerId = objectId(session.customer);
    if (belongsDirectlyToUid(session, uid) || customerIds.has(customerId)) {
      sessionsById.set(objectId(session), session);
      if (customerId) customerIds.add(customerId);
      const subscriptionId = objectId(session.subscription);
      if (subscriptionId) subscriptionIds.add(subscriptionId);
    }
  }

  for (const subscriptionId of subscriptionIds) {
    if (!subscriptionsById.has(subscriptionId)) {
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        subscriptionsById.set(subscriptionId, subscription);
      } catch (error) {
        if (String(error && error.code || "") !== "resource_missing") throw error;
      }
    }
  }
  return {customerIds, subscriptionIds, sessionsById, subscriptionsById};
}

function createStripeAccountDeletionService(options = {}) {
  if (!options.stripe || !options.firestore) {
    throw new TypeError("Stripe deletion dependencies are incomplete.");
  }
  const stripe = options.stripe;
  const profiles = options.firestore.collection("userProfiles");

  return async function reconcileStripe(uid) {
    try {
      const profileSnapshot = await profiles.doc(uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
      const resources = await discoverStripeResources(stripe, uid, profile);
      for (const session of resources.sessionsById.values()) {
        if (session.status === "open") {
          await stripe.checkout.sessions.expire(session.id, {}, {
            idempotencyKey: idempotencyKey(uid, "expire-session", session.id),
          });
        }
      }
      for (const [subscriptionId, subscription] of resources.subscriptionsById) {
        if (!TERMINAL_SUBSCRIPTION_STATUSES.has(String(subscription.status || ""))) {
          await stripe.subscriptions.cancel(subscriptionId, {}, {
            idempotencyKey: idempotencyKey(uid, "cancel-subscription", subscriptionId),
          });
        }
      }
      const verification = await discoverStripeResources(stripe, uid, profile);
      const openSession = [...verification.sessionsById.values()]
          .some((session) => session.status === "open");
      const liveSubscription = [...verification.subscriptionsById.values()]
          .some((subscription) => !TERMINAL_SUBSCRIPTION_STATUSES.has(String(subscription.status || "")));
      if (openSession || liveSubscription) {
        throw new AccountDeletionError("stripe-reconciliation-incomplete");
      }
      return {
        customersRetained: verification.customerIds.size,
        sessionsReconciled: resources.sessionsById.size,
        subscriptionsReconciled: resources.subscriptionsById.size,
      };
    } catch (error) {
      if (error instanceof AccountDeletionError) throw error;
      throw new AccountDeletionError("stripe-cleanup-failed");
    }
  };
}

module.exports = {
  TERMINAL_SUBSCRIPTION_STATUSES,
  belongsDirectlyToUid,
  createStripeAccountDeletionService,
  discoverStripeResources,
  idempotencyKey,
  listAll,
};
