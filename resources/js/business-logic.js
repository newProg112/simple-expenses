const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function safeNumber(value) {
  if (value === null || value === undefined || value === "") return 0;

  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function roundMoney(value) {
  return Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;
}

export function calculateInvoiceSubtotal(items = []) {
  if (!Array.isArray(items)) return 0;

  const subtotal = items.reduce((sum, item) => {
    const description = String(item?.description || "").trim();
    const amount = safeNumber(item?.amount);

    return description && amount > 0 ? sum + amount : sum;
  }, 0);

  return roundMoney(subtotal);
}

export function calculateVat(subtotal, vatRate) {
  return roundMoney(safeNumber(subtotal) * safeNumber(vatRate));
}

export function calculateInvoiceTotals(items = [], vatRate = 0) {
  const subtotal = calculateInvoiceSubtotal(items);
  const vat = calculateVat(subtotal, vatRate);

  return {
    subtotal,
    vat,
    total: roundMoney(subtotal + vat)
  };
}

export function normaliseVatRateOptionValue(
  value,
  optionValues = ["0.20", "0.05", "0"]
) {
  const numericRate = Number(value);

  if (!Number.isFinite(numericRate)) return "";

  return optionValues.find(optionValue => Number(optionValue) === numericRate) || "";
}

export function calculateBillAmounts(netValue, vatRateValue) {
  const net = roundMoney(netValue);
  const vatRate = Number(vatRateValue);
  const safeVatRate = Number.isFinite(vatRate) && vatRate >= 0 ? vatRate : 0;
  const vat = calculateVat(net, safeVatRate);

  return {
    net,
    vatRate: safeVatRate,
    vat,
    total: roundMoney(net + vat)
  };
}

function localCalendarDate(year, month, day) {
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

export function normaliseInvoiceDate(value) {
  const invalidResult = {
    date: null,
    display: "-",
    monthKey: "",
    yearMonthKey: "",
    inputValue: ""
  };

  if (value === null || value === undefined || value === "") {
    return invalidResult;
  }

  if (typeof value === "object" && !(value instanceof Date)) {
    if (typeof value.toDate === "function") {
      try {
        return normaliseInvoiceDate(value.toDate());
      } catch (_error) {
        return invalidResult;
      }
    }

    if (typeof value.seconds === "number") {
      return normaliseInvoiceDate(new Date(value.seconds * 1000));
    }
  }

  let date = null;

  if (value instanceof Date) {
    date = new Date(value.getTime());
  } else {
    const text = String(value).trim();
    let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

    if (match) {
      date = localCalendarDate(Number(match[3]), Number(match[2]), Number(match[1]));
    } else {
      match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);

      if (match) {
        date = localCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
      } else {
        const parsed = new Date(text);
        date = Number.isNaN(parsed.getTime()) ? null : parsed;
      }
    }
  }

  if (!date || Number.isNaN(date.getTime())) return invalidResult;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return {
    date,
    display: `${day}/${month}/${year}`,
    monthKey: `${month}/${year}`,
    yearMonthKey: `${year}-${month}`,
    inputValue: `${year}-${month}-${day}`
  };
}

export function addInvoiceDueDays(invoiceDate, dueDays) {
  const normalised = normaliseInvoiceDate(invoiceDate);
  const days = Number(dueDays);

  if (!normalised.date || !Number.isFinite(days)) return "";

  const date = new Date(
    normalised.date.getFullYear(),
    normalised.date.getMonth(),
    normalised.date.getDate() + Math.trunc(days)
  );

  return normaliseInvoiceDate(date).inputValue;
}

export function formatDashboardMonthLabel(yearMonthKey) {
  const match = String(yearMonthKey).match(/^(\d{4})-(\d{2})$/);

  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return "";

  return new Date(Number(match[1]), Number(match[2]) - 1, 1)
    .toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export function chronologicalMonthKeys(values = []) {
  const keys = new Set();

  values.forEach(value => {
    const key = normaliseInvoiceDate(value).yearMonthKey;
    if (key) keys.add(key);
  });

  return [...keys].sort((a, b) => a.localeCompare(b));
}

function calendarDayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MILLISECONDS_PER_DAY;
}

export function isOutstandingInvoice(invoice) {
  const status = String(invoice?.status || "Unpaid").toLowerCase();
  return status === "unpaid" || status === "outstanding" || status === "overdue";
}

export function buildReceivablesAgeing(invoices = [], referenceDate = new Date()) {
  const buckets = {
    "Not yet due": 0,
    "0-30 days": 0,
    "31-60 days": 0,
    "61+ days": 0
  };
  const reference = normaliseInvoiceDate(referenceDate).date;

  if (!reference || !Array.isArray(invoices)) return buckets;

  invoices.forEach(invoice => {
    if (!isOutstandingInvoice(invoice)) return;

    const dueDate = normaliseInvoiceDate(
      invoice?.dueDate || invoice?.date || invoice?.invoiceDate
    ).date;

    if (!dueDate) return;

    const daysOverdue = calendarDayNumber(reference) - calendarDayNumber(dueDate);
    const total = safeNumber(invoice?.total);

    if (daysOverdue < 0) {
      buckets["Not yet due"] += total;
    } else if (daysOverdue <= 30) {
      buckets["0-30 days"] += total;
    } else if (daysOverdue <= 60) {
      buckets["31-60 days"] += total;
    } else {
      buckets["61+ days"] += total;
    }
  });

  return buckets;
}
