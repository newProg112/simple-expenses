import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildBusinessInsights,
  calculateHealthScore
} from "../assets/business-insights-calculations.js";
import { resolveBusinessInsightsAccess } from "../assets/business-insights-access.js";
import { loadBusinessInsightsData } from "../assets/business-insights-data.js";
import { buildDashboardBusinessHealth } from "../assets/dashboard-business-health.js";
import { LIVE_PRO_PRICE_ID } from "../resources/js/stripe-billing-config.js";

const TODAY = new Date(2026, 7, 10);
const dashboard = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
const insightsSource = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
const dashboardPresenterSource = readFileSync(new URL("../assets/dashboard-business-health.js", import.meta.url), "utf8");
const dataSource = readFileSync(new URL("../assets/business-insights-data.js", import.meta.url), "utf8");
const navigationSource = readFileSync(new URL("../assets/app-shell.js", import.meta.url), "utf8");
const liveProProfile = {
  currentPlan:"Pro", subscriptionStatus:"active", stripeMode:"live",
  stripePriceId:LIVE_PRO_PRICE_ID, stripeCustomerId:"cus_live",
  stripeSubscriptionId:"sub_live"
};

const snap = data => ({ exists:() => true, data:() => data });
const access = (plan, demoMode = false) => resolveBusinessInsightsAccess(
  snap({ demoMode }),
  snap(plan === "Pro" ? liveProProfile : { currentPlan:plan })
);
const empty = () => ({
  invoices:[], bills:[], expenses:[], projects:[], budgets:[], journals:[],
  accountingAvailable:true,
  sourceAvailability:{ invoices:true, bills:true, expenses:true, projects:true, budgets:true }
});
const journal = (id, date, revenue) => ({
  id, date, sourceType:"test", sourceId:id, description:id, userId:"user",
  lines:[
    { accountCode:"1100", debit:revenue, credit:0 },
    { accountCode:"4000", debit:0, credit:revenue }
  ]
});

