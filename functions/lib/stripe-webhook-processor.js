/* eslint-disable max-len, require-jsdoc */

"use strict";

const {assertStripeObjectMode} = require("./stripe-billing-config");
const {
  assertCustomerRelationship,
  assertUidMetadata,
  metadataUid,
  objectId,
  retrieveOwnedSubscription,
  subscriptionCustomerId,
  subscriptionPriceIds,
  subscriptionUsesConfiguredPrice,
} = require("./stripe-object-validation");
const {stripeSubscriptionStatus} = require("./stripe-subscription-status");

const STRIPE_WEBHOOK_EVENT_TYPES = Object.freeze([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const supportedEvents = new Set(STRIPE_WEBHOOK_EVENT_TYPES);

function validEventId(value) {
  return typeof value === "string" && /^evt_[A-Za-z0-9]+$/.test(value);
}

function eventUid(value) {
  return metadataUid(value) || String(value && value.client_reference_id || "");
}

function createStripeWebhookProcessor(options = {}) {
  const {stripe, billingConfiguration, updateProfile, billingDetails} = options;
  if (!stripe || !billingConfiguration || typeof updateProfile !== "function" ||
    typeof billingDetails !== "function") {
    throw new TypeError("Stripe webhook dependencies are incomplete.");
  }
  return async function processStripeWebhook(event) {
    if (!validEventId(event && event.id)) {
      const error = new Error("Stripe webhook event ID is invalid.");
      error.code = "stripe-event-invalid";
      throw error;
    }
    assertStripeObjectMode(event, billingConfiguration, "event");
    if (!supportedEvents.has(event.type)) {
      return {handled: false, reason: "unsupported-event"};
    }

    let subscription;
    let uid;
    if (event.type === "checkout.session.completed") {
      const session = event.data && event.data.object;
      assertStripeObjectMode(session, billingConfiguration, "checkout-session");
      uid = eventUid(session);
      assertUidMetadata(session, uid, "checkout session");
      if (session.mode !== "subscription" || !session.subscription ||
        !session.customer) {
        const error = new Error("Checkout Session subscription ownership is incomplete.");
        error.code = "stripe-ownership-invalid";
        throw error;
      }
      subscription = await retrieveOwnedSubscription(
          stripe,
          objectId(session.subscription),
          uid,
          billingConfiguration,
      );
      assertCustomerRelationship(subscription, objectId(session.customer));
    } else {
      const eventSubscription = event.data && event.data.object;
      assertStripeObjectMode(
          eventSubscription, billingConfiguration, "subscription-event",
      );
      uid = metadataUid(eventSubscription);
      assertUidMetadata(eventSubscription, uid, "subscription event");
      subscription = await retrieveOwnedSubscription(
          stripe,
          objectId(eventSubscription),
          uid,
          billingConfiguration,
      );
    }

    const prices = subscriptionPriceIds(subscription);
    const configuredPrice = subscriptionUsesConfiguredPrice(
        subscription, billingConfiguration,
    );
    const solePriceId = prices.length === 1 ? prices[0] : "";
    const storedPriceId = solePriceId === billingConfiguration.proPriceId &&
      !configuredPrice ? "" : solePriceId;
    const details = await billingDetails(stripe, subscription);
    const profileUpdate = await updateProfile(uid, {
      subscriptionStatus: stripeSubscriptionStatus(subscription),
      stripeCustomerId: subscriptionCustomerId(subscription),
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionCreated: Number(subscription.created || 0),
      stripePriceId: storedPriceId,
      stripeMode: billingConfiguration.expectedMode,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
      ...details,
    }, {
      eventId: event.id,
      eventCreated: Number(event.created || 0),
    });
    return {
      handled: true,
      eventType: event.type,
      uid,
      subscription,
      subscriptionStatus: stripeSubscriptionStatus(subscription),
      configuredPrice,
      profileUpdate,
    };
  };
}

module.exports = {
  STRIPE_WEBHOOK_EVENT_TYPES,
  createStripeWebhookProcessor,
  eventUid,
  validEventId,
};
