/* eslint-disable max-len, require-jsdoc */

"use strict";

const {isDemoAuthUser} = require("./admin-authorization");
const {calendarMonthKey, normaliseUsageCount} = require("./plan-entitlements");

const DEFAULT_CUSTOMER_ANALYTICS_RANGE = "30d";
const CUSTOMER_ANALYTICS_SCHEMA_VERSION = 2;
const CUSTOMER_ANALYTICS_RANGES = Object.freeze({"7d": 7, "30d": 30, "all": null});
const CUSTOMER_ACTIVITY_LIMIT = 10000;
const CUSTOMER_ACCOUNT_LIMIT = 5000;
const AUTH_PAGE_SIZE = 1000;
const READ_BATCH_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const TOP_ENGAGED_CUSTOMER_LIMIT = 20;

const FEATURE_DEFINITIONS = Object.freeze([
  {key: "invoices", label: "Invoices", events: ["invoice_created", "invoice_saved"]},
  {key: "bills", label: "Bills", events: ["bill_created", "bill_saved"]},
  {key: "expenses", label: "Expenses", events: ["expense_created", "expense_saved"]},
  {key: "mileage", label: "Mileage", events: ["mileage_created", "mileage_claim_created"]},
  {key: "projects", label: "Projects", events: ["project_created"]},
  {key: "budgets", label: "Budgets", events: ["budget_created"]},
  {key: "ai_assistant", label: "AI Assistant", events: ["ai_question_asked", "ai_assistant_used"]},
  {key: "invoice_scanning", label: "Invoice Scanning", events: ["invoice_scanned", "document_scanned"]},
  {key: "accountant_pack", label: "Accountant Pack", events: ["accountant_pack_generated", "accountant_pack_downloaded"]},
  {key: "accounting_reports", label: "Accounting Reports", events: ["trial_balance_viewed", "general_ledger_viewed", "profit_and_loss_viewed", "balance_sheet_viewed"]},
]);
const ADOPTION_DEFINITIONS = Object.freeze([
  {key: "invoices", label: "Invoices", events: ["invoice_created", "invoice_saved"]},
  {key: "bills", label: "Bills", events: ["bill_created", "bill_saved"]},
  {key: "expenses", label: "Expenses", events: ["expense_created", "expense_saved"]},
  {key: "mileage", label: "Mileage", events: ["mileage_created", "mileage_claim_created"]},
  {key: "projects", label: "Projects", events: ["project_created"]},
  {key: "budgets", label: "Budgets", events: ["budget_created"]},
  {key: "ai_assistant", label: "AI Assistant", events: ["ai_question_asked", "ai_assistant_used"]},
  {key: "invoice_scanning", label: "Invoice Scanning", events: ["invoice_scanned", "document_scanned"]},
  {key: "accountant_pack", label: "Accountant Pack", events: ["accountant_pack_generated", "accountant_pack_downloaded"]},
  {key: "trial_balance", label: "Trial Balance", events: ["trial_balance_viewed"]},
  {key: "general_ledger", label: "General Ledger", events: ["general_ledger_viewed"]},
  {key: "profit_and_loss", label: "Profit & Loss", events: ["profit_and_loss_viewed"]},
  {key: "balance_sheet", label: "Balance Sheet", events: ["balance_sheet_viewed"]},
]);
const EVENT_TO_FEATURE = new Map(FEATURE_DEFINITIONS.flatMap((feature) =>
  feature.events.map((eventName) => [eventName, feature])));
const QUALIFYING_NON_FEATURE_EVENTS = new Set([
  "user_logged_in",
  "checkout_started",
  "upgraded_to_pro",
  "subscription_cancelled",
]);
const RETENTION_ADOPTION_DEFINITIONS = Object.freeze([
  {key: "first_invoice", label: "Created first invoice", events: ["invoice_created"]},
  {key: "first_bill", label: "Created first bill", events: ["bill_created"]},
  {key: "first_expense", label: "Created first expense", events: ["expense_created"]},
  {key: "first_project", label: "Created first project", events: ["project_created"]},
  {key: "ai_assistant", label: "Used AI Assistant", events: ["ai_question_asked"]},
  {key: "invoice_scanning", label: "Used Invoice Scanning", events: ["invoice_scanned"]},
]);
const RETENTION_EVENT_TO_ADOPTION = new Map(RETENTION_ADOPTION_DEFINITIONS.flatMap((feature) =>
  feature.events.map((eventName) => [eventName, feature.key])));

