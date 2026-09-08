/* eslint-disable max-len, require-jsdoc */

"use strict";

const {assertStripeObjectMode} = require("./stripe-billing-config");
const {isProEligibleSubscriptionStatus} = require("./plan-entitlements");
const STRIPE_READ_OPTIONS = Object.freeze({timeout: 3000, maxNetworkRetries: 0});
const {
  isBillingPortalStatus,
  stripeSubscriptionStatus,
} = require("./stripe-subscription-status");

function objectId(value) {
  return typeof value === "string" ? value :
    value && typeof value.id === "string" ? value.id : "";
}

function metadataUid(value) {
  return String(value && value.metadata && value.metadata.firebaseUid || "");
}

function subscriptionCustomerId(subscription) {
  return objectId(subscription && subscription.customer);
}

function subscriptionItems(subscription) {
  return subscription && subscription.items &&
    Array.isArray(subscription.items.data) ? subscription.items.data : [];
}

function subscriptionPriceIds(subscription) {
  return subscriptionItems(subscription)
      .map((item) => objectId(item && item.price))
      .filter(Boolean);
}

function subscriptionUsesConfiguredPrice(subscription, billingConfiguration) {
  const items = subscriptionItems(subscription);
  return items.length === 1 &&
    objectId(items[0] && items[0].price) === billingConfiguration.proPriceId &&
    items[0].quantity === 1;
}

function subscriptionEligibleForPro(subscription, billingConfiguration) {
  return subscriptionUsesConfiguredPrice(subscription, billingConfiguration) &&
    isProEligibleSubscriptionStatus(stripeSubscriptionStatus(subscription));
}

function assertUidMetadata(value, uid, label) {
  if (typeof uid !== "string" || !uid.trim() || uid.length > 128 ||
    uid.includes("/") || metadataUid(value) !== uid) {
    const error = new Error(`Stripe ${label} ownership could not be verified.`);
    error.code = "stripe-ownership-invalid";
    throw error;
  }
}

function assertCustomerRelationship(subscription, customerId) {
  if (!customerId || subscriptionCustomerId(subscription) !== customerId) {
    const error = new Error("Stripe subscription customer ownership is invalid.");
    error.code = "stripe-ownership-invalid";
    throw error;
  }
}

async function retrieveOwnedCustomer(stripe, customerId, uid, billingConfiguration, options = {}) {
  const customer = await stripe.customers.retrieve(customerId, {}, options.requestOptions);
  if (!customer || customer.deleted === true) {
    const error = new Error("Stripe customer is unavailable.");
    error.code = "stripe-customer-unavailable";
    throw error;
  }
  assertStripeObjectMode(customer, billingConfiguration, "customer");
  const owner = metadataUid(customer);
  if (owner && owner !== uid) {
    const error = new Error("Stripe customer ownership is invalid.");
    error.code = "stripe-ownership-invalid";
    throw error;
  }
  if (options.requireDirectOwnership === true && owner !== uid) {
    const error = new Error("Stripe customer ownership is unproven.");
    error.code = "stripe-ownership-unproven";
    throw error;
  }
  return customer;
}

async function retrieveOwnedSubscription(stripe, subscriptionId, uid, billingConfiguration, requestOptions) {
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
    throw new Error("Invalid Stripe subscription reference.");
  }
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["default_payment_method"],
  }, requestOptions);
  if (!subscription || subscription.deleted === true) {
    const error = new Error("Stripe subscription is unavailable.");
    error.code = "stripe-subscription-unavailable";
    throw error;
  }
  if (subscription.id !== subscriptionId) throw new Error("Stripe subscription identity mismatch.");
  assertStripeObjectMode(subscription, billingConfiguration, "subscription");
  assertUidMetadata(subscription, uid, "subscription");
  const customerId = subscriptionCustomerId(subscription);
  await retrieveOwnedCustomer(stripe, customerId, uid, billingConfiguration, {requestOptions});
  return subscription;
}

function subscriptionAllowsPortal(subscription) {
  return isBillingPortalStatus(stripeSubscriptionStatus(subscription));
}

module.exports = {
  STRIPE_READ_OPTIONS,
  assertCustomerRelationship,
  assertUidMetadata,
  metadataUid,
  objectId,
  retrieveOwnedCustomer,
  retrieveOwnedSubscription,
  subscriptionAllowsPortal,
  subscriptionCustomerId,
  subscriptionEligibleForPro,
  subscriptionItems,
  subscriptionPriceIds,
  subscriptionUsesConfiguredPrice,
};
