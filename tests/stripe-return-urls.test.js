import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  EMULATOR_STRIPE_FRONTEND_ORIGIN,
  PRODUCTION_STRIPE_FRONTEND_ORIGIN,
  stripeBillingReturnUrls
} = require("../functions/lib/stripe-return-urls.js");
const {
  TEST_PRO_PRICE_ID
} = require("../functions/lib/stripe-billing-config.js");

describe("Stripe billing return URLs", () => {
  it("uses the fixed localhost rehearsal URLs only in the Functions Emulator", () => {
    expect(stripeBillingReturnUrls({ FUNCTIONS_EMULATOR: "true" })).toEqual({
      emulator: true,
      frontendOrigin: EMULATOR_STRIPE_FRONTEND_ORIGIN,
      successUrl: "http://localhost:5500/account.html?checkout=success",
      cancelUrl: "http://localhost:5500/account.html?checkout=cancelled",
      billingPortalReturnUrl: "http://localhost:5500/account.html"
    });
  });

  it("preserves production URLs and ignores rehearsal overrides outside the emulator", () => {
    expect(stripeBillingReturnUrls({
      FUNCTIONS_EMULATOR: "false",
      STRIPE_REHEARSAL_FRONTEND_ORIGIN: "http://127.0.0.1:9999"
    })).toEqual({
      emulator: false,
      frontendOrigin: PRODUCTION_STRIPE_FRONTEND_ORIGIN,
      successUrl: "https://simple-books.co.uk/account.html?checkout=success",
      cancelUrl: "https://simple-books.co.uk/account.html?checkout=cancelled",
      billingPortalReturnUrl: "https://simple-books.co.uk/account.html"
    });
  });

  it.each([
    "https://example.com",
    "https://localhost:5500",
    "http://example.com:5500",
    "http://localhost:5500/elsewhere",
    "http://localhost:5500/?next=https://example.com"
  ])("rejects unsafe emulator rehearsal origin %s", value => {
    expect(() => stripeBillingReturnUrls({
      FUNCTIONS_EMULATOR: "true",
      STRIPE_REHEARSAL_FRONTEND_ORIGIN: value
    })).toThrowError(expect.objectContaining({
      code: "stripe-return-url-invalid"
    }));
  });

  it("uses only server runtime configuration for handler URLs and local portal CORS", () => {
    const source = readFileSync(
      new URL("../functions/index.js", import.meta.url),
      "utf8"
    );
    expect(source).toContain(
      "const stripeBillingUrls = stripeBillingReturnUrls(process.env);"
    );
    expect(source).toContain("successUrl: stripeBillingUrls.successUrl");
    expect(source).toContain("cancelUrl: stripeBillingUrls.cancelUrl");
    expect(source).toContain(
      "returnUrl: stripeBillingUrls.billingPortalReturnUrl"
    );
    expect(source).not.toMatch(
      /request\.(?:body|query).*?(?:successUrl|cancelUrl|returnUrl)/s
    );
  });

  it("keeps deployed checkout disabled and the local rehearsal test-only", () => {
    const deployed = readFileSync(
      new URL("../functions/.env.simple-books-office", import.meta.url),
      "utf8"
    );
    expect(deployed).toMatch(/^STRIPE_EXPECTED_MODE=live$/m);
    expect(deployed).toMatch(/^STRIPE_CHECKOUT_ENABLED=false$/m);

    const local = readFileSync(
      new URL("../functions/.env.local", import.meta.url),
      "utf8"
    );
    expect(local).toMatch(/^STRIPE_EXPECTED_MODE=test$/m);
    expect(local).toMatch(new RegExp(`^STRIPE_PRO_PRICE_ID=${TEST_PRO_PRICE_ID}$`, "m"));
    expect(local).toMatch(/^STRIPE_CHECKOUT_ENABLED=(?:true|false)$/m);
  });
});
