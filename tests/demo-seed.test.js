import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DEMO_SEED, DEMO_SEED_VERSION } from "../assets/demo-seed.js";
import {
  DEMO_MANAGED_USER_COLLECTIONS,
  buildDemoJournalRecords,
  clearDemoBusiness,
  seedDemoBusiness,
  validateDemoSeed
} from "../assets/demo-seed-engine.js";
import { buildReceivablesAgeing } from "../resources/js/business-logic.js";
import {
  buildTrialBalance,
  validateJournal
} from "../resources/js/ledger-engine.js";
import { trialBalanceViewFromJournals } from "../resources/js/trial-balance-view.js";
import { generalLedgerViewFromJournals } from "../resources/js/general-ledger-view.js";
import { profitLossViewFromJournals } from "../resources/js/profit-loss-view.js";
import { balanceSheetViewFromJournals } from "../resources/js/balance-sheet-view.js";

const demoUser = { uid: "official-demo-user" };
const seededSections = [
  "customers",
  "invoices",
  "bills",
  "expenses",
  "mileage",
  "projects",
  "budgets"
];

function demoJournals(){
  return buildDemoJournalRecords(demoUser.uid).map(record => record.data);
}

function seededDocumentCount(){
  return seededSections.reduce((total, section) => total + DEMO_SEED[section].length, 0);
}

function createFirestoreServices(documentsByCollection = {}){
  const batches = [];
  const reference = (...segments) => ({ path: segments.join("/") });
  const services = {
    auth: { currentUser: null },
    db: { name: "test-db" },
    collection: vi.fn((_db, ...segments) => reference(...segments)),
    doc: vi.fn((_db, ...segments) => reference(...segments)),
    getDoc: vi.fn().mockResolvedValue({
      exists: () => true,
      data: () => ({ demoMode: true })
    }),
    where: vi.fn((field, operator, value) => ({ field, operator, value })),
    query: vi.fn((collectionReference, constraint) => ({
      collectionReference,
      constraint
    })),
    getDocs: vi.fn(async target => {
      const collectionPath = target.path || target.collectionReference?.path || "";
      const collectionName = collectionPath.split("/").at(-1);
      const count = documentsByCollection[collectionName] || 0;
      return {
        docs: Array.from({ length: count }, (_value, index) => ({
          ref: reference(collectionPath, `existing-${index + 1}`)
        }))
      };
    }),
    writeBatch: vi.fn(() => {
      const operations = [];
      const batch = {
        set: vi.fn((documentReference, data, options) => {
          operations.push({ type: "set", documentReference, data, options });
        }),
        delete: vi.fn(documentReference => {
          operations.push({ type: "delete", documentReference });
        }),
        commit: vi.fn().mockResolvedValue(undefined),
        operations
      };
      batches.push(batch);
      return batch;
    })
  };

  return { services, batches };
}

