import {
  PLAN_IDS,
  effectiveProductPlan,
  getPlanEntitlements,
  isUnlimited,
  normalisePlan
} from "./plan-entitlements.js?v=20260806-demo-pro1";

export const PROJECT_STATUS = Object.freeze({
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold"
});

export function countActiveProjects(projects = []) {
  return projects.filter(project => project?.status === PROJECT_STATUS.ACTIVE).length;
}

export function canUseAnotherActiveProject(plan, projects = [], demoMode = false) {
  const { activeProjectsLimit } = getPlanEntitlements(effectiveProductPlan(plan, demoMode));
  return isUnlimited(activeProjectsLimit) ||
    countActiveProjects(projects) < activeProjectsLimit;
}

export function canSaveProjectStatus({
  plan,
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

  return canUseAnotherActiveProject(plan, projects, demoMode);
}

export function activeProjectLimitMessage(plan, demoMode = false) {
  const normalisedPlan = effectiveProductPlan(normalisePlan(plan), demoMode);
  const { activeProjectsLimit } = getPlanEntitlements(normalisedPlan);

  if (isUnlimited(activeProjectsLimit)) {
    return "";
  }

  return `You've reached the ${normalisedPlan} limit of ${activeProjectsLimit} active projects. ` +
    `Upgrade to ${PLAN_IDS.PRO} for unlimited active projects.`;
}
