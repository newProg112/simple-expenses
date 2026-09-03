import {
  isTrustedWorkbookPreflightResult
} from "./canonical-workbook-preflight.js?v=20260902-stripe-live2";
import {
  PROJECT_STATUS,
  canUseAnotherActiveProject
} from "./project-access.js?v=20260902-stripe-live2";

export const PHASE4A_MODULE_ORDER = Object.freeze(["clients", "projects", "budgets"]);

function requireService(services, name) {
  if(typeof services?.[name] !== "function"){
    throw new TypeError(`Firestore Phase 4A persistence requires services.${name}().`);
  }
  return services[name];
}

function snapshotRecords(snapshot) {
  return (snapshot?.docs || []).map(documentSnapshot => ({
    id: documentSnapshot.id,
    ...documentSnapshot.data()
  }));
}

export function createFirestorePhase4APersistence({ services, user }) {
  if(!user?.uid) throw new TypeError("Firestore Phase 4A persistence requires an authenticated user.");
  const addDoc = requireService(services, "addDoc");
  const collection = requireService(services, "collection");
  const doc = requireService(services, "doc");
  const getDoc = requireService(services, "getDoc");
  const getDocs = requireService(services, "getDocs");
  const writeBatch = requireService(services, "writeBatch");
  const timestamp = typeof services.serverTimestamp === "function"
    ? () => services.serverTimestamp()
    : () => new Date().toISOString();
  const userCollection = name => collection(services.db, "users", user.uid, name);

  return Object.freeze({
    async readExecutionContext() {
      const [clients, customers, projects, budgets, account, profile] = await Promise.all([
        getDocs(userCollection("clients")),
        getDocs(userCollection("customers")),
        getDocs(userCollection("projects")),
        getDocs(userCollection("budgets")),
        getDoc(doc(services.db, "users", user.uid)),
        getDoc(doc(services.db, "userProfiles", user.uid))
      ]);
      return {
        clients: snapshotRecords(clients),
        customers: snapshotRecords(customers),
        projects: snapshotRecords(projects),
        budgets: snapshotRecords(budgets),
        billingProfile: profile.exists() ? profile.data() : {},
        demoMode: account.exists() && account.data().demoMode === true
      };
    },
    async ensureClientRepresentations(operation) {
      const batch = writeBatch(services.db);
      let clientId = text(operation.client.existingId);
      let customerId = text(operation.customer.existingId);

      if(operation.client.action === "create"){
        const reference = doc(userCollection("clients"));
        clientId = reference.id;
        batch.set(reference, operation.client.payload);
      }
      if(operation.customer.action === "create"){
        const reference = doc(userCollection("customers"));
        customerId = reference.id;
        const now = timestamp();
        batch.set(reference, {
          ...operation.customer.payload,
          createdAt: now,
          updatedAt: now
        });
      }

      await batch.commit();
      return { clientId, customerId };
    },
    async createProject(payload) {
      const now = timestamp();
      return addDoc(userCollection("projects"), {
        ...payload,
        createdAt: now,
        updatedAt: now
      });
    },
    async createBudget(payload) {
      const now = timestamp();
      return addDoc(userCollection("budgets"), {
        ...payload,
        createdAt: now,
        updatedAt: now
      });
    }
  });
}

function text(value) {
  return String(value ?? "").trim();
}

function identity(value) {
  return text(value).toLocaleLowerCase("en-GB");
}

function sourceOf(record, fallbackSheet) {
  return {
    sheet: text(record?.source?.sheet) || fallbackSheet,
    row: Number(record?.source?.row) || 0
  };
}

function problem(code, module, record, message, details = {}) {
  return {
    code,
    module,
    ...sourceOf(record, module),
    message,
    ...details
  };
}

function clientPayload(record) {
  return {
    name: text(record.clientName),
    email: text(record.email),
    phone: text(record.phone),
    status: text(record.status) || "Lead",
    followUp: text(record.followUpDate),
    lastContacted: text(record.lastContactedDate),
    notes: text(record.notes)
  };
}

function customerPayload(record) {
  const name = text(record.clientName);
  const email = text(record.email);
  return {
    name,
    email,
    address: text(record.address),
    paymentTerms: text(record.paymentTerms),
    nameKey: identity(name),
    emailKey: identity(email)
  };
}