describe("demo seed definition", () => {
  it("loads the centrally versioned Northbank business", () => {
    expect(DEMO_SEED_VERSION).toBe(2);
    expect(DEMO_SEED.businessProfile.demoMode).toBe(true);
    expect(DEMO_SEED.businessProfile.businessName)
      .toBe("Northbank Creative Studio Ltd");
    expect(DEMO_SEED.customers).toHaveLength(10);
    expect(DEMO_SEED.projects).toHaveLength(7);
    expect(DEMO_SEED.invoices).toHaveLength(25);
    expect(DEMO_SEED.bills).toHaveLength(18);
    expect(DEMO_SEED.expenses).toHaveLength(20);
    expect(DEMO_SEED.mileage).toHaveLength(15);
    expect(DEMO_SEED.budgets).toHaveLength(7);
  });

  it("passes structural, financial, and ledger validation", () => {
    expect(validateDemoSeed()).toEqual({ valid: true, errors: [] });
    expect(demoJournals()).toHaveLength(78);
    expect(demoJournals().every(journal => validateJournal(journal).valid)).toBe(true);
  });

  it("keeps every customer, project, and transaction relationship valid", () => {
    const customersById = new Map(DEMO_SEED.customers.map(record => [record.id, record.data]));
    const projectsById = new Map(DEMO_SEED.projects.map(record => [record.id, record.data]));

    for(const project of DEMO_SEED.projects){
      const customer = customersById.get(project.data.customerId);
      expect(customer).toBeDefined();
      expect(project.data.customerName).toBe(customer.name);
    }

    for(const invoice of DEMO_SEED.invoices){
      expect(DEMO_SEED.customers.some(customer =>
        customer.data.name === invoice.data.client &&
        customer.data.email === invoice.data.clientEmail
      )).toBe(true);
    }

    for(const section of ["invoices", "bills", "expenses", "mileage", "budgets"]){
      for(const record of DEMO_SEED[section]){
        if(!record.data.projectId) continue;
        const project = projectsById.get(record.data.projectId);
        expect(project).toBeDefined();
        expect(record.data.projectName).toBe(project.name);
        expect(record.data.projectReference).toBe(project.reference);
      }
    }
  });

  it("gives every customer and project genuine invoice history", () => {
    const invoicedCustomerNames = new Set(DEMO_SEED.invoices.map(record => record.data.client));
    const invoicedProjectIds = new Set(
      DEMO_SEED.invoices.map(record => record.data.projectId).filter(Boolean)
    );

    for(const customer of DEMO_SEED.customers){
      expect(invoicedCustomerNames.has(customer.data.name)).toBe(true);
    }
    for(const project of DEMO_SEED.projects){
      expect(invoicedProjectIds.has(project.id)).toBe(true);
    }
  });

  it("contains varied project states, invoice states, and trading trends", () => {
    expect(new Set(DEMO_SEED.projects.map(record => record.data.status)))
      .toEqual(new Set(["Active", "Completed", "On Hold"]));
    expect(new Set(DEMO_SEED.invoices.map(record => record.data.status)))
      .toEqual(new Set(["Paid", "Unpaid"]));

    const monthlyRevenue = new Map();
    for(const invoice of DEMO_SEED.invoices){
      const month = invoice.data.createdAt.slice(0, 7);
      monthlyRevenue.set(month, (monthlyRevenue.get(month) || 0) + invoice.data.amount);
    }

    expect(monthlyRevenue.size).toBeGreaterThanOrEqual(7);
    expect(monthlyRevenue.get("2026-07")).toBeGreaterThan(monthlyRevenue.get("2026-02"));
    expect(new Set(monthlyRevenue.values()).size).toBeGreaterThanOrEqual(6);
  });

  it("produces meaningful overdue receivables and future cashflow inputs", () => {
    const invoices = DEMO_SEED.invoices.map(record => record.data);
    const ageing = buildReceivablesAgeing(invoices, new Date("2026-08-04T12:00:00.000Z"));
    const overdueReceivables = ageing["0-30 days"] + ageing["31-60 days"] + ageing["61+ days"];
    const futureReceivables = ageing["Not yet due"];
    const futurePayables = DEMO_SEED.bills
      .filter(record => record.data.status === "Unpaid" && record.data.dueDate >= "2026-08-04")
      .reduce((sum, record) => sum + record.data.total, 0);

    expect(overdueReceivables).toBeGreaterThan(0);
    expect(futureReceivables).toBeGreaterThan(0);
    expect(futurePayables).toBeGreaterThan(0);
    expect(DEMO_SEED).not.toHaveProperty("cashflow");
  });

  it("is deterministic across repeated seed and journal generation", () => {
    const firstSeed = JSON.stringify(DEMO_SEED);
    const firstJournals = buildDemoJournalRecords(demoUser.uid);

    expect(JSON.stringify(DEMO_SEED)).toBe(firstSeed);
    expect(buildDemoJournalRecords(demoUser.uid)).toEqual(firstJournals);
  });

  it("detects broken relationships", () => {
    const invalidSeed = {
      ...DEMO_SEED,
      projects: [{
        ...DEMO_SEED.projects[0],
        data: { ...DEMO_SEED.projects[0].data, customerId: "missing-customer" }
      }]
    };

    expect(validateDemoSeed(invalidSeed)).toMatchObject({ valid: false });
    expect(validateDemoSeed(invalidSeed).errors.join(" "))
      .toContain("references an unknown customer");
  });
});

