import {
  PHASE4B_MODULE_ORDER,
  createFirestorePhase4BPersistence,
  executePhase4B,
  planPhase4BExecution
} from "./canonical-workbook-phase4b.js?v=20260902-stripe-live2";

export const PHASE4C_PREFLIGHT_MAX_AGE_MS = 10 * 60 * 1000;

const LABELS = Object.freeze({
  clients: "Clients",
  projects: "Projects",
  budgets: "Budgets",
  invoices: "Invoices",
  bills: "Bills",
  expenses: "Expenses",
  mileage: "Mileage",
  invoiceItems: "Invoice Items"
});

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function issueLocation(issue = {}) {
  const sheet = String(issue.sheet || issue.module || "Workbook");
  const row = number(issue.row);
  const field = String(issue.field || "").trim();
  return [sheet, row ? `row ${row}` : "", field].filter(Boolean).join(", ");
}

export function userFacingImportIssue(issue = {}) {
  if(issue.code === "paid-accounting-history-required"){
    if(issue.module === "invoices"){
      return {
        ...issue,
        message: "This paid invoice cannot be imported safely because its payment history is not included in the workbook. Change its Status to Unpaid, or restore the payment history through a supported backup method."
      };
    }
    if(issue.module === "bills"){
      return {
        ...issue,
        message: "This paid bill cannot be imported safely because its payment history is not included in the workbook. Change its Status to Unpaid, or restore the payment history through a supported backup method."
      };
    }
  }
  return { ...issue, message: String(issue.message || "The workbook cannot be imported safely.") };
}

function displayIssue(issue) {
  const friendly = userFacingImportIssue(issue);
  return {
    ...friendly,
    location: issueLocation(friendly)
  };
}

function moduleCounts(source = {}) {
  return PHASE4B_MODULE_ORDER.map(moduleName => ({
    module: moduleName,
    label: LABELS[moduleName],
    count: number(source[moduleName])
  }));
}

function planModuleCounts(plan, group) {
  return Object.fromEntries(PHASE4B_MODULE_ORDER.map(moduleName => {
    const source = ["clients", "projects", "budgets"].includes(moduleName)
      ? plan?.phase4APlan?.[group]?.[moduleName]
      : plan?.[group]?.[moduleName];
    return [moduleName, Array.isArray(source) ? source.length : 0];
  }));
}

function total(source = {}) {
  return Object.values(source).reduce((sum, value) => sum + number(value), 0);
}

export function createPreflightPresentation(preflight, plan = null) {
  const counts = preflight?.counts || {};
  const createCounts = planModuleCounts(plan, "operations");
  const skipCounts = planModuleCounts(plan, "skipped");
  const errors = [
    ...(preflight?.errors || []),
    ...(plan?.errors || []),
    ...(plan?.conflicts || [])
  ].map(displayIssue);
  const warnings = (preflight?.warnings || []).map(displayIssue);
  const unresolved = (preflight?.unresolvedRelationships || []).map(displayIssue);
  const duplicates = (preflight?.duplicateCandidates || []).map(candidate => displayIssue({
    ...candidate,
    message: candidate.message || "A matching existing record is expected to be skipped."
  }));
  const preflightSafe = preflight?.safeToProceed === true &&
    (preflight?.errors || []).length === 0 && unresolved.length === 0;
  const canProceed = preflightSafe && plan?.eligible === true && errors.length === 0;
  return Object.freeze({
    kind: "preflight",
    workbookType: preflight?.workbookType === "canonical" ? "Canonical" : "Legacy",
    totalRecords: total(counts),
    businessRecords: total(Object.fromEntries(
      Object.entries(counts).filter(([moduleName]) => moduleName !== "invoiceItems")
    )),
    counts: Object.entries(counts).map(([module, count]) => ({
      module, label: LABELS[module] || module, count: number(count)
    })),
    createCounts: moduleCounts(createCounts),
    skipCounts: moduleCounts(skipCounts),
    createTotal: total(createCounts),
    skipTotal: total(skipCounts),
    errors,
    warnings,
    duplicates,
    unresolved,
    canProceed
  });
}

export function createConfirmationPresentation(preflight, plan) {
  const preview = createPreflightPresentation(preflight, plan);
  return Object.freeze({
    recordsToCreate: preview.createTotal,
    likelySkips: preview.skipTotal,
    warningCount: preview.warnings.length,
    modules: preview.createCounts.map(item => ({
      ...item,
      skipped: preview.skipCounts.find(skip => skip.module === item.module)?.count || 0
    })),
    paidHistoryWarning: preview.errors.some(issue => issue.code === "paid-accounting-history-required")
  });
}

