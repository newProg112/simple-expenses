import {
  buildTrialBalance,
  DEFAULT_CHART_OF_ACCOUNTS
} from "./ledger-engine.js";
import {
  filterJournalsByDate,
  generalLedgerDateRange
} from "./general-ledger-view.js";
import { formatTrialBalanceGbp } from "./trial-balance-view.js";

const ACCOUNT_BY_CODE = new Map(
  DEFAULT_CHART_OF_ACCOUNTS.map(account => [account.code, account])
);

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

function accountRows(trialBalance, accountType) {
  return trialBalance.accounts
    .filter(account => {
      const chartAccount = ACCOUNT_BY_CODE.get(account.accountCode);
      return chartAccount?.type === accountType &&
        (Number(account.debits) !== 0 || Number(account.credits) !== 0);
    })
    .map(account => {
      const amount = accountType === "Income"
        ? roundMoney(account.credits - account.debits)
        : roundMoney(account.debits - account.credits);

      return {
        accountCode: account.accountCode,
        accountName: ACCOUNT_BY_CODE.get(account.accountCode).name,
        amount,
        amountDisplay: formatProfitLossAmount(amount)
      };
    })
    .sort((left, right) => left.accountCode.localeCompare(right.accountCode));
}

export function getIncomeAccountRows(trialBalance) {
  return accountRows(trialBalance, "Income");
}

export function getExpenseAccountRows(trialBalance) {
  return accountRows(trialBalance, "Expense");
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

export function buildProfitLossReport(journals = []) {
  const trialBalance = buildTrialBalance(journals);
  const incomeRows = getIncomeAccountRows(trialBalance);
  const expenseRows = getExpenseAccountRows(trialBalance);
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
  { dateFrom = "", dateTo = "" } = {}
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
    buildTrialBalance(journals);
    const validDateJournals = filterJournalsByDateRange(journals);
    if (validDateJournals.length !== journals.length) {
      throw new Error("A valid journal calendar date is required.");
    }

    const filteredJournals = filterJournalsByDateRange(
      journals,
      dateFrom,
      dateTo
    );
    const report = buildProfitLossReport(filteredJournals);
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
