import {
  FEATURE_IDS,
  PLAN_IDS,
  effectiveProductPlan,
  isFeatureIncluded
} from "./plan-entitlements.js?v=20260806-demo-pro1";

export function getAccountantPackAccess(plan, demoMode = false) {
  const allowed = isFeatureIncluded(effectiveProductPlan(plan, demoMode), FEATURE_IDS.ACCOUNTANT_PACK);

  return Object.freeze({
    allowed,
    badgeLabel: `${PLAN_IDS.PRO} feature`,
    message: allowed
      ? ""
      : `Accountant Pack is available with Simple Books ${PLAN_IDS.PRO}.`,
    upgradeLabel: `Upgrade to ${PLAN_IDS.PRO}`
  });
}
