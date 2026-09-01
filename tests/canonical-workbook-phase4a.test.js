import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CANONICAL_WORKBOOK_SCHEMA } from "../resources/js/canonical-workbook-schema.js";
import { preflightCanonicalWorkbook } from "../resources/js/canonical-workbook-preflight.js";
import {
  createFirestorePhase4APersistence,
  executePhase4A,
  planPhase4AExecution
} from "../resources/js/canonical-workbook-phase4a.js";

const DATA_SHEETS = CANONICAL_WORKBOOK_SCHEMA.sheets.filter(sheet => !sheet.importIgnored);

function schemaSheet(name) {
  return DATA_SHEETS.find(sheet => sheet.name === name);
}

function row(name, values = {}) {
  return schemaSheet(name).columns.map(column => values[column.header] ?? "");
}

function workbook(sheetRows = {}) {
  const sheets = Object.fromEntries(CANONICAL_WORKBOOK_SCHEMA.sheets.map(sheet => [
    sheet.name,
    sheet.name === "Summary"
      ? [["Simple Books Workbook"], ["Workbook schema", "Version 1"]]
      : [sheet.columns.map(column => column.header), ...(sheetRows[sheet.name] || [])]
  ]));
  return {
    SheetNames: CANONICAL_WORKBOOK_SCHEMA.sheets.map(sheet => sheet.name),
    Sheets: sheets
  };
}

function preflight(sheetRows = {}, options = {}) {
  return preflightCanonicalWorkbook(workbook(sheetRows), {
    plan: "Pro",
    existing: {},
    ...options
  });
}

function client(name = "Acme Ltd", overrides = {}) {
  return row("Clients", {
    "Client Name": name,
    Status: "Lead",
    ...overrides
  });
}

function project(reference = "P-1", overrides = {}) {
  return row("Projects", {
    "Project Reference": reference,
    "Project Name": "Project One",
    Status: "Active",
    ...overrides
  });
}

function budget(name = "Monthly plan", overrides = {}) {
  return row("Budgets", {
    "Budget Name": name,
    "Period Type": "Monthly",
    "Start Date": "2026-08-01",
    "End Date": "2026-08-31",
    "Budget Type": "Overall",
    "Planned Amount": 500,
    Status: "Active",
    ...overrides
  });
}

function fullRows() {
  return {
    Clients: [client("Acme Ltd", {
      Email: "accounts@acme.test",
      Address: "1 High Street",
      "Payment Terms": "14 days"
    })],
    Projects: [project("P-1", { "Client Name": "Acme Ltd" })],
    Budgets: [budget("Monthly plan", { "Project Reference": "P-1" })]
  };
}

function memoryPersistence(initial = {}, behavior = {}) {
  const state = {
    clients: [...(initial.clients || [])],
    customers: [...(initial.customers || [])],
    projects: [...(initial.projects || [])],
    budgets: [...(initial.budgets || [])],
    plan: initial.plan ?? "Pro",
    demoMode: initial.demoMode === true
  };
  const calls = [];
  const nextIds = { clients: 1, customers: 1, projects: 1, budgets: 1 };
  const persistence = {
    readExecutionContext: vi.fn(async () => ({
      clients: state.clients.map(item => ({ ...item })),
      customers: state.customers.map(item => ({ ...item })),
      projects: state.projects.map(item => ({ ...item })),
      budgets: state.budgets.map(item => ({ ...item })),
      plan: state.plan,
      demoMode: state.demoMode
    })),
    ensureClientRepresentations: vi.fn(async operation => {
      calls.push("clients");
      if(behavior.failModule === "clients") throw new Error("Client persistence failed");
      let clientId = operation.client.existingId;
      let customerId = operation.customer.existingId;
      if(operation.client.action === "create"){
        clientId = `client-${nextIds.clients++}`;
        state.clients.push({ id: clientId, ...operation.client.payload });
      }
      if(operation.customer.action === "create"){
        customerId = `customer-${nextIds.customers++}`;
        state.customers.push({ id: customerId, ...operation.customer.payload });
      }
      return { clientId, customerId };
    }),
    createProject: vi.fn(async payload => {
      calls.push("projects");
      if(behavior.failModule === "projects") throw new Error("Project persistence failed");
      const record = { id: `project-${nextIds.projects++}`, ...payload };
      state.projects.push(record);
      return record;
    }),
    createBudget: vi.fn(async payload => {
      calls.push("budgets");
      if(behavior.failModule === "budgets") throw new Error("Budget persistence failed");
      const record = { id: `budget-${nextIds.budgets++}`, ...payload };
      state.budgets.push(record);
      return record;
    })
  };
  return { persistence, state, calls };
}

