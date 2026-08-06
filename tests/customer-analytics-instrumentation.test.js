import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {describe, expect, it, vi} from "vitest";

const require = createRequire(import.meta.url);
const {
  CUSTOMER_ANALYTICS_EVENT_TYPES,
  validateFrontendActivityRequest,
  writeActivityEvent
} = require("../functions/lib/admin-activity.js");
const {createActivityLoggerHandler} = require("../functions/lib/admin-activity-handlers.js");
const {aggregateCustomerAnalytics, normalizeEventName} = require("../functions/lib/admin-customer-analytics.js");

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sources = {
  bills: read("resources/tools/bills.html"),
  expenses: read("resources/tools/expenses.html"),
  projects: read("resources/tools/projects.html"),
  budgets: read("resources/tools/budgets.html"),
  exports: read("exports.html"),
  trialBalance: read("resources/tools/trial-balance.html"),
  generalLedger: read("resources/tools/general-ledger.html"),
  profitLoss: read("resources/tools/profit-loss.html"),
  balanceSheet: read("resources/tools/balance-sheet.html"),
  businessInsights: read("business-insights.html"),
  demoAnalytics: read("functions/lib/admin-demo-analytics.js")
};
const NOW = new Date("2026-08-05T12:00:00.000Z");

const canonicalEvents = [
  "bill_created", "expense_created", "mileage_created", "project_created",
  "budget_created", "accountant_pack_generated", "trial_balance_viewed",
  "general_ledger_viewed", "profit_and_loss_viewed", "balance_sheet_viewed", "business_insights_viewed"
];

function handlerDependencies({uid = "customer", account = {demoMode: false}, email = "customer@example.test"} = {}){
  const create = vi.fn(async () => {});
  return {
    create,
    options: {
      adminUidConfiguration: "owner,second-owner",
      demoConfiguration: "uid:official-demo,email:demo@example.test",
      auth: {getUser: vi.fn(async () => ({uid, email}))},
      firestore: {collection(name){
        if(name === "users") return {doc: () => ({get: async () => ({exists: true, data: () => account})})};
        if(name === "userProfiles") return {doc: () => ({get: async () => ({exists: true, data: () => ({currentPlan: "Pro"})})})};
        if(name === "adminActivityEvents") return {doc: () => ({create})};
        throw new Error(`Unexpected collection ${name}`);
      }},
      fieldValue: {serverTimestamp: () => ({server: true})},
      now: () => NOW
    }
  };
}

describe("Customer Analytics Phase 1B activity policy", () => {
  it("accepts every exact canonical event and rejects non-canonical variants", () => {
    expect([...CUSTOMER_ANALYTICS_EVENT_TYPES]).toEqual(canonicalEvents);
    for(const eventType of canonicalEvents){
      expect(validateFrontendActivityRequest({eventType, idempotencyKey: "opaque_key_123"}).eventType).toBe(eventType);
      expect(normalizeEventName(eventType)).toBe(eventType);
    }
    for(const eventType of ["bill-created", "profit_loss_viewed", "accountant_pack_downloaded"]){
      expect(() => validateFrontendActivityRequest({eventType})).toThrow();
    }
  });

  it("does not write for unauthenticated, admin, configured-demo or demoMode accounts", async () => {
    const unauthenticated = handlerDependencies();
    await expect(createActivityLoggerHandler(unauthenticated.options)({data: {eventType: "bill_created"}}))
      .rejects.toMatchObject({code: "unauthenticated"});
    expect(unauthenticated.create).not.toHaveBeenCalled();

    for(const setup of [
      {uid: "owner"},
      {uid: "official-demo", email: "demo@example.test"},
      {uid: "flagged-demo", account: {demoMode: true}}
    ]){
      const dependencies = handlerDependencies(setup);
      const result = await createActivityLoggerHandler(dependencies.options)({
        auth: {uid: setup.uid}, data: {eventType: "expense_created", idempotencyKey: "opaque_key_123"}
      });
      expect(result).toEqual({created: false, excluded: true});
      expect(dependencies.create).not.toHaveBeenCalled();
    }
  });

  it("writes only privacy-safe fields and deterministic duplicate IDs for new events", async () => {
    const create = vi.fn(async () => {});
    const firestore = {collection: () => ({doc: id => ({create: value => create(id, value)})})};
    const input = {
      firestore, fieldValue: {serverTimestamp: () => ({server: true})},
      identity: {uid: "customer", displayEmail: "private@example.test", plan: "Pro"},
      eventType: "bill_created", idempotencyKey: "opaque_key_123", now: NOW
    };
    await writeActivityEvent(input);
    await writeActivityEvent(input);
    expect(create.mock.calls[0][0]).toBe(create.mock.calls[1][0]);
    expect(create.mock.calls[0][1]).toEqual({
      eventType: "bill_created", createdAt: {server: true}, uid: "customer"
    });
    expect(JSON.stringify(create.mock.calls[0][1])).not.toMatch(/email|name|amount|description|useragent|document/i);
  });
});

