export const BANK_SETTLEMENT_STATUS_MESSAGE =
  "This record is matched to a bank transaction. Unmatch it in Banking before changing its payment status.";

export const BANK_SETTLEMENT_PROTECTED_ACTIONS_MESSAGE =
  "This record is matched to a bank transaction. Unmatch it in Banking before editing, changing its payment status or deleting it.";

export const BANK_SETTLEMENT_ACCOUNTING_MESSAGE =
  "This invoice is matched to a bank transaction. Unmatch it in Banking before changing accounting details.";

export const BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE =
  "This record is matched to a bank transaction. Unmatch it in Banking before changing accounting details.";

export const BANK_SETTLED_EXPENSE_EDIT_ERROR_CODE = "bank-settled-expense-edit";

export const BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE =
  "This record is matched to a bank transaction. Unmatch it in Banking before deleting it.";

export const BANK_SETTLED_EXPENSE_DELETE_ERROR_CODE = "bank-settled-expense-delete";

export const BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE =
  "This record is matched to a bank transaction. Unmatch it in Banking before changing accounting details.";

export const BANK_SETTLED_BILL_MUTATION_ERROR_CODE = "bank-settled-bill-mutation";

export const BANK_CATEGORISATION_STATUS_MESSAGE =
  "This expense was created from a bank transaction. Uncategorise it in Banking before editing or deleting it.";

export function isBankingSettledSource(record){
  const marker = record?.bankSettlement;
  return Boolean(
    marker &&
    Number(marker.version) === 1 &&
    String(marker.transactionId || "").trim() &&
    String(marker.journalId || "").trim()
  );
}

export function isBankCategorisedExpense(record){
  const marker = record?.bankCategorisation;
  return Boolean(
    marker &&
    Number(marker.version) === 1 &&
    String(marker.transactionId || "").trim()
  );
}

export function sourceStatusForSave(record,requestedStatus){
  return isBankingSettledSource(record)
    ? String(record?.status || "Paid")
    : String(requestedStatus || "");
}

function snapshotExists(snapshot){
  return typeof snapshot?.exists === "function" ? snapshot.exists() : Boolean(snapshot?.exists);
}

function bankSettledBillMutationError(){
  const error = new Error(BANK_SETTLEMENT_BILL_ACCOUNTING_MESSAGE);
  error.code = BANK_SETTLED_BILL_MUTATION_ERROR_CODE;
  return error;
}

function requireBillMutationOptions(options){
  const { db,services = {} } = options;
  const userId = String(options.userId || "").trim();
  const billId = String(options.billId || "").trim();
  if(!userId) throw new Error("An authenticated user is required to change a bill.");
  if(!billId || billId.includes("/")) throw new Error("Bill ID is invalid.");
  if(typeof services.doc !== "function") throw new Error("Firestore doc helper is required.");
  return { db,services,userId,billId,billRef:services.doc(db,"users",userId,"bills",billId) };
}

export async function readBillRecordWithSettlementGuard(options = {}){
  const { services,billId,billRef } = requireBillMutationOptions(options);
  if(typeof services.getDoc !== "function") throw new Error("Firestore getDoc helper is required.");
  const snapshot = await services.getDoc(billRef);
  if(!snapshotExists(snapshot)) throw new Error("Could not find this bill.");
  const bill = snapshot.data();
  if(isBankingSettledSource(bill)) throw bankSettledBillMutationError();
  return Object.freeze({ ...bill,id:billId });
}

