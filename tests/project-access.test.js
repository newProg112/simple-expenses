import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_IDS } from "../resources/js/plan-entitlements.js";
import {
  PROJECT_STATUS,
  activeProjectLimitMessage,
  canSaveProjectStatus,
  canUseAnotherActiveProject,
  countActiveProjects
} from "../resources/js/project-access.js";

const starterProfile = { currentPlan: PLAN_IDS.STARTER };
const explicitProProfile = { currentPlan: PLAN_IDS.PRO, billingOverride: true };

function projectsByStatus(statuses) {
  return statuses.map((status, index) => ({
    id: `project-${index + 1}`,
    status
  }));
}

describe("active project limits", () => {
  it.each([0, 1, 2, 3, 4])(
    "allows Starter to create an Active project with %i already Active",
    activeCount => {
      const projects = projectsByStatus(
        Array(activeCount).fill(PROJECT_STATUS.ACTIVE)
      );

      expect(canUseAnotherActiveProject(starterProfile, projects)).toBe(true);
      expect(canSaveProjectStatus({
        profile: starterProfile,
        projects,
        nextStatus: PROJECT_STATUS.ACTIVE
      })).toBe(true);
    }
  );

  it("prevents Starter from creating a sixth Active project", () => {
    const projects = projectsByStatus(
      Array(5).fill(PROJECT_STATUS.ACTIVE)
    );

    expect(canUseAnotherActiveProject(starterProfile, projects)).toBe(false);
    expect(canSaveProjectStatus({
      profile: starterProfile,
      projects,
      nextStatus: PROJECT_STATUS.ACTIVE
    })).toBe(false);
  });

  it("does not count Completed projects", () => {
    const projects = projectsByStatus([
      ...Array(4).fill(PROJECT_STATUS.ACTIVE),
      ...Array(8).fill(PROJECT_STATUS.COMPLETED)
    ]);

    expect(countActiveProjects(projects)).toBe(4);
    expect(canUseAnotherActiveProject(starterProfile, projects)).toBe(true);
  });

  it("does not count On Hold projects", () => {
    const projects = projectsByStatus([
      ...Array(4).fill(PROJECT_STATUS.ACTIVE),
      ...Array(8).fill(PROJECT_STATUS.ON_HOLD)
    ]);

    expect(countActiveProjects(projects)).toBe(4);
    expect(canUseAnotherActiveProject(starterProfile, projects)).toBe(true);
  });

  it("keeps Pro Active projects unlimited", () => {
    const projects = projectsByStatus(
      Array(500).fill(PROJECT_STATUS.ACTIVE)
    );

    expect(canUseAnotherActiveProject(explicitProProfile, projects)).toBe(true);
    expect(canSaveProjectStatus({
      profile: explicitProProfile,
      projects,
      nextStatus: PROJECT_STATUS.ACTIVE
    })).toBe(true);
  });

  it("gives an authoritative demo the unlimited Pro project entitlement", () => {
    const projects = projectsByStatus(Array(50).fill(PROJECT_STATUS.ACTIVE));
    expect(canUseAnotherActiveProject(starterProfile, projects, true)).toBe(true);
    expect(activeProjectLimitMessage(starterProfile, true)).toBe("");
  });

  it("prevents reopening a Completed project when Starter is at the limit", () => {
    const projects = projectsByStatus([
      ...Array(5).fill(PROJECT_STATUS.ACTIVE),
      PROJECT_STATUS.COMPLETED
    ]);
    const completedProject = projects.at(-1);

    expect(canSaveProjectStatus({
      profile: starterProfile,
      projects,
      projectId: completedProject.id,
      nextStatus: PROJECT_STATUS.ACTIVE
    })).toBe(false);
  });

  it("prevents reopening an On Hold project when Starter is at the limit", () => {
    const projects = projectsByStatus([
      ...Array(5).fill(PROJECT_STATUS.ACTIVE),
      PROJECT_STATUS.ON_HOLD
    ]);
    const onHoldProject = projects.at(-1);

    expect(canSaveProjectStatus({
      profile: starterProfile,
      projects,
      projectId: onHoldProject.id,
      nextStatus: PROJECT_STATUS.ACTIVE
    })).toBe(false);
  });

  it("allows an existing Active project to be edited at or above the limit", () => {
    const projects = projectsByStatus(
      Array(6).fill(PROJECT_STATUS.ACTIVE)
    );

    expect(canSaveProjectStatus({
      profile: starterProfile,
      projects,
      projectId: projects[0].id,
      nextStatus: PROJECT_STATUS.ACTIVE
    })).toBe(true);
  });

  it("allows Active projects to be completed or placed On Hold", () => {
    const projects = projectsByStatus(
      Array(5).fill(PROJECT_STATUS.ACTIVE)
    );

    for (const nextStatus of [
      PROJECT_STATUS.COMPLETED,
      PROJECT_STATUS.ON_HOLD
    ]) {
      expect(canSaveProjectStatus({
        profile: starterProfile,
        projects,
        projectId: projects[0].id,
        nextStatus
      })).toBe(true);
    }
  });

  it("uses the entitlement values in the friendly Starter message", () => {
    expect(activeProjectLimitMessage(starterProfile)).toBe(
      "You've reached the Starter limit of 5 active projects. " +
      "Upgrade to Pro for unlimited active projects."
    );
    expect(activeProjectLimitMessage(explicitProProfile)).toBe("");
  });
});

describe("Projects page integration", () => {
  const html = readFileSync(
    new URL("../resources/tools/projects.html", import.meta.url),
    "utf8"
  );

  it("loads the billing profile and the entitlement-backed project policy", () => {
    expect(html).toContain('from "../js/project-access.js?v=20260901-stripe-live1"');
    expect(html).toContain('doc(db, "users", user.uid)');
    expect(html).toContain('doc(db, "userProfiles", user.uid)');
  });

  it("disables both project-creation buttons when capacity is exhausted", () => {
    expect(html).toContain(
      "const limitReached = !canUseAnotherActiveProject(currentBillingProfile, projects, currentDemoMode)"
    );
    expect(html).toContain("button.disabled = limitReached");
  });

  it("checks Active capacity before any project write", () => {
    const guardPosition = html.indexOf("if (!canSaveProjectStatus({");
    const updatePosition = html.indexOf("await updateDoc(");
    const createPosition = html.indexOf("await addDoc(");

    expect(guardPosition).toBeGreaterThan(-1);
    expect(guardPosition).toBeLessThan(updatePosition);
    expect(guardPosition).toBeLessThan(createPosition);
  });
});
