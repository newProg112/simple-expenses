/* eslint-disable max-len, require-jsdoc */

"use strict";

const {
  MONTHLY_LIMIT_IDS,
  calendarMonthKey,
  getMonthlyLimit,
  normalisePlan,
  normaliseUsageCount,
} = require("./plan-entitlements");
const {stripeSubscriptionStatus} = require("./stripe-subscription-status");
const {qualifiesAsActivePaidSubscription} = require("./admin-metrics");
const {EVENT_PRESENTATION, safeTimestamp} = require("./admin-activity");
const {isDemoAuthUser} = require("./admin-authorization");

const ADMIN_USER_ACTIVITY_LIMIT = 20;

class AdminUserNotFoundError extends Error {
  constructor() {
    super("The requested Firebase Auth user was not found.");
    this.name = "AdminUserNotFoundError";
    this.code = "user-not-found";
  }
}

function safeIsoDate(value) {
  if (value && typeof value.toDate === "function") value = value.toDate();
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeText(value, maximum = 320) {
  if (typeof value !== "string") return "";
  return [...value].filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("").trim().slice(0, maximum);
}

function supportDiagnostics(profileExists, profile, usage) {
  const diagnostics = [];
  const recordedPlan = typeof profile.currentPlan === "string" ? profile.currentPlan.trim() : "";
  const subscriptionStatus = stripeSubscriptionStatus({status: profile.subscriptionStatus});
  const hasStripeCustomer = typeof profile.stripeCustomerId === "string" && Boolean(profile.stripeCustomerId.trim());
  if (!profileExists) diagnostics.push("missing-profile");
  if (recordedPlan !== "Starter" && recordedPlan !== "Pro") diagnostics.push("plan-not-set");
  if (!subscriptionStatus) diagnostics.push("subscription-status-not-set");
  if (!hasStripeCustomer) diagnostics.push("stripe-customer-not-linked");
  if (normaliseUsageCount(usage.aiAssistantSuccessfulUses) === 0) diagnostics.push("no-ai-usage-this-month");
  if (normaliseUsageCount(usage.invoiceScanningSuccessfulUses) === 0) diagnostics.push("no-invoice-scan-usage-this-month");
  return diagnostics;
}

async function getAuthUser(auth, selector) {
  if (!auth) throw new TypeError("Firebase Auth Admin is required.");
  try {
    if (selector.uid && typeof auth.getUser === "function") return await auth.getUser(selector.uid);
    if (selector.email && typeof auth.getUserByEmail === "function") return await auth.getUserByEmail(selector.email);
    throw new TypeError("Firebase Auth lookup method is unavailable.");
  } catch (error) {
    if (error && error.code === "auth/user-not-found") throw new AdminUserNotFoundError();
    throw error;
  }
}

function detailBadges(user, account, adminUids, demoIdentifiers) {
  const badges = [];
  if (user.disabled === true) badges.push("Disabled");
  if (account.demoMode === true || isDemoAuthUser(user, demoIdentifiers)) badges.push("Demo");
  if (adminUids.has(user.uid)) badges.push("Admin");
  if (user.emailVerified !== true) badges.push("Email unverified");
  if (badges.length === 0) badges.push("Active");
  return badges;
}

async function readActiveProjectCount(accountReference) {
  const query = accountReference.collection("projects").where("status", "==", "Active");
  if (!query || typeof query.count !== "function") return null;
  const snapshot = await query.count().get();
  const count = Number(snapshot.data().count);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

async function readRecentSafeActivity(firestore, uid) {
  const snapshot = await firestore.collection("adminActivityEvents")
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(ADMIN_USER_ACTIVITY_LIMIT)
      .select("eventType", "createdAt")
      .get();
  const events = [];
  for (const documentSnapshot of snapshot.docs) {
    const data = documentSnapshot.data() || {};
    if (!Object.hasOwn(EVENT_PRESENTATION, data.eventType)) continue;
    const timestamp = safeTimestamp(data.createdAt);
    if (!timestamp) continue;
    events.push({
      eventType: data.eventType,
      summary: EVENT_PRESENTATION[data.eventType].summary,
      timestamp,
    });
  }
  return events.slice(0, ADMIN_USER_ACTIVITY_LIMIT);
}

async function buildAdminUserDetails({auth, firestore, selector, adminUids, demoIdentifiers, proPriceId, now = new Date()}) {
  if (!firestore || typeof firestore.collection !== "function") throw new TypeError("Firestore Admin is required.");
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("A valid lookup date is required.");
  const user = await getAuthUser(auth, selector);
  const monthKey = calendarMonthKey(now);
  const accountReference = firestore.collection("users").doc(user.uid);
  const profileReference = firestore.collection("userProfiles").doc(user.uid);
  const usageReference = profileReference.collection("usage").doc(monthKey);
  const [accountSnapshot, profileSnapshot, usageSnapshot, activeProjects, recentActivity] = await Promise.all([
    accountReference.get(),
    profileReference.get(),
    usageReference.get(),
    readActiveProjectCount(accountReference),
    readRecentSafeActivity(firestore, user.uid),
  ]);
  const account = accountSnapshot.exists ? accountSnapshot.data() || {} : {};
  const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
  const usage = usageSnapshot.exists ? usageSnapshot.data() || {} : {};
  const plan = normalisePlan(profile.currentPlan);
  const subscriptionStatus = stripeSubscriptionStatus({status: profile.subscriptionStatus});
  const metadata = user.metadata || {};
  return {
    account: {
      uid: safeText(user.uid, 128),
      email: safeText(user.email),
      fullName: safeText(user.displayName || account.fullName, 160),
      businessName: safeText(account.businessName, 160),
      signupDate: safeIsoDate(metadata.creationTime),
      lastSignInDate: safeIsoDate(metadata.lastSignInTime),
      disabled: user.disabled === true,
      emailVerified: user.emailVerified === true,
      demo: account.demoMode === true || isDemoAuthUser(user, demoIdentifiers),
      admin: adminUids.has(user.uid),
      badges: detailBadges(user, account, adminUids, demoIdentifiers),
    },
    plan: {
      currentPlan: plan,
      subscriptionStatus,
      currentPeriodEnd: safeIsoDate(profile.subscriptionCurrentPeriodEnd),
      activePaidSubscription: qualifiesAsActivePaidSubscription(profile, proPriceId),
    },
    usage: {
      monthKey,
      aiAssistantSuccessfulUses: normaliseUsageCount(usage.aiAssistantSuccessfulUses),
      aiAssistantAllowance: getMonthlyLimit(plan, MONTHLY_LIMIT_IDS.AI_ASSISTANT),
      invoiceScanningSuccessfulUses: normaliseUsageCount(usage.invoiceScanningSuccessfulUses),
      invoiceScanningAllowance: getMonthlyLimit(plan, MONTHLY_LIMIT_IDS.INVOICE_SCANNING),
      activeProjects,
    },
    recentActivity,
    diagnostics: supportDiagnostics(profileSnapshot.exists, profile, usage),
  };
}

module.exports = {
  ADMIN_USER_ACTIVITY_LIMIT,
  AdminUserNotFoundError,
  buildAdminUserDetails,
  detailBadges,
  getAuthUser,
  readActiveProjectCount,
  readRecentSafeActivity,
  safeIsoDate,
  supportDiagnostics,
};