export function createExecutionPresentation(result = {}) {
  const modules = PHASE4B_MODULE_ORDER.map(moduleName => ({
    module: moduleName,
    label: LABELS[moduleName],
    created: number(result.created?.[moduleName]),
    skipped: number(result.skipped?.[moduleName])
  }));
  const errors = (result.errors || []).map(displayIssue);
  const conflicts = (result.conflicts || []).map(displayIssue);
  const warnings = (result.warnings || []).map(displayIssue);
  const fidelityWarnings = (result.fidelityWarnings || []).map(displayIssue);
  const partial = result.partialWrites === true;
  return Object.freeze({
    kind: "execution",
    status: result.success === true ? "success" : partial ? "partial" : "failed",
    title: result.success === true
      ? "Workbook import complete"
      : partial
        ? "Workbook import partially completed"
        : "Workbook import failed",
    modules,
    createdTotal: modules.reduce((sum, item) => sum + item.created, 0),
    skippedTotal: modules.reduce((sum, item) => sum + item.skipped, 0),
    warnings,
    fidelityWarnings,
    conflicts,
    errors,
    partialWrites: partial
  });
}

function contextKey(user, context = {}) {
  return JSON.stringify({
    uid: String(user?.uid || ""),
    plan: String(context.plan || ""),
    demoMode: context.demoMode === true
  });
}

function planKey(plan) {
  return JSON.stringify({
    eligible: plan?.eligible === true,
    create: planModuleCounts(plan, "operations"),
    skip: planModuleCounts(plan, "skipped"),
    errors: (plan?.errors || []).map(issue => [issue.code, issue.module, issue.sheet, issue.row]),
    conflicts: (plan?.conflicts || []).map(issue => [issue.code, issue.module, issue.sheet, issue.row])
  });
}

function requireFunction(options, name) {
  if(typeof options?.[name] !== "function") throw new TypeError(`Phase 4C requires ${name}().`);
  return options[name];
}