describe("Customer action success-point instrumentation", () => {
  it("logs bill creation only after a confirmed write and never on edit/validation branches", () => {
    const source = sources.bills.slice(sources.bills.indexOf("async function saveBill"), sources.bills.indexOf("function clearForm"));
    expect(source.indexOf('if (!supplier)')).toBeLessThan(source.indexOf('logActivityEvent("bill_created"'));
    expect(source.indexOf("await setDoc(ref, bill)")).toBeLessThan(source.indexOf('logActivityEvent("bill_created"'));
    expect(source).toMatch(/if \(!existingBill\)[\s\S]*logActivityEvent\("bill_created"/);
  });

  it("logs expense or mileage creation after Firestore succeeds and excludes edits", () => {
    const source = sources.expenses.slice(sources.expenses.indexOf("async function saveExpense"), sources.expenses.indexOf("function sortExpenses"));
    expect(source.indexOf("await setDoc(doc(db")).toBeLessThan(source.indexOf('"mileage_created" : "expense_created"'));
    expect(source).toMatch(/if \(!existingExpense\)[\s\S]*"mileage_created" : "expense_created"/);
    expect(source.indexOf("Enter a mileage route")).toBeLessThan(source.indexOf('"mileage_created" : "expense_created"'));
  });

  it("logs projects and budgets only in successful create branches", () => {
    expect(sources.projects).toMatch(/await addDoc\(collection\(db, "users", user\.uid, "projects"\)[\s\S]*logActivityEvent\("project_created"/);
    expect(sources.projects.indexOf('logActivityEvent("project_created"')).toBeLessThan(sources.projects.indexOf('showPageFeedback("Project created."'));
    expect(sources.budgets).toMatch(/await addDoc\(collection\(db, "users", currentUser\.uid, "budgets"\)[\s\S]*logActivityEvent\("budget_created"/);
    expect(sources.budgets.indexOf("const validated = validateBudget()"))
      .toBeLessThan(sources.budgets.indexOf('logActivityEvent("budget_created"'));
  });

  it("logs Accountant Pack only after successful ZIP generation/download and never in its catch", () => {
    const handler = sources.exports.slice(sources.exports.indexOf("async function handleGenerate"), sources.exports.indexOf("periodSelect?.addEventListener"));
    expect(handler.indexOf("await generateAccountantPackZip")).toBeLessThan(handler.indexOf('"accountant_pack_generated"'));
    expect(handler.match(/accountant_pack_generated/g)).toHaveLength(1);
    expect(handler.slice(handler.lastIndexOf("}catch(error){"))).not.toContain("accountant_pack_generated");
    expect(handler).toContain("if(isGenerating || !generateButton)");
  });

  it("logs each successfully loaded report with one stable page-load key", () => {
    const reports = [
      [sources.trialBalance, "trial_balance_viewed"],
      [sources.generalLedger, "general_ledger_viewed"],
      [sources.profitLoss, "profit_and_loss_viewed"],
      [sources.balanceSheet, "balance_sheet_viewed"]
    ];
    for(const [source, eventType] of reports){
      expect(source.match(/const reportActivityIdempotencyKey = createActivityIdempotencyKey\(\)/g)).toHaveLength(1);
      expect(source.match(new RegExp(`logActivityEvent\\("${eventType}"`, "g"))).toHaveLength(1);
      expect(source).toContain(`logActivityEvent("${eventType}", reportActivityIdempotencyKey)`);
      expect(source.indexOf("await getDocs(ownerQuery)")).toBeLessThan(source.indexOf(`logActivityEvent("${eventType}"`));
    }
  });

  it("keeps analytics failures non-blocking and double-click guards intact", () => {
    for(const source of [sources.bills, sources.expenses, sources.projects, sources.budgets, sources.exports]){
      expect(source).toContain("void logActivityEvent".replace("logActivityEvent", source === sources.exports ? "activityLogger.logActivityEvent" : "logActivityEvent"));
    }
    expect(sources.projects).toContain("if (isSaving) return");
    expect(sources.budgets).toContain("if(isSaving) return");
    expect(sources.exports).toContain("if(isGenerating || !generateButton)");
  });
});

describe("Customer Analytics Phase 1B aggregation", () => {
  it("adds separate Product Adoption rows and groups report views under Accounting Reports", () => {
    const entry = {user: {uid: "customer", metadata: {creationTime: "2026-01-01T00:00:00Z"}}, profile: {currentPlan: "Pro"}};
    const events = canonicalEvents.map((eventType, index) => ({
      uid: "customer", eventType, createdAt: new Date(NOW.getTime() - index * 1000)
    }));
    const result = aggregateCustomerAnalytics({entries: [entry], events, range: "30d", now: NOW});
    for(const label of ["Bills", "Expenses", "Mileage", "Projects", "Budgets", "Accountant Pack", "Trial Balance", "General Ledger", "Profit & Loss", "Balance Sheet", "Business Insights"]){
      expect(result.adoption).toContainEqual(expect.objectContaining({label, count: 1}));
    }
    expect(result.features).toContainEqual({key: "accounting_reports", label: "Accounting Reports", count: 4, share: 36.4});
    expect(result.features).toContainEqual({key: "business_insights", label: "Business Insights", count: 1, share: 9.1});
    expect(result.summary.totalTrackedCustomerActions).toBe(11);
    expect(result.daily.reduce((sum, day) => sum + day.trackedActions, 0)).toBe(11);
  });

  it("leaves Demo Analytics implementation untouched by instrumentation", () => {
    expect(sources.demoAnalytics).not.toMatch(/bill_created|accountant_pack_generated|trial_balance_viewed/);
  });
});