describe("canonical workbook Phase 4A execution", () => {
  it("rejects an unsafe trusted preflight before reading or writing", async () => {
    const unsafe = preflight({ Clients: [client("", { Email: "x@example.test" })] });
    const memory = memoryPersistence();

    const result = await executePhase4A(unsafe, { persistence: memory.persistence });

    expect(result.success).toBe(false);
    expect(result.errors.some(error => error.code === "unsafe-preflight")).toBe(true);
    expect(memory.persistence.readExecutionContext).not.toHaveBeenCalled();
    expect(memory.calls).toEqual([]);
  });

  it("does not let raw or copied records bypass canonical preflight", async () => {
    const raw = {
      safeToProceed: true,
      errors: [],
      unresolvedRelationships: [],
      records: { clients: [], projects: [], budgets: [] }
    };
    const memory = memoryPersistence();

    const result = await executePhase4A(raw, { persistence: memory.persistence });

    expect(result.errors).toContainEqual(expect.objectContaining({ code: "untrusted-preflight" }));
    expect(memory.calls).toEqual([]);
  });

  it("treats a zero-record safe workbook as a successful no-op", async () => {
    const memory = memoryPersistence();
    const result = await executePhase4A(preflight(), { persistence: memory.persistence });

    expect(result).toMatchObject({
      success: true,
      created: { clients: 0, projects: 0, budgets: 0 },
      skipped: { clients: 0, projects: 0, budgets: 0 },
      modulesAttempted: []
    });
    expect(memory.calls).toEqual([]);
  });

  it("executes strictly Clients then Projects then Budgets", async () => {
    const memory = memoryPersistence();
    const result = await executePhase4A(preflight(fullRows()), { persistence: memory.persistence });

    expect(result.success).toBe(true);
    expect(memory.calls).toEqual(["clients", "projects", "budgets"]);
    expect(result.modulesAttempted).toEqual(["clients", "projects", "budgets"]);
    expect(result.created).toEqual({ clients: 1, projects: 1, budgets: 1 });
  });

  it("creates both internal representations for a new canonical Client", async () => {
    const memory = memoryPersistence();

    const result = await executePhase4A(preflight({ Clients: [client("Acme Ltd", {
      Email: "accounts@acme.test",
      Phone: "020 0000 0000",
      Address: "1 High Street",
      "Payment Terms": "14 days",
      Notes: "Call on Monday"
    })] }), { persistence: memory.persistence });

    expect(result.created.clients).toBe(1);
    expect(result.createdRecords.clients[0]).toMatchObject({
      id: "client-1",
      customerId: "customer-1",
      representationsCreated: ["clients", "customers"]
    });
    expect(memory.state.clients).toContainEqual(expect.objectContaining({
      id: "client-1",
      name: "Acme Ltd",
      phone: "020 0000 0000",
      notes: "Call on Monday"
    }));
    expect(memory.state.clients[0]).not.toHaveProperty("address");
    expect(memory.state.clients[0].notes).not.toContain("1 High Street");
    expect(memory.state.customers).toContainEqual(expect.objectContaining({
      id: "customer-1",
      name: "Acme Ltd",
      address: "1 High Street",
      paymentTerms: "14 days",
      nameKey: "acme ltd",
      emailKey: "accounts@acme.test"
    }));
  });

  it("creates only the missing invoice Customer when the Client Tracker record exists", async () => {
    const existing = { id: "client-9", name: "Acme Ltd", status: "Lead" };
    const checked = preflight({ Clients: [client()] }, { existing: { clients: [existing] } });
    const memory = memoryPersistence({ clients: [existing] });

    const result = await executePhase4A(checked, { persistence: memory.persistence });

    expect(result.created.clients).toBe(1);
    expect(result.createdRecords.clients[0]).toMatchObject({
      id: "client-9",
      customerId: "customer-1",
      representationsCreated: ["customers"]
    });
    expect(memory.state.clients).toEqual([existing]);
    expect(memory.state.customers).toHaveLength(1);
  });

  it("creates only the missing Client Tracker record when the invoice Customer exists", async () => {
    const existing = {
      id: "customer-9", name: "Acme Ltd", email: "accounts@acme.test",
      address: "1 High Street", paymentTerms: "14 days"
    };
    const checked = preflight({ Clients: [client("Acme Ltd", {
      Email: "accounts@acme.test", Address: "1 High Street", "Payment Terms": "14 days"
    })] }, { existing: { clients: [existing] } });
    const memory = memoryPersistence({ customers: [existing] });

    const result = await executePhase4A(checked, { persistence: memory.persistence });

    expect(result.created.clients).toBe(1);
    expect(result.createdRecords.clients[0]).toMatchObject({
      id: "client-1",
      customerId: "customer-9",
      representationsCreated: ["clients"]
    });
    expect(memory.state.clients).toHaveLength(1);
    expect(memory.state.customers).toEqual([existing]);
  });

  it("skips a canonical Client when both internal representations already match", async () => {
    const existingClient = { id: "client-9", name: "Acme Ltd", status: "Lead" };
    const existingCustomer = { id: "customer-9", name: "Acme Ltd" };
    const checked = preflight({ Clients: [client()] }, {
      existing: { clients: [existingClient] }
    });
    const memory = memoryPersistence({
      clients: [existingClient], customers: [existingCustomer]
    });

    const result = await executePhase4A(checked, { persistence: memory.persistence });

    expect(result.skipped.clients).toBe(1);
    expect(result.skippedRecords.clients[0]).toMatchObject({
      reason: "both-representations-exist",
      existingId: "client-9",
      customerId: "customer-9"
    });
    expect(memory.persistence.ensureClientRepresentations).not.toHaveBeenCalled();
  });

  it("fails before writes when matching Client details conflict", async () => {
    const existing = {
      id: "client-1", name: "Acme Ltd", email: "old@example.test", status: "Lead"
    };
    const checked = preflight({
      Clients: [client("Acme Ltd", { Email: "new@example.test" })]
    }, { existing: { clients: [existing] } });
    const memory = memoryPersistence({ clients: [existing] });

    const result = await executePhase4A(checked, { persistence: memory.persistence });

    expect(result.conflicts).toContainEqual(expect.objectContaining({ code: "client-representation-conflict" }));
    expect(memory.calls).toEqual([]);
  });

  it("fails before writes when existing Client and Customer representations conflict", async () => {
    const existingClient = {
      id: "client-9", name: "Acme Ltd", email: "accounts@acme.test", status: "Lead"
    };
    const existingCustomer = {
      id: "customer-9", name: "Acme Ltd", email: "other@acme.test"
    };
    const checked = preflight({
      Clients: [client("Acme Ltd", { Email: "accounts@acme.test" })]
    }, { existing: { clients: [existingClient] } });
    const memory = memoryPersistence({
      clients: [existingClient], customers: [existingCustomer]
    });

    const result = await executePhase4A(checked, { persistence: memory.persistence });

    expect(result.conflicts).toContainEqual(expect.objectContaining({ code: "client-representation-conflict" }));
    expect(memory.calls).toEqual([]);
  });

  it("skips an exact existing Project", async () => {
    const existingProject = {
      id: "project-1", reference: "P-1", name: "Project One", status: "Active",
      customerId: "", customerName: "", description: "", startDate: "", endDate: "", budget: 0
    };
    const checked = preflight({ Projects: [project()] }, {
      existing: { projects: [existingProject] }
    });
    const memory = memoryPersistence({ projects: [existingProject] });

    const result = await executePhase4A(checked, { persistence: memory.persistence });

    expect(result.skipped.projects).toBe(1);
    expect(memory.persistence.createProject).not.toHaveBeenCalled();
  });

  it("resolves a Project to a newly created workbook Client", async () => {
    const memory = memoryPersistence();
    await executePhase4A(preflight({
      Clients: [client()],
      Projects: [project("P-1", { "Client Name": "Acme Ltd" })]
    }), { persistence: memory.persistence });

    expect(memory.persistence.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "client-1", customerName: "Acme Ltd" }),
      expect.any(Object)
    );
  });

  it("resolves a Project to the new Client Tracker ID when only its Customer existed", async () => {
    const existingCustomer = { id: "customer-9", name: "Acme Ltd" };
    const checked = preflight({
      Clients: [client()],
      Projects: [project("P-1", { "Client Name": "Acme Ltd" })]
    }, { existing: { clients: [existingCustomer] } });
    const memory = memoryPersistence({ customers: [existingCustomer] });

    await executePhase4A(checked, { persistence: memory.persistence });

    expect(memory.persistence.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "client-1", customerName: "Acme Ltd" }),
      expect.any(Object)
    );
  });

  it("resolves a Project to an existing legacy Customer or Client", async () => {
    const existingCustomer = { id: "customer-9", name: "Acme Ltd" };
    const checked = preflight({
      Projects: [project("P-1", { "Client Name": "Acme Ltd" })]
    }, { existing: { clients: [{ id: "customer-9", name: "Acme Ltd" }] } });
    const memory = memoryPersistence({ customers: [existingCustomer] });

    await executePhase4A(checked, { persistence: memory.persistence });

    expect(memory.persistence.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "customer-9", customerName: "Acme Ltd" }),
      expect.any(Object)
    );
  });

  it("aborts all writes if a previously resolved Client disappears", async () => {
    const checked = preflight({
      Projects: [project("P-1", { "Client Name": "Acme Ltd" })]
    }, { existing: { clients: [{ id: "client-1", name: "Acme Ltd" }] } });
    const memory = memoryPersistence();

    const result = await executePhase4A(checked, { persistence: memory.persistence });

    expect(result.errors).toContainEqual(expect.objectContaining({ code: "missing-client-relationship" }));
    expect(memory.calls).toEqual([]);
  });

  it("rechecks the Starter limit immediately before writes and creates nothing", async () => {
    const checked = preflight({ Projects: [project()] });
    const existingProjects = Array.from({ length: 5 }, (_, index) => ({
      id: `existing-${index}`, reference: `EX-${index}`, name: `Existing ${index}`, status: "Active"
    }));
    const memory = memoryPersistence({ plan: "Starter", projects: existingProjects });

    const result = await executePhase4A(checked, { persistence: memory.persistence });

    expect(result.errors).toContainEqual(expect.objectContaining({ code: "active-project-limit" }));
    expect(result.created).toEqual({ clients: 0, projects: 0, budgets: 0 });
    expect(memory.calls).toEqual([]);
  });

  it("resolves a Budget to a newly created workbook Project", async () => {
    const memory = memoryPersistence();
    await executePhase4A(preflight({
      Projects: [project()],
      Budgets: [budget("Plan", { "Project Reference": "P-1" })]
    }), { persistence: memory.persistence });

    expect(memory.persistence.createBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1", projectName: "Project One", projectReference: "P-1"
      }),
      expect.any(Object)
    );
  });

  it("resolves a Budget to an existing Project", async () => {
    const existingProject = { id: "project-8", reference: "P-1", name: "Project One", status: "Completed" };
    const checked = preflight({ Budgets: [budget("Plan", { "Project Reference": "P-1" })] }, {
      existing: { projects: [existingProject] }
    });
    const memory = memoryPersistence({ projects: [existingProject] });

    await executePhase4A(checked, { persistence: memory.persistence });

    expect(memory.persistence.createBudget).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-8", projectReference: "P-1" }),
      expect.any(Object)
    );
  });

  it("aborts all writes if a previously resolved Budget Project disappears", async () => {
    const existingProject = { id: "project-8", reference: "P-1", name: "Project One" };
    const checked = preflight({ Budgets: [budget("Plan", { "Project Reference": "P-1" })] }, {
      existing: { projects: [existingProject] }
    });
    const memory = memoryPersistence();

    const result = await executePhase4A(checked, { persistence: memory.persistence });

    expect(result.errors).toContainEqual(expect.objectContaining({ code: "missing-project-relationship" }));
    expect(memory.calls).toEqual([]);
  });

  it("is idempotent across repeated Clients, Projects and Budgets execution", async () => {
    const checked = preflight(fullRows());
    const memory = memoryPersistence();

    const first = await executePhase4A(checked, { persistence: memory.persistence });
    const second = await executePhase4A(checked, { persistence: memory.persistence });

    expect(first.created).toEqual({ clients: 1, projects: 1, budgets: 1 });
    expect(second.created).toEqual({ clients: 0, projects: 0, budgets: 0 });
    expect(second.skipped).toEqual({ clients: 1, projects: 1, budgets: 1 });
    expect(memory.state.clients).toHaveLength(1);
    expect(memory.state.customers).toHaveLength(1);
    expect(memory.state.projects).toHaveLength(1);
    expect(memory.state.budgets).toHaveLength(1);
  });

  it("does not leave a half-created Client pair when paired persistence fails", async () => {
    const memory = memoryPersistence({}, { failModule: "clients" });

    const result = await executePhase4A(preflight({ Clients: [client()] }), {
      persistence: memory.persistence
    });

    expect(result).toMatchObject({
      success: false,
      stoppedEarly: true,
      partialWrites: false,
      created: { clients: 0, projects: 0, budgets: 0 }
    });
    expect(memory.state.clients).toEqual([]);
    expect(memory.state.customers).toEqual([]);
  });

  it("stops subsequent writes and reports exact partial state on persistence failure", async () => {
    const memory = memoryPersistence({}, { failModule: "projects" });
    const result = await executePhase4A(preflight(fullRows()), { persistence: memory.persistence });

    expect(result).toMatchObject({
      success: false,
      stoppedEarly: true,
      partialWrites: true,
      created: { clients: 1, projects: 0, budgets: 0 }
    });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "persistence-failure", module: "projects" }));
    expect(memory.calls).toEqual(["clients", "projects"]);
    expect(memory.persistence.createBudget).not.toHaveBeenCalled();
  });

  it("never writes accounting modules, journals, settlements, attachments or Auth", async () => {
    const prohibited = {
      createInvoice: vi.fn(), createBill: vi.fn(), createExpense: vi.fn(),
      createMileage: vi.fn(), createJournal: vi.fn(), createSettlement: vi.fn(),
      uploadAttachment: vi.fn(), createUser: vi.fn()
    };
    const memory = memoryPersistence();
    Object.assign(memory.persistence, prohibited);

    await executePhase4A(preflight(fullRows()), { persistence: memory.persistence });

    Object.values(prohibited).forEach(method => expect(method).not.toHaveBeenCalled());
  });

  it("keeps Import All initially disabled and leaves Phase 4A behind the Phase 4C controller", () => {
    const exportsSource = readFileSync(
      fileURLToPath(new URL("../exports.html", import.meta.url)),
      "utf8"
    );
    const uploadStart = exportsSource.indexOf("async function validateExcelImportWorkbook");
    const uploadEnd = exportsSource.indexOf("async function readOnlyWorkbookPreflightContext", uploadStart);
    const uploadPath = exportsSource.slice(uploadStart, uploadEnd);

    expect(exportsSource).toContain('id="importAllButton" onclick="importValidatedWorkbookAll()" disabled');
    expect(uploadPath).toContain("setAllImportButtonsEnabled(false)");
    expect(uploadPath).toContain("importController.arm(validatedWorkbookPreflight)");
    expect(uploadPath).not.toContain("executePhase4A");
    expect(uploadPath).not.toContain("validatedImportWorkbook = workbook");
    expect(exportsSource).toContain("canonical-workbook-phase4c.js");
  });

  it("pure planning performs no persistence calls", () => {
    const checked = preflight(fullRows());
    const memory = memoryPersistence();
    const context = {
      clients: [], customers: [], projects: [], budgets: [], plan: "Pro", demoMode: false
    };

    const plan = planPhase4AExecution(checked, context);

    expect(plan.eligible).toBe(true);
    expect(plan.operations.clients).toHaveLength(1);
    expect(memory.persistence.readExecutionContext).not.toHaveBeenCalled();
    expect(memory.calls).toEqual([]);
  });

  it("uses an atomic batch for Client/Customer compatibility writes and no prohibited collections", async () => {
    const collectionReads = new Map([
      ["clients", []], ["customers", []], ["projects", []], ["budgets", []]
    ]);
    const writes = [];
    const services = {
      db: {},
      collection: vi.fn((_db, _users, _uid, name) => ({ kind: "collection", name })),
      doc: vi.fn((parent, name, uid) => parent?.kind === "collection"
        ? { kind: "document", name: parent.name, id: `${parent.name}-1` }
        : { kind: "document", name, uid }),
      getDocs: vi.fn(async reference => ({
        docs: collectionReads.get(reference.name).map(record => ({
          id: record.id,
          data: () => record
        }))
      })),
      getDoc: vi.fn(async reference => ({
        exists: () => reference.name === "userProfiles",
        data: () => reference.name === "userProfiles" ? { currentPlan: "Pro", billingOverride: true } : {}
      })),
      addDoc: vi.fn(async (reference, payload) => {
        writes.push({ collection: reference.name, payload });
        return { id: `${reference.name}-1` };
      }),
      writeBatch: vi.fn(() => ({
        set: vi.fn((reference, payload) => {
          writes.push({ collection: reference.name, payload, batched: true });
        }),
        commit: vi.fn(async () => undefined)
      })),
      serverTimestamp: vi.fn(() => "server-time")
    };
    const persistence = createFirestorePhase4APersistence({ services, user: { uid: "user-1" } });

    await persistence.readExecutionContext();
    await persistence.ensureClientRepresentations({
      client: { action: "create", existingId: "", payload: { name: "Acme", notes: "CRM" } },
      customer: {
        action: "create", existingId: "",
        payload: { name: "Acme", address: "1 High Street", paymentTerms: "14 days" }
      }
    });
    await persistence.createProject({ name: "Project" });
    await persistence.createBudget({ name: "Budget" });

    expect(writes.map(write => write.collection)).toEqual([
      "clients", "customers", "projects", "budgets"
    ]);
    expect(writes[0]).toMatchObject({
      collection: "clients", batched: true, payload: { name: "Acme", notes: "CRM" }
    });
    expect(writes[1]).toMatchObject({
      collection: "customers",
      batched: true,
      payload: {
        name: "Acme", address: "1 High Street", paymentTerms: "14 days",
        createdAt: "server-time", updatedAt: "server-time"
      }
    });
    expect(writes[2].payload).toMatchObject({ createdAt: "server-time", updatedAt: "server-time" });
    expect(writes[3].payload).toMatchObject({ createdAt: "server-time", updatedAt: "server-time" });
  });
});
