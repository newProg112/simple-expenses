import {
  buildTrialBalance,
  DEFAULT_CHART_OF_ACCOUNTS
} from "./ledger-engine.js";
import {
  filterJournalsByDate,
  generalLedgerDateRange
} from "./general-ledger-view.js";
import { buildProfitLossReport } from "./profit-loss-view.js";
import {
  formatTrialBalanceGbp,
  journalFromFirestoreData,
  requireJournalOwnerId
} from "./trial-balance-view.js";

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function neutralView() {
  return {
    assetRows: [],
    liabilityRows: [],
    equityRows: [],
    currentYearResult: null,
    currentYearResultLabel: "Current Year Profit",
    currentYearResultDisplay: "—",
    currentYearResultHref: "/resources/tools/profit-loss.html",
    totalAssets: null,
    totalLiabilities: null,
    totalEquity: null,
    totalLiabilitiesAndEquity: null,
    difference: null,
    totalAssetsDisplay: "—",
    totalLiabilitiesDisplay: "—",
    totalEquityDisplay: "—",
    totalLiabilitiesAndEquityDisplay: "—",
    differenceDisplay: "—",
    reportingDate: "",
    error: null
  };
}

export function formatBalanceSheetAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("A finite amount is required.");
  const rounded = roundMoney(amount);
  return rounded < 0
    ? `(${formatTrialBalanceGbp(Math.abs(rounded))})`
    : formatTrialBalanceGbp(rounded);
}

export function balanceSheetAsAtDate(asAt = "") {
  const rawDate = String(asAt ?? "").trim();
  const range = generalLedgerDateRange("", rawDate);
  return {
    valid: range.valid,
    asAt: range.to,
    error: range.valid ? "" : "Enter a valid As at date."
  };
}

export function filterJournalsAsAt(journals, asAt = "") {
  const date = balanceSheetAsAtDate(asAt);
  if (!date.valid) throw new Error(date.error);
  return filterJournalsByDate(journals, "", date.asAt);
}

function generalLedgerHref(accountCode) {
  return `/resources/tools/general-ledger.html?account=${encodeURIComponent(accountCode)}`;
}

function statementRows(trialBalance, accountType) {
  return trialBalance.accounts
    .filter(account => account.accountType === accountType)
    .map(account => {
      const amount = accountType === "Asset"
        ? roundMoney(account.debits - account.credits)
        : roundMoney(account.credits - account.debits);

      return {
        accountCode: account.accountCode,
        accountName: account.accountName,
        amount,
        amountDisplay: formatBalanceSheetAmount(amount),
        generalLedgerHref: generalLedgerHref(account.accountCode),
        generalLedgerLabel:
          `View General Ledger for ${account.accountName || account.accountCode}`
      };
    })
    .filter(row => row.amount !== 0)
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode));
}

function totalRows(rows) {
  return roundMoney(rows.reduce((sum, row) => sum + row.amount, 0));
}

function latestJournalDate(journals) {
  return journals.reduce((latest, journal) => {
    const date = String(journal?.date || "").slice(0, 10);
    return date > latest ? date : latest;
  }, "");
}

export function buildBalanceSheetReport(
  journals = [],
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS
) {
  const trialBalance = buildTrialBalance(journals, chartOfAccounts);
  const profitLoss = buildProfitLossReport(journals, chartOfAccounts);
  const assetRows = statementRows(trialBalance, "Asset");
  const liabilityRows = statementRows(trialBalance, "Liability");
  const equityRows = statementRows(trialBalance, "Equity");
  const currentYearResult = roundMoney(profitLoss.netResult);
  const equityAccountTotal = totalRows(equityRows);
  const totalAssets = totalRows(assetRows);
  const totalLiabilities = totalRows(liabilityRows);
  const totalEquity = roundMoney(equityAccountTotal + currentYearResult);
  const totalLiabilitiesAndEquity = roundMoney(
    totalLiabilities + totalEquity
  );
  const difference = roundMoney(
    totalAssets - totalLiabilitiesAndEquity
  );

  return {
    assetRows,
    liabilityRows,
    equityRows,
    currentYearResult,
    currentYearResultLabel: currentYearResult < 0
      ? "Current Year Loss"
      : "Current Year Profit",
    currentYearResultDisplay: formatBalanceSheetAmount(
      Math.abs(currentYearResult)
    ),
    currentYearResultHref: "/resources/tools/profit-loss.html",
    hasProfitLossActivity:
      profitLoss.incomeRows.length > 0 || profitLoss.expenseRows.length > 0,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabilitiesAndEquity,
    difference,
    totalAssetsDisplay: formatBalanceSheetAmount(totalAssets),
    totalLiabilitiesDisplay: formatBalanceSheetAmount(totalLiabilities),
    totalEquityDisplay: formatBalanceSheetAmount(totalEquity),
    totalLiabilitiesAndEquityDisplay:
      formatBalanceSheetAmount(totalLiabilitiesAndEquity),
    differenceDisplay: formatBalanceSheetAmount(difference)
  };
}

