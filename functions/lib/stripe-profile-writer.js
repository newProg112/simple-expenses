/* eslint-disable max-len, require-jsdoc */

"use strict";

const {createAccountDeletionGuard} = require("./account-deletion-guard");

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

  return async function updateStripeProfile(uid, data) {
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
    try {
      return await firestore.runTransaction(async (transaction) => {
        const accountSnapshot = await transaction.get(accountReference);
        await deletionGuard.assertAccountNotDeletingInTransaction(
            transaction,
            uid,
            accountSnapshot,
        );
        if (accountSnapshot.exists && accountSnapshot.data().demoMode === true) {
          log.warn("Ignoring subscription update for demo account", {uid});
          return {updated: false, reason: "demo-account"};
        }
        transaction.set(profileReference, {
          currentPlan: "Pro",
          subscriptionStatus: data.subscriptionStatus,
          stripeCustomerId: data.stripeCustomerId,
          stripeSubscriptionId: data.stripeSubscriptionId,
          stripePriceId: data.stripePriceId,
          subscriptionCurrentPeriodEnd: data.subscriptionCurrentPeriodEnd || null,
          paymentMethodBrand: data.paymentMethodBrand || "",
          paymentMethodLast4: data.paymentMethodLast4 || "",
          subscriptionUpdatedAt: fieldValue.serverTimestamp(),
        }, {merge: true});
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
