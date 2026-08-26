import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createExecutionPresentation,
  createPhase4CImportController,
  createPreflightPresentation,
  userFacingImportIssue
} from "../resources/js/canonical-workbook-phase4c.js";

const MODULES = ["clients", "projects", "budgets", "invoices", "bills", "expenses", "mileage"];

function list(count) {
  return Array.from({ length: count }, (_, index) => ({ index }));
}

function preflight(overrides = {}) {
  return {
    workbookType: "canonical",
    safeToProceed: true,
    counts: {
      clients: 1, projects: 1, budgets: 1, invoices: 1,
      invoiceItems: 1, bills: 1, expenses: 1, mileage: 1
    },
    errors: [], warnings: [], duplicateCandidates: [], unresolvedRelationships: [],
    ...overrides
  };
}

function plan(overrides = {}) {
  const operations = Object.fromEntries(MODULES.map(moduleName => [moduleName, list(1)]));
  const skipped = Object.fromEntries(MODULES.map(moduleName => [moduleName, []]));
  return {
    eligible: true,
    phase4APlan: {
      operations: {
        clients: operations.clients, projects: operations.projects, budgets: operations.budgets
      },
      skipped: { clients: [], projects: [], budgets: [] }
    },
    operations: {
      invoices: operations.invoices, bills: operations.bills,
      expenses: operations.expenses, mileage: operations.mileage
    },
    skipped,
    errors: [], conflicts: [],
    ...overrides
  };
}

function successfulResult(overrides = {}) {
  return {
    success: true,
    partialWrites: false,
    created: Object.fromEntries(MODULES.map(moduleName => [moduleName, 1])),
    skipped: Object.fromEntries(MODULES.map(moduleName => [moduleName, moduleName === "bills" ? 2 : 0])),
    errors: [], conflicts: [], warnings: [], fidelityWarnings: [],
    ...overrides
  };
}

function fixture(overrides = {}) {
  const states = [];
  const context = overrides.context || { plan: "Pro", demoMode: false };
  const persistence = { readExecutionContext: vi.fn(async () => structuredClone(context)) };
  const executeExecution = overrides.executeExecution || vi.fn(async () => successfulResult());
  const confirmExecution = overrides.confirmExecution || vi.fn(async () => true);
  const planExecution = overrides.planExecution || vi.fn(() => plan());
  let currentNow = 1000;
  let user = { uid: "user-1" };
  const getSession = overrides.getSession || vi.fn(async () => ({
    user, services: { db: {} }, callables: {}
  }));
  const controller = createPhase4CImportController({
    getSession,
    createPersistence: vi.fn(() => persistence),
    planExecution,
    executeExecution,
    confirmExecution,
    onStateChange: state => states.push(state),
    now: () => currentNow,
    maxAgeMs: 100,
    setTimer: vi.fn(() => 1),
    clearTimer: vi.fn()
  });
  return {
    controller, states, persistence, executeExecution, confirmExecution, planExecution, getSession,
    setNow(value){ currentNow = value; },
    setUser(value){ user = value; }
  };
}

