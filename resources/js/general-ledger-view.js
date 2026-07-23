import {
  buildAccountLedger,
  buildTrialBalance
} from "./ledger-engine.js";
import { formatTrialBalanceGbp } from "./trial-balance-view.js";

function calendarDateKey(value) {
  const rawValue = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(rawValue);
  if (!match) return "";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return "";
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function stableJournalKey(journal) {
  return String(
    journal?.journalId ||
    journal?.id ||
    journal?.sourceId ||
    ""
  );
}

export function generalLedgerDateRange(dateFrom = "", dateTo = "") {
  const from = dateFrom ? calendarDateKey(dateFrom) : "";
  const to = dateTo ? calendarDateKey(dateTo) : "";
  const valid = (!dateFrom || Boolean(from)) &&
    (!dateTo || Boolean(to)) &&
    (!from || !to || from <= to);

  return {
    valid,
    from,
    to,
    error: valid ? "" : "Date From must be on or before Date To."
  };
}

export function filterJournalsByDate(journals, dateFrom = "", dateTo = "") {
  if (!Array.isArray(journals)) throw new Error("Journals must be an array.");
  const range = generalLedgerDateRange(dateFrom, dateTo);
  if (!range.valid) throw new Error(range.error);

  return journals.filter(journal => {
    const date = calendarDateKey(journal?.date);
    if (!date) return false;
    if (range.from && date < range.from) return false;
    if (range.to && date > range.to) return false;
    return true;
  });
}

export function sortJournalsForAccountLedger(journals) {
  if (!Array.isArray(journals)) throw new Error("Journals must be an array.");

  return [...journals].sort((left, right) => {
    const dateDifference = calendarDateKey(left?.date)
      .localeCompare(calendarDateKey(right?.date));
    return dateDifference ||
      stableJournalKey(left).localeCompare(stableJournalKey(right));
  });
}

export function activeGeneralLedgerAccounts(journals) {
  journals.forEach(journal => {
    if (!calendarDateKey(journal?.date)) {
      throw new Error("A valid journal calendar date is required.");
    }
  });
  const trialBalance = buildTrialBalance(journals);

  return trialBalance.accounts
    .filter(account => Number(account.debits) !== 0 || Number(account.credits) !== 0)
    .map(account => ({
      accountCode: account.accountCode,
      accountName: account.accountName,
      label: `${account.accountCode} — ${account.accountName}`
    }))
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode));
}

export function resolveGeneralLedgerAccount(requestedAccount, accounts) {
  const requested = String(requestedAccount ?? "").trim();
  if (!requested || !Array.isArray(accounts)) return "";
  return accounts.some(account => account.accountCode === requested)
    ? requested
    : "";
}

export function generalLedgerReference(entry) {
  return String(
    entry?.sourceNumber ||
    entry?.sourceId ||
    entry?.journalId ||
    entry?.journalReference ||
    ""
  );
}

export function formatGeneralLedgerBalance(value) {
  const balance = Number(value);
  if (!Number.isFinite(balance)) throw new Error("A finite balance is required.");
  if (balance === 0) return formatTrialBalanceGbp(0);

  return `${formatTrialBalanceGbp(Math.abs(balance))} ${balance > 0 ? "Dr" : "Cr"}`;
}

function ledgerRows(entries) {
  return entries.map(entry => ({
    date: calendarDateKey(entry.date) || String(entry.date || ""),
    reference: generalLedgerReference(entry),
    description: String(entry.description || ""),
    debit: entry.debit,
    credit: entry.credit,
    runningBalance: entry.runningBalance,
    debitDisplay: entry.debit > 0 ? formatTrialBalanceGbp(entry.debit) : "—",
    creditDisplay: entry.credit > 0 ? formatTrialBalanceGbp(entry.credit) : "—",
    runningBalanceDisplay: formatGeneralLedgerBalance(entry.runningBalance)
  }));
}

function baseView(accounts) {
  return {
    accounts,
    accountsCount: accounts.length,
    entriesCount: 0,
    rows: [],
    selectedAccountCode: "",
    selectedAccountName: "",
    heading: "Journal entries",
    headingText: "Choose an account to review its ledger entries.",
    closingBalance: 0,
    closingBalanceDisplay: "£0.00",
    error: null
  };
}

export function generalLedgerViewFromJournals(
  journals,
  { accountCode = "", dateFrom = "", dateTo = "" } = {}
) {
  try {
    if (!Array.isArray(journals)) throw new Error("Journals must be an array.");
    const accounts = activeGeneralLedgerAccounts(journals);
    const base = baseView(accounts);

    if (journals.length === 0 || accounts.length === 0) {
      return {
        ...base,
        state: "noData",
        status: "No data",
        statusText: "No journal data available",
        emptyTitle: "No journal data available.",
        emptyText: "Journal entries will appear here after journals have been posted."
      };
    }

    const selectedAccountCode = resolveGeneralLedgerAccount(accountCode, accounts);
    const selectedAccount = accounts.find(
      account => account.accountCode === selectedAccountCode
    );

    if (!selectedAccount) {
      return {
        ...base,
        state: "ready",
        status: "Ready",
        statusText: "Choose an account",
        emptyTitle: "Choose an account to review its ledger entries.",
        emptyText: "Select an account above to view its journal postings."
      };
    }

    const selected = {
      selectedAccountCode,
      selectedAccountName: selectedAccount.accountName,
      heading: selectedAccount.label,
      headingText: "Account activity in chronological order."
    };
    const range = generalLedgerDateRange(dateFrom, dateTo);

    if (!range.valid) {
      return {
        ...base,
        ...selected,
        state: "invalidDate",
        status: "Check dates",
        statusText: "Date range is invalid",
        dateError: range.error,
        emptyTitle: range.error,
        emptyText: "Adjust the date filters and refresh the ledger."
      };
    }

    const filteredJournals = filterJournalsByDate(journals, dateFrom, dateTo);
    const orderedJournals = sortJournalsForAccountLedger(filteredJournals);
    const ledger = buildAccountLedger(orderedJournals, selectedAccountCode);
    const rows = ledgerRows(ledger.entries);
    const closingBalance = ledger.closingBalance;

    if (rows.length === 0) {
      return {
        ...base,
        ...selected,
        state: "noActivity",
        status: "No activity",
        statusText: "No entries in selected period",
        emptyTitle: "No journal entries found for the selected date range.",
        emptyText: "Adjust the date filters or choose another account."
      };
    }

    return {
      ...base,
      ...selected,
      state: "loaded",
      status: "Loaded",
      statusText: `${rows.length} ${rows.length === 1 ? "entry" : "entries"} shown`,
      entriesCount: rows.length,
      rows,
      closingBalance,
      closingBalanceDisplay: formatGeneralLedgerBalance(closingBalance),
      emptyTitle: "",
      emptyText: ""
    };
  } catch (error) {
    return {
      ...baseView([]),
      state: "error",
      status: "Unable to load",
      statusText: "Please try again",
      emptyTitle: "We could not load the General Ledger. Please try again.",
      emptyText: "No partial journal results have been displayed.",
      error
    };
  }
}