function projectPayload(record, customer = null) {
  return {
    name: text(record.projectName),
    reference: text(record.projectReference),
    customerId: text(customer?.id),
    customerName: text(customer?.name),
    description: text(record.description),
    status: text(record.status) || PROJECT_STATUS.ACTIVE,
    startDate: text(record.startDate),
    endDate: text(record.endDate),
    budget: Number(record.projectBudget ?? 0)
  };
}

function budgetPayload(record, project = null) {
  return {
    schemaVersion: 1,
    name: text(record.budgetName),
    periodType: text(record.periodType).toLowerCase(),
    startDate: text(record.startDate),
    endDate: text(record.endDate),
    budgetType: text(record.budgetType).toLowerCase(),
    category: text(record.budgetType).toLowerCase() === "category"
      ? text(record.category)
      : "",
    projectId: text(project?.id),
    projectName: text(project?.name),
    projectReference: text(project?.reference),
    plannedAmount: Number(record.plannedAmount),
    status: text(record.status) || "Active"
  };
}

function hasMaterialDifference(existing, desired, fields) {
  return fields.some(field => {
    if(!Object.prototype.hasOwnProperty.call(existing, field)) return false;
    const expected = desired[field];
    if(expected === "" || expected === null || expected === undefined) return false;
    if(typeof expected === "number") return Number(existing[field]) !== expected;
    return text(existing[field]) !== text(expected);
  });
}

function normalizeExistingPerson(record, collectionName) {
  const name = text(record.name ?? record.customerName ?? record.businessName);
  const email = text(record.email);
  return {
    ...record,
    id: text(record.id),
    name,
    email,
    nameKey: identity(record.nameKey || name),
    emailKey: identity(record.emailKey || email),
    _collection: collectionName
  };
}

function matchingPeople(records, desired) {
  const desiredName = identity(desired.name);
  const desiredEmail = identity(desired.email);
  return records.filter(record =>
    (desiredName && record.nameKey === desiredName) ||
    (desiredEmail && record.emailKey === desiredEmail)
  );
}

function representationsConflict(client, customer) {
  if(!client || !customer) return false;
  if(identity(client.name) !== identity(customer.name)) return true;
  return Boolean(client.email && customer.email && identity(client.email) !== identity(customer.email));
}

function normalizeExistingProject(record) {
  return {
    ...record,
    id: text(record.id),
    name: text(record.name ?? record.projectName),
    reference: text(record.reference ?? record.projectReference),
    customerId: text(record.customerId),
    customerName: text(record.customerName ?? record.clientName)
  };
}

function normalizeExistingBudget(record) {
  return {
    ...record,
    id: text(record.id),
    name: text(record.name ?? record.budgetName),
    periodType: text(record.periodType).toLowerCase(),
    budgetType: text(record.budgetType).toLowerCase(),
    projectReference: text(record.projectReference)
  };
}

function budgetIdentity(record) {
  return [
    identity(record.name ?? record.budgetName),
    identity(record.periodType),
    text(record.startDate),
    text(record.endDate),
    identity(record.budgetType),
    identity(record.category),
    identity(record.projectReference)
  ].join("|");
}

function preflightGateErrors(preflight) {
  const errors = [];
  if(!isTrustedWorkbookPreflightResult(preflight)){
    errors.push(problem(
      "untrusted-preflight",
      "preflight",
      null,
      "Execution requires the original immutable result returned by canonical workbook preflight."
    ));
    return errors;
  }
  const supportedWorkbook =
    (preflight.workbookType === "canonical" && preflight.schema?.version === 1) ||
    (preflight.workbookType === "legacy" && preflight.schema?.detected === false);
  if(preflight.contract !== "simple-books-workbook-preflight-v1" || !supportedWorkbook){
    errors.push(problem("unsupported-preflight", "preflight", null, "Phase 4A requires a supported canonical or legacy workbook preflight result."));
  }
  if(preflight.safeToProceed !== true){
    errors.push(problem("unsafe-preflight", "preflight", null, "Preflight is not safe to proceed."));
  }
  if(!Array.isArray(preflight.errors) || preflight.errors.length > 0){
    errors.push(problem("preflight-errors", "preflight", null, "Preflight contains validation errors."));
  }
  if(!Array.isArray(preflight.unresolvedRelationships) || preflight.unresolvedRelationships.length > 0){
    errors.push(problem("unresolved-relationships", "preflight", null, "Preflight contains unresolved required relationships."));
  }
  if(!preflight.records || !PHASE4A_MODULE_ORDER.every(moduleName => Array.isArray(preflight.records[moduleName]))){
    errors.push(problem("invalid-preflight-contract", "preflight", null, "Preflight does not contain the required normalized Phase 4A record groups."));
  }
  return errors;
}

