/* eslint-disable max-len, require-jsdoc */

"use strict";

const {
  calendarMonthKey,
  normalisePlan,
  normaliseUsageCount,
} = require("./plan-entitlements");
const {stripeSubscriptionStatus} = require("./stripe-subscription-status");

class AdminUserNotFoundError extends Error {
  constructor() {
    super("The requested Firebase Auth user was not found.");
    this.name = "AdminUserNotFoundError";
    this.code = "user-not-found";
  }
}

function safeIsoDate(value) {
  if (value && typeof value.toDate === "function") {
    value = value.toDate();
  }
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function supportDiagnostics(profileExists, profile, usage) {
  const diagnostics = [];
  const recordedPlan = typeof profile.currentPlan === "string" ?
    profile.currentPlan.trim() : "";
  const subscriptionStatus = stripeSubscriptionStatus({
    status: profile.subscriptionStatus,
  });
  const hasStripeCustomer = typeof profile.stripeCustomerId === "string" &&
    Boolean(profile.stripeCustomerId.trim());
  const aiUsage = normaliseUsageCount(usage.aiAssistantSuccessfulUses);
  const scanUsage = normaliseUsageCount(usage.invoiceScanningSuccessfulUses);

  if (!profileExists) diagnostics.push("missing-profile");
  if (recordedPlan !== "Starter" && recordedPlan !== "Pro") {
    diagnostics.push("plan-not-set");
  }
  if (!subscriptionStatus) diagnostics.push("subscription-status-not-set");
  if (!hasStripeCustomer) diagnostics.push("stripe-customer-not-linked");
  if (aiUsage === 0) diagnostics.push("no-ai-usage-this-month");
  if (scanUsage === 0) diagnostics.push("no-invoice-scan-usage-this-month");
  return diagnostics;
}

async function getAuthUserByEmail(auth, email) {
  if (!auth || typeof auth.getUserByEmail !== "function") {
    throw new TypeError("A Firebase Auth Admin service is required.");
  }

  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error && error.code === "auth/user-not-found") {
      throw new AdminUserNotFoundError();
    }
    throw error;
  }
}

async function buildAdminUserDetails({
  auth,
  firestore,
  email,
  now = new Date(),
}) {
  if (!firestore || typeof firestore.collection !== "function") {
    throw new TypeError("A Firestore Admin service is required.");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("A valid lookup date is required.");
  }

  const user = await getAuthUserByEmail(auth, email);
  const monthKey = calendarMonthKey(now);
  const profileReference = firestore.collection("userProfiles").doc(user.uid);
  const usageReference = profileReference.collection("usage").doc(monthKey);
  const [profileSnapshot, usageSnapshot] = await Promise.all([
    profileReference.get(),
    usageReference.get(),
  ]);
  const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
  const usage = usageSnapshot.exists ? usageSnapshot.data() : {};
  const metadata = user.metadata || {};

  return {
    email: typeof user.email === "string" ? user.email : "",
    plan: normalisePlan(profile.currentPlan),
    subscriptionStatus: stripeSubscriptionStatus({
      status: profile.subscriptionStatus,
    }),
    createdDate: safeIsoDate(metadata.creationTime),
    lastSignInTime: safeIsoDate(metadata.lastSignInTime),
    aiAssistantSuccessfulUses: normaliseUsageCount(
        usage.aiAssistantSuccessfulUses,
    ),
    invoiceScanningSuccessfulUses: normaliseUsageCount(
        usage.invoiceScanningSuccessfulUses,
    ),
    stripeCustomerPresent: typeof profile.stripeCustomerId === "string" &&
      Boolean(profile.stripeCustomerId.trim()),
    currentPeriodEnd: safeIsoDate(profile.subscriptionCurrentPeriodEnd),
    diagnostics: supportDiagnostics(
        profileSnapshot.exists,
        profile,
        usage,
    ),
  };
}

module.exports = {
  AdminUserNotFoundError,
  buildAdminUserDetails,
  getAuthUserByEmail,
  safeIsoDate,
  supportDiagnostics,
};
