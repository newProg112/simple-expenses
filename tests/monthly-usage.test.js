import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  USAGE_ENFORCEMENT_DISABLED_MESSAGE,
  USAGE_TRACKING_DISABLED_MESSAGE,
  buildMonthlyUsageView,
  buildUsageMetric
} from "../resources/js/monthly-usage.js";

const require = createRequire(import.meta.url);
const {
  readMonthlyUsage
} = require("../functions/lib/monthly-usage-reader.js");

const fixedMonth = "2026-07";

describe("monthly usage presentation", () => {
  it("renders Starter allowances and remaining usage", () => {
    const view = buildMonthlyUsageView({
      profile: { currentPlan: "Starter" },
      usage: {
        aiAssistantSuccessfulUses: 3,
        invoiceScanningSuccessfulUses: 4
      },
      monthKey: fixedMonth,
      trackingEnabled: true
    });

    expect(view.plan).toBe("Starter");
    expect(view.aiAssistant).toEqual({
      allowance: 10,
      current: 3,
      remaining: 7
    });
    expect(view.invoiceScanning).toEqual({
      allowance: 10,
      current: 4,
      remaining: 6
    });
    expect(view.monthKey).toBe(fixedMonth);
  });

  it("renders Pro allowances from the entitlement definitions", () => {
    const view = buildMonthlyUsageView({
      profile: { currentPlan: "Pro" },
      usage: {
        aiAssistantSuccessfulUses: 120,
        invoiceScanningSuccessfulUses: 25
      },
      monthKey: fixedMonth,
      trackingEnabled: true
    });

    expect(view.plan).toBe("Pro");
    expect(view.aiAssistant).toEqual({
      allowance: 500,
      current: 120,
      remaining: 380
    });
    expect(view.invoiceScanning).toEqual({
      allowance: 500,
      current: 25,
      remaining: 475
    });
  });

  it("renders deliberate unlimited allowances as Unlimited", () => {
    expect(buildUsageMetric(null, 123)).toEqual({
      allowance: "Unlimited",
      current: 123,
      remaining: "Unlimited"
    });
  });

  it("defaults a missing usage document to zero usage", () => {
    const view = buildMonthlyUsageView({
      profile: { currentPlan: "Starter" },
      monthKey: fixedMonth
    });

    expect(view.aiAssistant.current).toBe(0);
    expect(view.aiAssistant.remaining).toBe(10);
    expect(view.invoiceScanning.current).toBe(0);
    expect(view.invoiceScanning.remaining).toBe(10);
  });

  it("fails a missing profile safely to Starter", () => {
    const view = buildMonthlyUsageView({
      usage: {},
      monthKey: fixedMonth
    });

    expect(view.plan).toBe("Starter");
    expect(view.aiAssistant.allowance).toBe(10);
    expect(view.invoiceScanning.allowance).toBe(10);
  });

  it("distinguishes counting from enforcement", () => {
    const disabled = buildMonthlyUsageView({ monthKey: fixedMonth });
    const counting = buildMonthlyUsageView({
      monthKey: fixedMonth,
      trackingEnabled: true
    });
    const enforced = buildMonthlyUsageView({
      monthKey: fixedMonth,
      trackingEnabled: true,
      enforcementEnabled: true
    });

    expect(disabled.trackingEnabled).toBe(false);
    expect(disabled.message).toBe(USAGE_TRACKING_DISABLED_MESSAGE);
    expect(disabled.message).toBe("AI Assistant usage status is unavailable.");
    expect(counting.enforcementEnabled).toBe(false);
    expect(counting.message).toBe(USAGE_ENFORCEMENT_DISABLED_MESSAGE);
    expect(counting.message).toBe(
      "AI Assistant usage is being counted. Monthly limits are not enforced yet."
    );
    expect(enforced.message).toBe("");
  });

  it("normalises malformed usage values and never shows negative remaining", () => {
    const view = buildMonthlyUsageView({
      profile: { currentPlan: "Starter" },
      usage: {
        aiAssistantSuccessfulUses: -4,
        invoiceScanningSuccessfulUses: 999
      },
      monthKey: fixedMonth
    });

    expect(view.aiAssistant.current).toBe(0);
    expect(view.aiAssistant.remaining).toBe(10);
    expect(view.invoiceScanning.current).toBe(999);
    expect(view.invoiceScanning.remaining).toBe(0);
  });
});