export async function saveBillRecordWithSettlementGuard(options = {}){
  const { db,services,billId,billRef } = requireBillMutationOptions(options);
  const bill = options.bill;
  if(!bill || typeof bill !== "object" || Array.isArray(bill)){
    throw new Error("Bill data is required.");
  }
  if(typeof services.runTransaction !== "function"){
    throw new Error("Firestore runTransaction helper is required.");
  }

  return services.runTransaction(db,async transaction => {
    const snapshot = await transaction.get(billRef);
    const exists = snapshotExists(snapshot);
    if(options.requireExisting && !exists) throw new Error("Could not find this bill.");
    if(exists && isBankingSettledSource(snapshot.data())) throw bankSettledBillMutationError();
    if(typeof transaction.set !== "function") throw new Error("Firestore transaction set helper is required.");
    transaction.set(billRef,bill);
    return Object.freeze({ status:exists ? "updated" : "created",billId });
  });
}

export async function deleteBillRecordWithSettlementGuard(options = {}){
  const { db,services,billId,billRef } = requireBillMutationOptions(options);
  if(typeof services.runTransaction !== "function"){
    throw new Error("Firestore runTransaction helper is required.");
  }

  return services.runTransaction(db,async transaction => {
    const snapshot = await transaction.get(billRef);
    if(!snapshotExists(snapshot)) throw new Error("Could not find this bill.");
    if(isBankingSettledSource(snapshot.data())) throw bankSettledBillMutationError();
    if(typeof transaction.delete !== "function") throw new Error("Firestore transaction delete helper is required.");
    transaction.delete(billRef);
    return Object.freeze({ status:"deleted",billId });
  });
}

export async function saveExpenseRecordWithSettlementGuard(options = {}){
  const { db,services = {},expense } = options;
  const userId = String(options.userId || "").trim();
  const expenseId = String(options.expenseId || "").trim();
  if(!userId) throw new Error("An authenticated user is required to save an expense.");
  if(!expenseId || expenseId.includes("/")) throw new Error("Expense ID is invalid.");
  if(!expense || typeof expense !== "object" || Array.isArray(expense)){
    throw new Error("Expense data is required.");
  }
  for(const helper of ["doc","runTransaction"]){
    if(typeof services[helper] !== "function") throw new Error(`Firestore ${helper} helper is required.`);
  }
  const expenseRef = services.doc(db,"users",userId,"expenses",expenseId);

  return services.runTransaction(db,async transaction => {
    const snapshot = await transaction.get(expenseRef);
    const exists = snapshotExists(snapshot);
    if(options.requireExisting && !exists) throw new Error("Could not find this expense or mileage claim.");
    if(exists && isBankingSettledSource(snapshot.data())){
      const error = new Error(BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE);
      error.code = BANK_SETTLED_EXPENSE_EDIT_ERROR_CODE;
      throw error;
    }
    if(typeof transaction.set !== "function") throw new Error("Firestore transaction set helper is required.");
    transaction.set(expenseRef,expense);
    return Object.freeze({ status:exists ? "updated" : "created",expenseId });
  });
}

export async function deleteExpenseRecordWithSettlementGuard(options = {}){
  const { db,services = {} } = options;
  const userId = String(options.userId || "").trim();
  const expenseId = String(options.expenseId || "").trim();
  if(!userId) throw new Error("An authenticated user is required to delete an expense.");
  if(!expenseId || expenseId.includes("/")) throw new Error("Expense ID is invalid.");
  for(const helper of ["doc","runTransaction"]){
    if(typeof services[helper] !== "function") throw new Error(`Firestore ${helper} helper is required.`);
  }
  const expenseRef = services.doc(db,"users",userId,"expenses",expenseId);

  return services.runTransaction(db,async transaction => {
    const snapshot = await transaction.get(expenseRef);
    if(!snapshotExists(snapshot)) throw new Error("Could not find this expense or mileage claim.");
    if(isBankingSettledSource(snapshot.data())){
      const error = new Error(BANK_SETTLEMENT_EXPENSE_DELETE_MESSAGE);
      error.code = BANK_SETTLED_EXPENSE_DELETE_ERROR_CODE;
      throw error;
    }
    if(typeof transaction.delete !== "function") throw new Error("Firestore transaction delete helper is required.");
    transaction.delete(expenseRef);
    return Object.freeze({ status:"deleted",expenseId });
  });
}
