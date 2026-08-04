import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createDemoEnvironmentController,
  demoSeedFailureState,
  validateDemoTargetUid
} from "../assets/admin-demo-environment.js";

const require = createRequire(import.meta.url);
const {
  createAdminDemoSeedHandler,
  defaultSeedModuleLoader
} = require("../functions/lib/admin-demo-seed-handler.js");
const dashboardSource = readFileSync(
  new URL("../assets/admin-dashboard.js", import.meta.url),
  "utf8"
);
const adminHtml = readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const functionsIndexSource = readFileSync(
  new URL("../functions/index.js", import.meta.url),
  "utf8"
);
const firebaseConfiguration = JSON.parse(
  readFileSync(new URL("../firebase.json", import.meta.url), "utf8")
);
const functionsPackage = JSON.parse(
  readFileSync(new URL("../functions/package.json", import.meta.url), "utf8")
);

const TARGET_UID = "official-demo-account-uid";
const ADMIN_UID = "authorised-admin-uid";

function firestoreWithTarget({ exists = true, data = {} } = {}){
  const get = vi.fn().mockResolvedValue({ exists, data: () => data });
  const doc = vi.fn(() => ({ get }));
  const collection = vi.fn(() => ({ doc }));
  return { firestore: { collection }, get, doc, collection };
}

function fakeModules(events = []){
  const seed = {
    businessProfile: { demoMode: true },
    customers: Array(10).fill({}),
    projects: Array(7).fill({}),
    invoices: Array(25).fill({}),
    bills: Array(18).fill({}),
    expenses: Array(20).fill({}),
    mileage: Array(15).fill({}),
    budgets: Array(7).fill({})
  };
  return {
    seedModule: { DEMO_SEED: seed },
    engine: {
      validateDemoSeed: vi.fn(() => ({ valid: true, errors: [] })),
      clearDemoBusiness: vi.fn(async context => {
        events.push(["clear", context.user.uid]);
        return { deletedDocuments: 23, committedBatches: 2, preservedAccountDocument: true };
      }),
      seedDemoBusiness: vi.fn(async context => {
        events.push(["seed", context.user.uid]);
        return { seedVersion: 2, writtenDocuments: 181, committedBatches: 1 };
      }),
      buildDemoJournalRecords: vi.fn(() => Array(78).fill({}))
    }
  };
}

function backendHandler({ target = { exists: true, data: { demoMode: true } }, modules } = {}){
  const database = firestoreWithTarget(target);
  const loadedModules = modules || fakeModules();
  const handler = createAdminDemoSeedHandler({
    firestore: database.firestore,
    adminUidConfiguration: ADMIN_UID,
    loadSeedModules: vi.fn(async () => loadedModules),
    logger: { info: vi.fn(), error: vi.fn() }
  });
  return { handler, database, modules: loadedModules };
}

function request(data = { targetUid: TARGET_UID }, uid = ADMIN_UID){
  return { auth: uid ? { uid } : null, data };
}