function preflightSkipRows(preflight, moduleName) {
  return new Set(
    preflight.duplicateCandidates
      .filter(candidate => candidate.module === moduleName && candidate.proposedAction === "skip")
      .map(candidate => Number(candidate.row))
  );
}

function emptyPlan() {
  return {
    eligible: false,
    moduleOrder: [...PHASE4A_MODULE_ORDER],
    operations: { clients: [], projects: [], budgets: [] },
    skipped: { clients: [], projects: [], budgets: [] },
    resolutions: { clients: new Map(), projects: new Map() },
    conflicts: [],
    errors: []
  };
}

export function planPhase4AExecution(preflight, executionContext = {}) {
  const plan = emptyPlan();
  plan.errors.push(...preflightGateErrors(preflight));
  if(plan.errors.length) return plan;

  const currentClients = (executionContext.clients || [])
    .map(record => normalizeExistingPerson(record, "clients"))
    .filter(record => record.name);
  const currentCustomers = (executionContext.customers || [])
    .map(record => normalizeExistingPerson(record, "customers"))
    .filter(record => record.name);
  const currentProjects = (executionContext.projects || []).map(normalizeExistingProject);
  const currentBudgets = (executionContext.budgets || []).map(normalizeExistingBudget);
  const clientSkipRows = preflightSkipRows(preflight, "clients");
  const projectSkipRows = preflightSkipRows(preflight, "projects");

  for(const current of currentClients){
    plan.resolutions.clients.set(identity(current.name), current);
  }
  for(const current of currentCustomers){
    if(!plan.resolutions.clients.has(identity(current.name))){
      plan.resolutions.clients.set(identity(current.name), current);
    }
  }

  for(const record of preflight.records.clients){
    const key = identity(record.clientName);
    const desiredClient = clientPayload(record);
    const desiredCustomer = customerPayload(record);
    const clientMatches = matchingPeople(currentClients, desiredClient);
    const customerMatches = matchingPeople(currentCustomers, desiredCustomer);
    if(clientMatches.length > 1 || customerMatches.length > 1){
      plan.conflicts.push(problem(
        "ambiguous-client-match",
        "clients",
        record,
        `More than one existing internal record matches ${desiredClient.name} by normalized name or email.`
      ));
      continue;
    }
    const existingClient = clientMatches[0] || null;
    const existingCustomer = customerMatches[0] || null;
    const clientConflict = existingClient && hasMaterialDifference(
      existingClient,
      desiredClient,
      ["name", "email", "phone", "status", "followUp", "lastContacted", "notes"]
    );
    const customerConflict = existingCustomer && hasMaterialDifference(
      existingCustomer,
      desiredCustomer,
      ["name", "email", "address", "paymentTerms"]
    );
    if(clientConflict || customerConflict || representationsConflict(existingClient, existingCustomer)){
      plan.conflicts.push(problem(
        "client-representation-conflict",
        "clients",
        record,
        `Existing Client Tracker or invoice-customer data for ${desiredClient.name} materially conflicts with the workbook; nothing will be overwritten.`
      ));
      continue;
    }
    if(!existingClient && !existingCustomer && clientSkipRows.has(Number(record.source?.row))){
      plan.conflicts.push(problem(
        "stale-client-duplicate",
        "clients",
        record,
        "Preflight marked this client as existing, but the execution-time client snapshot no longer contains it. Run preflight again."
      ));
      continue;
    }
    if(existingClient && existingCustomer){
      plan.resolutions.clients.set(key, existingClient);
      plan.skipped.clients.push({
        record,
        reason: "both-representations-exist",
        existingId: existingClient.id,
        customerId: existingCustomer.id
      });
      continue;
    }
    const pending = {
      id: existingClient?.id || "",
      customerId: existingCustomer?.id || "",
      name: desiredClient.name,
      _pending: true
    };
    plan.resolutions.clients.set(key, pending);
    plan.operations.clients.push({
      record,
      key,
      pending,
      client: {
        action: existingClient ? "existing" : "create",
        existingId: existingClient?.id || "",
        payload: desiredClient
      },
      customer: {
        action: existingCustomer ? "existing" : "create",
        existingId: existingCustomer?.id || "",
        payload: desiredCustomer
      }
    });
  }

  for(const current of currentProjects){
    if(current.reference) plan.resolutions.projects.set(identity(current.reference), current);
  }

  for(const record of preflight.records.projects){
    const key = identity(record.projectReference);
    const clientKey = identity(record.clientName);
    const customer = clientKey ? plan.resolutions.clients.get(clientKey) : null;
    if(clientKey && !customer){
      plan.errors.push(problem(
        "missing-client-relationship",
        "projects",
        record,
        `Project client “${record.clientName}” is no longer resolvable at execution time.`
      ));
      continue;
    }
    const desired = projectPayload(record, customer);
    const existing = plan.resolutions.projects.get(key);
    if(existing){
      if(hasMaterialDifference(existing, desired, ["name", "customerId", "customerName", "description", "status", "startDate", "endDate", "budget"])){
        plan.conflicts.push(problem(
          "project-details-conflict",
          "projects",
          record,
          `Existing project “${desired.reference}” has materially different details; it will not be overwritten.`
        ));
      }else{
        plan.skipped.projects.push({ record, reason: "existing-match", existingId: existing.id });
      }
      continue;
    }
    if(projectSkipRows.has(Number(record.source?.row))){
      plan.conflicts.push(problem(
        "stale-project-duplicate",
        "projects",
        record,
        "Preflight marked this project as existing, but the execution-time project snapshot no longer contains it. Run preflight again."
      ));
      continue;
    }
    const pending = { id: "", name: desired.name, reference: desired.reference, _pending: true };
    plan.resolutions.projects.set(key, pending);
    plan.operations.projects.push({ record, key, clientKey, payload: desired, pending });
  }

  const projectedProjects = [...currentProjects];
  for(const operation of plan.operations.projects){
    if(operation.payload.status !== PROJECT_STATUS.ACTIVE) continue;
    if(!canUseAnotherActiveProject(executionContext.billingProfile, projectedProjects, executionContext.demoMode === true)){
      plan.errors.push(problem(
        "active-project-limit",
        "projects",
        operation.record,
        "The account's current active-project allowance would be exceeded. Nothing has been written."
      ));
    }else{
      projectedProjects.push({ status: PROJECT_STATUS.ACTIVE });
    }
  }

  const budgetsByIdentity = new Map(
    currentBudgets.map(record => [budgetIdentity(record), record])
  );
  for(const record of preflight.records.budgets){
    const projectKey = identity(record.projectReference);
    const project = projectKey ? plan.resolutions.projects.get(projectKey) : null;
    if(projectKey && !project){
      plan.errors.push(problem(
        "missing-project-relationship",
        "budgets",
        record,
        `Budget project “${record.projectReference}” is no longer resolvable at execution time.`
      ));
      continue;
    }
    const desired = budgetPayload(record, project);
    const key = budgetIdentity(desired);
    const existing = budgetsByIdentity.get(key);
    if(existing){
      if(hasMaterialDifference(existing, desired, ["plannedAmount", "status", "projectId", "projectName"])){
        plan.conflicts.push(problem(
          "budget-details-conflict",
          "budgets",
          record,
          `An existing budget with the same identity has materially different details; it will not be overwritten.`
        ));
      }else{
        plan.skipped.budgets.push({ record, reason: "existing-match", existingId: existing.id });
      }
      continue;
    }
    budgetsByIdentity.set(key, { ...desired, _pending: true });
    plan.operations.budgets.push({ record, key, projectKey, payload: desired });
  }

  plan.eligible = plan.errors.length === 0 && plan.conflicts.length === 0;
  return plan;
}