describe("demo accounting integrity", () => {
  it("produces a balanced Trial Balance", () => {
    const journals = demoJournals();
    const report = buildTrialBalance(journals);
    const view = trialBalanceViewFromJournals(journals);

    expect(report.balanced).toBe(true);
    expect(report.totalDebits).toBe(report.totalCredits);
    expect(view.state).toBe("ready");
    expect(view.status).toBe("Balanced");
  });

  it("produces a populated General Ledger", () => {
    const journals = demoJournals();
    const readyView = generalLedgerViewFromJournals(journals);
    const loadedView = generalLedgerViewFromJournals(journals, { accountCode: "4000" });

    expect(readyView.state).toBe("ready");
    expect(readyView.accountsCount).toBeGreaterThanOrEqual(8);
    expect(loadedView.state).toBe("loaded");
    expect(loadedView.rows).toHaveLength(
      DEMO_SEED.invoices.reduce((total, invoice) => total + invoice.data.items.length, 0)
    );
  });

  it("derives a profitable Profit & Loss report", () => {
    const view = profitLossViewFromJournals(demoJournals());

    expect(view.state).toBe("profit");
    expect(view.totalIncome).toBeGreaterThan(view.totalExpenses);
    expect(view.netResult).toBeGreaterThan(0);
    expect(view.incomeRows.length).toBeGreaterThan(0);
    expect(view.expenseRows.length).toBeGreaterThanOrEqual(4);
  });

  it("derives a balanced Balance Sheet", () => {
    const view = balanceSheetViewFromJournals(demoJournals());

    expect(view.state).toBe("balanced");
    expect(view.difference).toBe(0);
    expect(view.totalAssets).toBe(view.totalLiabilitiesAndEquity);
  });
});

describe("demo seed engine", () => {
  it("writes deterministic business, module, and derived journal documents only when called", async () => {
    const { services, batches } = createFirestoreServices();
    const result = await seedDemoBusiness({
      user: demoUser,
      accountData: { demoMode: true },
      services
    });
    const operations = batches.flatMap(batch => batch.operations);
    const journalCount = demoJournals().length;
    const expectedWrites = 1 + seededDocumentCount() + journalCount;

    expect(result).toEqual({
      seedVersion: 2,
      writtenDocuments: expectedWrites,
      committedBatches: 1
    });
    expect(operations).toHaveLength(expectedWrites);
    expect(operations[0]).toMatchObject({
      type: "set",
      documentReference: { path: `users/${demoUser.uid}` },
      options: { merge: true }
    });
    expect(operations.filter(operation => operation.documentReference.path.startsWith("journals/")))
      .toHaveLength(journalCount);
  });

  it("clears all managed demo records and all owned journals, including bank opening balances, while preserving the account marker", async () => {
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankAccounts");
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankTransactions");
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankIncome");
    expect(DEMO_MANAGED_USER_COLLECTIONS).toContain("bankReconciliations");
    expect(DEMO_SEED).not.toHaveProperty("bankAccounts");
    const collectionCounts = Object.fromEntries(
      DEMO_MANAGED_USER_COLLECTIONS.map(collectionName => [collectionName, 1])
    );
    collectionCounts.journals = 2;
    const { services, batches } = createFirestoreServices(collectionCounts);
    const result = await clearDemoBusiness({
      user: demoUser,
      accountData: { demoMode: true },
      services
    });
    const operations = batches.flatMap(batch => batch.operations);

    expect(result).toEqual({
      deletedDocuments: DEMO_MANAGED_USER_COLLECTIONS.length + 2,
      committedBatches: 1,
      preservedAccountDocument: true
    });
    expect(operations.every(operation => operation.type === "delete")).toBe(true);
    expect(operations.some(operation => operation.documentReference.path === `users/${demoUser.uid}`))
      .toBe(false);
    expect(services.where).toHaveBeenCalledWith("userId", "==", demoUser.uid);
    expect(operations.filter(operation => operation.documentReference.path.startsWith("journals/")))
      .toHaveLength(2);
  });

  it.each([
    [null, { demoMode: true }],
    [demoUser, null],
    [demoUser, { demoMode: false }],
    [demoUser, {}]
  ])("rejects missing or non-demo context", async (user, accountData) => {
    const { services, batches } = createFirestoreServices();

    await expect(seedDemoBusiness({ user, accountData, services })).rejects.toThrow();
    expect(batches).toHaveLength(0);
  });

  it("does not connect seeding to authentication or the Phase 1 reset placeholder", () => {
    const authenticationSources = [
      "../assets/demo-mode.js",
      "../assets/app-shell.js",
      "../auth-guard.js",
      "../login.html"
    ].map(relativePath => readFileSync(new URL(relativePath, import.meta.url), "utf8"));

    for(const source of authenticationSources){
      expect(source).not.toContain("demo-seed-engine");
      expect(source).not.toContain("seedDemoBusiness(");
      expect(source).not.toContain("clearDemoBusiness(");
    }
  });
});
