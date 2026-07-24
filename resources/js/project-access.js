import {
  PLAN_IDS,
  getPlanEntitlements,
  isUnlimited,
  normalisePlan
} from "./plan-entitlements.js";

export const PROJECT_STATUS = Object.freeze({
  ACTIVE: "Active",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold"
});

export function countActiveProjects(projects = []) {
  return projects.filter(project => project?.status === PROJECT_STATUS.ACTIVE).length;
}

export function canUseAnotherActiveProject(plan, projects = []) {
  const { activeProjectsLimit } = getPlanEntitlements(plan);
  return isUnlimited(activeProjectsLimit) ||
    countActiveProjects(projects) < activeProjectsLimit;
}

export function canSaveProjectStatus({
  plan,
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

  return canUseAnotherActiveProject(plan, projects);
}

export function activeProjectLimitMessage(plan) {
  const normalisedPlan = normalisePlan(plan);
  const { activeProjectsLimit } = getPlanEntitlements(normalisedPlan);

  if (isUnlimited(activeProjectsLimit)) {
    return "";
  }

  return `You've reached the ${normalisedPlan} limit of ${activeProjectsLimit} active projects. ` +
    `Upgrade to ${PLAN_IDS.PRO} for unlimited active projects.`;
}
