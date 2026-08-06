import { resolveProductAccess } from "./demo-mode.js?v=20260806-demo-pro3";
import { PLAN_IDS } from "../resources/js/plan-entitlements.js?v=20260806-demo-pro1";

const STARTER_SNAPSHOT_METRIC_IDS = Object.freeze([
  "outstandingInvoices",
  "overdueInvoices",
  "unpaidBills",
  "activeProjects"
]);
const FULL_SNAPSHOT_METRIC_IDS = Object.freeze([
  "outstandingInvoices",
  "overdueInvoices",
  "unpaidBills",
  "monthRevenue",
  "monthExpenses",
  "monthProfit",
  "activeProjects",
  "lossMakingProjects",
  "pressuredBudgets"
]);

function snapshotData(snapshot){
  return snapshot?.exists?.() === true ? snapshot.data() || {} : {};
}

export function resolveBusinessInsightsAccess(accountSnapshot, profileSnapshot){
  const account = snapshotData(accountSnapshot);
  const productAccess = resolveProductAccess(
    account,
    snapshotData(profileSnapshot)
  );
  return Object.freeze({
    ...productAccess,
    vatRegistered: String(account.vatRegistered || "").trim().toLowerCase() === "yes" || account.vatRegistered === true,
    fullAccess: productAccess.effectivePlan === PLAN_IDS.PRO,
    starterPreview: productAccess.effectivePlan === PLAN_IDS.STARTER
  });
}

export async function loadBusinessInsightsAccess(user, services){
  if(!user?.uid || !services?.db || typeof services.doc !== "function" || typeof services.getDoc !== "function"){
    throw new Error("Business Insights access services are unavailable.");
  }
  const [accountSnapshot, profileSnapshot] = await Promise.all([
    services.getDoc(services.doc(services.db, "users", user.uid)),
    services.getDoc(services.doc(services.db, "userProfiles", user.uid))
  ]);
  return resolveBusinessInsightsAccess(accountSnapshot, profileSnapshot);
}

export function businessInsightsVisibility(access){
  if(!access || typeof access.fullAccess !== "boolean"){
    throw new Error("Resolved Business Insights access is required.");
  }
  return Object.freeze({
    scoreBreakdown: access.fullAccess,
    priorityLimit: access.fullAccess ? 5 : 2,
    trends: access.fullAccess,
    fullSnapshot: access.fullAccess,
    snapshotLayout: access.fullAccess ? "full" : "compact",
    snapshotMetricIds: access.fullAccess
      ? FULL_SNAPSHOT_METRIC_IDS
      : STARTER_SNAPSHOT_METRIC_IDS,
    methodology: access.fullAccess,
    upgradePrompt: access.starterPreview,
    billingActions: access.starterPreview && !access.demo,
    actionableDetails: access.fullAccess,
    actionablePreview: access.starterPreview
  });
}

export function businessInsightsPresentation(model, access){
  const visibility = businessInsightsVisibility(access);
  const snapshot = model?.snapshot || {};
  return Object.freeze({
    visibility,
    actionable: visibility.actionableDetails ? Object.freeze((model?.actionable?.recommendations || []).slice(0, 6)) : Object.freeze([]),
    actionableTeasers: visibility.actionablePreview ? Object.freeze((model?.actionable?.teasers || []).slice(0, 2)) : Object.freeze([]),
    priorities: Object.freeze((model?.priorities || []).slice(0, visibility.priorityLimit)),
    snapshot: visibility.fullSnapshot ? snapshot : Object.freeze({
      outstandingInvoiceTotal: snapshot.outstandingInvoiceTotal,
      overdueInvoiceCount: snapshot.overdueInvoiceCount,
      overdueInvoiceValue: snapshot.overdueInvoiceValue,
      unpaidBillsTotal: snapshot.unpaidBillsTotal,
      activeProjects: snapshot.activeProjects
    })
  });
}
