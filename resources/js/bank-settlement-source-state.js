export const BANK_SETTLEMENT_STATUS_MESSAGE =
  "This record is matched to a bank transaction. Unmatch it in Banking before changing its payment status.";

export const BANK_SETTLEMENT_ACCOUNTING_MESSAGE =
  "This invoice is matched to a bank transaction. Unmatch it in Banking before changing accounting details.";

export const BANK_SETTLEMENT_EXPENSE_ACCOUNTING_MESSAGE =
  "This record is matched to a bank transaction. Unmatch it in Banking before changing accounting details.";

export const BANK_SETTLED_EXPENSE_EDIT_ERROR_CODE = "bank-settled-expense-edit";

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