function parseCustomerAnalyticsRange(value) {
  const range = value === undefined ? DEFAULT_CUSTOMER_ANALYTICS_RANGE : value;
  if (typeof range !== "string" || !Object.hasOwn(CUSTOMER_ANALYTICS_RANGES, range)) {
    const error = new Error("Invalid Customer Analytics range.");
    error.code = "invalid-argument";
    throw error;
  }
  return range;
}

function utcRangeStart(range, now) {
  const days = CUSTOMER_ANALYTICS_RANGES[range];
  if (days === null) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (days - 1) * DAY_MS);
}

function safeDate(value) {
  try {
    const date = value && typeof value.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  } catch (_error) {
    return null;
  }
}

function safeUid(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    !value.includes("/") && !/\s/.test(value) ? value : "";
}

function normalizePlan(value) {
  const plan = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (plan === "starter") return "starter";
  if (plan === "pro") return "pro";
  return "unknown";
}

function normalizeEventName(value) {
  if (typeof value !== "string") return "";
  const eventName = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return eventName.length <= 80 && /^[a-z][a-z0-9_]*$/.test(eventName) ? eventName : "";
}

function safeCreationDate(user) {
  return safeDate(user && user.metadata ? user.metadata.creationTime : null);
}

function safeBusinessName(value) {
  if (typeof value !== "string") return "";
  return [...value].filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("").trim().slice(0, 160);
}

function percentage(count, total) {
  return total > 0 ? Math.round(count / total * 1000) / 10 : 0;
}

function utcMonthStart(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function signupCohorts(entries, now) {
  const currentMonth = utcMonthStart(now);
  const months = Array.from({length: 12}, (_value, index) => {
    const month = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - 11 + index, 1));
    return {
      monthKey: month.toISOString().slice(0, 7),
      label: month.toLocaleDateString("en-GB", {month: "short", year: "numeric", timeZone: "UTC"}),
      count: 0,
    };
  });
  const byMonth = new Map(months.map((month) => [month.monthKey, month]));
  for (const entry of entries) {
    const created = safeCreationDate(entry.user);
    const bucket = created && created <= now ? byMonth.get(created.toISOString().slice(0, 7)) : null;
    if (bucket) bucket.count += 1;
  }
  return months;
}

function rankEngagedCustomers(entries, events) {
  const byUid = new Map(entries.map((entry) => [entry.user.uid, {
    uid: entry.user.uid,
    businessName: safeBusinessName(entry.account && entry.account.businessName),
    plan: normalizePlan(entry.profile && entry.profile.currentPlan),
    lastActive: null,
    totalSafeActivityEvents: 0,
  }]));
  for (const event of events) {
    const customer = byUid.get(event.uid);
    if (!customer) continue;
    customer.totalSafeActivityEvents += 1;
    if (!customer.lastActive || event.createdAt > customer.lastActive) customer.lastActive = event.createdAt;
  }
  return [...byUid.values()].filter((customer) => customer.totalSafeActivityEvents > 0)
      .sort((left, right) => right.totalSafeActivityEvents - left.totalSafeActivityEvents ||
        right.lastActive.getTime() - left.lastActive.getTime() || left.uid.localeCompare(right.uid));
}