export function createPhase4CImportController(options = {}) {
  const getSession = requireFunction(options, "getSession");
  const createPersistence = options.createPersistence || createFirestorePhase4BPersistence;
  const planExecution = options.planExecution || planPhase4BExecution;
  const executeExecution = options.executeExecution || executePhase4B;
  const confirmExecution = requireFunction(options, "confirmExecution");
  const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const setTimer = typeof options.setTimer === "function" ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === "function" ? options.clearTimer : clearTimeout;
  const maxAgeMs = number(options.maxAgeMs) || PHASE4C_PREFLIGHT_MAX_AGE_MS;
  let generation = 0;
  let expiryTimer = null;
  let armed = null;
  let busy = false;
  let state = Object.freeze({ status: "empty", reason: "no-workbook", canExecute: false });

  function publish(status, details = {}) {
    state = Object.freeze({ status, canExecute: status === "ready" && !busy, ...details });
    onStateChange(state);
    return state;
  }

  function cancelExpiry() {
    if(expiryTimer !== null) clearTimer(expiryTimer);
    expiryTimer = null;
  }

  function invalidate(reason = "invalidated") {
    generation += 1;
    cancelExpiry();
    armed = null;
    busy = false;
    return publish("empty", { reason });
  }

  async function buildCurrent(preflight) {
    const session = await getSession();
    if(!session?.user?.uid || !session.services){
      throw new Error("Please log in before importing workbook data.");
    }
    const persistence = createPersistence({
      services: session.services,
      user: session.user,
      callables: session.callables || {}
    });
    const context = await persistence.readExecutionContext();
    const plan = planExecution(preflight, context || {});
    return {
      session,
      persistence,
      context,
      plan,
      contextKey: contextKey(session.user, context),
      planKey: planKey(plan)
    };
  }

  async function arm(preflight) {
    const token = ++generation;
    cancelExpiry();
    armed = null;
    busy = true;
    publish("checking", { reason: "execution-preview" });
    try{
      const current = await buildCurrent(preflight);
      if(token !== generation) return { kind: "stale", reason: "workbook-changed" };
      const presentation = createPreflightPresentation(preflight, current.plan);
      if(!presentation.canProceed){
        busy = false;
        publish("blocked", { reason: "unsafe-preflight", presentation });
        return { kind: "blocked", presentation };
      }
      const armedAt = now();
      armed = { token, preflight, contextKey: current.contextKey, planKey: current.planKey, armedAt };
      busy = false;
      publish("ready", {
        reason: "safe-preflight",
        presentation,
        expiresAt: armedAt + maxAgeMs
      });
      expiryTimer = setTimer(() => {
        if(armed?.token === token) invalidate("preflight-stale");
      }, maxAgeMs);
      return { kind: "ready", presentation };
    }catch(error){
      if(token !== generation) return { kind: "stale", reason: "workbook-changed" };
      busy = false;
      publish("blocked", { reason: "preview-failed", error: error?.message || String(error) });
      return { kind: "blocked", error };
    }
  }

  async function revalidate(captured, expectedPlanKey = "") {
    if(!armed || armed.token !== captured.token || captured.token !== generation){
      return { valid: false, reason: "preflight-stale" };
    }
    if(now() - captured.armedAt >= maxAgeMs){
      return { valid: false, reason: "preflight-stale" };
    }
    const current = await buildCurrent(captured.preflight);
    if(!armed || armed.token !== captured.token || captured.token !== generation ||
      now() - captured.armedAt >= maxAgeMs){
      return { valid: false, reason: "preflight-stale" };
    }
    if(current.contextKey !== captured.contextKey){
      return { valid: false, reason: "account-context-changed" };
    }
    const presentation = createPreflightPresentation(captured.preflight, current.plan);
    if(!presentation.canProceed){
      return { valid: false, reason: "execution-constraints-changed", presentation };
    }
    if(expectedPlanKey && current.planKey !== expectedPlanKey){
      return { valid: false, reason: "execution-preview-changed", presentation };
    }
    return { valid: true, ...current, presentation };
  }

  async function execute() {
    if(busy) return { kind: "blocked", reason: "concurrent-execution" };
    if(!armed) return { kind: "blocked", reason: "no-safe-preflight" };
    const captured = armed;
    busy = true;
    publish("checking", { reason: "pre-confirmation-revalidation" });
    try{
      const beforeConfirmation = await revalidate(captured);
      if(!beforeConfirmation.valid){
        invalidate(beforeConfirmation.reason);
        return { kind: "stale", ...beforeConfirmation };
      }
      publish("confirming", { reason: "confirmation-required" });
      const confirmed = await confirmExecution(
        createConfirmationPresentation(captured.preflight, beforeConfirmation.plan)
      );
      if(!armed || armed.token !== captured.token || captured.token !== generation ||
        now() - captured.armedAt >= maxAgeMs){
        invalidate("preflight-stale");
        return { kind: "stale", reason: "preflight-stale" };
      }
      if(!confirmed){
        busy = false;
        publish("ready", {
          reason: "confirmation-cancelled",
          presentation: beforeConfirmation.presentation,
          expiresAt: captured.armedAt + maxAgeMs
        });
        return { kind: "cancelled" };
      }
      publish("executing", { reason: "importing-workbook" });
      const finalCheck = await revalidate(captured, beforeConfirmation.planKey);
      if(!finalCheck.valid){
        invalidate(finalCheck.reason);
        return { kind: "stale", ...finalCheck };
      }
      cancelExpiry();
      let result;
      try{
        result = await executeExecution(captured.preflight, { persistence: finalCheck.persistence });
      }catch(error){
        result = {
          success: false,
          partialWrites: false,
          created: {},
          skipped: {},
          errors: [{ code: "unexpected-execution-failure", module: "execution", message: error?.message || String(error) }],
          conflicts: [], warnings: [], fidelityWarnings: []
        };
      }
      const presentation = createExecutionPresentation(result);
      generation += 1;
      cancelExpiry();
      armed = null;
      busy = false;
      publish("consumed", { reason: result.success ? "completed" : "failed", presentation });
      return { kind: "completed", result, presentation };
    }catch(error){
      generation += 1;
      cancelExpiry();
      armed = null;
      busy = false;
      const result = {
        success: false,
        partialWrites: false,
        created: {}, skipped: {}, conflicts: [], warnings: [], fidelityWarnings: [],
        errors: [{ code: "unexpected-execution-failure", module: "execution", message: error?.message || String(error) }]
      };
      const presentation = createExecutionPresentation(result);
      publish("consumed", { reason: "failed", presentation });
      return { kind: "completed", result, presentation };
    }
  }

  return Object.freeze({
    arm,
    execute,
    invalidate,
    snapshot: () => state
  });
}

if(typeof window !== "undefined"){
  window.simpleBooksCanonicalWorkbookPhase4C = Object.freeze({
    createController: createPhase4CImportController,
    createPersistence: createFirestorePhase4BPersistence,
    planExecution: planPhase4BExecution,
    executeExecution: executePhase4B,
    createPreflightPresentation,
    createExecutionPresentation
  });
}