describe("admin demo environment frontend controller", () => {
  it("keeps the control unavailable to non-admin users", async () => {
    const execute = vi.fn();
    const onState = vi.fn();
    const controller = createDemoEnvironmentController({
      isAdmin: () => false,
      confirmAction: () => true,
      execute,
      onState
    });
    await expect(controller.run(TARGET_UID)).resolves.toEqual({ status: "denied" });
    expect(execute).not.toHaveBeenCalled();
    expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({
      state: "error",
      stage: "validation"
    }));
    expect(adminHtml).toContain('id="adminContent" hidden');
  });

  it("rejects a missing or malformed UID before confirmation", async () => {
    expect(validateDemoTargetUid("   ").valid).toBe(false);
    expect(validateDemoTargetUid("users/not-a-uid").valid).toBe(false);
    const execute = vi.fn();
    const confirmAction = vi.fn();
    const controller = createDemoEnvironmentController({
      isAdmin: () => true,
      confirmAction,
      execute
    });
    await expect(controller.run("")).resolves.toMatchObject({
      status: "rejected",
      stage: "validation"
    });
    expect(confirmAction).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("performs no writes or deletes when confirmation is cancelled", async () => {
    const execute = vi.fn();
    const controller = createDemoEnvironmentController({
      isAdmin: () => true,
      confirmAction: () => false,
      execute
    });
    await expect(controller.run(TARGET_UID)).resolves.toEqual({ status: "cancelled" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("prevents duplicate clicks while the operation is active", async () => {
    let finish;
    const execute = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const controller = createDemoEnvironmentController({
      isAdmin: () => true,
      confirmAction: () => true,
      execute
    });
    const first = controller.run(TARGET_UID);
    const second = controller.run(TARGET_UID);
    expect(second).toBe(first);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(controller.isRunning()).toBe(true);
    finish({ writtenDocuments: 181, counts: { invoices: 25 } });
    await first;
    expect(controller.isRunning()).toBe(false);
  });

  it("reports successful counts and surfaces stage-specific errors", async () => {
    const states = [];
    const result = { writtenDocuments: 181, counts: { invoices: 25, journals: 78 } };
    const successController = createDemoEnvironmentController({
      isAdmin: () => true,
      confirmAction: () => true,
      execute: async () => result,
      onState: state => states.push(state)
    });
    await expect(successController.run(TARGET_UID)).resolves.toEqual({ status: "success", result });
    expect(states.at(-1)).toMatchObject({ state: "success", result });

    const failure = { code: "functions/internal", details: { stage: "seeding" } };
    const errorController = createDemoEnvironmentController({
      isAdmin: () => true,
      confirmAction: () => true,
      execute: async () => { throw failure; },
      onState: state => states.push(state)
    });
    await expect(errorController.run(TARGET_UID)).resolves.toMatchObject({
      status: "error",
      stage: "seeding"
    });
    expect(demoSeedFailureState(failure).message).toContain("seeding failed");
    expect(states.at(-1)).toMatchObject({ state: "error", stage: "seeding" });
  });

  it("does not seed automatically during page load or authentication", () => {
    const authSection = dashboardSource.slice(dashboardSource.lastIndexOf("onAuthStateChanged("));
    expect(authSection).not.toContain("callSeedAdminDemoEnvironment");
    expect(dashboardSource).toContain('seedDemoDataButton.addEventListener("click"');
    expect(dashboardSource.match(/callSeedAdminDemoEnvironment\(\{ targetUid \}\)/g)).toHaveLength(1);
  });

  it("wires one protected callable and prepares canonical runtime files for deployment", () => {
    expect(functionsIndexSource).toContain("exports.seedAdminDemoEnvironment = onCall(");
    expect(functionsIndexSource).toContain("createAdminDemoSeedHandler({");
    expect(functionsPackage.scripts["prepare:demo-seed"])
      .toBe("node ../scripts/sync-demo-seed-runtime.mjs");
    expect(firebaseConfiguration.functions[0].predeploy).toEqual([
      'npm --prefix "$RESOURCE_DIR" run lint',
      'npm --prefix "$RESOURCE_DIR" run prepare:demo-seed'
    ]);
  });
});

describe("admin demo environment callable", () => {
  it("loads the existing canonical seed and engine without duplicating them", async () => {
    const { engine, seedModule } = await defaultSeedModuleLoader();
    expect(seedModule.DEMO_SEED.businessProfile.businessName)
      .toBe("Northbank Creative Studio Ltd");
    expect(engine.validateDemoSeed(seedModule.DEMO_SEED)).toEqual({
      valid: true,
      errors: []
    });
  });

  it("rejects non-admin operators before reading the target", async () => {
    const { handler, database } = backendHandler();
    await expect(handler(request(undefined, "normal-user-uid"))).rejects.toMatchObject({
      code: "permission-denied",
      details: { stage: "validation" }
    });
    expect(database.collection).not.toHaveBeenCalled();
  });

  it("rejects a missing UID", async () => {
    const { handler, database } = backendHandler();
    await expect(handler(request({ targetUid: "" }))).rejects.toMatchObject({
      code: "invalid-argument",
      details: { stage: "validation" }
    });
    expect(database.collection).not.toHaveBeenCalled();
  });

  it("rejects a nonexistent target user", async () => {
    const { handler, modules } = backendHandler({ target: { exists: false, data: {} } });
    await expect(handler(request())).rejects.toMatchObject({ code: "not-found" });
    expect(modules.engine.clearDemoBusiness).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["false", { demoMode: false }],
    ["truthy string", { demoMode: "true" }]
  ])("rejects a target whose demoMode is %s", async (_label, data) => {
    const { handler, modules } = backendHandler({ target: { exists: true, data } });
    await expect(handler(request())).rejects.toMatchObject({
      code: "failed-precondition",
      details: { stage: "validation" }
    });
    expect(modules.engine.clearDemoBusiness).not.toHaveBeenCalled();
    expect(modules.engine.seedDemoBusiness).not.toHaveBeenCalled();
  });

  it("allows literal demoMode true, clears before seeding, and returns expected counts", async () => {
    const events = [];
    const modules = fakeModules(events);
    const { handler } = backendHandler({ modules });
    const result = await handler(request());
    expect(events).toEqual([["clear", TARGET_UID], ["seed", TARGET_UID]]);
    expect(result).toMatchObject({
      targetUid: TARGET_UID,
      seedVersion: 2,
      clearedDocuments: 23,
      writtenDocuments: 181,
      preservedAccountDocument: true,
      counts: {
        businessProfile: 1,
        customers: 10,
        projects: 7,
        invoices: 25,
        bills: 18,
        expenses: 20,
        mileage: 15,
        budgets: 7,
        journals: 78
      }
    });
  });

  it("reports clearing failures without attempting seeding", async () => {
    const modules = fakeModules();
    modules.engine.clearDemoBusiness.mockRejectedValue(new Error("batch rejected"));
    const { handler } = backendHandler({ modules });
    await expect(handler(request())).rejects.toMatchObject({
      code: "internal",
      details: { stage: "clearing" }
    });
    expect(modules.engine.seedDemoBusiness).not.toHaveBeenCalled();
  });

  it("reports seeding failures only after clearing succeeds", async () => {
    const modules = fakeModules();
    modules.engine.seedDemoBusiness.mockRejectedValue(new Error("batch rejected"));
    const { handler } = backendHandler({ modules });
    await expect(handler(request())).rejects.toMatchObject({
      code: "internal",
      details: { stage: "seeding", clearedDocuments: 23 }
    });
    expect(modules.engine.clearDemoBusiness).toHaveBeenCalledTimes(1);
    expect(modules.engine.seedDemoBusiness).toHaveBeenCalledTimes(1);
  });
});
