/* eslint-disable max-len, require-jsdoc */

"use strict";

const {
  calendarMonthKey,
  normalisePlan,
  normaliseUsageCount,
} = require("./plan-entitlements");
const {stripeSubscriptionStatus} = require("./stripe-subscription-status");
const {isDemoAuthUser} = require("./admin-authorization");
const {safeIsoDate} = require("./admin-user-details");

const ADMIN_USER_SEARCH_PAGE_SIZE = 1000;
const ADMIN_USER_SEARCH_RESULT_LIMIT = 20;

async function findMatchingAuthUsers(auth, query, demoIdentifiers) {
  if (!auth || typeof auth.listUsers !== "function") {
    throw new TypeError("A Firebase Auth Admin service is required.");
  }

  const matches = [];
  const seenPageTokens = new Set();
  let pageToken;
  do {
    const page = await auth.listUsers(
        ADMIN_USER_SEARCH_PAGE_SIZE,
        pageToken,
    );
    const users = Array.isArray(page.users) ? page.users : [];
    for (const user of users) {
      const email = typeof user.email === "string" ? user.email.trim() : "";
      if (!email || isDemoAuthUser(user, demoIdentifiers)) continue;
      if (email.toLowerCase().includes(query.toLowerCase())) {
        matches.push(user);
        if (matches.length === ADMIN_USER_SEARCH_RESULT_LIMIT) break;
      }
    }
    if (matches.length === ADMIN_USER_SEARCH_RESULT_LIMIT) break;
    pageToken = page.pageToken || undefined;
    if (pageToken && seenPageTokens.has(pageToken)) {
      throw new Error("Firebase Auth pagination returned a repeated token.");
    }
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);

  return matches;
}

async function searchResultForUser(firestore, user, monthKey) {
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
    email: user.email.trim(),
    plan: normalisePlan(profile.currentPlan),
    joinedAt: safeIsoDate(metadata.creationTime),
    lastSignInAt: safeIsoDate(metadata.lastSignInTime),
    subscriptionStatus: stripeSubscriptionStatus({
      status: profile.subscriptionStatus,
    }),
    aiAssistantSuccessfulUses: normaliseUsageCount(
        usage.aiAssistantSuccessfulUses,
    ),
    invoiceScanningSuccessfulUses: normaliseUsageCount(
        usage.invoiceScanningSuccessfulUses,
    ),
    stripeCustomerLinked: typeof profile.stripeCustomerId === "string" &&
      Boolean(profile.stripeCustomerId.trim()),
  };
}

async function searchAdminUsers({
  auth,
  firestore,
  demoIdentifiers,
  query,
  now = new Date(),
}) {
  if (!firestore || typeof firestore.collection !== "function") {
    throw new TypeError("A Firestore Admin service is required.");
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("A valid search date is required.");
  }

  const users = await findMatchingAuthUsers(auth, query, demoIdentifiers);
  const monthKey = calendarMonthKey(now);
  const results = await Promise.all(users.map((user) =>
    searchResultForUser(firestore, user, monthKey),
  ));
  return {results};
}

module.exports = {
  ADMIN_USER_SEARCH_PAGE_SIZE,
  ADMIN_USER_SEARCH_RESULT_LIMIT,
  findMatchingAuthUsers,
  searchAdminUsers,
  searchResultForUser,
};
