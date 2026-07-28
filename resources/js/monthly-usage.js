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
  "AI Assistant usage status is unavailable.";
export const USAGE_ENFORCEMENT_DISABLED_MESSAGE =
  "AI Assistant and Invoice Scanning usage are being counted. Monthly limits are not enforced yet.";

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
  trackingEnabled = false,
  enforcementEnabled = false
} = {}) {
  const plan = normalisePlan(profile?.currentPlan);
  const source = usage && typeof usage === "object" ? usage : {};
  const isTrackingEnabled = trackingEnabled === true;
  const isEnforcementEnabled = enforcementEnabled === true;

  return Object.freeze({
    plan,
    monthKey: monthKey || calendarMonthKey(),
    trackingEnabled: isTrackingEnabled,
    enforcementEnabled: isEnforcementEnabled,
    message: !isTrackingEnabled
      ? USAGE_TRACKING_DISABLED_MESSAGE
      : isEnforcementEnabled
        ? ""
        : USAGE_ENFORCEMENT_DISABLED_MESSAGE,
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