function phaseTwoCustomerAnalytics({entries, events, now, usageByUid = new Map()}) {
  const totalCustomers = entries.length;
  const eventUidsByFeature = new Map(RETENTION_ADOPTION_DEFINITIONS.map((feature) => [feature.key, new Set()]));
  const eventsByUid = new Map(entries.map((entry) => [entry.user.uid, []]));
  const entryByUid = new Map(entries.map((entry) => [entry.user.uid, entry]));
  const lastActivityByUid = new Map();
  for (const event of events) {
    if (!eventsByUid.has(event.uid) || event.createdAt > now) continue;
    eventsByUid.get(event.uid).push(event);
    const previous = lastActivityByUid.get(event.uid);
    if (!previous || event.createdAt > previous) lastActivityByUid.set(event.uid, event.createdAt);
    const featureKey = RETENTION_EVENT_TO_ADOPTION.get(event.eventType);
    if (featureKey) eventUidsByFeature.get(featureKey).add(event.uid);
  }
  const cutoff24Hours = now.getTime() - DAY_MS;
  const cutoff7Days = now.getTime() - 7 * DAY_MS;
  const cutoff30Days = now.getTime() - 30 * DAY_MS;
  let active24Hours = 0;
  let active7Days = 0;
  let active30Days = 0;
  let dormant30Days = 0;
  for (const entry of entries) {
    const lastActive = lastActivityByUid.get(entry.user.uid);
    const created = safeCreationDate(entry.user);
    if (lastActive && lastActive.getTime() >= cutoff24Hours) active24Hours += 1;
    if (lastActive && lastActive.getTime() >= cutoff7Days) active7Days += 1;
    if (lastActive && lastActive.getTime() >= cutoff30Days) active30Days += 1;
    if ((lastActive && lastActive.getTime() < cutoff30Days) ||
      (!lastActive && created && created.getTime() < cutoff30Days)) dormant30Days += 1;
  }
  const monthStart = utcMonthStart(now);
  const newUsersThisMonth = entries.filter((entry) => {
    const created = safeCreationDate(entry.user);
    return created && created >= monthStart && created <= now;
  }).length;
  const returningUids = new Set(events.filter((event) => {
    const entry = entryByUid.get(event.uid);
    const created = safeCreationDate(entry && entry.user);
    return event.createdAt >= monthStart && event.createdAt <= now && created && created < monthStart;
  }).map((event) => event.uid));
  const returningUsersThisMonth = returningUids.size;
  const monthlyUsers = newUsersThisMonth + returningUsersThisMonth;
  const adoption = RETENTION_ADOPTION_DEFINITIONS.map(({key, label}) => ({
    key,
    label,
    customers: eventUidsByFeature.get(key).size,
    percentageOfCustomers: percentage(eventUidsByFeature.get(key).size, totalCustomers),
  }));

  const accountCreated = new Set(entries.map((entry) => entry.user.uid));
  const signedIn = new Set();
  const firstInvoice = new Set();
  const secondInvoice = new Set();
  const usedAi = new Set();
  const subscribedPro = new Set();
  for (const [uid, customerEvents] of eventsByUid) {
    const orderedEvents = customerEvents.slice().sort((left, right) => left.createdAt - right.createdAt);
    const signInIndex = orderedEvents.findIndex((event) => event.eventType === "user_logged_in");
    if (signInIndex < 0) continue;
    signedIn.add(uid);
    const firstInvoiceIndex = orderedEvents.findIndex((event, index) =>
      index > signInIndex && event.eventType === "invoice_created");
    if (firstInvoiceIndex < 0) continue;
    firstInvoice.add(uid);
    const secondInvoiceIndex = orderedEvents.findIndex((event, index) =>
      index > firstInvoiceIndex && event.eventType === "invoice_created");
    if (secondInvoiceIndex < 0) continue;
    secondInvoice.add(uid);
    const aiIndex = orderedEvents.findIndex((event, index) =>
      index > secondInvoiceIndex && event.eventType === "ai_question_asked");
    if (aiIndex < 0) continue;
    usedAi.add(uid);
    if (normalizePlan(entryByUid.get(uid).profile && entryByUid.get(uid).profile.currentPlan) === "pro") subscribedPro.add(uid);
  }
  const funnelCounts = [accountCreated.size, signedIn.size, firstInvoice.size, secondInvoice.size, usedAi.size, subscribedPro.size];
  const funnelLabels = ["Account Created", "Signed In", "Created First Invoice", "Created Second Invoice", "Used AI Assistant", "Subscribed to Pro"];
  const conversionJourney = funnelLabels.map((label, index) => ({
    key: label.toLowerCase().replace(/\s+/g, "_"),
    label,
    count: funnelCounts[index],
    percentageFromPrevious: index === 0 ? (funnelCounts[0] ? 100 : 0) : percentage(funnelCounts[index], funnelCounts[index - 1]),
  }));
  const topEngagedCustomers = rankEngagedCustomers(entries, events).slice(0, TOP_ENGAGED_CUSTOMER_LIMIT)
      .map((customer) => {
        const usage = usageByUid.get(customer.uid) || {};
        return {
          businessName: customer.businessName,
          plan: customer.plan,
          lastActive: customer.lastActive.toISOString(),
          totalSafeActivityEvents: customer.totalSafeActivityEvents,
          aiAssistantSuccessfulUses: normaliseUsageCount(usage.aiAssistantSuccessfulUses),
          invoiceScanningSuccessfulUses: normaliseUsageCount(usage.invoiceScanningSuccessfulUses),
        };
      });
  return {
    retention: {active24Hours, active7Days, active30Days, dormant30Days},
    signupCohorts: signupCohorts(entries, now),
    returningUsers: {
      newUsersThisMonth,
      returningUsersThisMonth,
      returningUserPercentage: percentage(returningUsersThisMonth, monthlyUsers),
    },
    featureAdoption: adoption,
    conversionJourney,
    topEngagedCustomers,
  };
}

