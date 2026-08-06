import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createDemoResetController,
  demoResetFailureMessage
} from "../assets/demo-reset.js";

const require = createRequire(import.meta.url);
const {
  createDemoResetHandler,
  emptyRequestData
} = require("../functions/lib/demo-reset-handler.js");

const uid = "official-demo-user";

function fakeModules(events = []){
  const seed = {
    businessProfile: { demoMode: true },
    customers: [], projects: [], invoices: [], bills: [], expenses: [],
    mileage: [], budgets: []
  };
  return {
    seedModule: { DEMO_SEED: seed },
    engine: {
      validateDemoSeed: vi.fn(() => ({ valid: true, errors: [] })),
      clearDemoBusiness: vi.fn(async context => {
        events.push(["clear", context.user.uid]);
        return { deletedDocuments: 10, committedBatches: 1, preservedAccountDocument: true };
      }),
      seedDemoBusiness: vi.fn(async context => {
        events.push(["seed", context.user.uid]);
        return { seedVersion: 2, writtenDocuments: 20, committedBatches: 1 };
      }),
      buildDemoJournalRecords: vi.fn(() => [])
    }
  };
}

function backend({ account = { demoMode: true }, exists = true, modules } = {}){
  const get = vi.fn(async () => ({ exists, data: () => account }));
  const firestore = { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get })) })) };
  const loadedModules = modules || fakeModules();
  return {
    firestore,
    modules: loadedModules,
    handler: createDemoResetHandler({
      firestore,
      loadSeedModules: vi.fn(async () => loadedModules),
      logger: { info: vi.fn(), error: vi.fn() }
    })
  };
}

describe("shared Demo Reset controller", () => {
  it("rejects non-demo callers before confirmation or execution", async () => {
    const confirmAction = vi.fn();
    const execute = vi.fn();
    const controller = createDemoResetController({
      isDemo: () => false,
      confirmAction,
      execute
    });
    await expect(controller.run()).resolves.toEqual({ status: "denied" });
    expect(confirmAction).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves confirmation and prevents duplicate reset requests", async () => {
    let finish;
    const execute = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const onState = vi.fn();
    const reload = vi.fn();
    const controller = createDemoResetController({
      isDemo: () => true,
      confirmAction: () => true,
      execute,
      onState,
      reload
    });
    const first = controller.run();
    const second = controller.run();
    expect(second).toBe(first);
    expect(execute).toHaveBeenCalledOnce();
    finish({ writtenDocuments: 20 });
    await expect(first).resolves.toMatchObject({ status: "success" });
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ state: "running" }));
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ state: "success" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not execute when confirmation is cancelled", async () => {
    const execute = vi.fn();
    const controller = createDemoResetController({
      isDemo: () => true,
      confirmAction: () => false,
      execute
    });
    await expect(controller.run()).resolves.toEqual({ status: "cancelled" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("surfaces real callable errors instead of the legacy placeholder", async () => {
    const states = [];
    const controller = createDemoResetController({
      isDemo: () => true,
      confirmAction: () => true,
      execute: async () => { throw { code: "functions/unavailable" }; },
      onState: state => states.push(state)
    });
    await expect(controller.run()).resolves.toMatchObject({ status: "error" });
    expect(states.at(-1).message).toBe("Demo data could not be reset. Please try again.");
    expect(demoResetFailureMessage({ code: "functions/failed-precondition" }))
      .toContain("shared demo account");
  });
});

describe("authoritative Demo Reset callable", () => {
  it("accepts no target UID or other client-selected data", () => {
    expect(emptyRequestData(undefined)).toBe(true);
    expect(emptyRequestData({})).toBe(true);
    expect(emptyRequestData({ targetUid: uid })).toBe(false);
  });

  it("requires authentication before reading Firestore", async () => {
    const { handler, firestore } = backend();
    await expect(handler({ auth: null, data: {} })).rejects.toMatchObject({
      code: "unauthenticated"
    });
    expect(firestore.collection).not.toHaveBeenCalled();
  });

  it("rejects authenticated non-demo accounts", async () => {
    const { handler, modules } = backend({ account: { demoMode: false } });
    await expect(handler({ auth: { uid }, data: {} })).rejects.toMatchObject({
      code: "failed-precondition",
      details: { stage: "validation" }
    });
    expect(modules.engine.clearDemoBusiness).not.toHaveBeenCalled();
  });

  it("derives the target from auth.uid and runs canonical clear then seed", async () => {
    const events = [];
    const modules = fakeModules(events);
    const { handler, firestore } = backend({ modules });
    const result = await handler({ auth: { uid }, data: {} });
    expect(events).toEqual([["clear", uid], ["seed", uid]]);
    expect(firestore.collection).toHaveBeenCalledWith("users");
    expect(result).toMatchObject({
      seedVersion: 2,
      clearedDocuments: 10,
      writtenDocuments: 20,
      preservedAccountDocument: true
    });
    expect(result).not.toHaveProperty("targetUid");
  });

  it("wires every authenticated banner to the real shared reset flow", () => {
    const shell = readFileSync(new URL("../assets/app-shell.js", import.meta.url), "utf8");
    const demoMode = readFileSync(new URL("../assets/demo-mode.js", import.meta.url), "utf8");
    const functions = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
    const runtimeSync = readFileSync(
      new URL("../scripts/sync-demo-seed-runtime.mjs", import.meta.url),
      "utf8"
    );
    expect(shell).toContain("createDemoResetController({");
    expect(shell).toContain("execute: callCurrentDemoReset");
    expect(functions).toContain("exports.resetDemoEnvironment = onCall(");
    expect(runtimeSync).toContain('"resources/js/plan-entitlements.js"');
    expect(demoMode).not.toContain("Demo reset will be added in a later phase.");
    expect(shell).not.toContain("handleDemoResetClick");
  });
});