function initialResult() {
  return {
    success: false,
    status: "failed",
    modulesAttempted: [],
    created: { clients: 0, projects: 0, budgets: 0 },
    skipped: { clients: 0, projects: 0, budgets: 0 },
    createdRecords: { clients: [], projects: [], budgets: [] },
    skippedRecords: { clients: [], projects: [], budgets: [] },
    conflicts: [],
    errors: [],
    stoppedEarly: false,
    partialWrites: false
  };
}

function assertPersistence(persistence) {
  for(const method of ["readExecutionContext", "ensureClientRepresentations", "createProject", "createBudget"]){
    if(typeof persistence?.[method] !== "function"){
      throw new TypeError(`Phase 4A persistence requires ${method}().`);
    }
  }
}

function createdIdentity(created, fallback) {
  const id = text(created?.id);
  if(!id) throw new Error("Persistence did not return the created document ID.");
  return { ...fallback, id };
}

export async function executePhase4A(preflight, { persistence } = {}) {
  const result = initialResult();
  const gateErrors = preflightGateErrors(preflight);
  if(gateErrors.length){
    result.errors.push(...gateErrors);
    result.stoppedEarly = true;
    return result;
  }

  try{
    assertPersistence(persistence);
  }catch(error){
    result.errors.push(problem("invalid-persistence", "execution", null, error.message));
    result.stoppedEarly = true;
    return result;
  }

  let context;
  try{
    context = await persistence.readExecutionContext();
  }catch(error){
    result.errors.push(problem("execution-context-read-failed", "execution", null, error?.message || "Could not refresh execution context."));
    result.stoppedEarly = true;
    return result;
  }

  const plan = planPhase4AExecution(preflight, context || {});
  result.conflicts.push(...plan.conflicts);
  result.errors.push(...plan.errors);
  for(const moduleName of PHASE4A_MODULE_ORDER){
    result.skipped[moduleName] = plan.skipped[moduleName].length;
    result.skippedRecords[moduleName] = plan.skipped[moduleName].map(item => ({
      source: sourceOf(item.record, moduleName),
      reason: item.reason,
      existingId: item.existingId,
      ...(item.customerId ? { customerId: item.customerId } : {})
    }));
  }
  if(!plan.eligible){
    result.stoppedEarly = true;
    return result;
  }

  try{
    for(const operation of plan.operations.clients){
      result.modulesAttempted.push("clients");
      const ensured = await persistence.ensureClientRepresentations(operation, {
        identity: operation.key
      });
      const clientId = text(ensured?.clientId);
      const customerId = text(ensured?.customerId);
      if(!clientId || !customerId){
        throw new Error("Persistence did not ensure both Client Tracker and invoice-customer document IDs.");
      }
      Object.assign(operation.pending, { id: clientId, customerId });
      result.created.clients += 1;
      result.createdRecords.clients.push({
        id: clientId,
        customerId,
        representationsCreated: [
          operation.client.action === "create" ? "clients" : "",
          operation.customer.action === "create" ? "customers" : ""
        ].filter(Boolean),
        source: sourceOf(operation.record, "Clients")
      });
    }

    for(const operation of plan.operations.projects){
      result.modulesAttempted.push("projects");
      const customer = operation.clientKey ? plan.resolutions.clients.get(operation.clientKey) : null;
      const payload = projectPayload(operation.record, customer);
      const created = createdIdentity(
        await persistence.createProject(payload, { identity: operation.key }),
        { name: payload.name, reference: payload.reference }
      );
      Object.assign(operation.pending, created);
      result.created.projects += 1;
      result.createdRecords.projects.push({ id: created.id, source: sourceOf(operation.record, "Projects") });
    }

    for(const operation of plan.operations.budgets){
      result.modulesAttempted.push("budgets");
      const project = operation.projectKey ? plan.resolutions.projects.get(operation.projectKey) : null;
      const payload = budgetPayload(operation.record, project);
      const created = createdIdentity(
        await persistence.createBudget(payload, { identity: operation.key }),
        { name: payload.name }
      );
      result.created.budgets += 1;
      result.createdRecords.budgets.push({ id: created.id, source: sourceOf(operation.record, "Budgets") });
    }
  }catch(error){
    const failedModule = PHASE4A_MODULE_ORDER.find(moduleName =>
      result.modulesAttempted.at(-1) === moduleName
    ) || "execution";
    result.errors.push(problem(
      "persistence-failure",
      failedModule,
      null,
      error?.message || "Persistence failed unexpectedly."
    ));
    result.stoppedEarly = true;
    result.partialWrites = Object.values(result.created).some(count => count > 0);
    return result;
  }

  result.success = true;
  result.status = "success";
  result.modulesAttempted = [...new Set(result.modulesAttempted)];
  result.partialWrites = false;
  return result;
}
