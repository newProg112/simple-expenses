import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

const require = createRequire(import.meta.url);
const {
  authenticatedCheckoutIdentity,
  usableAuthEmail
} = require("../functions/lib/stripe-checkout-auth.js");

describe("Stripe Checkout authenticated identity", () => {
  it("uses only request.auth.token.email and ignores browser-provided email", () => {
    expect(authenticatedCheckoutIdentity({
      auth: {
        uid: "firebase-owner",
        token: {email: "trusted@example.test"}
      },
      data: {email: "attacker@example.test"}
    })).toEqual({
      uid: "firebase-owner",
      email: "trusted@example.test"
    });
  });

  it("rejects a missing authenticated context with HttpsError", () => {
    expect(() => authenticatedCheckoutIdentity({
      data: {email: "attacker@example.test"}
    })).toThrowError(expect.objectContaining({
      code: "unauthenticated"
    }));
  });

  it.each([undefined, null, "", "not-an-email", "two@@example.test", "space @example.test"])(
    "rejects unusable authenticated email %j with HttpsError",
    email => {
      expect(() => authenticatedCheckoutIdentity({
        auth: {uid: "firebase-owner", token: {email}}
      })).toThrowError(expect.objectContaining({
        code: "failed-precondition",
        details: {reason: "authenticated-email-required"}
      }));
    }
  );

  it("accepts and trims a usable verified-token email", () => {
    expect(usableAuthEmail("  test16@test.com ")).toBe("test16@test.com");
  });

  it("keeps the HTTP browser request email-free and adapts only the verified token", () => {
    const account = readFileSync(new URL("../account.html", import.meta.url), "utf8");
    const start = account.slice(
      account.indexOf("async function startStripeCheckout()"),
      account.indexOf("async function openBillingPortal()")
    );
    const functions = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
    const endpoint = functions.slice(
      functions.indexOf("exports.createCheckoutSession = onRequest("),
      functions.indexOf("exports.createBillingPortalSession = onRequest(")
    );
    expect(start).not.toMatch(/\bemail\b/i);
    expect(start).not.toContain("body:");
    expect(endpoint).toContain("token: decodedToken");
    expect(endpoint).not.toContain("request.body");
    expect(endpoint).toContain("authenticatedCheckoutIdentity({");
  });
});
