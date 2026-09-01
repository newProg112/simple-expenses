/* eslint-disable max-len, require-jsdoc */

"use strict";

const STRIPE_MODES = Object.freeze(["test", "live"]);
const TEST_PRO_PRICE_ID = "price_1TnLTCJmLqrFk5SqusEJiIhu";
const LIVE_PRO_PRICE_ID = "price_1UAwaZQwA8Uui39wNgjE9zNh";

class StripeBillingConfigurationError extends Error {
  constructor(reason) {
    super("Stripe billing configuration is invalid.");
    this.name = "StripeBillingConfigurationError";
    this.code = "stripe-configuration-invalid";
    this.reason = reason;
  }
}

function booleanConfiguration(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

function validateStripeBillingConfiguration(source = {}) {
  const expectedMode = String(source.expectedMode || "").trim().toLowerCase();
  const proPriceId = String(source.proPriceId || "").trim();
  if (!STRIPE_MODES.includes(expectedMode)) {
    throw new StripeBillingConfigurationError("expected-mode-invalid");
  }
  if (!/^price_[A-Za-z0-9]+$/.test(proPriceId)) {
    throw new StripeBillingConfigurationError("pro-price-invalid");
  }
  if (expectedMode === "live" && proPriceId !== LIVE_PRO_PRICE_ID) {
    throw new StripeBillingConfigurationError("live-price-mismatch");
  }
  if (expectedMode === "test" && proPriceId === LIVE_PRO_PRICE_ID) {
    throw new StripeBillingConfigurationError("test-price-is-live");
  }
  return Object.freeze({
    expectedMode,
    proPriceId,
    checkoutEnabled: booleanConfiguration(source.checkoutEnabled),
  });
}

function runtimeStripeBillingConfiguration(environment = process.env) {
  const expectedMode = String(environment.STRIPE_EXPECTED_MODE || "test")
      .trim().toLowerCase();
  return validateStripeBillingConfiguration({
    expectedMode,
    proPriceId: environment.STRIPE_PRO_PRICE_ID ||
      (expectedMode === "test" ? TEST_PRO_PRICE_ID : ""),
    checkoutEnabled: environment.STRIPE_CHECKOUT_ENABLED || false,
  });
}

function stripeSecretKeyMode(secretKey) {
  const prefix = String(secretKey || "").trim().split("_").slice(0, 2).join("_");
  if (prefix === "sk_test" || prefix === "rk_test") return "test";
  if (prefix === "sk_live" || prefix === "rk_live") return "live";
  return "";
}

function assertStripeSecretKeyMode(secretKey, billingConfiguration) {
  const mode = stripeSecretKeyMode(secretKey);
  if (!mode || mode !== billingConfiguration.expectedMode) {
    throw new StripeBillingConfigurationError("secret-key-mode-mismatch");
  }
}

function objectStripeMode(value) {
  return value && value.livemode === true ? "live" :
    value && value.livemode === false ? "test" : "";
}

function assertStripeObjectMode(value, billingConfiguration, label = "object") {
  if (objectStripeMode(value) !== billingConfiguration.expectedMode) {
    throw new StripeBillingConfigurationError(`${label}-mode-mismatch`);
  }
}

function assertConfiguredProPrice(price, billingConfiguration) {
  assertStripeObjectMode(price, billingConfiguration, "price");
  const recurring = price && price.recurring || {};
  if (!price || price.id !== billingConfiguration.proPriceId ||
    price.active !== true || price.type !== "recurring" ||
    price.currency !== "gbp" || Number(price.unit_amount) !== 1500 ||
    recurring.interval !== "month" || Number(recurring.interval_count) !== 1) {
    throw new StripeBillingConfigurationError("pro-price-details-mismatch");
  }
  return price;
}

module.exports = {
  LIVE_PRO_PRICE_ID,
  STRIPE_MODES,
  TEST_PRO_PRICE_ID,
  StripeBillingConfigurationError,
  assertStripeObjectMode,
  assertConfiguredProPrice,
  assertStripeSecretKeyMode,
  booleanConfiguration,
  objectStripeMode,
  runtimeStripeBillingConfiguration,
  stripeSecretKeyMode,
  validateStripeBillingConfiguration,
};