describe("canonical workbook Phase 4C controller", () => {
  it("starts with Import All ineligible before upload", () => {
    expect(fixture().controller.snapshot()).toMatchObject({
      status: "empty", reason: "no-workbook", canExecute: false
    });
  });

  it("arms only a safe canonical preflight accepted by the execution planner", async () => {
    const testFixture = fixture();
    const result = await testFixture.controller.arm(preflight());
    expect(result.kind).toBe("ready");
    expect(result.presentation).toMatchObject({ canProceed: true, createTotal: 7, skipTotal: 0 });
    expect(testFixture.controller.snapshot()).toMatchObject({ status: "ready", canExecute: true });
  });

  it.each([
    ["errors", { errors: [{ code: "invalid-row", sheet: "Bills", row: 4, message: "Invalid Bill" }] }],
    ["unresolved relationships", { unresolvedRelationships: [{ code: "missing-client", sheet: "Invoices", row: 3, message: "Client missing" }] }]
  ])("keeps execution disabled for preflight %s", async (_label, change) => {
    const testFixture = fixture();
    const result = await testFixture.controller.arm(preflight(change));
    expect(result.kind).toBe("blocked");
    expect(testFixture.controller.snapshot().canExecute).toBe(false);
  });

  it("expires stale preflight and performs zero writes", async () => {
    const testFixture = fixture();
    await testFixture.controller.arm(preflight());
    testFixture.setNow(1100);
    const result = await testFixture.controller.execute();
    expect(result).toMatchObject({ kind: "stale", reason: "preflight-stale" });
    expect(testFixture.executeExecution).not.toHaveBeenCalled();
    expect(testFixture.controller.snapshot().canExecute).toBe(false);
  });

  it("invalidates a materially changed account before confirmation", async () => {
    const testFixture = fixture();
    await testFixture.controller.arm(preflight());
    testFixture.setUser({ uid: "user-2" });
    const result = await testFixture.controller.execute();
    expect(result).toMatchObject({ kind: "stale", reason: "account-context-changed" });
    expect(testFixture.confirmExecution).not.toHaveBeenCalled();
    expect(testFixture.executeExecution).not.toHaveBeenCalled();
  });

  it.each([
    ["invoices", "invoice"],
    ["bills", "bill"]
  ])("surfaces the accounting-history stop for paid %s in user language", (module, noun) => {
    const issue = userFacingImportIssue({
      code: "paid-accounting-history-required", module,
      message: "internal settlement wording"
    });
    expect(issue.message).toContain(`This paid ${noun} cannot be imported safely`);
    expect(issue.message).toContain("Change its Status to Unpaid");
    expect(issue.message).not.toContain("account 1100");
  });

  it("blocks Import All and presents a new Paid Invoice planner error clearly", async () => {
    const planExecution = vi.fn(() => plan({
      eligible: false,
      errors: [{
        code: "paid-accounting-history-required", module: "invoices",
        sheet: "Invoices", row: 4, message: "internal settlement wording"
      }]
    }));
    const testFixture = fixture({ planExecution });
    const result = await testFixture.controller.arm(preflight());
    expect(result.kind).toBe("blocked");
    expect(result.presentation.errors[0]).toMatchObject({
      location: "Invoices, row 4"
    });
    expect(result.presentation.errors[0].message).toContain("payment history is not included in the workbook");
    expect(testFixture.controller.snapshot().canExecute).toBe(false);
  });

  it("requires confirmation and cancellation performs zero writes", async () => {
    const confirmExecution = vi.fn(async () => false);
    const testFixture = fixture({ confirmExecution });
    await testFixture.controller.arm(preflight());
    const result = await testFixture.controller.execute();
    expect(result.kind).toBe("cancelled");
    expect(confirmExecution).toHaveBeenCalledWith(expect.objectContaining({
      recordsToCreate: 7, likelySkips: 0, warningCount: 0
    }));
    expect(testFixture.executeExecution).not.toHaveBeenCalled();
    expect(testFixture.controller.snapshot()).toMatchObject({ status: "ready", canExecute: true });
  });

  it("prevents concurrent confirmation/execution", async () => {
    let resolveConfirmation;
    const confirmExecution = vi.fn(() => new Promise(resolve => { resolveConfirmation = resolve; }));
    const testFixture = fixture({ confirmExecution });
    await testFixture.controller.arm(preflight());
    const first = testFixture.controller.execute();
    await vi.waitFor(() => expect(confirmExecution).toHaveBeenCalledOnce());
    await expect(testFixture.controller.execute()).resolves.toEqual({
      kind: "blocked", reason: "concurrent-execution"
    });
    resolveConfirmation(false);
    await first;
    expect(testFixture.executeExecution).not.toHaveBeenCalled();
  });

  it("invokes the approved executor once and consumes trusted state after success", async () => {
    const testFixture = fixture();
    const trusted = preflight();
    await testFixture.controller.arm(trusted);
    const result = await testFixture.controller.execute();
    expect(testFixture.executeExecution).toHaveBeenCalledOnce();
    expect(testFixture.executeExecution).toHaveBeenCalledWith(trusted, {
      persistence: testFixture.persistence
    });
    expect(result.presentation.status).toBe("success");
    expect(testFixture.controller.snapshot()).toMatchObject({ status: "consumed", canExecute: false });
    await expect(testFixture.controller.execute()).resolves.toEqual({
      kind: "blocked", reason: "no-safe-preflight"
    });
  });

  it("stops when execution-time constraints change before confirmation", async () => {
    const planExecution = vi.fn()
      .mockReturnValueOnce(plan())
      .mockReturnValueOnce(plan({
        eligible: false,
        errors: [{ code: "active-project-limit", module: "projects", message: "Plan limit changed" }]
      }));
    const testFixture = fixture({ planExecution });
    await testFixture.controller.arm(preflight());
    const result = await testFixture.controller.execute();
    expect(result).toMatchObject({ kind: "stale", reason: "execution-constraints-changed" });
    expect(testFixture.confirmExecution).not.toHaveBeenCalled();
    expect(testFixture.executeExecution).not.toHaveBeenCalled();
  });

  it("shows created and skipped separately and surfaces warnings/fidelity warnings", () => {
    const presentation = createExecutionPresentation(successfulResult({
      warnings: [{ code: "warning", message: "Review this row" }],
      fidelityWarnings: [{ code: "legacy-invoice-item-synthesized", message: "Invoice detail reconstructed" }]
    }));
    expect(presentation.modules.find(item => item.module === "bills")).toMatchObject({
      created: 1, skipped: 2
    });
    expect(presentation.createdTotal).toBe(7);
    expect(presentation.skippedTotal).toBe(2);
    expect(presentation.warnings).toHaveLength(1);
    expect(presentation.fidelityWarnings).toHaveLength(1);
  });

  it("visibly preserves partialWrites and failure details, then requires fresh state", async () => {
    const executeExecution = vi.fn(async () => successfulResult({
      success: false,
      partialWrites: true,
      created: { clients: 1, projects: 1, budgets: 0, invoices: 0, bills: 0, expenses: 0, mileage: 0 },
      errors: [{ code: "accounting-persistence-failure", module: "invoices", message: "Invoice write stopped" }]
    }));
    const testFixture = fixture({ executeExecution });
    await testFixture.controller.arm(preflight());
    const result = await testFixture.controller.execute();
    expect(result.presentation).toMatchObject({
      status: "partial", partialWrites: true, title: "Workbook import partially completed"
    });
    expect(result.presentation.errors[0].message).toBe("Invoice write stopped");
    expect(testFixture.controller.snapshot()).toMatchObject({ status: "consumed", canExecute: false });
  });

  it("recovers controls into consumed state after an unexpected executor throw", async () => {
    const testFixture = fixture({
      executeExecution: vi.fn(async () => { throw new Error("unexpected outage"); })
    });
    await testFixture.controller.arm(preflight());
    const result = await testFixture.controller.execute();
    expect(result.presentation).toMatchObject({ status: "failed", partialWrites: false });
    expect(result.presentation.errors[0].message).toBe("unexpected outage");
    expect(testFixture.controller.snapshot()).toMatchObject({ status: "consumed", canExecute: false });
  });

  it("presents row-level errors, warnings, duplicates and unresolved relationships without raw JSON", () => {
    const presentation = createPreflightPresentation(preflight({
      errors: [{ code: "bad-date", sheet: "Expenses", row: 8, field: "Date", message: "Date is invalid" }],
      warnings: [{ code: "warning", sheet: "Bills", row: 5, message: "Review Bill" }],
      duplicateCandidates: [{ code: "duplicate", module: "clients", sheet: "Clients", row: 3 }],
      unresolvedRelationships: [{ code: "missing-project", sheet: "Mileage", row: 9, message: "Project missing" }]
    }), plan());
    expect(presentation.errors[0]).toMatchObject({ location: "Expenses, row 8, Date", message: "Date is invalid" });
    expect(presentation.warnings).toHaveLength(1);
    expect(presentation.duplicates).toHaveLength(1);
    expect(presentation.unresolved).toHaveLength(1);
    expect(presentation.canProceed).toBe(false);
  });
});

