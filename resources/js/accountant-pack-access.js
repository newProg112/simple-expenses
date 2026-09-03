import {
  FEATURE_IDS,
  PLAN_IDS,
  effectiveBillingPlan,
  isFeatureIncluded
} from "./plan-entitlements.js?v=20260902-stripe-live2";
import { clientStripeBillingConfiguration } from "./stripe-billing-config.js?v=20260902-stripe-live2";

export function getAccountantPackAccess(profile, demoMode = false) {
  const allowed = isFeatureIncluded(
    effectiveBillingPlan(
      profile,
      demoMode,
      clientStripeBillingConfiguration()
    ),
    FEATURE_IDS.ACCOUNTANT_PACK
  );

  return Object.freeze({
    allowed,
    badgeLabel: `${PLAN_IDS.PRO} feature`,
    message: allowed
      ? ""
      : `Accountant Pack is available with Simple Books ${PLAN_IDS.PRO}.`,
    upgradeLabel: `Upgrade to ${PLAN_IDS.PRO}`
  });
}