export function createBalanceSheetView(
  report,
  journalCount,
  reportingDate = ""
) {
  if (!report || !Array.isArray(report.assetRows)) {
    throw new Error("A Balance Sheet report is required.");
  }

  if (journalCount === 0) {
    return {
      ...neutralView(),
      state: "noData",
      status: "No data",
      statusText: "No journals found for this reporting date",
      emptyTitle: "No financial data available.",
      emptyText: "Balance Sheet accounts will appear after journals have been posted."
    };
  }

  const balanced = roundMoney(report.difference) === 0;
  return {
    ...report,
    reportingDate,
    state: balanced ? "balanced" : "outOfBalance",
    status: balanced ? "Balanced" : "Out of balance",
    statusText: balanced
      ? "Assets equal liabilities plus equity"
      : "Assets do not equal liabilities plus equity",
    emptyTitle: "",
    emptyText: "",
    error: null
  };
}

export function balanceSheetErrorView(error) {
  return {
    ...neutralView(),
    state: "error",
    status: "Unable to calculate",
    statusText: "Please try again",
    emptyTitle: "Unable to calculate.",
    emptyText: "No partial Balance Sheet results have been displayed.",
    error
  };
}

export function balanceSheetViewFromJournals(
  journals,
  {
    asAt = "",
    chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS
  } = {}
) {
  try {
    if (!Array.isArray(journals)) throw new Error("Journals must be an array.");
    const date = balanceSheetAsAtDate(asAt);

    if (!date.valid) {
      return {
        ...neutralView(),
        state: "invalidDate",
        status: "Check date",
        statusText: "The reporting date is invalid",
        dateError: date.error,
        emptyTitle: date.error,
        emptyText: "Choose a valid As at date and refresh the report."
      };
    }

    // Validate every loaded journal before filtering so a malformed record
    // cannot disappear outside the selected date and leave partial totals.
    buildTrialBalance(journals, chartOfAccounts);
    const validDateJournals = filterJournalsAsAt(journals);
    if (validDateJournals.length !== journals.length) {
      throw new Error("A valid journal calendar date is required.");
    }

    const filteredJournals = filterJournalsAsAt(journals, date.asAt);
    if (filteredJournals.length === 0) {
      return createBalanceSheetView(nullReport(), 0);
    }

    const report = buildBalanceSheetReport(
      filteredJournals,
      chartOfAccounts
    );
    return createBalanceSheetView(
      report,
      filteredJournals.length,
      date.asAt || latestJournalDate(filteredJournals)
    );
  } catch (error) {
    return balanceSheetErrorView(error);
  }
}

function nullReport() {
  return {
    assetRows: []
  };
}

export function ownerJournalsFromDocuments(documents, userId) {
  if (!Array.isArray(documents)) {
    throw new Error("Journal documents must be an array.");
  }
  const ownerId = requireJournalOwnerId(userId);

  return documents
    .map(documentSnapshot => {
      const data = typeof documentSnapshot?.data === "function"
        ? documentSnapshot.data()
        : documentSnapshot?.data;
      return {
        id: String(documentSnapshot?.id || ""),
        data: data && typeof data === "object" ? data : {}
      };
    })
    .filter(document => String(document.data.userId || "").trim() === ownerId)
    .map(document =>
      journalFromFirestoreData(document.id, document.data)
    );
}
