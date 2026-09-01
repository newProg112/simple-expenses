import {
  PLAN_IDS,
  effectiveBillingPlan,
  getPlanEntitlements,
  isUnlimited
} from "./plan-entitlements.js?v=20260901-stripe-live1";
import { clientStripeBillingConfiguration } from "./stripe-billing-config.js?v=20260901-stripe-live1";

export const PROJECT_STATUS = Object.freeze({
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold"
});

export function countActiveProjects(projects = []) {
  return projects.filter(project => project?.status === PROJECT_STATUS.ACTIVE).length;
}

function effectiveProjectPlan(profile, demoMode){
  return effectiveBillingPlan(
    profile,
    demoMode,
    clientStripeBillingConfiguration()
  );
}

export function canUseAnotherActiveProject(profile, projects = [], demoMode = false) {
  const { activeProjectsLimit } = getPlanEntitlements(effectiveProjectPlan(profile, demoMode));
  return isUnlimited(activeProjectsLimit) ||
    countActiveProjects(projects) < activeProjectsLimit;
}

export function canSaveProjectStatus({
  profile,
  demoMode = false,
  projects = [],
  projectId = null,
  nextStatus
}) {
  if (nextStatus !== PROJECT_STATUS.ACTIVE) {
    return true;
  }

  const existingProject = projects.find(project => project?.id === projectId);
  if (existingProject?.status === PROJECT_STATUS.ACTIVE) {
    return true;
  }

  return canUseAnotherActiveProject(profile, projects, demoMode);
}

export function activeProjectLimitMessage(profile, demoMode = false) {
  const normalisedPlan = effectiveProjectPlan(profile, demoMode);
  const { activeProjectsLimit } = getPlanEntitlements(normalisedPlan);

  if (isUnlimited(activeProjectsLimit)) {
    return "";
  }

  return `You've reached the ${normalisedPlan} limit of ${activeProjectsLimit} active projects. ` +
    `Upgrade to ${PLAN_IDS.PRO} for unlimited active projects.`;
}
