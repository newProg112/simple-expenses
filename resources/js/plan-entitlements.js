export const PLAN_IDS = Object.freeze({
  STARTER: "Starter",
  PRO: "Pro"
});

export const MONTHLY_LIMIT_IDS = Object.freeze({
  AI_ASSISTANT: "aiAssistantMonthlyLimit",
  INVOICE_SCANNING: "invoiceScanningMonthlyLimit"
});

export const FEATURE_IDS = Object.freeze({
  ACCOUNTANT_PACK: "accountantPack"
});

export const REPORT_IDS = Object.freeze({
  TRIAL_BALANCE: "trialBalance",
  GENERAL_LEDGER: "generalLedger",
  PROFIT_LOSS: "profitLoss",
  BALANCE_SHEET: "balanceSheet"
});

export const PRO_ELIGIBLE_SUBSCRIPTION_STATUSES = Object.freeze([
  "active",
  "trialing"
]);

const starterReports = Object.freeze({
  [REPORT_IDS.TRIAL_BALANCE]: false,
  [REPORT_IDS.GENERAL_LEDGER]: false,
  [REPORT_IDS.PROFIT_LOSS]: false,
  [REPORT_IDS.BALANCE_SHEET]: false
});

const proReports = Object.freeze({
  [REPORT_IDS.TRIAL_BALANCE]: true,
  [REPORT_IDS.GENERAL_LEDGER]: true,
  [REPORT_IDS.PROFIT_LOSS]: true,
  [REPORT_IDS.BALANCE_SHEET]: true
});

export const PLAN_ENTITLEMENTS = Object.freeze({
  [PLAN_IDS.STARTER]: Object.freeze({
    aiAssistantMonthlyLimit: 10,
    invoiceScanningMonthlyLimit: 10,
    activeProjectsLimit: 5,
    accountantPack: false,
    reports: starterReports
  }),
  [PLAN_IDS.PRO]: Object.freeze({
    aiAssistantMonthlyLimit: 500,
    invoiceScanningMonthlyLimit: 500,
    activeProjectsLimit: null,
    accountantPack: true,
    reports: proReports
  })
});

const monthlyLimitIds = new Set(Object.values(MONTHLY_LIMIT_IDS));
const featureIds = new Set(Object.values(FEATURE_IDS));
const reportIds = new Set(Object.values(REPORT_IDS));
const proEligibleStatuses = new Set(PRO_ELIGIBLE_SUBSCRIPTION_STATUSES);

export function normalisePlan(plan) {
  return plan === PLAN_IDS.PRO ? PLAN_IDS.PRO : PLAN_IDS.STARTER;
}

export function getPlanEntitlements(plan) {
  return PLAN_ENTITLEMENTS[normalisePlan(plan)];
}

export function getMonthlyLimit(plan, limitId) {
  if (!monthlyLimitIds.has(limitId)) {
    return 0;
  }

  return getPlanEntitlements(plan)[limitId];
}

export function isUnlimited(allowance) {
  return allowance === null;
}

export function isFeatureIncluded(plan, featureId) {
  if (!featureIds.has(featureId)) {
    return false;
  }

  return getPlanEntitlements(plan)[featureId] === true;
}

export function isReportIncluded(plan, reportId) {
  if (!reportIds.has(reportId)) {
    return false;
  }

  return getPlanEntitlements(plan).reports[reportId] === true;
}

export function isProEligibleSubscriptionStatus(status) {
  return proEligibleStatuses.has(status);
}

export function hasProAccess(plan, subscriptionStatus) {
  return normalisePlan(plan) === PLAN_IDS.PRO &&
    isProEligibleSubscriptionStatus(subscriptionStatus);
}

export function calendarMonthKey(date) {
  const value = arguments.length === 0 ? new Date() : date;

  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("calendarMonthKey expects a valid Date.");
  }

  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
