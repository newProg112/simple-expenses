import {
  MONTHLY_LIMIT_IDS,
  calendarMonthKey,
  getMonthlyLimit,
  isUnlimited,
  normalisePlan,
  normaliseUsageCount,
  remainingMonthlyAllowance
} from "./plan-entitlements.js";

export const USAGE_TRACKING_DISABLED_MESSAGE =
  "Usage tracking is not yet enabled.";

export function buildUsageMetric(allowance, usage) {
  const current = normaliseUsageCount(usage);
  const remaining = remainingMonthlyAllowance(allowance, current);

  return Object.freeze({
    allowance: isUnlimited(allowance) ? "Unlimited" : allowance,
    current,
    remaining: isUnlimited(remaining) ? "Unlimited" : remaining
  });
}

export function buildMonthlyUsageView({
  profile,
  usage,
  monthKey,
  trackingEnabled = false
} = {}) {
  const plan = normalisePlan(profile?.currentPlan);
  const source = usage && typeof usage === "object" ? usage : {};

  return Object.freeze({
    plan,
    monthKey: monthKey || calendarMonthKey(),
    trackingEnabled: trackingEnabled === true,
    message: trackingEnabled === true ? "" : USAGE_TRACKING_DISABLED_MESSAGE,
    aiAssistant: buildUsageMetric(
      getMonthlyLimit(plan, MONTHLY_LIMIT_IDS.AI_ASSISTANT),
      source.aiAssistantSuccessfulUses
    ),
    invoiceScanning: buildUsageMetric(
      getMonthlyLimit(plan, MONTHLY_LIMIT_IDS.INVOICE_SCANNING),
      source.invoiceScanningSuccessfulUses
    )
  });
}
