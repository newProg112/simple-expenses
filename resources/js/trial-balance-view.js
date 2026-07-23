import { buildTrialBalance } from "./ledger-engine.js";

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function formatTrialBalanceGbp(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("A finite amount is required.");

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function requireJournalOwnerId(userId) {
  const ownerId = String(userId ?? "").trim();
  if (!ownerId) throw new Error("An authenticated user ID is required.");
  return ownerId;
}

export function journalFromFirestoreData(documentId, data) {
  const journalData = data && typeof data === "object" && !Array.isArray(data)
    ? data
    : {};

  return {
    id: String(documentId || journalData.journalId || ""),
    journalId: journalData.journalId,
    date: journalData.date,
    sourceType: journalData.sourceType,
    sourceId: journalData.sourceId,
    description: journalData.description,
    lines: Array.isArray(journalData.lines)
      ? journalData.lines.map(line => ({
          accountCode: line?.accountCode,
          description: line?.description,
          debit: line?.debit,
          credit: line?.credit
        }))
      : journalData.lines
  };
}

export function createTrialBalanceView(trialBalance, journalCount = 0) {
  if (!trialBalance || !Array.isArray(trialBalance.accounts)) {
    throw new Error("A Trial Balance result is required.");
  }

  const totalDebits = roundMoney(trialBalance.totalDebits);
  const totalCredits = roundMoney(trialBalance.totalCredits);
  const difference = roundMoney(Math.abs(totalDebits - totalCredits));
  const rows = [...trialBalance.accounts]
    .sort((left, right) =>
      String(left.accountCode || "").localeCompare(String(right.accountCode || ""))
    )
    .map(account => {
      const debitBalance = roundMoney(account.debitBalance || 0);
      const creditBalance = roundMoney(account.creditBalance || 0);

      return {
        accountCode: String(account.accountCode || ""),
        accountName: String(account.accountName || ""),
        debitBalance,
        creditBalance,
        debitDisplay: debitBalance > 0 ? formatTrialBalanceGbp(debitBalance) : "",
        creditDisplay: creditBalance > 0 ? formatTrialBalanceGbp(creditBalance) : ""
      };
    });

  if (journalCount === 0 || rows.length === 0) {
    return {
      state: "empty",
      rows: [],
      totalDebits: 0,
      totalCredits: 0,
      difference: 0,
      totalDebitsDisplay: "—",
      totalCreditsDisplay: "—",
      differenceDisplay: "—",
      status: "No data",
      statusText: "No journal data available"
    };
  }

  const balanced = difference === 0;

  return {
    state: "ready",
    rows,
    totalDebits,
    totalCredits,
    difference,
    totalDebitsDisplay: formatTrialBalanceGbp(totalDebits),
    totalCreditsDisplay: formatTrialBalanceGbp(totalCredits),
    differenceDisplay: formatTrialBalanceGbp(difference),
    status: balanced ? "Balanced" : "Out of balance",
    statusText: balanced ? "Debits equal credits" : "Review journal data"
  };
}

export function trialBalanceViewFromJournals(journals) {
  try {
    if (!Array.isArray(journals)) throw new Error("Journals must be an array.");
    const trialBalance = buildTrialBalance(journals);
    return createTrialBalanceView(trialBalance, journals.length);
  } catch (error) {
    return {
      state: "error",
      rows: [],
      totalDebits: null,
      totalCredits: null,
      difference: null,
      totalDebitsDisplay: "—",
      totalCreditsDisplay: "—",
      differenceDisplay: "—",
      status: "Unable to calculate",
      statusText: "Please try again",
      error
    };
  }
}
