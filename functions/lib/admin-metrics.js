/* eslint-disable max-len, require-jsdoc */

"use strict";

const {
  calendarMonthKey,
  normalisePlan,
  normaliseUsageCount,
} = require("./plan-entitlements");
const {
  stripeSubscriptionStatus,
} = require("./stripe-subscription-status");
const {isDemoAuthUser} = require("./admin-authorization");

const AUTH_PAGE_SIZE = 1000;
const FIRESTORE_READ_BATCH_SIZE = 50;
const PRO_MONTHLY_PRICE_PENCE = 1500;
const RECENT_SIGNUP_LIMIT = 10;

async function listAllAuthUsers(auth) {
  if (!auth || typeof auth.listUsers !== "function") {
    throw new TypeError("A Firebase Auth Admin service is required.");
  }

  const users = [];
  const seenPageTokens = new Set();
  let pageToken;

  do {
    const page = await auth.listUsers(AUTH_PAGE_SIZE, pageToken);
    users.push(...(Array.isArray(page.users) ? page.users : []));
    pageToken = page.pageToken || undefined;
    if (pageToken && seenPageTokens.has(pageToken)) {
      throw new Error("Firebase Auth pagination returned a repeated token.");
    }
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);

  return users;
}

function safeCreationTime(user) {
  const value = user && user.metadata ? user.metadata.creationTime : null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function qualifiesAsActivePaidSubscription(profile, proPriceId) {
  const source = profile && typeof profile === "object" ? profile : {};
  return source.currentPlan === "Pro" &&
    source.subscriptionStatus === "active" &&
    source.billingOverride !== true &&
    typeof source.stripeCustomerId === "string" &&
    Boolean(source.stripeCustomerId.trim()) &&
    typeof source.stripeSubscriptionId === "string" &&
    Boolean(source.stripeSubscriptionId.trim()) &&
    source.stripePriceId === proPriceId;
}

async function readAdminUserData(firestore, user, monthKey) {
  const profileReference = firestore.collection("userProfiles").doc(user.uid);
  const usageReference = profileReference.collection("usage").doc(monthKey);
  const [profileSnapshot, usageSnapshot] = await Promise.all([
    profileReference.get(),
    usageReference.get(),
  ]);

  return {
    user,
    profile: profileSnapshot.exists ? profileSnapshot.data() : {},
    usage: usageSnapshot.exists ? usageSnapshot.data() : {},
  };
}

async function readAdminUserDataInBatches(firestore, users, monthKey) {
  const results = [];
  for (let index = 0; index < users.length; index += FIRESTORE_READ_BATCH_SIZE) {
    const batch = users.slice(index, index + FIRESTORE_READ_BATCH_SIZE);
    results.push(...await Promise.all(batch.map((user) =>
      readAdminUserData(firestore, user, monthKey),
    )));
  }
  return results;
}

function recentSignupRecord(entry) {
  const joinedDate = safeCreationTime(entry.user);
  return {
    email: typeof entry.user.email === "string" ? entry.user.email : "",
    plan: normalisePlan(entry.profile.currentPlan),
    joinedAt: joinedDate ? joinedDate.toISOString() : null,
    subscriptionStatus: stripeSubscriptionStatus({
      status: entry.profile.subscriptionStatus,
    }),
    aiAssistantSuccessfulUses: normaliseUsageCount(
        entry.usage.aiAssistantSuccessfulUses,
    ),
    invoiceScanningSuccessfulUses: normaliseUsageCount(
        entry.usage.invoiceScanningSuccessfulUses,
    ),
  };
}

function sortByNewestSignup(left, right) {
  const leftDate = safeCreationTime(left.user);
  const rightDate = safeCreationTime(right.user);
  if (leftDate && rightDate) return rightDate.getTime() - leftDate.getTime();
  if (leftDate) return -1;
  if (rightDate) return 1;
  return String(left.user.email || "").localeCompare(String(right.user.email || ""));
}

async function buildAdminMetrics({
  auth,
  firestore,
  demoIdentifiers,
  proPriceId,
  now = new Date(),
}) {
  if (!firestore || typeof firestore.collection !== "function") {
    throw new TypeError("A Firestore Admin service is required.");
  }
  if (typeof proPriceId !== "string" || !proPriceId.trim()) {
    throw new TypeError("The Pro Stripe price ID is required.");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("A valid metrics date is required.");
  }

  const monthKey = calendarMonthKey(now);
  const allAuthUsers = await listAllAuthUsers(auth);
  // Disabled Auth accounts remain registered accounts and are included. Only
  // configured demo identities are excluded from Phase 2A business metrics.
  const users = allAuthUsers.filter((user) =>
    !isDemoAuthUser(user, demoIdentifiers),
  );
  const entries = await readAdminUserDataInBatches(
      firestore,
      users,
      monthKey,
  );

  let starterUsers = 0;
  let proUsers = 0;
  let activePaidSubscriptions = 0;
  let aiAssistantSuccessfulUses = 0;
  let invoiceScanningSuccessfulUses = 0;

  entries.forEach((entry) => {
    const plan = normalisePlan(entry.profile.currentPlan);
    if (plan === "Pro") proUsers += 1;
    else starterUsers += 1;
    if (qualifiesAsActivePaidSubscription(entry.profile, proPriceId)) {
      activePaidSubscriptions += 1;
    }
    aiAssistantSuccessfulUses += normaliseUsageCount(
        entry.usage.aiAssistantSuccessfulUses,
    );
    invoiceScanningSuccessfulUses += normaliseUsageCount(
        entry.usage.invoiceScanningSuccessfulUses,
    );
  });

  const recentSignups = entries
      .slice()
      .sort(sortByNewestSignup)
      .slice(0, RECENT_SIGNUP_LIMIT)
      .map(recentSignupRecord);

  return {
    generatedAt: now.toISOString(),
    monthKey,
    metrics: {
      totalUsers: users.length,
      starterUsers,
      proUsers,
      activePaidSubscriptions,
      estimatedMrrPence:
        activePaidSubscriptions * PRO_MONTHLY_PRICE_PENCE,
      currency: "GBP",
      aiAssistantSuccessfulUses,
      invoiceScanningSuccessfulUses,
    },
    recentSignups,
  };
}

module.exports = {
  AUTH_PAGE_SIZE,
  FIRESTORE_READ_BATCH_SIZE,
  PRO_MONTHLY_PRICE_PENCE,
  RECENT_SIGNUP_LIMIT,
  buildAdminMetrics,
  listAllAuthUsers,
  qualifiesAsActivePaidSubscription,
  recentSignupRecord,
  safeCreationTime,
};