async function listBoundedAuthUsers(auth) {
  if (!auth || typeof auth.listUsers !== "function") throw new TypeError("Firebase Auth Admin is required.");
  const users = [];
  let pageToken;
  let truncated = false;
  const seen = new Set();
  do {
    const remaining = CUSTOMER_ACCOUNT_LIMIT + 1 - users.length;
    const page = await auth.listUsers(Math.min(AUTH_PAGE_SIZE, remaining), pageToken);
    users.push(...(Array.isArray(page.users) ? page.users : []));
    pageToken = page.pageToken || undefined;
    if (pageToken && seen.has(pageToken)) throw new Error("Repeated Auth page token.");
    if (pageToken) seen.add(pageToken);
  } while (pageToken && users.length <= CUSTOMER_ACCOUNT_LIMIT);
  if (users.length > CUSTOMER_ACCOUNT_LIMIT || pageToken) truncated = true;
  return {users: users.slice(0, CUSTOMER_ACCOUNT_LIMIT), truncated};
}

async function readAccount(firestore, user) {
  const [accountSnapshot, profileSnapshot] = await Promise.all([
    firestore.collection("users").doc(user.uid).get(),
    firestore.collection("userProfiles").doc(user.uid).get(),
  ]);
  return {
    user,
    account: accountSnapshot.exists ? accountSnapshot.data() || {} : {},
    profile: profileSnapshot.exists ? profileSnapshot.data() || {} : {},
  };
}

async function readAccounts(firestore, users) {
  const entries = [];
  for (let index = 0; index < users.length; index += READ_BATCH_SIZE) {
    entries.push(...await Promise.all(users.slice(index, index + READ_BATCH_SIZE)
        .map((user) => readAccount(firestore, user))));
  }
  return entries;
}

function emptyDailyBuckets(range, now, events) {
  const days = CUSTOMER_ANALYTICS_RANGES[range];
  if (days !== null) {
    const start = utcRangeStart(range, now);
    return Array.from({length: days}, (_value, index) => ({
      date: new Date(start.getTime() + index * DAY_MS).toISOString().slice(0, 10),
      activeAccounts: 0,
      trackedActions: 0,
    }));
  }
  return [...new Set(events.map((event) => event.createdAt.toISOString().slice(0, 10)))]
      .sort().map((date) => ({date, activeAccounts: 0, trackedActions: 0}));
}

