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
  STRIPE_READ_OPTIONS,
} = require("./stripe-object-validation");
const {stripeSubscriptionStatus} = require("./stripe-subscription-status");

const STRIPE_WEBHOOK_EVENT_TYPES = Object.freeze([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
  "invoice.payment_succeeded",
]);
const supportedEvents = new Set(STRIPE_WEBHOOK_EVENT_TYPES);

function validEventId(value) {
  return typeof value === "string" && /^evt_[A-Za-z0-9]+$/.test(value);
}

function eventUid(value) {
  return metadataUid(value) || String(value && value.client_reference_id || "");
}

// Supports the installed Stripe API's parent shape and older webhook payloads.
function invoiceSubscriptionId(invoice) {
  if (!invoice || invoice.deleted === true) return "";
  const parent = invoice.parent;
  if (parent && parent.type !== "subscription_details") return "";
  const modern = parent && parent.subscription_details && parent.subscription_details.subscription;
  const legacy = invoice.subscription;
  if (modern && legacy && objectId(modern) !== objectId(legacy)) return "";
  const reference = parent ? modern : legacy;
  const id = objectId(reference);
  return reference && reference.deleted !== true && /^sub_[A-Za-z0-9]+$/.test(id) ? id : "";
}

function createSubscriptionProjectionReader({
  stripe, billingConfiguration, billingDetails, uid, subscriptionId, customerId,
}) {
  return async function readProjection() {
    const subscription = await retrieveOwnedSubscription(
        stripe, subscriptionId, uid, billingConfiguration, STRIPE_READ_OPTIONS,
    );
    if (customerId) assertCustomerRelationship(subscription, customerId);
    const prices = subscriptionPriceIds(subscription);
    const configuredPrice = subscriptionUsesConfiguredPrice(subscription, billingConfiguration);
    const solePriceId = prices.length === 1 ? prices[0] : "";
    return {
      subscription,
      configuredPrice,
      data: {
        subscriptionStatus: stripeSubscriptionStatus(subscription),
        stripeCustomerId: subscriptionCustomerId(subscription),
        stripeSubscriptionId: subscription.id,
        stripeSubscriptionCreated: Number(subscription.created || 0),
        stripePriceId: solePriceId === billingConfiguration.proPriceId &&
          !configuredPrice ? "" : solePriceId,
        stripeMode: billingConfiguration.expectedMode,
        cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        ...await billingDetails(stripe, subscription),
      },
    };
  };
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

    let subscriptionId;
    let uid;
    let expectedCustomerId;
    if (event.type.startsWith("invoice.")) {
      const invoice = event.data && event.data.object;
      if (!invoice || typeof invoice !== "object" || invoice.deleted === true) {
        return {handled: false, reason: "irrelevant-invoice"};
      }
      assertStripeObjectMode(invoice, billingConfiguration, "invoice");
      subscriptionId = invoiceSubscriptionId(invoice);
      if (!subscriptionId) return {handled: false, reason: "non-subscription-invoice"};
      // Invoice metadata/payment fields are not entitlement or ownership evidence.
      let subscription;
      try {
        subscription = await stripe.subscriptions.retrieve(subscriptionId, {}, STRIPE_READ_OPTIONS);
      } catch (error) {
        if (error.code === "resource_missing" && error.type === "StripeInvalidRequestError") {
          return {handled: false, reason: "missing-invoice-subscription"};
        }
        throw error;
      }
      if (!subscription || subscription.deleted === true) {
        return {handled: false, reason: "missing-invoice-subscription"};
      }
      assertStripeObjectMode(subscription, billingConfiguration, "subscription");
      uid = metadataUid(subscription);
      if (!uid) return {handled: false, reason: "unowned-subscription-invoice"};
      assertUidMetadata(subscription, uid, "invoice subscription");
      expectedCustomerId = objectId(invoice.customer);
      assertCustomerRelationship(subscription, expectedCustomerId);
    } else if (event.type === "checkout.session.completed") {
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
      subscriptionId = objectId(session.subscription);
      expectedCustomerId = objectId(session.customer);
    } else {
      const eventSubscription = event.data && event.data.object;
      assertStripeObjectMode(
          eventSubscription, billingConfiguration, "subscription-event",
      );
      uid = metadataUid(eventSubscription);
      assertUidMetadata(eventSubscription, uid, "subscription event");
      subscriptionId = objectId(eventSubscription);
      expectedCustomerId = subscriptionCustomerId(eventSubscription);
    }

    const readProjection = createSubscriptionProjectionReader({
      stripe, billingConfiguration, billingDetails, uid,
      subscriptionId,
      customerId: expectedCustomerId,
    });
    let projection;
    const profileUpdate = await updateProfile(uid, null, {
      eventId: event.id,
      eventCreated: Number(event.created || 0),
      invoice: event.type.startsWith("invoice."),
      refreshData: async () => {
        projection = await readProjection();
        return projection.data;
      },
    });
    return {
      handled: true,
      eventType: event.type,
      uid,
      subscription: projection && projection.subscription,
      subscriptionStatus: projection ? projection.data.subscriptionStatus : "",
      configuredPrice: projection ? projection.configuredPrice : false,
      profileUpdate,
    };
  };
}

module.exports = {
  STRIPE_WEBHOOK_EVENT_TYPES,
  createStripeWebhookProcessor,
  createSubscriptionProjectionReader,
  invoiceSubscriptionId,
  eventUid,
  validEventId,
};
