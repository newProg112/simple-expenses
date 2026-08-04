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

const demoUser = { uid: "official-demo-user" };

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
  it("loads as a small, centrally versioned definition", () => {
    expect(DEMO_SEED_VERSION).toBe(1);
    expect(DEMO_SEED.businessProfile.demoMode).toBe(true);

    for(const section of [
      "customers",
      "invoices",
      "bills",
      "expenses",
      "mileage",
      "projects",
      "budgets"
    ]){
      expect(DEMO_SEED[section].length).toBeGreaterThan(0);
      expect(DEMO_SEED[section].length).toBeLessThanOrEqual(2);
    }
  });

  it("passes structural, financial, and ledger validation", () => {
    expect(validateDemoSeed()).toEqual({ valid: true, errors: [] });
    expect(buildDemoJournalRecords(demoUser.uid)).toHaveLength(4);
  });

  it("keeps customer, project, and transaction relationships valid", () => {
    const customer = DEMO_SEED.customers[0];
    const project = DEMO_SEED.projects[0];
    const invoice = DEMO_SEED.invoices[0];

    expect(project.data.customerId).toBe(customer.id);
    expect(project.data.customerName).toBe(customer.data.name);
    expect(invoice.data.client).toBe(customer.data.name);
    expect(invoice.data.clientEmail).toBe(customer.data.email);

    for(const section of ["invoices", "bills", "expenses", "mileage", "budgets"]){
      for(const record of DEMO_SEED[section]){
        expect(record.data.projectId).toBe(project.id);
        expect(record.data.projectName).toBe(project.data.name);
        expect(record.data.projectReference).toBe(project.data.reference);
      }
    }
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

describe("demo seed engine", () => {
  it("writes deterministic business, module, and derived journal documents only when called", async () => {
    const { services, batches } = createFirestoreServices();
    const result = await seedDemoBusiness({
      user: demoUser,
      accountData: { demoMode: true },
      services
    });
    const operations = batches.flatMap(batch => batch.operations);

    expect(result).toEqual({
      seedVersion: 1,
      writtenDocuments: 12,
      committedBatches: 1
    });
    expect(operations).toHaveLength(12);
    expect(operations[0]).toMatchObject({
      type: "set",
      documentReference: { path: `users/${demoUser.uid}` },
      options: { merge: true }
    });
    expect(operations.filter(operation => operation.documentReference.path.startsWith("journals/")))
      .toHaveLength(4);
  });

  it("clears all managed demo records and journals while preserving the account marker", async () => {
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
