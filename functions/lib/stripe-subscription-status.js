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
  let status = subscription && typeof subscription.status === "string" ?
    subscription.status :
    "";
  if (status === "cancelled") status = "canceled";
  return stripeStatuses.has(status) ? status : "";
}

/**
 * Preserves the old portal availability for known non-canceled statuses.
 * @param {*} status Stored subscription status.
 * @return {boolean} Whether Stripe billing management remains available.
 */
function isBillingPortalStatus(status) {
  const normalized = stripeSubscriptionStatus({status});
  return stripeStatuses.has(normalized) &&
    normalized !== "canceled" && normalized !== "incomplete_expired";
}

module.exports = {
  STRIPE_SUBSCRIPTION_STATUSES,
  isBillingPortalStatus,
  stripeSubscriptionStatus,
};
