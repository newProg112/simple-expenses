import { isDemoMode } from "./demo-mode.js?v=20260806-demo-pro2";
import { DEMO_SEED, DEMO_SEED_VERSION } from "./demo-seed.js";
import {
  prepareBillJournal,
  prepareExpenseJournal,
  prepareInvoiceJournal,
  prepareMileageJournal
} from "../resources/js/ledger-firestore.js";

export const DEMO_SEED_SECTION_COLLECTIONS = Object.freeze({
  customers: "customers",
  projects: "projects",
  invoices: "invoices",
  bills: "bills",
  expenses: "expenses",
  mileage: "expenses",
  budgets: "budgets"
});

export const DEMO_MANAGED_USER_COLLECTIONS = Object.freeze([
  "customers",
  "clients",
  "projects",
  "invoices",
  "bills",
  "expenses",
  "budgets",
  "bankAccounts",
  "bankTransactions",
  "bankIncome",
  "bankReconciliations",
  "bankTransfers",
  "bankTransferLinks",
  "bankExceptionResolutions"
]);

const BATCH_OPERATION_LIMIT = 450;
const TRANSACTION_SECTIONS = Object.freeze([
  ["invoices", "salesInvoice", prepareInvoiceJournal],
  ["bills", "supplierBill", prepareBillJournal],
  ["expenses", "expenseClaim", prepareExpenseJournal],
  ["mileage", "mileageClaim", prepareMileageJournal]
]);

