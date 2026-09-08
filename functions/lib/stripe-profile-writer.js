/* eslint-disable max-len, require-jsdoc */

"use strict";

const {createAccountDeletionGuard} = require("./account-deletion-guard");
const {
  PLAN_IDS,
  effectiveBillingPlan,
  hasValidBillingOverride,
} = require("./plan-entitlements");

const STRIPE_PROFILE_PROJECTION_VERSION = 2;
const MAX_PROJECTION_ATTEMPTS = 3;

function projectionRevision(profile) {
  const revision = profile.stripeProjectionRevision === undefined ? 0 :
    profile.stripeProjectionRevision;
  if (!Number.isSafeInteger(revision) || revision < 0 ||
    revision === Number.MAX_SAFE_INTEGER) {
    throw new Error("Invalid Stripe projection revision.");
  }
  return revision;
}

function authUserMissing(error) {
  return String(error && error.code || "") === "auth/user-not-found";
}

function deletionInProgress(error) {
  return Boolean(error && error.details &&
    error.details.reason === "account-deletion-in-progress");
}

function createStripeProfileWriter(options = {}) {
  const firestore = options.firestore;
  const auth = options.auth;
  const fieldValue = options.fieldValue;
  const log = options.logger || console;
  if (!firestore || typeof firestore.runTransaction !== "function" ||
    !auth || typeof auth.getUser !== "function" ||
    !fieldValue || typeof fieldValue.serverTimestamp !== "function") {
    throw new TypeError("Stripe profile writer dependencies are incomplete.");
  }
  const deletionGuard = options.deletionGuard ||
    createAccountDeletionGuard(firestore);
  const billingConfiguration = options.billingConfiguration;

  return async function updateStripeProfile(uid, initialData, eventContext = {}) {
    try {
      await auth.getUser(uid);
    } catch (error) {
      if (authUserMissing(error)) {
        log.warn("Ignoring Stripe profile update for deleted Auth user", {uid});
        return {updated: false, reason: "auth-user-not-found"};
      }
      throw error;
    }

    const profileReference = firestore.collection("userProfiles").doc(uid);
    const accountReference = firestore.collection("users").doc(uid);
    const eventId = String(eventContext.eventId || "");
    const eventReference = eventId ?
      firestore.collection("stripeWebhookEvents").doc(eventId) : null;
    try {
      for (let attempt = 0; attempt < MAX_PROJECTION_ATTEMPTS; attempt++) {
        // Observe the billing revision BEFORE starting the canonical read. No
        // Stripe calls run in a Firestore callback. Only this writer advances it.
        const before = await profileReference.get();
        const revision = projectionRevision(before.exists ? before.data() || {} : {});
        const data = typeof eventContext.refreshData === "function" ?
          await eventContext.refreshData() : initialData;
        const result = await firestore.runTransaction(async (transaction) => {
          const [accountSnapshot, profileSnapshot, eventSnapshot] =
            await Promise.all([
              transaction.get(accountReference),
              transaction.get(profileReference),
              eventReference ? transaction.get(eventReference) : null,
            ]);
          const eventReceipt = eventSnapshot && eventSnapshot.exists ?
            eventSnapshot.data() || {} : {};
          if (eventSnapshot && eventSnapshot.exists &&
            Number(eventReceipt.profileProjectionVersion || 0) >=
              STRIPE_PROFILE_PROJECTION_VERSION) {
            return {updated: false, reason: "duplicate-event"};
          }
          await deletionGuard.assertAccountNotDeletingInTransaction(
              transaction,
              uid,
              accountSnapshot,
          );
          if (accountSnapshot.exists && accountSnapshot.data().demoMode === true) {
            log.warn("Ignoring subscription update for demo account", {uid});
            if (eventReference) {
              transaction.set(eventReference, {
                uid,
                result: "ignored-demo",
                profileProjectionVersion: STRIPE_PROFILE_PROJECTION_VERSION,
                processedAt: fieldValue.serverTimestamp(),
              });
            }
            return {updated: false, reason: "demo-account"};
          }
          const existing = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
          // A competing projection invalidates this canonical read. Transaction
          // retries only repeat this comparison, never repeat remote API calls.
          if (projectionRevision(existing) !== revision) return {conflict: true};
          const validOverride = hasValidBillingOverride(existing);
          const incomingSubscriptionId = String(data.stripeSubscriptionId || "");
          const storedSubscriptionId = String(existing.stripeSubscriptionId || "");
          const incomingCreated = Number(data.stripeSubscriptionCreated || 0);
          const storedCreated = Number(existing.stripeSubscriptionCreated || 0);
          if (eventContext.invoice === true &&
            data.stripePriceId !== billingConfiguration.proPriceId &&
            incomingSubscriptionId !== storedSubscriptionId) {
            // An invoice for another product must not replace this account's Pro
            // subscription. A price change on the stored subscription still revokes.
            return {updated: false, reason: "irrelevant-invoice"};
          }
          const staleDifferentSubscription = incomingSubscriptionId &&
            storedSubscriptionId && incomingSubscriptionId !== storedSubscriptionId &&
            storedCreated > 0 && incomingCreated > 0 && incomingCreated < storedCreated;
          if (incomingSubscriptionId && storedSubscriptionId &&
            incomingSubscriptionId !== storedSubscriptionId &&
            (!(incomingCreated > 0) || !(storedCreated > 0) ||
              incomingCreated === storedCreated)) {
            // Equal/missing timestamps cannot establish a replacement. Stay retryable.
            throw new Error("Ambiguous Stripe subscription replacement.");
          }
          if (staleDifferentSubscription) {
            if (eventReference) {
              transaction.set(eventReference, {
                uid,
                stripeSubscriptionId: incomingSubscriptionId,
                result: "ignored-stale-subscription",
                profileProjectionVersion: STRIPE_PROFILE_PROJECTION_VERSION,
                processedAt: fieldValue.serverTimestamp(),
              });
            }
            return {updated: false, reason: "stale-subscription"};
          }
          const candidate = {
            ...existing,
            billingOverride: validOverride,
            currentPlan: PLAN_IDS.PRO,
            subscriptionStatus: data.subscriptionStatus,
            stripeCustomerId: data.stripeCustomerId,
            stripeSubscriptionId: incomingSubscriptionId,
            stripeSubscriptionCreated: incomingCreated,
            stripePriceId: data.stripePriceId,
            stripeMode: data.stripeMode,
          };
          const currentPlan = effectiveBillingPlan(
              candidate,
              false,
              billingConfiguration,
          );
          transaction.set(profileReference, {
            currentPlan,
            stripeProjectionRevision: revision + 1,
            billingOverride: validOverride,
            subscriptionStatus: data.subscriptionStatus,
            stripeCustomerId: data.stripeCustomerId,
            stripeSubscriptionId: incomingSubscriptionId,
            stripeSubscriptionCreated: incomingCreated,
            stripePriceId: data.stripePriceId,
            stripeMode: data.stripeMode,
            cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
            subscriptionCancelAt: data.subscriptionCancelAt || null,
            subscriptionCurrentPeriodEnd: data.subscriptionCurrentPeriodEnd || null,
            paymentMethodBrand: data.paymentMethodBrand || "",
            paymentMethodLast4: data.paymentMethodLast4 || "",
            subscriptionUpdatedAt: fieldValue.serverTimestamp(),
          }, {merge: true});
          if (eventReference) {
            transaction.set(eventReference, {
              uid,
              stripeSubscriptionId: incomingSubscriptionId,
              result: "updated",
              profileProjectionVersion: STRIPE_PROFILE_PROJECTION_VERSION,
              processedAt: fieldValue.serverTimestamp(),
            });
          }
          return {updated: true, reason: "updated"};
        }, {maxAttempts: 3});
        if (!result.conflict) return result;
        if (typeof eventContext.refreshData !== "function") break;
      }
      // No receipt is committed on contention exhaustion; webhook delivery retries.
      throw new Error("Stripe projection contention; retry canonical reconciliation.");
    } catch (error) {
      if (deletionInProgress(error)) {
        log.warn("Ignoring Stripe profile update during account deletion", {uid});
        return {updated: false, reason: "account-deletion-in-progress"};
      }
      throw error;
    }
  };
}

module.exports = {
  STRIPE_PROFILE_PROJECTION_VERSION,
  authUserMissing,
  createStripeProfileWriter,
  deletionInProgress,
};
