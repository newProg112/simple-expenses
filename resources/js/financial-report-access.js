import {
  PLAN_IDS,
  REPORT_IDS,
  effectiveProductPlan,
  isReportIncluded
} from "./plan-entitlements.js?v=20260806-demo-pro1";

const REPORT_LABELS = Object.freeze({
  [REPORT_IDS.TRIAL_BALANCE]: "Trial Balance",
  [REPORT_IDS.GENERAL_LEDGER]: "General Ledger",
  [REPORT_IDS.PROFIT_LOSS]: "Profit & Loss",
  [REPORT_IDS.BALANCE_SHEET]: "Balance Sheet"
});

export function getFinancialReportAccess(plan, reportId, demoMode = false) {
  const reportLabel = REPORT_LABELS[reportId] || "Financial report";
  const allowed = isReportIncluded(effectiveProductPlan(plan, demoMode), reportId);

  return Object.freeze({
    allowed,
    badgeLabel: `${PLAN_IDS.PRO} feature`,
    message: allowed
      ? ""
      : `${reportLabel} is available with Simple Books ${PLAN_IDS.PRO}.`,
    upgradeLabel: `Upgrade to ${PLAN_IDS.PRO}`
  });
}

export function renderFinancialReportAccess(access, {
  gate,
  reportContent
}) {
  const locked = !access.allowed;
  reportContent.hidden = locked;
  gate.hidden = !locked;
  gate.replaceChildren();

  if (!locked) {
    return;
  }

  const badge = document.createElement("span");
  badge.className = "financial-report-plan-badge";
  badge.textContent = access.badgeLabel;

  const message = document.createElement("p");
  message.className = "financial-report-upgrade-message";
  message.textContent = access.message;

  const upgradeLink = document.createElement("a");
  upgradeLink.className = "btn";
  upgradeLink.href = "/account.html";
  upgradeLink.textContent = access.upgradeLabel;

  gate.append(badge, message, upgradeLink);
}
