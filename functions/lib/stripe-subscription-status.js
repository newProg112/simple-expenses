"use strict";

const STRIPE_SUBSCRIPTION_STATUSES = Object.freeze([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

const stripeStatuses = new Set(STRIPE_SUBSCRIPTION_STATUSES);

/**
 * Preserves a supported Stripe subscription status.
 * @param {*} subscription Stripe subscription object.
 * @return {string} Supported status, or an empty string.
 */
function stripeSubscriptionStatus(subscription) {
  const status = subscription && typeof subscription.status === "string" ?
    subscription.status :
    "";
  return stripeStatuses.has(status) ? status : "";
}

/**
 * Preserves the old portal availability for known non-canceled statuses.
 * @param {*} status Stored subscription status.
 * @return {boolean} Whether Stripe billing management remains available.
 */
function isBillingPortalStatus(status) {
  return stripeStatuses.has(status) && status !== "canceled";
}

module.exports = {
  STRIPE_SUBSCRIPTION_STATUSES,
  isBillingPortalStatus,
  stripeSubscriptionStatus,
};
