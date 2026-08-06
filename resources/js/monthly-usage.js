import {
  MONTHLY_LIMIT_IDS,
  calendarMonthKey,
  effectiveProductPlan,
  getMonthlyLimit,
  isUnlimited,
  normaliseUsageCount,
  remainingMonthlyAllowance
} from "./plan-entitlements.js?v=20260806-demo-pro2";

export const USAGE_TRACKING_DISABLED_MESSAGE =
  "AI Assistant usage status is unavailable.";
export const USAGE_ENFORCEMENT_DISABLED_MESSAGE =
  "AI Assistant and Invoice Scanning usage are being counted. Monthly limits are not enforced yet.";
export const DEMO_USAGE_MESSAGE =
  "Full Pro demo allowances are shown. Usage is counted for the shared demo and is not billed.";
export const USAGE_LOADING_MESSAGE =
  "Checking authoritative monthly usage…";

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
  usage,
  monthKey,
  trackingEnabled = false,
  enforcementEnabled = false
} = {}) {
  const source = usage && typeof usage === "object" ? usage : {};
  const authoritative = ["Starter", "Pro"].includes(source.effectivePlan);
  const authoritativeDemo = source.demoMode === true || source.isDemo === true;
  const plan = authoritative
    ? effectiveProductPlan(source.effectivePlan, authoritativeDemo)
    : "";
  const displayPlan = authoritative
    ? authoritativeDemo ? "Pro Demo" : plan
    : "Checking access";
  const isTrackingEnabled = trackingEnabled === true;
  const isEnforcementEnabled = enforcementEnabled === true;
  const unavailableMetric = successfulUses => Object.freeze({
    allowance: "—",
    current: normaliseUsageCount(successfulUses),
    remaining: "—"
  });

  return Object.freeze({
    plan,
    displayPlan,
    loaded: authoritative,
    monthKey: monthKey || calendarMonthKey(),
    trackingEnabled: isTrackingEnabled,
    enforcementEnabled: isEnforcementEnabled,
    demoMode: authoritativeDemo,
    entitlementSource: !authoritative
      ? "unavailable"
      : source.entitlementSource === "demo-entitlement"
        ? "demo-entitlement"
        : "billing-profile",
    message: !authoritative
      ? USAGE_LOADING_MESSAGE
      : authoritativeDemo
      ? DEMO_USAGE_MESSAGE
      : !isTrackingEnabled
      ? USAGE_TRACKING_DISABLED_MESSAGE
      : isEnforcementEnabled
        ? ""
        : USAGE_ENFORCEMENT_DISABLED_MESSAGE,
    aiAssistant: authoritative ? buildUsageMetric(
      getMonthlyLimit(plan, MONTHLY_LIMIT_IDS.AI_ASSISTANT),
      source.aiAssistantSuccessfulUses
    ) : unavailableMetric(source.aiAssistantSuccessfulUses),
    invoiceScanning: authoritative ? buildUsageMetric(
      getMonthlyLimit(plan, MONTHLY_LIMIT_IDS.INVOICE_SCANNING),
      source.invoiceScanningSuccessfulUses
    ) : unavailableMetric(source.invoiceScanningSuccessfulUses)
  });
}
