/* eslint-disable max-len, require-jsdoc */

"use strict";

const {
  retrieveOwnedSubscription,
  subscriptionAllowsPortal,
  subscriptionCustomerId,
} = require("./stripe-object-validation");

class StripePortalError extends Error {
  constructor(code, message, httpStatus = 403) {
    super(message);
    this.name = "StripePortalError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function createStripePortalService(options = {}) {
  const {stripe, billingConfiguration} = options;
  if (!stripe || !billingConfiguration) {
    throw new TypeError("Stripe portal dependencies are incomplete.");
  }
  return async function createPortal({uid, profile, returnUrl}) {
    if (!profile || profile.billingOverride === true ||
      profile.stripeMode !== billingConfiguration.expectedMode ||
      typeof profile.stripeSubscriptionId !== "string" ||
      !profile.stripeSubscriptionId.trim()) {
      throw new StripePortalError(
          "portal-unavailable",
          "Billing Portal is unavailable for this account.",
      );
    }
    const subscription = await retrieveOwnedSubscription(
        stripe,
        profile.stripeSubscriptionId,
        uid,
        billingConfiguration,
    );
    if (!subscriptionAllowsPortal(subscription)) {
      throw new StripePortalError(
          "portal-unavailable",
          "Billing Portal is unavailable for this subscription.",
      );
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: subscriptionCustomerId(subscription),
      return_url: returnUrl,
    });
    if (!session || !session.url) {
      throw new StripePortalError(
          "portal-session-invalid",
          "Stripe returned an incomplete Billing Portal Session.",
          500,
      );
    }
    return {session, subscription};
  };
}

module.exports = {
  StripePortalError,
  createStripePortalService,
};
