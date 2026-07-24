import {
  FEATURE_IDS,
  PLAN_IDS,
  isFeatureIncluded
} from "./plan-entitlements.js";

export function getAccountantPackAccess(plan) {
  const allowed = isFeatureIncluded(plan, FEATURE_IDS.ACCOUNTANT_PACK);

  return Object.freeze({
    allowed,
    badgeLabel: `${PLAN_IDS.PRO} feature`,
    message: allowed
      ? ""
      : `Accountant Pack is available with Simple Books ${PLAN_IDS.PRO}.`,
    upgradeLabel: `Upgrade to ${PLAN_IDS.PRO}`
  });
}
