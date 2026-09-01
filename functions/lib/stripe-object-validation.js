/* eslint-disable max-len, require-jsdoc */

"use strict";

const {assertStripeObjectMode} = require("./stripe-billing-config");
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
    Number(items[0] && items[0].quantity || 1) === 1;
}

function subscriptionEligibleForPro(subscription, billingConfiguration) {
  return subscriptionUsesConfiguredPrice(subscription, billingConfiguration) &&
    ["active", "trialing"].includes(stripeSubscriptionStatus(subscription));
}

function assertUidMetadata(value, uid, label) {
  if (!uid || metadataUid(value) !== uid) {
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
  const customer = await stripe.customers.retrieve(customerId);
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

async function retrieveOwnedSubscription(stripe, subscriptionId, uid, billingConfiguration) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["default_payment_method"],
  });
  assertStripeObjectMode(subscription, billingConfiguration, "subscription");
  assertUidMetadata(subscription, uid, "subscription");
  const customerId = subscriptionCustomerId(subscription);
  await retrieveOwnedCustomer(stripe, customerId, uid, billingConfiguration);
  return subscription;
}

function subscriptionAllowsPortal(subscription) {
  return isBillingPortalStatus(stripeSubscriptionStatus(subscription));
}

module.exports = {
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
