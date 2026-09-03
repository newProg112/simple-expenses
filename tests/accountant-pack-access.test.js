import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_IDS } from "../resources/js/plan-entitlements.js";
import { getAccountantPackAccess } from "../resources/js/accountant-pack-access.js";

const exportsHtml = readFileSync(
  new URL("../exports.html", import.meta.url),
  "utf8"
);
const explicitProProfile = { currentPlan: PLAN_IDS.PRO, billingOverride: true };

describe("Accountant Pack access", () => {
  it("denies Starter and provides the friendly upgrade presentation", () => {
    expect(getAccountantPackAccess(PLAN_IDS.STARTER)).toEqual({
      allowed: false,
      badgeLabel: "Pro feature",
      message: "Accountant Pack is available with Simple Books Pro.",
      upgradeLabel: "Upgrade to Pro"
    });
  });

  it("fails closed for missing and unknown plans", () => {
    expect(getAccountantPackAccess().allowed).toBe(false);
    expect(getAccountantPackAccess("Enterprise").allowed).toBe(false);
  });

  it("allows Pro without an upgrade message", () => {
    expect(getAccountantPackAccess(explicitProProfile)).toEqual({
      allowed: true,
      badgeLabel: "Pro feature",
      message: "",
      upgradeLabel: "Upgrade to Pro"
    });
  });

  it("allows an authoritative Starter-backed demo without weakening Starter", () => {
    expect(getAccountantPackAccess(PLAN_IDS.STARTER, true).allowed).toBe(true);
    expect(getAccountantPackAccess(PLAN_IDS.STARTER, false).allowed).toBe(false);
  });
});

describe("Accountant Pack Exports integration", () => {
  it("loads the authoritative billing profile through the access adapter", () => {
    expect(exportsHtml).toContain(
      'from "/resources/js/accountant-pack-access.js?v=20260902-stripe-live2"'
    );
    expect(exportsHtml).toContain('doc(db, "userProfiles", user.uid)');
    expect(exportsHtml).toContain("getAccountantPackAccess(billingProfile, demoMode)");
  });

  it("guards the generation handler before resolving a period or creating a ZIP", () => {
    const handlerStart = exportsHtml.indexOf("async function handleGenerate()");
    const accessGuard = exportsHtml.indexOf(
      "if(!resolvedAccess.allowed)",
      handlerStart
    );
    const periodResolution = exportsHtml.indexOf(
      "resolveAccountantPackPeriod()",
      handlerStart
    );
    const generation = exportsHtml.indexOf(
      "generateAccountantPackZip(period, updateGenerationStage)",
      handlerStart
    );

    expect(handlerStart).toBeGreaterThan(-1);
    expect(accessGuard).toBeGreaterThan(handlerStart);
    expect(accessGuard).toBeLessThan(periodResolution);
    expect(accessGuard).toBeLessThan(generation);
  });

  it("guards the ZIP function itself before its existing pipeline starts", () => {
    const generatorStart = exportsHtml.indexOf(
      "async function generateAccountantPackZip(period, onStage)"
    );
    const generatorGuard = exportsHtml.indexOf(
      "await requireAccountantPackAccess()",
      generatorStart
    );
    const dataLoad = exportsHtml.indexOf(
      "loadAccountantPackSourceData(period)",
      generatorStart
    );

    expect(generatorStart).toBeGreaterThan(-1);
    expect(generatorGuard).toBeGreaterThan(generatorStart);
    expect(generatorGuard).toBeLessThan(dataLoad);
  });

  it("keeps the existing Pro ZIP generation pipeline connected", () => {
    for (const contract of [
      "loadExcelLibrary()",
      "loadZipLibrary()",
      "loadAccountantPackSourceData(period)",
      "buildAccountantPackWorkbook(",
      "addInvoicePdfsToZip(",
      "addAttachmentsToZip(",
      "downloadBrowserBlob(blob, accountantPackFilename(period))"
    ]) {
      expect(exportsHtml).toContain(contract);
    }
  });

  it("renders a disabled state, Pro badge, message, and existing upgrade route", () => {
    expect(exportsHtml).toContain('id="accountantPackPlanBadge"');
    expect(exportsHtml).toContain(
      'id="generateAccountantPackButton" type="button" disabled'
    );
    expect(exportsHtml).toContain('id="accountantPackUpgradeLink"');
    expect(exportsHtml).toContain('href="/account.html"');
    expect(exportsHtml).toContain("showMessage(resolvedAccess.message, \"warning\", true)");
  });
});