function isRecord(value){
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordsFor(seed, section){
  return Array.isArray(seed?.[section]) ? seed[section] : [];
}

function cents(value){
  return Math.round(Number(value) * 100);
}

function addRequiredStringError(errors, value, path){
  if(!String(value || "").trim()){
    errors.push(`${path} is required.`);
  }
}

function validateRecordShape(errors, section, record, index){
  const path = `${section}[${index}]`;
  addRequiredStringError(errors, record?.id, `${path}.id`);

  if(!isRecord(record?.data)){
    errors.push(`${path}.data must be an object.`);
  }
}

function validateProjectRelationships(errors, seed){
  const customers = new Map(recordsFor(seed, "customers").map(record => [record.id, record.data]));
  const projects = new Map(recordsFor(seed, "projects").map(record => [record.id, record.data]));

  for(const project of recordsFor(seed, "projects")){
    const customer = customers.get(project.data?.customerId);
    if(!customer){
      errors.push(`Project ${project.id} references an unknown customer.`);
    }else if(project.data.customerName !== customer.name){
      errors.push(`Project ${project.id} customerName does not match its customer.`);
    }
  }

  for(const section of ["invoices", "bills", "expenses", "mileage", "budgets"]){
    for(const record of recordsFor(seed, section)){
      if(!record.data?.projectId){
        continue;
      }

      const project = projects.get(record.data.projectId);
      if(!project){
        errors.push(`${section} record ${record.id} references an unknown project.`);
        continue;
      }

      if(
        record.data.projectName !== project.name ||
        record.data.projectReference !== project.reference
      ){
        errors.push(`${section} record ${record.id} project details do not match its project.`);
      }
    }
  }

  for(const invoice of recordsFor(seed, "invoices")){
    const customer = [...customers.values()].find(candidate =>
      candidate.name === invoice.data?.client &&
      candidate.email === invoice.data?.clientEmail
    );

    if(!customer){
      errors.push(`Invoice ${invoice.id} does not match an existing customer.`);
    }
  }
}

function validateMonetaryConsistency(errors, seed){
  for(const invoice of recordsFor(seed, "invoices")){
    const itemTotal = (invoice.data?.items || [])
      .reduce((total, item) => total + Number(item?.amount || 0), 0);

    if(cents(itemTotal) !== cents(invoice.data?.amount)){
      errors.push(`Invoice ${invoice.id} amount does not equal its item total.`);
    }

    if(cents(Number(invoice.data?.amount) + Number(invoice.data?.vat)) !== cents(invoice.data?.total)){
      errors.push(`Invoice ${invoice.id} total is inconsistent.`);
    }
  }

  for(const bill of recordsFor(seed, "bills")){
    if(cents(Number(bill.data?.net) + Number(bill.data?.vat)) !== cents(bill.data?.total)){
      errors.push(`Bill ${bill.id} total is inconsistent.`);
    }
  }

  for(const expense of recordsFor(seed, "expenses")){
    if(cents(Number(expense.data?.net) + Number(expense.data?.vat)) !== cents(expense.data?.gross)){
      errors.push(`Expense ${expense.id} gross amount is inconsistent.`);
    }
  }

  for(const mileage of recordsFor(seed, "mileage")){
    if(cents(Number(mileage.data?.miles) * Number(mileage.data?.ratePerMile)) !== cents(mileage.data?.amount)){
      errors.push(`Mileage ${mileage.id} amount is inconsistent.`);
    }
  }
}

export function buildDemoJournalRecords(userId, seed = DEMO_SEED){
  const ownerId = String(userId || "").trim();
  if(!ownerId){
    throw new Error("A user ID is required to build demo journals.");
  }

  return TRANSACTION_SECTIONS.flatMap(([section, _sourceType, prepare]) =>
    recordsFor(seed, section).map(record => {
      const timestamps = {
        createdAt: record.data.createdAt || "",
        updatedAt: record.data.updatedAt || record.data.createdAt || ""
      };
      const data = prepare(ownerId, record.id, record.data, timestamps);
      return { id: data.journalId, data };
    })
  );
}

export function validateDemoSeed(seed = DEMO_SEED){
  const errors = [];

  if(!isRecord(seed)){
    return { valid: false, errors: ["Demo seed must be an object."] };
  }

  if(!isRecord(seed.businessProfile)){
    errors.push("businessProfile must be an object.");
  }else{
    addRequiredStringError(errors, seed.businessProfile.businessName, "businessProfile.businessName");
    if(seed.businessProfile.demoMode !== true){
      errors.push("businessProfile.demoMode must be true.");
    }
  }

  const storagePaths = new Set();
  for(const [section, collectionName] of Object.entries(DEMO_SEED_SECTION_COLLECTIONS)){
    if(!Array.isArray(seed[section])){
      errors.push(`${section} must be an array.`);
      continue;
    }

    seed[section].forEach((record, index) => {
      validateRecordShape(errors, section, record, index);
      const storagePath = `${collectionName}/${record?.id || ""}`;
      if(storagePaths.has(storagePath)){
        errors.push(`Duplicate demo document path: ${storagePath}.`);
      }
      storagePaths.add(storagePath);
    });
  }

  validateProjectRelationships(errors, seed);
  validateMonetaryConsistency(errors, seed);

  try{
    buildDemoJournalRecords("demo-seed-validation-user", seed);
  }catch(error){
    errors.push(`Demo journal validation failed: ${error.message}`);
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidDemoSeed(seed = DEMO_SEED){
  const validation = validateDemoSeed(seed);
  if(!validation.valid){
    throw new Error(`Invalid demo seed: ${validation.errors.join(" ")}`);
  }
  return seed;
}

async function defaultFirestoreServices(){
  const [{ auth, db }, firestore] = await Promise.all([
    import("/firebase-config.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
  ]);

  return {
    auth,
    db,
    collection: firestore.collection,
    doc: firestore.doc,
    getDoc: firestore.getDoc,
    getDocs: firestore.getDocs,
    query: firestore.query,
    where: firestore.where,
    writeBatch: firestore.writeBatch
  };
}

function requireFirestoreServices(services){
  for(const method of ["collection", "doc", "getDoc", "getDocs", "query", "where", "writeBatch"]){
    if(typeof services?.[method] !== "function"){
      throw new Error(`Firestore ${method} helper is required.`);
    }
  }
}

async function resolveDemoContext(options){
  const services = options.services || await defaultFirestoreServices();
  requireFirestoreServices(services);

  const user = options.user || services.auth?.currentUser || null;
  if(!user?.uid){
    throw new Error("An authenticated demo user is required.");
  }

  let accountData = options.accountData;
  if(accountData === undefined){
    const accountSnapshot = await services.getDoc(
      services.doc(services.db, "users", user.uid)
    );
    accountData = accountSnapshot.exists() ? accountSnapshot.data() : null;
  }

  if(!isDemoMode(user, accountData)){
    throw new Error("Demo seeding is only available for an account with demoMode enabled.");
  }

  return { services, user, accountData };
}

async function commitOperations(services, operations){
  let committedBatches = 0;

  for(let start = 0; start < operations.length; start += BATCH_OPERATION_LIMIT){
    const batch = services.writeBatch(services.db);
    const chunk = operations.slice(start, start + BATCH_OPERATION_LIMIT);

    for(const operation of chunk){
      if(operation.type === "set"){
        if(operation.options){
          batch.set(operation.reference, operation.data, operation.options);
        }else{
          batch.set(operation.reference, operation.data);
        }
      }else{
        batch.delete(operation.reference);
      }
    }

    await batch.commit();
    committedBatches += 1;
  }

  return committedBatches;
}

function seedWriteOperations(services, userId, seed){
  const operations = [{
    type: "set",
    reference: services.doc(services.db, "users", userId),
    data: seed.businessProfile,
    options: { merge: true }
  }];

  for(const [section, collectionName] of Object.entries(DEMO_SEED_SECTION_COLLECTIONS)){
    for(const record of recordsFor(seed, section)){
      operations.push({
        type: "set",
        reference: services.doc(services.db, "users", userId, collectionName, record.id),
        data: record.data
      });
    }
  }

  for(const journal of buildDemoJournalRecords(userId, seed)){
    operations.push({
      type: "set",
      reference: services.doc(services.db, "journals", journal.id),
      data: journal.data
    });
  }

  return operations;
}

export async function seedDemoBusiness(options = {}){
  const seed = options.seed || DEMO_SEED;
  assertValidDemoSeed(seed);
  const { services, user } = await resolveDemoContext(options);
  const operations = seedWriteOperations(services, user.uid, seed);
  const committedBatches = await commitOperations(services, operations);

  return {
    seedVersion: DEMO_SEED_VERSION,
    writtenDocuments: operations.length,
    committedBatches
  };
}

export async function clearDemoBusiness(options = {}){
  const { services, user } = await resolveDemoContext(options);
  const snapshots = await Promise.all([
    ...DEMO_MANAGED_USER_COLLECTIONS.map(collectionName =>
      services.getDocs(services.collection(services.db, "users", user.uid, collectionName))
    ),
    services.getDocs(services.query(
      services.collection(services.db, "journals"),
      services.where("userId", "==", user.uid)
    ))
  ]);
  const references = snapshots.flatMap(snapshot => snapshot.docs.map(document => document.ref));
  const operations = references.map(reference => ({ type: "delete", reference }));
  const committedBatches = await commitOperations(services, operations);

  return {
    deletedDocuments: operations.length,
    committedBatches,
    preservedAccountDocument: true
  };
}