describe("Phase 4C exports UI wiring", () => {
  const exportsSource = readFileSync(fileURLToPath(new URL("../exports.html", import.meta.url)), "utf8");
  const phase4CSource = readFileSync(fileURLToPath(new URL("../resources/js/canonical-workbook-phase4c.js", import.meta.url)), "utf8");
  const importAllStart = exportsSource.indexOf("async function importValidatedWorkbookAll()");
  const importAllEnd = exportsSource.indexOf("async function runSingleWorkbookImport", importAllStart);
  const importAllPath = exportsSource.slice(importAllStart, importAllEnd);

  it("keeps Import All disabled before upload and permanently disables legacy module buttons", () => {
    expect(exportsSource).toContain('id="importAllButton" onclick="importValidatedWorkbookAll()" disabled');
    expect(exportsSource).toContain("Legacy per-module import options (disabled)");
    expect(exportsSource).toContain("setLegacyModuleImportButtonsEnabled(false)");
  });

  it("wires only the trusted Phase 4C controller to Import All", () => {
    expect(exportsSource).toContain("canonical-workbook-phase4c.js");
    expect(importAllPath).toContain("controller.execute()");
    expect(importAllPath).not.toMatch(/importClientsFromWorkbook|importInvoicesFromWorkbook|importBillsFromWorkbook|importExpensesFromWorkbook|importMileageFromWorkbook/);
    expect(phase4CSource).toContain("executePhase4B");
    expect(phase4CSource).toContain("planPhase4BExecution");
  });

  it("preserves approved module order and contains no Banking/settlement writer", () => {
    expect(MODULES).toEqual(["clients", "projects", "budgets", "invoices", "bills", "expenses", "mileage"]);
    expect(phase4CSource).not.toMatch(/createBankTransaction|createBankSettlementJournal|markBankMatched|bankSettlement\s*:/);
  });

  it("does not automatically execute during load", () => {
    const scriptTag = '<script type="module" src="/resources/js/canonical-workbook-phase4c.js?v=20260826-canonical-workbook4c1"></script>';
    expect(exportsSource).toContain(scriptTag);
    expect(exportsSource.slice(exportsSource.indexOf(scriptTag), exportsSource.indexOf("<script>", exportsSource.indexOf(scriptTag))))
      .not.toContain("importValidatedWorkbookAll()");
  });

  it("keeps the classic exports script syntactically valid", () => {
    const classicScripts = [...exportsSource.matchAll(/<script(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/g)]
      .map(match => match[1])
      .filter(source => source.trim());
    classicScripts.forEach(source => expect(() => new Function(source)).not.toThrow());
  });
});
