import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scanHandler = readFileSync(
  new URL("../functions/business-document-scan.js", import.meta.url),
  "utf8"
);
const usageManager = readFileSync(
  new URL("../functions/lib/ai-usage.js", import.meta.url),
  "utf8"
);
const billsHtml = readFileSync(
  new URL("../resources/tools/bills.html", import.meta.url),
  "utf8"
);
const expensesHtml = readFileSync(
  new URL("../resources/tools/expenses.html", import.meta.url),
  "utf8"
);

describe("Invoice Scanning usage integration", () => {
  it("uses the shared monthly reservation and finalisation service", () => {
    expect(scanHandler).toContain('require("./lib/ai-usage")');
    expect(scanHandler).toContain("createMonthlyUsageManager({");
    expect(scanHandler).toContain("usageManager.reserve({");
    expect(scanHandler).toContain("usageManager.finalize({");
    expect(scanHandler).toContain("usageManager.release({");
    expect(scanHandler).toContain("usageType: USAGE_TYPES.INVOICE_SCANNING");
    expect(usageManager).toContain(
      'INVOICE_SCANNING: "invoiceScanning"'
    );
  });

  it("keeps scan enforcement disabled while counting is enabled", () => {
    expect(scanHandler).toContain(
      "const INVOICE_SCANNING_USAGE_COUNTING_ENABLED = true;"
    );
    expect(scanHandler).toContain(
      "const INVOICE_SCANNING_USAGE_ENFORCEMENT_ENABLED = false;"
    );
  });

  it.each([
    ["Bills", billsHtml],
    ["Expenses", expensesHtml]
  ])("sends an idempotency UUID from %s", (_name, html) => {
    expect(html).toContain(
      'import { createRequestId } from "../js/request-id.js?v=20260728-phase4d"'
    );
    expect(html).toContain("requestId: createRequestId()");
  });
});
