import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PLAN_IDS,
  REPORT_IDS
} from "../resources/js/plan-entitlements.js";
import {
  getFinancialReportAccess
} from "../resources/js/financial-report-access.js";

const reports = [
  {
    file: "trial-balance.html",
    id: REPORT_IDS.TRIAL_BALANCE,
    idName: "TRIAL_BALANCE",
    label: "Trial Balance",
    loader: "loadTrialBalance"
  },
  {
    file: "general-ledger.html",
    id: REPORT_IDS.GENERAL_LEDGER,
    idName: "GENERAL_LEDGER",
    label: "General Ledger",
    loader: "loadGeneralLedger"
  },
  {
    file: "profit-loss.html",
    id: REPORT_IDS.PROFIT_LOSS,
    idName: "PROFIT_LOSS",
    label: "Profit & Loss",
    loader: "loadProfitLoss"
  },
  {
    file: "balance-sheet.html",
    id: REPORT_IDS.BALANCE_SHEET,
    idName: "BALANCE_SHEET",
    label: "Balance Sheet",
    loader: "loadBalanceSheet"
  }
];

describe.each(reports)("$label access", ({ id, label }) => {
  it("denies Starter with the shared Pro upgrade presentation", () => {
    expect(getFinancialReportAccess(PLAN_IDS.STARTER, id)).toEqual({
      allowed: false,
      badgeLabel: "Pro feature",
      message: `${label} is available with Simple Books Pro.`,
      upgradeLabel: "Upgrade to Pro"
    });
  });

  it("fails closed for a missing plan", () => {
    expect(getFinancialReportAccess(undefined, id).allowed).toBe(false);
  });

  it("allows Pro without an upgrade message", () => {
    expect(getFinancialReportAccess(PLAN_IDS.PRO, id)).toEqual({
      allowed: true,
      badgeLabel: "Pro feature",
      message: "",
      upgradeLabel: "Upgrade to Pro"
    });
  });

  it("allows an authoritative Starter-backed demo", () => {
    expect(getFinancialReportAccess(PLAN_IDS.STARTER, id, true).allowed).toBe(true);
  });
});

describe("Financial Reports page integration", () => {
  it.each(reports)(
    "guards direct access to $label before loading journals",
    ({ file, idName, loader }) => {
      const html = readFileSync(
        new URL(`../resources/tools/${file}`, import.meta.url),
        "utf8"
      );
      const accessCheck = html.indexOf(
        `getFinancialReportAccess(\n          profilePlan,\n          REPORT_IDS.${idName}`
      );
      const deniedGuard = html.indexOf("if (!access.allowed)", accessCheck);
      const reportLoad = html.indexOf(`${loader}(user)`, deniedGuard);

      expect(html).toContain('id="financialReportAccessGate"');
      expect(html).toContain('id="financialReportContent" hidden');
      expect(html).toContain('doc(db, "userProfiles", user.uid)');
      expect(accessCheck).toBeGreaterThan(-1);
      expect(deniedGuard).toBeGreaterThan(accessCheck);
      expect(reportLoad).toBeGreaterThan(deniedGuard);
    }
  );

  it.each(reports)(
    "keeps $label report calculations connected",
    ({ file, loader }) => {
      const html = readFileSync(
        new URL(`../resources/tools/${file}`, import.meta.url),
        "utf8"
      );

      expect(html).toContain(`async function ${loader}(user)`);
      expect(html).toContain('collection(db, "journals")');
      expect(html).toContain('where("userId", "==", ownerId)');
    }
  );
});