describe("read-only monthly usage source", () => {
  it("reads the authenticated user's UTC month and normalises counters", async () => {
    let requestedPath = "";
    const firestore = {
      collection: collectionName => ({
        doc: uid => ({
          collection: subcollection => ({
            doc: monthKey => ({
              get: async () => {
                requestedPath =
                  `${collectionName}/${uid}/${subcollection}/${monthKey}`;
                return {
                  exists: true,
                  data: () => ({
                    aiAssistantSuccessfulUses: 4.8,
                    invoiceScanningSuccessfulUses: -2
                  })
                };
              }
            })
          })
        })
      })
    };

    const usage = await readMonthlyUsage(
      firestore,
      "authenticated-user",
      new Date("2027-01-01T00:30:00+01:00")
    );

    expect(requestedPath)
      .toBe("userProfiles/authenticated-user/usage/2026-12");
    expect(usage).toEqual({
      monthKey: "2026-12",
      aiAssistantSuccessfulUses: 4,
      invoiceScanningSuccessfulUses: 0
    });
    expect(buildMonthlyUsageView({
      profile: { currentPlan: "Starter" },
      usage,
      monthKey: usage.monthKey,
      trackingEnabled: true,
      enforcementEnabled: false
    }).aiAssistant).toEqual({
      allowance: 10,
      current: 4,
      remaining: 6
    });
  });

  it("returns zero when the monthly usage document is missing", async () => {
    const firestore = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              get: async () => ({ exists: false })
            })
          })
        })
      })
    };

    await expect(readMonthlyUsage(
      firestore,
      "authenticated-user",
      new Date("2026-07-24T00:00:00.000Z")
    )).resolves.toEqual({
      monthKey: fixedMonth,
      aiAssistantSuccessfulUses: 0,
      invoiceScanningSuccessfulUses: 0
    });
  });
});

describe("Account page monthly usage integration", () => {
  const accountHtml = readFileSync(
    new URL("../account.html", import.meta.url),
    "utf8"
  );
  const assistantHtml = readFileSync(
    new URL("../resources/tools/ai-assistant.html", import.meta.url),
    "utf8"
  );
  const functionsIndex = readFileSync(
    new URL("../functions/index.js", import.meta.url),
    "utf8"
  );
  const usageReader = readFileSync(
    new URL("../functions/lib/monthly-usage-reader.js", import.meta.url),
    "utf8"
  );
  const aiHandler = readFileSync(
    new URL("../functions/ai-assistant.js", import.meta.url),
    "utf8"
  );

  it("renders both usage categories and the counting-only message", () => {
    for (const id of [
      "monthlyUsageStatus",
      "monthlyUsageMonth",
      "monthlyAiAllowance",
      "monthlyAiCurrent",
      "monthlyAiRemaining",
      "monthlyScanAllowance",
      "monthlyScanCurrent",
      "monthlyScanRemaining"
    ]) {
      expect(accountHtml).toContain(`id="${id}"`);
    }
    expect(accountHtml).toContain(
      "AI Assistant usage is being counted. Monthly limits are not enforced yet."
    );
  });

  it("uses the entitlement-backed presentation helper", () => {
    expect(accountHtml).toContain(
      'from "./resources/js/monthly-usage.js?v=20260728-phase4c"'
    );
    expect(accountHtml).toContain("buildMonthlyUsageView({");
    expect(accountHtml).toContain("MONTHLY_USAGE_FUNCTION_URL");
  });

  it("reloads live usage on the AI Assistant page", () => {
    for (const id of [
      "usageProgress",
      "usagePlan",
      "usageUsed",
      "usageRemaining",
      "usageReset",
      "usageDescription"
    ]) {
      expect(assistantHtml).toContain(`id="${id}"`);
    }
    expect(assistantHtml).toContain(
      'import { buildMonthlyUsageView } from "../js/monthly-usage.js?v=20260728-phase4c"'
    );
    expect(assistantHtml).toContain(
      "cloudfunctions.net/getMonthlyUsage"
    );
    expect(assistantHtml).toContain("loadMonthlyUsage(user)");
    expect(assistantHtml).toContain(
      'if(result.data?.mode === "ai" && currentUsageUser)'
    );
    expect(assistantHtml).not.toContain("Preview data");
    expect(assistantHtml).not.toContain("Usage tracking is not yet enabled.");
  });

  it("keeps the backend endpoint authenticated and read-only", () => {
    expect(functionsIndex).toContain(
      "admin.auth().verifyIdToken(match[1])"
    );
    expect(functionsIndex).toContain(
      "readMonthlyUsage("
    );
    expect(functionsIndex).toContain(
      "trackingEnabled: AI_USAGE_COUNTING_ENABLED"
    );
    expect(functionsIndex).toContain(
      "enforcementEnabled: AI_USAGE_ENFORCEMENT_ENABLED"
    );
    expect(usageReader).toContain(".get()");
    expect(usageReader).not.toMatch(/\.(set|create|update|delete)\(/);
  });

  it("keeps AI enforcement disabled", () => {
    expect(aiHandler).toContain(
      "const AI_USAGE_COUNTING_ENABLED = true;"
    );
    expect(aiHandler).toContain(
      "const AI_USAGE_ENFORCEMENT_ENABLED = false;"
    );
  });
});
