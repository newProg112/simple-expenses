import {
  buildTrialBalance,
  DEFAULT_CHART_OF_ACCOUNTS
} from "./ledger-engine.js";
import {
  filterJournalsByDate,
  generalLedgerDateRange
} from "./general-ledger-view.js";
import { formatTrialBalanceGbp } from "./trial-balance-view.js";

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function emptyReport() {
  return {
    incomeRows: [],
    expenseRows: [],
    totalIncome: null,
    totalExpenses: null,
    netResult: null,
    totalIncomeDisplay: "—",
    totalExpensesDisplay: "—",
    netResultDisplay: "—",
    netResultLabel: "Net Profit",
    error: null
  };
}

export function formatProfitLossAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error("A finite amount is required.");
  const rounded = roundMoney(amount);
  return rounded < 0
    ? `(${formatTrialBalanceGbp(Math.abs(rounded))})`
    : formatTrialBalanceGbp(rounded);
}

export function filterJournalsByDateRange(
  journals,
  dateFrom = "",
  dateTo = ""
) {
  return filterJournalsByDate(journals, dateFrom, dateTo);
}

function accountRows(
  trialBalance,
  accountType,
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS
) {
  const accountByCode = new Map(
    chartOfAccounts.map(account => [account.code, account])
  );

  return trialBalance.accounts
    .filter(account => {
      const chartAccount = accountByCode.get(account.accountCode);
      return chartAccount?.type === accountType &&
        (Number(account.debits) !== 0 || Number(account.credits) !== 0);
    })
    .map(account => {
      const amount = accountType === "Income"
        ? roundMoney(account.credits - account.debits)
        : roundMoney(account.debits - account.credits);

      return {
        accountCode: account.accountCode,
        accountName: accountByCode.get(account.accountCode).name,
        amount,
        amountDisplay: formatProfitLossAmount(amount)
      };
    })
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode));
}

export function getIncomeAccountRows(
  trialBalance,
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS
) {
  return accountRows(trialBalance, "Income", chartOfAccounts);
}

export function getExpenseAccountRows(
  trialBalance,
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS
) {
  return accountRows(trialBalance, "Expense", chartOfAccounts);
}

export function determineProfitLossStatus(netResult, hasFinancialActivity) {
  if (!hasFinancialActivity) {
    return {
      state: "noData",
      status: "No data",
      statusText: "No financial data available"
    };
  }

  const result = roundMoney(netResult);
  if (result > 0) {
    return {
      state: "profit",
      status: "Profit",
      statusText: "Income exceeds expenses"
    };
  }
  if (result < 0) {
    return {
      state: "loss",
      status: "Loss",
      statusText: "Expenses exceed income"
    };
  }
  return {
    state: "breakEven",
    status: "Break-even",
    statusText: "Income equals expenses"
  };
}

export function buildProfitLossReport(
  journals = [],
  chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS
) {
  const trialBalance = buildTrialBalance(journals, chartOfAccounts);
  const incomeRows = getIncomeAccountRows(trialBalance, chartOfAccounts);
  const expenseRows = getExpenseAccountRows(trialBalance, chartOfAccounts);
  const totalIncome = roundMoney(
    incomeRows.reduce((sum, row) => sum + row.amount, 0)
  );
  const totalExpenses = roundMoney(
    expenseRows.reduce((sum, row) => sum + row.amount, 0)
  );
  const netResult = roundMoney(totalIncome - totalExpenses);

  return {
    incomeRows,
    expenseRows,
    totalIncome,
    totalExpenses,
    netResult,
    totalIncomeDisplay: formatProfitLossAmount(totalIncome),
    totalExpensesDisplay: formatProfitLossAmount(totalExpenses),
    netResultDisplay: formatProfitLossAmount(Math.abs(netResult)),
    netResultLabel: netResult < 0
      ? "Net Loss"
      : netResult === 0
        ? "Break-even"
        : "Net Profit"
  };
}

export function profitLossViewFromJournals(
  journals,
  {
    dateFrom = "",
    dateTo = "",
    chartOfAccounts = DEFAULT_CHART_OF_ACCOUNTS
  } = {}
) {
  const base = emptyReport();

  try {
    if (!Array.isArray(journals)) throw new Error("Journals must be an array.");
    const range = generalLedgerDateRange(dateFrom, dateTo);

    if (!range.valid) {
      return {
        ...base,
        state: "invalidDate",
        status: "Check dates",
        statusText: "Date range is invalid",
        dateError: range.error,
        emptyTitle: range.error,
        emptyText: "Adjust the date filters and refresh the report."
      };
    }

    // Validate every loaded journal before filtering so malformed records never
    // disappear outside a selected period and leave misleading partial totals.
    buildTrialBalance(journals, chartOfAccounts);
    const validDateJournals = filterJournalsByDateRange(journals);
    if (validDateJournals.length !== journals.length) {
      throw new Error("A valid journal calendar date is required.");
    }

    const filteredJournals = filterJournalsByDateRange(
      journals,
      dateFrom,
      dateTo
    );
    const report = buildProfitLossReport(filteredJournals, chartOfAccounts);
    const hasFinancialActivity =
      report.incomeRows.length > 0 || report.expenseRows.length > 0;
    const status = determineProfitLossStatus(
      report.netResult,
      hasFinancialActivity
    );

    if (!hasFinancialActivity) {
      return {
        ...base,
        ...status,
        emptyTitle: "No financial data available.",
        emptyText: "No income or expense activity was found for this reporting period."
      };
    }

    return {
      ...report,
      ...status,
      emptyTitle: "",
      emptyText: ""
    };
  } catch (error) {
    return {
      ...base,
      state: "error",
      status: "Unable to calculate",
      statusText: "Please try again",
      emptyTitle: "Unable to calculate.",
      emptyText: "No partial financial results have been displayed.",
      error
    };
  }
}
