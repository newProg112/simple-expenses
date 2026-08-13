export const BANK_ACCOUNT_STATUS = Object.freeze({
  ACTIVE:"Active",
  ARCHIVED:"Archived"
});

function finiteMoney(value){
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

function timestampValue(value){
  if(typeof value?.toMillis === "function") return value.toMillis();
  if(typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normaliseOpeningBalanceDate(value){
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year,month - 1,day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? raw
    : "";
}

export function validateBankAccountInput(input = {}){
  const accountName = String(input.accountName || "").trim();
  const bankName = String(input.bankName || "").trim();
  const openingSource = String(input.openingBalance ?? "").trim();
  const openingBalance = openingSource === "" ? 0 : finiteMoney(openingSource);
  const openingBalanceDate = normaliseOpeningBalanceDate(input.openingBalanceDate);
  const errors = {};
  if(!accountName) errors.accountName = "Enter an account name.";
  if(!bankName) errors.bankName = "Enter a bank name.";
  if(openingBalance === null) errors.openingBalance = "Enter a valid opening balance.";
  if(!openingBalanceDate) errors.openingBalanceDate = "Enter a valid opening balance effective date.";
  return Object.freeze({
    valid:Object.keys(errors).length === 0,
    errors:Object.freeze(errors),
    value:Object.freeze({ accountName, bankName, openingBalance:openingBalance ?? 0, openingBalanceDate })
  });
}

export function normaliseBankAccount(id, data = {}){
  const openingBalance = finiteMoney(data.openingBalance);
  return Object.freeze({
    id:String(id || ""),
    accountName:String(data.accountName || "").trim(),
    bankName:String(data.bankName || "").trim(),
    openingBalance:openingBalance ?? 0,
    openingBalanceDate:normaliseOpeningBalanceDate(data.openingBalanceDate),
    openingBalanceAccounting:data.openingBalanceAccounting && typeof data.openingBalanceAccounting === "object"
      ? Object.freeze({ ...data.openingBalanceAccounting })
      : null,
    bankingActivity:data.bankingActivity && typeof data.bankingActivity === "object"
      ? Object.freeze({ ...data.bankingActivity })
      : null,
    status:data.status === BANK_ACCOUNT_STATUS.ARCHIVED ? BANK_ACCOUNT_STATUS.ARCHIVED : BANK_ACCOUNT_STATUS.ACTIVE,
    createdAt:data.createdAt || null
  });
}

export function activeBankAccounts(accounts = []){
  return (Array.isArray(accounts) ? accounts : [])
    .filter(account => account?.status !== BANK_ACCOUNT_STATUS.ARCHIVED)
    .slice()
    .sort((left, right) => timestampValue(right.createdAt) - timestampValue(left.createdAt) ||
      String(left.accountName || "").localeCompare(String(right.accountName || "")) ||
      String(left.id || "").localeCompare(String(right.id || "")));
}
