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
  };
}

module.exports = {
  AdminUserNotFoundError,
  buildAdminUserDetails,
  getAuthUserByEmail,
  safeIsoDate,
};
