"use strict";

const {
  calendarMonthKey,
  effectiveProductPlan,
  getMonthlyLimit,
  MONTHLY_LIMIT_IDS,
  normaliseUsageCount,
  remainingMonthlyAllowance,
} = require("./plan-entitlements");

/**
 * Reads a user's current UTC monthly usage without writing any data.
 * @param {object} firestore Firestore service.
 * @param {string} uid Authenticated Firebase UID.
 * @param {Date} date Current server date.
 * @return {Promise<object>} Normalized monthly usage.
 */
async function readMonthlyUsage(firestore, uid, date = new Date()) {
  if (!firestore || typeof firestore.collection !== "function") {
    throw new TypeError("A Firestore service is required.");
  }
  if (typeof uid !== "string" || !uid || uid.includes("/")) {
    throw new TypeError("A valid Firebase UID is required.");
  }

  const monthKey = calendarMonthKey(date);
  const accountReference = firestore.collection("users").doc(uid);
  const profileReference = firestore.collection("userProfiles").doc(uid);
  const [accountSnapshot, profileSnapshot, usageSnapshot] = await Promise.all([
    accountReference.get(),
    profileReference.get(),
    profileReference.collection("usage").doc(monthKey).get(),
  ]);
  const account = accountSnapshot.exists ? accountSnapshot.data() : {};
  const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
  const usage = usageSnapshot.exists ? usageSnapshot.data() : {};
  const demoMode = account.demoMode === true;
  const effectivePlan = effectiveProductPlan(profile.currentPlan, demoMode);
  const aiAssistantSuccessfulUses =
    normaliseUsageCount(usage.aiAssistantSuccessfulUses);
  const invoiceScanningSuccessfulUses =
    normaliseUsageCount(usage.invoiceScanningSuccessfulUses);
  const aiAssistantAllowance = getMonthlyLimit(
      effectivePlan,
      MONTHLY_LIMIT_IDS.AI_ASSISTANT,
  );
  const invoiceScanningAllowance = getMonthlyLimit(
      effectivePlan,
      MONTHLY_LIMIT_IDS.INVOICE_SCANNING,
  );

  return Object.freeze({
    monthKey,
    effectivePlan,
    displayPlan: demoMode ? "Pro Demo" : effectivePlan,
    entitlementSource: demoMode ? "demo-entitlement" : "billing-profile",
    demoMode,
    isDemo: demoMode,
    aiAssistantSuccessfulUses,
    aiAssistantAllowance,
    aiAssistantRemaining: remainingMonthlyAllowance(
        aiAssistantAllowance,
        aiAssistantSuccessfulUses,
    ),
    invoiceScanningSuccessfulUses,
    invoiceScanningAllowance,
    invoiceScanningRemaining: remainingMonthlyAllowance(
        invoiceScanningAllowance,
        invoiceScanningSuccessfulUses,
    ),
  });
}

module.exports = {
  readMonthlyUsage,
};