function aggregateCustomerAnalytics({entries, events, range, now, activityTruncated, accountsTruncated, usageByUid = new Map()}) {
  const startDate = utcRangeStart(range, now);
  const startTime = startDate ? startDate.getTime() : -Infinity;
  const endTime = now.getTime();
  const plans = new Map(entries.map((entry) => [entry.user.uid, normalizePlan(entry.profile && entry.profile.currentPlan)]));
  const starterAccounts = [...plans.values()].filter((plan) => plan === "starter").length;
  const proAccounts = [...plans.values()].filter((plan) => plan === "pro").length;
  const unknownAccounts = plans.size - starterAccounts - proAccounts;
  const knownAccounts = starterAccounts + proAccounts;
  const eligibleEvents = events.filter((event) => event.createdAt.getTime() <= endTime && plans.has(event.uid));
  const validEvents = eligibleEvents.filter((event) => event.createdAt.getTime() >= startTime);
  const activeUids = new Set(validEvents.map((event) => event.uid));
  const activeStarter = [...activeUids].filter((uid) => plans.get(uid) === "starter").length;
  const activePro = [...activeUids].filter((uid) => plans.get(uid) === "pro").length;
  const activeUnknown = activeUids.size - activeStarter - activePro;
  const featureCounts = new Map(FEATURE_DEFINITIONS.map((feature) => [feature.key, 0]));
  const adoptionCounts = new Map(ADOPTION_DEFINITIONS.map((item) => [item.key, 0]));
  const eventToAdoption = new Map(ADOPTION_DEFINITIONS.flatMap((item) =>
    item.events.map((eventName) => [eventName, item])));
  for (const event of validEvents) {
    const feature = EVENT_TO_FEATURE.get(event.eventType);
    if (feature) featureCounts.set(feature.key, featureCounts.get(feature.key) + 1);
    const adoption = eventToAdoption.get(event.eventType);
    if (adoption) adoptionCounts.set(adoption.key, adoptionCounts.get(adoption.key) + 1);
  }
  const measuredFeatureActions = [...featureCounts.values()].reduce((sum, count) => sum + count, 0);
  const features = FEATURE_DEFINITIONS.map(({key, label}) => ({
    key,
    label,
    count: featureCounts.get(key),
    share: measuredFeatureActions ? Math.round(featureCounts.get(key) / measuredFeatureActions * 1000) / 10 : 0,
  })).filter((feature) => feature.count > 0)
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const daily = emptyDailyBuckets(range, now, validEvents);
  const dailyMap = new Map(daily.map((bucket) => [bucket.date, {bucket, uids: new Set()}]));
  for (const event of validEvents) {
    const item = dailyMap.get(event.createdAt.toISOString().slice(0, 10));
    if (!item) continue;
    item.bucket.trackedActions += 1;
    item.uids.add(event.uid);
  }
  for (const item of dailyMap.values()) item.bucket.activeAccounts = item.uids.size;
  const newSignUps = entries.filter((entry) => {
    const created = safeCreationDate(entry.user);
    return created && created.getTime() >= startTime && created.getTime() <= endTime;
  }).length;
  return {
    schemaVersion: CUSTOMER_ANALYTICS_SCHEMA_VERSION,
    range,
    generatedAt: now.toISOString(),
    summary: {
      activeCustomerAccounts: activeUids.size,
      newSignUps,
      activeStarterAccounts: activeStarter,
      activeProAccounts: activePro,
      activeUnknownPlanAccounts: activeUnknown,
      starterToProConversionRate: knownAccounts ? Math.round(proAccounts / knownAccounts * 1000) / 10 : 0,
      totalTrackedCustomerActions: validEvents.length,
    },
    adoption: ADOPTION_DEFINITIONS.map(({key, label}) => ({key, label, count: adoptionCounts.get(key)}))
        .filter((item) => item.count > 0),
    features,
    measuredFeatureActions,
    daily,
    planAdoption: {
      starter: {count: starterAccounts, percentageOfKnown: knownAccounts ? Math.round(starterAccounts / knownAccounts * 1000) / 10 : 0},
      pro: {count: proAccounts, percentageOfKnown: knownAccounts ? Math.round(proAccounts / knownAccounts * 1000) / 10 : 0},
      unknown: {count: unknownAccounts, percentageOfKnown: null},
      knownAccounts,
      conversionRate: knownAccounts ? Math.round(proAccounts / knownAccounts * 1000) / 10 : 0,
    },
    ...phaseTwoCustomerAnalytics({entries, events: eligibleEvents, now, usageByUid}),
    caps: {
      activityLimit: CUSTOMER_ACTIVITY_LIMIT,
      accountLimit: CUSTOMER_ACCOUNT_LIMIT,
      activityTruncated: Boolean(activityTruncated),
      accountsTruncated: Boolean(accountsTruncated),
      incomplete: Boolean(activityTruncated || accountsTruncated),
    },
    limitations: [
      "Product adoption includes only valid successful activity events recorded by Simple Books.",
      "Plan adoption is a current plan snapshot and does not represent paid subscription status.",
      "Retention, journeys and engagement use the most recent bounded safe activity events; capped results may understate historical progression.",
      "Subscribed to Pro in the journey uses the current recorded plan after prior funnel stages and does not expose billing data.",
    ],
  };
}

async function readTopCustomerUsage(firestore, entries, events, now) {
  const monthKey = calendarMonthKey(now);
  const top = rankEngagedCustomers(entries, events).slice(0, TOP_ENGAGED_CUSTOMER_LIMIT);
  const usage = new Map();
  await Promise.all(top.map(async (customer) => {
    const snapshot = await firestore.collection("userProfiles").doc(customer.uid)
        .collection("usage").doc(monthKey).get();
    usage.set(customer.uid, snapshot.exists ? snapshot.data() || {} : {});
  }));
  return usage;
}