describe("Dashboard Business Health summary", () => {
  it("removes only the Trial Balance and Balance Sheet dashboard shortcuts", () => {
    expect(dashboard).not.toContain('href="./resources/tools/trial-balance.html"');
    expect(dashboard).not.toContain('href="./resources/tools/balance-sheet.html"');
    expect(dashboard).not.toContain('aria-hidden="true">TB</span>');
    expect(dashboard).not.toContain('aria-hidden="true">BS</span>');
    expect(navigationSource).toContain('href: "/resources/tools/trial-balance.html"');
    expect(navigationSource).toContain('href: "/resources/tools/balance-sheet.html"');
    expect(readFileSync(new URL("../resources/tools/trial-balance.html", import.meta.url), "utf8")).toContain("Trial Balance");
    expect(readFileSync(new URL("../resources/tools/balance-sheet.html", import.meta.url), "utf8")).toContain("Balance Sheet");
  });

  it("uses the exact shared Business Insights health result", () => {
    const data = empty();
    data.invoices.push({ id:"invoice", date:"2026-08-02", dueDate:"2026-08-08", status:"Unpaid", total:500 });
    data.journals.push(journal("revenue", "2026-08-02", 500));
    const insights = buildBusinessInsights(data, TODAY);
    const summary = buildDashboardBusinessHealth(insights, access("Pro"));
    expect(summary.health).toBe(insights.health);
    expect(summary.health).toEqual(calculateHealthScore(data, TODAY));
  });

  it("keeps Starter useful without Pro forecast or breakdown detail", () => {
    const data = empty();
    data.invoices.push({ id:"invoice", dueDate:"2026-08-01", status:"Unpaid", total:500 });
    data.bills.push({ id:"bill", dueDate:"2026-08-12", status:"Unpaid", total:125 });
    data.journals.push(journal("revenue", "2026-08-02", 500));
    const summary = buildDashboardBusinessHealth(buildBusinessInsights(data, TODAY), access("Starter"));
    expect(summary.state).toBe("ready");
    expect(summary.signals.map(item => item.id)).toEqual(["overdue-invoices", "outstanding-invoices", "unpaid-bills"]);
    expect(summary.signals.map(item => item.id)).not.toContain("revenue-forecast");
    expect(dashboard).not.toMatch(/summary\.health\.components|score breakdown|forecast methodology|detailed actionable recommendations/i);
  });

  it("gives Pro a concise authoritative three-signal summary", () => {
    const data = empty();
    data.invoices.push({ id:"invoice", date:"2026-08-02", dueDate:"2026-08-01", status:"Unpaid", total:500 });
    data.bills.push({ id:"bill", dueDate:"2026-08-12", status:"Unpaid", total:125 });
    data.journals.push(journal("revenue", "2026-08-02", 500));
    const summary = buildDashboardBusinessHealth(buildBusinessInsights(data, TODAY), access("Pro"));
    expect(summary.signals).toHaveLength(3);
    expect(summary.signals.map(item => item.id)).toEqual(["priorities", "revenue-forecast", "bills-due"]);
    expect(summary.signals.find(item => item.id === "bills-due")?.value).toBe("£125.00");
  });

  it("treats Demo as effective Pro without changing stored plan", () => {
    const data = empty();
    data.invoices.push({ id:"invoice", status:"Unpaid", total:50 });
    data.journals.push(journal("revenue", "2026-08-02", 50));
    const demoAccess = access("Starter", true);
    const summary = buildDashboardBusinessHealth(buildBusinessInsights(data, TODAY), demoAccess);
    expect(demoAccess).toMatchObject({ demo:true, effectivePlan:"Pro", fullAccess:true, paidSubscription:false });
    expect(summary.signals.some(item => item.id === "revenue-forecast")).toBe(true);
  });

  it("supports empty and partial data honestly", () => {
    const emptySummary = buildDashboardBusinessHealth(buildBusinessInsights(empty(), TODAY), access("Starter"));
    expect(emptySummary).toMatchObject({ state:"empty", signals:[] });
    expect(emptySummary.health).toMatchObject({ score:null, status:"Not enough data yet" });

    const data = empty();
    data.invoices.push({ id:"invoice", status:"Unpaid", total:50 });
    const partial = buildDashboardBusinessHealth(buildBusinessInsights(data, TODAY), access("Starter"), ["bills"]);
    expect(partial.partial).toBe(true);
    expect(partial.signals.some(item => item.id === "unpaid-bills")).toBe(false);
    expect(partial.signals.every(item => !/undefined|NaN/.test(item.value))).toBe(true);
  });

  it("rejects an invalid health calculation while the Dashboard provides a non-blocking error state", () => {
    expect(() => buildDashboardBusinessHealth({ hasData:true, health:{ score:Number.NaN, status:"Healthy" } }, access("Pro")))
      .toThrow("Business Health result is unavailable");
    expect(dashboard).toContain("Business Health is temporarily unavailable.");
    expect(dashboard).toContain("Your Dashboard can still be used normally.");
    expect(dashboard.indexOf("void loadDashboardBusinessHealth();")).toBeLessThan(dashboard.indexOf("await loadAccountSummary();"));
  });

  it("provides neutral loading, responsive, accessible markup and the Business Insights link", () => {
    expect(dashboard).toContain('aria-labelledby="dashboardBusinessHealthTitle"');
    expect(dashboard).toContain('id="dashboardBusinessHealthContent" aria-live="polite" aria-busy="true"');
    expect(dashboard).toContain('class="business-health-loading" role="status"');
    expect(dashboard).toContain('class="business-health-state" role="alert"');
    expect(dashboard).toContain("Loading your Business Health summary&hellip;");
    expect(dashboard).toContain('href="/business-insights.html"');
    expect(dashboard).toContain("Business Health score ${summary.health.score} out of 100");
    expect(dashboard).toMatch(/\.business-health-card\{\r?\n      grid-column:1 \/ -1;/);
    expect(dashboard).toMatch(/@media\(max-width:800px\)[\s\S]*?\.business-health-card\{\s*grid-column:1 \/ -1/);
    expect(dashboard).toMatch(/@media\(max-width:800px\)[\s\S]*?\.business-health-signals\{\s*grid-template-columns:1fr/);
    expect(dashboard).toContain(".business-health-link:focus-visible");
  });

  it("keeps the frontend inline module syntactically valid", () => {
    const moduleSource = dashboard.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] || "";
    const withoutImports = moduleSource.replace(/import[\s\S]*?;\s*/g, "");
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    expect(moduleSource).not.toBe("");
    expect(() => new AsyncFunction(withoutImports)).not.toThrow();
  });

  it("shares the data loader and performs no writes or AI requests", () => {
    expect(insightsSource).toContain('from "./business-insights-data.js?v=20260807-dashboard-health1"');
    expect(dashboard).toContain('from "./assets/business-insights-data.js?v=20260807-dashboard-health1"');
    expect(dashboard).toContain("buildBusinessInsights({ ...data, vatRegistered:access.vatRegistered })");
    expect(`${dashboardPresenterSource}\n${dataSource}`).not.toMatch(/addDoc|setDoc|updateDoc|deleteDoc/);
    expect(`${dashboardPresenterSource}\n${dataSource}`).not.toMatch(/openai|httpsCallable\([^)]*ai/i);
    expect(dashboard).not.toContain('logActivityEvent("business_health_dashboard_viewed"');
  });
});

describe("shared Business Insights data loading", () => {
  it("isolates a source failure and never writes records", async () => {
    const services = {
      db:{},
      collection:(_db, ...parts) => parts.join("/"),
      query:value => value,
      where:() => ({}),
      getDocs:async ref => {
        if(ref.endsWith("/bills")) throw new Error("bills unavailable");
        return { docs:[] };
      }
    };
    const result = await loadBusinessInsightsData({ uid:"user" }, services);
    expect(result.failures).toEqual(["bills"]);
    expect(result.data.sourceAvailability).toMatchObject({ invoices:true, bills:false });
    expect(result.data.accountingAvailable).toBe(true);
  });
});
