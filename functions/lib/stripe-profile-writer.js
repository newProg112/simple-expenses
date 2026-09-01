/* eslint-disable max-len, require-jsdoc */

"use strict";

const {createAccountDeletionGuard} = require("./account-deletion-guard");
const {
  PLAN_IDS,
  effectiveBillingPlan,
} = require("./plan-entitlements");

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

  return async function updateStripeProfile(uid, data, eventContext = {}) {
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
      return await firestore.runTransaction(async (transaction) => {
        const [accountSnapshot, profileSnapshot, eventSnapshot] =
          await Promise.all([
            transaction.get(accountReference),
            transaction.get(profileReference),
            eventReference ? transaction.get(eventReference) : null,
          ]);
        if (eventSnapshot && eventSnapshot.exists) {
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
            transaction.create(eventReference, {
              uid,
              result: "ignored-demo",
              processedAt: fieldValue.serverTimestamp(),
            });
          }
          return {updated: false, reason: "demo-account"};
        }
        const existing = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
        const incomingSubscriptionId = String(data.stripeSubscriptionId || "");
        const storedSubscriptionId = String(existing.stripeSubscriptionId || "");
        const incomingCreated = Number(data.stripeSubscriptionCreated || 0);
        const storedCreated = Number(existing.stripeSubscriptionCreated || 0);
        const staleDifferentSubscription = incomingSubscriptionId &&
          storedSubscriptionId && incomingSubscriptionId !== storedSubscriptionId &&
          storedCreated > 0 && incomingCreated > 0 && incomingCreated < storedCreated;
        if (staleDifferentSubscription) {
          if (eventReference) {
            transaction.create(eventReference, {
              uid,
              stripeSubscriptionId: incomingSubscriptionId,
              result: "ignored-stale-subscription",
              processedAt: fieldValue.serverTimestamp(),
            });
          }
          return {updated: false, reason: "stale-subscription"};
        }
        const candidate = {
          ...existing,
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
          subscriptionStatus: data.subscriptionStatus,
          stripeCustomerId: data.stripeCustomerId,
          stripeSubscriptionId: incomingSubscriptionId,
          stripeSubscriptionCreated: incomingCreated,
          stripePriceId: data.stripePriceId,
          stripeMode: data.stripeMode,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
          subscriptionCurrentPeriodEnd: data.subscriptionCurrentPeriodEnd || null,
          paymentMethodBrand: data.paymentMethodBrand || "",
          paymentMethodLast4: data.paymentMethodLast4 || "",
          subscriptionUpdatedAt: fieldValue.serverTimestamp(),
        }, {merge: true});
        if (eventReference) {
          transaction.create(eventReference, {
            uid,
            stripeSubscriptionId: incomingSubscriptionId,
            result: "updated",
            processedAt: fieldValue.serverTimestamp(),
          });
        }
        return {updated: true, reason: "updated"};
      });
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
  authUserMissing,
  createStripeProfileWriter,
  deletionInProgress,
};