async function buildAdminCustomerAnalytics({auth, firestore, demoIdentifiers, adminUids, range, now, timestampFactory, diagnosticsLogger = () => {}}) {
  const approvedRange = parseCustomerAnalyticsRange(range);
  const generatedAt = new Date(now);
  if (!Number.isFinite(generatedAt.getTime())) throw new Error("Invalid generation time.");
  const authResult = await listBoundedAuthUsers(auth);
  const nonAdminUsers = authResult.users.filter((user) => !adminUids.has(user.uid));
  const candidates = nonAdminUsers.filter((user) => !isDemoAuthUser(user, demoIdentifiers));
  const accountEntries = await readAccounts(firestore, candidates);
  const entries = accountEntries.filter((entry) => entry.account.demoMode !== true);
  const eligibleUids = new Set(entries.map((entry) => entry.user.uid));
  let query = firestore.collection("adminActivityEvents");
  query = query.where("createdAt", "<=", timestampFactory.fromDate(generatedAt))
      .orderBy("createdAt", "desc")
      .limit(CUSTOMER_ACTIVITY_LIMIT + 1)
      .select("eventType", "createdAt", "uid");
  const snapshot = await query.get();
  const activityTruncated = snapshot.docs.length > CUSTOMER_ACTIVITY_LIMIT;
  const documents = activityTruncated ? snapshot.docs.slice(0, CUSTOMER_ACTIVITY_LIMIT) : snapshot.docs;
  const events = [];
  for (const documentSnapshot of documents) {
    const data = documentSnapshot.data() || {};
    const uid = safeUid(data.uid);
    const eventType = normalizeEventName(data.eventType);
    const createdAt = safeDate(data.createdAt);
    if (!uid || !eligibleUids.has(uid) || !createdAt ||
      (!EVENT_TO_FEATURE.has(eventType) && !QUALIFYING_NON_FEATURE_EVENTS.has(eventType))) continue;
    events.push({uid, eventType, createdAt});
  }
  const usageByUid = await readTopCustomerUsage(firestore, entries, events, generatedAt);
  const result = aggregateCustomerAnalytics({
    entries,
    events,
    range: approvedRange,
    now: generatedAt,
    activityTruncated,
    accountsTruncated: authResult.truncated,
    usageByUid,
  });
  const cohortStart = new Date(Date.UTC(generatedAt.getUTCFullYear(), generatedAt.getUTCMonth() - 11, 1));
  const creationDates = entries.map((entry) => ({
    raw: entry.user && entry.user.metadata ? entry.user.metadata.creationTime : null,
    parsed: safeCreationDate(entry.user),
  }));
  diagnosticsLogger({
    authAccountsLoaded: authResult.users.length,
    excludedAdminAccounts: authResult.users.length - nonAdminUsers.length,
    excludedConfiguredDemoAccounts: nonAdminUsers.length - candidates.length,
    excludedDemoModeAccounts: accountEntries.length - entries.length,
    eligibleCustomerAccounts: entries.length,
    missingCreationTime: creationDates.filter((item) => item.raw === null || item.raw === undefined || item.raw === "").length,
    invalidCreationTime: creationDates.filter((item) => item.raw !== null && item.raw !== undefined && item.raw !== "" && !item.parsed).length,
    futureCreationTime: creationDates.filter((item) => item.parsed && item.parsed > generatedAt).length,
    outsideLast12Months: creationDates.filter((item) => item.parsed && item.parsed < cohortStart).length,
    includedInSignupCohorts: result.signupCohorts.reduce((sum, cohort) => sum + cohort.count, 0),
  });
  return result;
}

module.exports = {
  CUSTOMER_ACCOUNT_LIMIT,
  CUSTOMER_ACTIVITY_LIMIT,
  CUSTOMER_ANALYTICS_RANGES,
  CUSTOMER_ANALYTICS_SCHEMA_VERSION,
  ADOPTION_DEFINITIONS,
  FEATURE_DEFINITIONS,
  RETENTION_ADOPTION_DEFINITIONS,
  TOP_ENGAGED_CUSTOMER_LIMIT,
  aggregateCustomerAnalytics,
  buildAdminCustomerAnalytics,
  normalizeEventName,
  normalizePlan,
  phaseTwoCustomerAnalytics,
  rankEngagedCustomers,
  readTopCustomerUsage,
  parseCustomerAnalyticsRange,
  utcRangeStart,
};
