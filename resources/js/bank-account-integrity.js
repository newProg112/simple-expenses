const SUPPORTED_BANK_ACCOUNT_STATUSES = Object.freeze(new Set(["Active","Archived"]));

function snapshotExists(snapshot){
  return typeof snapshot?.exists === "function" ? snapshot.exists() : Boolean(snapshot?.exists);
}

export async function requireOwnedBankAccountInTransaction(options = {}){
  const { db,services = {},firestoreTransaction,bankTransaction } = options;
  const userId = String(options.userId || "").trim();
  const rawBankAccountId = typeof bankTransaction?.bankAccountId === "string"
    ? bankTransaction.bankAccountId
    : "";
  const bankAccountId = rawBankAccountId.trim();
  if(!bankAccountId || rawBankAccountId !== bankAccountId || bankAccountId.length > 1400 || bankAccountId.includes("/")){
    throw new Error("Bank transaction has an invalid bank account attribution.");
  }
  if(!userId || typeof services.doc !== "function" || typeof firestoreTransaction?.get !== "function"){
    throw new Error("Bank account integrity validation is unavailable.");
  }
  const accountRef = services.doc(db,"users",userId,"bankAccounts",bankAccountId);
  const accountSnapshot = await firestoreTransaction.get(accountRef);
  if(!snapshotExists(accountSnapshot)){
    throw new Error("The bank account attributed to this transaction does not exist for the authenticated user.");
  }
  const status = String(accountSnapshot.data()?.status || "");
  if(!SUPPORTED_BANK_ACCOUNT_STATUSES.has(status)){
    throw new Error("The bank account attributed to this transaction has an unsupported status.");
  }
  return Object.freeze({ bankAccountId,status });
}
