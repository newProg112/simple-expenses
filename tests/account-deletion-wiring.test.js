import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

const source = readFileSync(new URL("../functions/index.js", import.meta.url),
    "utf8");

function between(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("account-deletion production wiring", () => {
  it("guards Checkout before constructing or calling Stripe", () => {
    const checkout = between(
        "exports.createCheckoutSession",
        "exports.createBillingPortalSession",
    );
    const guard = checkout.indexOf(
        "accountDeletionGuard.assertAccountNotDeleting(decodedToken.uid)",
    );
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(checkout.indexOf("new Stripe("));
    expect(guard).toBeLessThan(checkout.indexOf("checkout.sessions.create"));
  });

  it("guards Billing Portal before creating a portal session", () => {
    const portal = between(
        "exports.createBillingPortalSession",
        "exports.stripeWebhook",
    );
    const guard = portal.indexOf(
        "accountDeletionGuard.assertAccountNotDeleting(decodedToken.uid)",
    );
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(portal.indexOf("billingPortal.sessions.create"));
  });

  it("injects the shared guard into privileged accounting mutations", () => {
    const foundation = between(
        "const accountDeletionGuard",
        "const stripeSecretKey",
    );
    expect(foundation.match(/deletionGuard: accountDeletionGuard/g))
        .toHaveLength(3);
  });

  it("exposes the protected, authenticated deletion callable", () => {
    expect(source).toContain("exports.requestAccountDeletion = onCall(");
    expect(source).toContain("protectedUidConfiguration: protectedUidsSecret.value()");
    expect(source).toContain("enqueueDeletionTask: enqueueAccountDeletion");
  });

  it("exposes only a non-public retrying task worker for destructive cleanup", () => {
    const worker = between(
        "exports.processAccountDeletion",
        "exports.requestAccountDeletion",
    );
    expect(worker).toContain("onTaskDispatched(");
    expect(worker).not.toMatch(/invoker\s*:/);
    expect(worker).not.toContain("onCall(");
    expect(worker).toContain("retryConfig:");
    expect(worker).toContain("createAccountDeletionWorker(");
  });

  it("exposes an authenticated minimal status callable for Phase 3 polling", () => {
    expect(source).toContain("exports.getAccountDeletionStatus = onCall(");
    expect(source).toContain("createGetAccountDeletionStatusHandler({firestore})");
  });
});
