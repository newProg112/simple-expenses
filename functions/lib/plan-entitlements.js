const PLAN_IDS = Object.freeze({
  STARTER: "Starter",
  PRO: "Pro",
});

const MONTHLY_LIMIT_IDS = Object.freeze({
  AI_ASSISTANT: "aiAssistantMonthlyLimit",
  INVOICE_SCANNING: "invoiceScanningMonthlyLimit",
});

const FEATURE_IDS = Object.freeze({
  ACCOUNTANT_PACK: "accountantPack",
});

const REPORT_IDS = Object.freeze({
  TRIAL_BALANCE: "trialBalance",
  GENERAL_LEDGER: "generalLedger",
  PROFIT_LOSS: "profitLoss",
  BALANCE_SHEET: "balanceSheet",
});

const PRO_ELIGIBLE_SUBSCRIPTION_STATUSES = Object.freeze([
  "active",
  "trialing",
]);

const starterReports = Object.freeze({
  [REPORT_IDS.TRIAL_BALANCE]: false,
  [REPORT_IDS.GENERAL_LEDGER]: false,
  [REPORT_IDS.PROFIT_LOSS]: false,
  [REPORT_IDS.BALANCE_SHEET]: false,
});

const proReports = Object.freeze({
  [REPORT_IDS.TRIAL_BALANCE]: true,
  [REPORT_IDS.GENERAL_LEDGER]: true,
  [REPORT_IDS.PROFIT_LOSS]: true,
  [REPORT_IDS.BALANCE_SHEET]: true,
});

const PLAN_ENTITLEMENTS = Object.freeze({
  [PLAN_IDS.STARTER]: Object.freeze({
    aiAssistantMonthlyLimit: 10,
    invoiceScanningMonthlyLimit: 10,
    activeProjectsLimit: 5,
    accountantPack: false,
    reports: starterReports,
  }),
  [PLAN_IDS.PRO]: Object.freeze({
    aiAssistantMonthlyLimit: 500,
    invoiceScanningMonthlyLimit: 500,
    activeProjectsLimit: null,
    accountantPack: true,
    reports: proReports,
  }),
});

const monthlyLimitIds = new Set(Object.values(MONTHLY_LIMIT_IDS));
const featureIds = new Set(Object.values(FEATURE_IDS));
const reportIds = new Set(Object.values(REPORT_IDS));
const proEligibleStatuses = new Set(PRO_ELIGIBLE_SUBSCRIPTION_STATUSES);

/**
 * Normalises a stored plan value, failing safely to Starter.
 * @param {*} plan Stored plan value.
 * @return {string} A known plan identifier.
 */
function normalisePlan(plan) {
  return plan === PLAN_IDS.PRO ? PLAN_IDS.PRO : PLAN_IDS.STARTER;
}

/**
 * Resolves product access independently from billing for an authoritative demo.
 * @param {*} plan Stored billing plan.
 * @param {*} demoMode Authoritative users/{uid}.demoMode value.
 * @return {string} Effective Starter or Pro product plan.
 */
function effectiveProductPlan(plan, demoMode = false) {
  return demoMode === true ? PLAN_IDS.PRO : normalisePlan(plan);
}

/**
 * Returns the entitlement definition for a plan.
 * @param {*} plan Stored plan value.
 * @return {object} Frozen plan entitlement definition.
 */
function getPlanEntitlements(plan) {
  return PLAN_ENTITLEMENTS[normalisePlan(plan)];
}

/**
 * Returns a named monthly limit, or zero for an unknown identifier.
 * @param {*} plan Stored plan value.
 * @param {string} limitId Monthly limit identifier.
 * @return {number} Monthly allowance.
 */
function getMonthlyLimit(plan, limitId) {
  if (!monthlyLimitIds.has(limitId)) {
    return 0;
  }

  return getPlanEntitlements(plan)[limitId];
}

/**
 * Checks for the deliberate unlimited allowance representation.
 * @param {*} allowance Allowance value.
 * @return {boolean} Whether the allowance is unlimited.
 */
function isUnlimited(allowance) {
  return allowance === null;
}

/**
 * Normalises a stored monthly usage counter.
 * @param {*} value Stored usage value.
 * @return {number} A non-negative integer.
 */
function normaliseUsageCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

/**
 * Calculates the remaining monthly allowance.
 * @param {number|null} limit Monthly allowance.
 * @param {*} usage Stored usage value.
 * @return {number|null} Remaining uses, or null when unlimited.
 */
function remainingMonthlyAllowance(limit, usage) {
  if (isUnlimited(limit)) {
    return null;
  }

  return Math.max(
      0,
      normaliseUsageCount(limit) - normaliseUsageCount(usage),
  );
}

/**
 * Checks whether a named feature is included in a plan.
 * @param {*} plan Stored plan value.
 * @param {string} featureId Feature identifier.
 * @return {boolean} Whether the feature is included.
 */
function isFeatureIncluded(plan, featureId) {
  if (!featureIds.has(featureId)) {
    return false;
  }

  return getPlanEntitlements(plan)[featureId] === true;
}

/**
 * Checks whether a named advanced report is included in a plan.
 * @param {*} plan Stored plan value.
 * @param {string} reportId Report identifier.
 * @return {boolean} Whether the report is included.
 */
function isReportIncluded(plan, reportId) {
  if (!reportIds.has(reportId)) {
    return false;
  }

  return getPlanEntitlements(plan).reports[reportId] === true;
}

/**
 * Checks whether a subscription status is currently eligible for Pro.
 * @param {*} status Subscription status.
 * @return {boolean} Whether the status is eligible.
 */
function isProEligibleSubscriptionStatus(status) {
  return proEligibleStatuses.has(status);
}

/**
 * Checks whether both plan and status qualify for Pro access.
 * @param {*} plan Stored plan value.
 * @param {*} subscriptionStatus Subscription status.
 * @return {boolean} Whether the subscription qualifies.
 */
function hasProAccess(plan, subscriptionStatus) {
  return normalisePlan(plan) === PLAN_IDS.PRO &&
    isProEligibleSubscriptionStatus(subscriptionStatus);
}

/**
 * Produces a stable UTC calendar-month key.
 * @param {Date} date Date to format. Defaults to now only when omitted.
 * @return {string} UTC month key in YYYY-MM format.
 */
function calendarMonthKey(date) {
  const value = arguments.length === 0 ? new Date() : date;

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("calendarMonthKey expects a valid Date.");
  }

  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

module.exports = {
  PLAN_IDS,
  MONTHLY_LIMIT_IDS,
  FEATURE_IDS,
  REPORT_IDS,
  PRO_ELIGIBLE_SUBSCRIPTION_STATUSES,
  PLAN_ENTITLEMENTS,
  normalisePlan,
  effectiveProductPlan,
  getPlanEntitlements,
  getMonthlyLimit,
  isUnlimited,
  normaliseUsageCount,
  remainingMonthlyAllowance,
  isFeatureIncluded,
  isReportIncluded,
  isProEligibleSubscriptionStatus,
  hasProAccess,
  calendarMonthKey,
};
