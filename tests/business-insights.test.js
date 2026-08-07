import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildBusinessInsights,
  calculateBudgetSummaries,
  calculateHealthScore,
  calculateProjectSummaries,
  calculateSnapshot,
  calculateTrend,
  comparisonPeriods,
  formatInsightsGbp,
  generatePriorities,
  healthStatus,
  trendSentence
} from "../assets/business-insights-calculations.js";
import {
  businessInsightsPresentation,
  businessInsightsVisibility,
  loadBusinessInsightsAccess,
  resolveBusinessInsightsAccess
} from "../assets/business-insights-access.js";
import { DEMO_SEED } from "../assets/demo-seed.js";
import { buildDemoJournalRecords } from "../assets/demo-seed-engine.js";
import { profitLossViewFromJournals } from "../resources/js/profit-loss-view.js";
import {
  loadOwnedJournals,
  normaliseJournalSnapshot,
  ownedJournalQuery,
  partialJournalDataMessage
} from "../resources/js/journal-source.js";

const today = new Date(2026, 7, 6);
const source = record => ({ id: record.id, ...record.data });
const empty = () => ({ invoices: [], bills: [], expenses: [], projects: [], budgets: [], journals: [] });
const journal = (id, date, income, expense = 0) => ({
  id, userId: "user", date, sourceType: "test", sourceId: id, description: id,
  lines: [
    ...(income ? [{ accountCode: "1100", description: id, debit: income, credit: 0 }, { accountCode: "4000", description: id, debit: 0, credit: income }] : []),
    ...(expense ? [{ accountCode: "5000", description: id, debit: expense, credit: 0 }, { accountCode: "2200", description: id, debit: 0, credit: expense }] : [])
  ]
});

describe("Business Insights Phase 1", () => {
  it("is authenticated and defines the complete page plus one Starter Pro panel", () => {
    const html = readFileSync(new URL("../business-insights.html", import.meta.url), "utf8");
    expect(html).toContain('/auth-guard.js');
    expect(html.match(/Unlock complete Business Insights/g)).toHaveLength(1);
    expect(html).toContain("Pro feature");
    expect(html).toContain("Upgrade to Pro");
    for(const title of ["Business Health", "Today’s Priorities", "Key Trends", "Business Snapshot", "How this is calculated"]) expect(html).toContain(title);
    expect(html).toContain("No AI is used");
    const javascript = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
    expect(javascript).not.toMatch(/openai|ai-assistant|httpsCallable\([^)]*ai/i);
  });

  it("resolves Starter preview, Pro full access, and Demo full Pro access", () => {
    const snapshot = data => ({ exists:() => true, data:() => data });
    const starter = resolveBusinessInsightsAccess(snapshot({demoMode:false}), snapshot({currentPlan:"Starter"}));
    const pro = resolveBusinessInsightsAccess(snapshot({demoMode:false}), snapshot({currentPlan:"Pro"}));
    const demo = resolveBusinessInsightsAccess(snapshot({demoMode:true}), snapshot({currentPlan:"Starter"}));
    expect(businessInsightsVisibility(starter)).toEqual(expect.objectContaining({scoreBreakdown:false, priorityLimit:2, trends:false, fullSnapshot:false, methodology:false, upgradePrompt:true, billingActions:true}));
    expect(businessInsightsVisibility(pro)).toEqual(expect.objectContaining({scoreBreakdown:true, priorityLimit:5, trends:true, fullSnapshot:true, methodology:true, upgradePrompt:false}));
    expect(demo).toMatchObject({fullAccess:true, demo:true, planLabel:"Pro Demo", billingLabel:"Not billed", paidSubscription:false});
    expect(businessInsightsVisibility(demo)).toEqual(expect.objectContaining({upgradePrompt:false, billingActions:false}));
    const model = {priorities:[1,2,3], snapshot:{outstandingInvoiceTotal:1, overdueInvoiceCount:2, overdueInvoiceValue:3, unpaidBillsTotal:4, activeProjects:5, currentMonthRevenue:6}};
    const starterPresentation = businessInsightsPresentation(model, starter);
    expect(businessInsightsVisibility(starter).snapshotMetricIds).toEqual([
      "outstandingInvoices", "overdueInvoices", "unpaidBills", "activeProjects"
    ]);
    expect(businessInsightsVisibility(starter).snapshotLayout).toBe("compact");
    expect(starterPresentation.priorities).toEqual([1,2]);
    expect(starterPresentation.snapshot).toEqual({outstandingInvoiceTotal:1, overdueInvoiceCount:2, overdueInvoiceValue:3, unpaidBillsTotal:4, activeProjects:5});
    expect(starterPresentation.snapshot).not.toHaveProperty("currentMonthRevenue");
    expect(businessInsightsPresentation(model, pro).priorities).toEqual([1,2,3]);
    expect(businessInsightsPresentation(model, pro).snapshot).toBe(model.snapshot);
    expect(businessInsightsVisibility(pro).snapshotMetricIds).toHaveLength(9);
    expect(businessInsightsVisibility(pro).snapshotLayout).toBe("full");
    expect(businessInsightsVisibility(demo).snapshotMetricIds).toHaveLength(9);
    const javascript = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
    expect(javascript).toContain('access.demo ? "Pro Demo · Not billed" : ""');
  });

  it("uses both authoritative access documents and rejects genuine resolution failure", async () => {
    const paths = [];
    const services = {
      db:{},
      doc:(_db, collectionName, uid) => { paths.push(`${collectionName}/${uid}`); return `${collectionName}/${uid}`; },
      getDoc:async reference => ({exists:() => true, data:() => reference.startsWith("users/") ? {demoMode:false} : {currentPlan:"Starter"}})
    };
    await expect(loadBusinessInsightsAccess({uid:"customer"}, services)).resolves.toMatchObject({starterPreview:true});
    expect(paths).toEqual(["users/customer", "userProfiles/customer"]);
    await expect(loadBusinessInsightsAccess({uid:"customer"}, {...services, getDoc:async () => { throw new Error("offline"); }})).rejects.toThrow("offline");
  });

  it("keeps entitlement-controlled content hidden during neutral loading", () => {
    const html = readFileSync(new URL("../business-insights.html", import.meta.url), "utf8");
    expect(html).toMatch(/id="insightsMain"[^>]*hidden/);
    expect(html).toMatch(/id="trendsSection"[^>]*hidden/);
    expect(html).toMatch(/id="insightsUpgradePanel"[^>]*hidden/);
    expect(html).toMatch(/id="methodologySection"[^>]*hidden/);
    const javascript = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
    expect(javascript).toContain("We could not confirm your Business Insights access");
    expect(javascript).toContain('error.code = "business-insights-access-unavailable"');
  });

  it.each([[0,"At risk"],[39,"At risk"],[40,"Needs attention"],[59,"Needs attention"],[60,"Healthy"],[79,"Healthy"],[80,"Strong"],[100,"Strong"]])("maps %i to %s", (score, status) => expect(healthStatus(score)).toBe(status));

  it("suppresses the score for an empty account", () => {
    const result = calculateHealthScore(empty(), today);
    expect(result.score).toBeNull();
    expect(result.status).toBe("Not enough data yet");
    expect(buildBusinessInsights(empty(), today).hasData).toBe(false);
  });

  it("clamps health scores and overdue invoices reduce the score", () => {
    const base = empty();
    base.invoices = [{ id:"1", date:"2026-08-01", dueDate:"2026-08-30", total:100, status:"Unpaid" }];
    const healthy = calculateHealthScore(base, today).score;
    base.invoices[0].dueDate = "2026-07-01";
    const overdue = calculateHealthScore(base, today).score;
    expect(overdue).toBeLessThan(healthy);
    expect(overdue).toBeGreaterThanOrEqual(0);
    expect(healthy).toBeLessThanOrEqual(100);
  });

  it("rewards improving revenue and treats rising expenses as unfavourable", () => {
    const data = empty();
    data.journals = [journal("previous", "2026-07-03", 1000, 100), journal("current", "2026-08-03", 2000, 400)];
    const model = buildBusinessInsights(data, today);
    expect(model.trends.revenue.favourability).toBe("favourable");
    expect(model.trends.expenses.favourability).toBe("unfavourable");
    expect(model.health.components.find(item => item.key === "revenue").points).toBe(10);
    expect(model.health.components.find(item => item.key === "expenses").points).toBe(-8);
    expect(model.health.components.find(item => item.key === "profit").points).toBe(12);
  });

  it("uses the authenticated top-level journal query and working userId ownership field", async () => {
    const api = {
      collection: (_db, name) => ({ collection: name }),
      where: (field, operator, value) => ({ field, operator, value }),
      query: (base, constraint) => ({ base, constraint }),
      getDocs: async queryValue => {
        expect(queryValue).toEqual({
          base: { collection: "journals" },
          constraint: { field: "userId", operator: "==", value: "authenticated-user" }
        });
        return { docs: [] };
      }
    };
    expect(ownedJournalQuery({}, "authenticated-user", api).constraint.field).toBe("userId");
    await expect(loadOwnedJournals({}, "authenticated-user", api)).resolves.toEqual({ journals: [], skippedCount: 0 });
  });

  it("loads the same valid journal fixture as Profit & Loss", () => {
    const stored = [journal("one", "2026-08-03", 500, 125)];
    const snapshot = { docs: stored.map(item => ({ id:item.id, data:() => item })) };
    const loaded = normaliseJournalSnapshot(snapshot);
    const direct = profitLossViewFromJournals(stored, { dateFrom:"2026-08-01", dateTo:"2026-08-06" });
    const normalized = profitLossViewFromJournals(loaded.journals, { dateFrom:"2026-08-01", dateTo:"2026-08-06" });
    expect(normalized).toEqual(direct);
    expect(normalized).toEqual(expect.objectContaining({ totalIncome:500, totalExpenses:125, netResult:375 }));
  });

  it("treats a successful zero-journal load as zero activity, not a warning", () => {
    const data = { ...empty(), accountingAvailable:true, invoices:[{ id:"invoice", total:20, status:"Paid" }] };
    const snapshot = calculateSnapshot(data, today);
    expect(snapshot.currentMonthRevenue).toBe(0);
    expect(snapshot.currentMonthExpenses).toBe(0);
    expect(snapshot.currentMonthProfit).toBe(0);
    expect(partialJournalDataMessage([], [])).toBe("");
  });

  it("distinguishes genuine journal failure and skipped malformed records", () => {
    expect(partialJournalDataMessage(["accounting journals"], [])).toContain("could not be loaded (accounting journals)");
    const valid = journal("valid", "2026-08-03", 100);
    const result = normaliseJournalSnapshot({ docs:[
      { id:"valid", data:() => valid },
      { id:"malformed", data:() => ({ date:"bad", lines:"bad" }) }
    ] });
    expect(result.journals).toHaveLength(1);
    expect(result.skippedCount).toBe(1);
    expect(partialJournalDataMessage([], ["1 malformed accounting journal was skipped"])).toContain("Valid records are still included");
    const unavailable = calculateSnapshot({ ...empty(), accountingAvailable:false, invoices:[{ id:"invoice" }] }, today);
    expect(unavailable.currentMonthRevenue).toBeNull();
    expect(unavailable.currentMonthExpenses).toBeNull();
    expect(unavailable.currentMonthProfit).toBeNull();
  });

  it("uses project source totals and lets unprofitable projects affect health", () => {
    const data = empty();
    data.projects = [{ id:"p", name:"Project", status:"Active" }];
    data.invoices = [{ projectId:"p", total:100 }];
    data.bills = [{ projectId:"p", total:150 }];
    const projects = calculateProjectSummaries(data.projects, data.invoices, data.bills, data.expenses);
    expect(projects[0].profit).toBe(-50);
    expect(calculateHealthScore(data, today).components.find(item => item.key === "projects").points).toBeLessThan(0);
  });

  it("calculates budget pressure from the same supported transaction fields", () => {
    const budgets = calculateBudgetSummaries([{ id:"b", name:"Budget", status:"Active", startDate:"2026-08-01", endDate:"2026-08-31", budgetType:"overall", plannedAmount:100 }], [], [{ date:"2026-08-02", gross:90 }]);
    expect(budgets[0].percentageUsed).toBe(90);
    expect(budgets[0].pressure).toBe(true);
  });

  it("ranks priorities deterministically, high first, without duplicates, capped at five", () => {
    const data = empty();
    data.invoices = Array.from({length:7}, (_, index) => ({ id:`i${index}`, date:"2026-07-01", dueDate:"2026-07-10", status:"Unpaid", total:100 + index }));
    data.bills = [{ id:"bill", dueDate:"2026-07-01", status:"Unpaid", total:500 }];
    data.projects = [{ id:"p", name:"Loss", status:"Active" }];
    data.budgets = [{ id:"b", name:"Spent", status:"Active", startDate:"2026-01-01", endDate:"2026-12-31", budgetType:"overall", plannedAmount:10 }];
    data.expenses = [{ projectId:"p", date:"2026-08-01", gross:200 }];
    const first = generatePriorities(data, today);
    const second = generatePriorities(data, today);
    expect(first).toEqual(second);
    expect(first.length).toBeLessThanOrEqual(5);
    expect(first[0].severity).toBe("high");
    expect(new Set(first.map(item => item.id)).size).toBe(first.length);
  });

  it("returns a positive priority when growth is favourable and no issues exist", () => {
    const data = empty();
    data.journals = [journal("previous", "2026-07-03", 100), journal("current", "2026-08-03", 200)];
    expect(generatePriorities(data, today)).toContainEqual(expect.objectContaining({ severity:"positive" }));
  });

  it("handles zero and unavailable trend comparisons without infinity", () => {
    const zero = calculateTrend(6540, 0, "down", true, "outstanding balance");
    expect(zero.percentage).toBeNull();
    expect(zero.comparisonText).not.toMatch(/infinity/i);
    expect(zero.comparisonText).toBe("£6,540.00 higher; no outstanding balance was recorded in the comparison period");
    expect(zero.favourability).toBe("unfavourable");
    expect(formatInsightsGbp(6540)).toBe("£6,540.00");
    expect(calculateTrend(0, 0, "up", false).comparisonText).toBe("No comparison available");
    expect(calculateTrend(10, 20, "down", true).favourability).toBe("favourable");
  });

  it("renders concise trend sentences without duplicated direction wording", () => {
    expect(trendSentence(calculateTrend(1946, 1000, "up", true, "revenue"))).toBe("Up 94.6% from the comparison period.");
    expect(trendSentence(calculateTrend(900, 1000, "down", true, "expenses"))).toBe("Down 10% from the comparison period.");
    expect(trendSentence(calculateTrend(1000, 1000, "up", true))).toBe("No change from the comparison period.");
    expect(trendSentence(calculateTrend(6540, 0, "down", true, "outstanding balance"))).toBe("£6,540.00 higher; no outstanding balance was recorded in the comparison period.");
  });

  it("snapshot totals match shared project and budget helpers", () => {
    const data = empty();
    data.invoices = [{ id:"i", projectId:"p", total:120, status:"Unpaid", date:"2026-08-02", dueDate:"2026-08-03" }];
    data.projects = [{ id:"p", status:"Active" }];
    const snapshot = calculateSnapshot(data, today);
    expect(snapshot.outstandingInvoiceTotal).toBe(120);
    expect(snapshot.projects).toEqual(calculateProjectSummaries(data.projects, data.invoices, [], []));
  });

  it("canonical demo seed naturally produces populated insights", () => {
    const data = {
      invoices: DEMO_SEED.invoices.map(source), bills: DEMO_SEED.bills.map(source), expenses: [...DEMO_SEED.expenses, ...DEMO_SEED.mileage].map(source),
      projects: DEMO_SEED.projects.map(source), budgets: DEMO_SEED.budgets.map(source), journals: buildDemoJournalRecords("demo").map(source), accountingAvailable:true
    };
    const result = buildBusinessInsights(data, today);
    expect(result.health.score).not.toBeNull();
    expect(result.priorities.length).toBeGreaterThan(1);
    expect(Object.values(result.trends).some(trend => trend.direction !== "flat" && trend.direction !== "none")).toBe(true);
    expect(result.snapshot.outstandingInvoiceTotal).toBeGreaterThan(0);
    expect(result.snapshot.currentMonthRevenue).toBe(5450);
    expect(result.snapshot.currentMonthExpenses).toBe(879.7);
    expect(result.snapshot.currentMonthProfit).toBe(4570.3);
    expect(result.trends.revenue.previous).toBe(2800);
    expect(result.trends.expenses.previous).toBe(378.5);
    expect(result.trends.profit.previous).toBe(2421.5);
    expect(result.health.components.find(item => item.key === "revenue").points).toBe(10);
    expect(result.health.components.find(item => item.key === "expenses").points).toBe(-8);
    expect(result.health.components.find(item => item.key === "profit").points).toBe(12);
    const rawScore = 60 + result.health.components.reduce((sum, item) => sum + item.points, 0);
    expect(result.health.score).toBe(Math.min(100, Math.max(0, Math.round(rawScore))));
    expect(result.health.score).toBe(82);
    const periods = comparisonPeriods(today);
    expect(periods.currentStart).toEqual(new Date(2026, 7, 1));
    expect(periods.currentEnd).toEqual(new Date(2026, 7, 6));
    expect(periods.previousStart).toEqual(new Date(2026, 6, 1));
    expect(periods.previousEnd).toEqual(new Date(2026, 6, 6));
  });

  it("reconciles month-to-date snapshot values with the shared P&L helper", () => {
    const journals = [journal("previous", "2026-07-03", 100, 25), journal("current", "2026-08-03", 500, 125)];
    const snapshot = calculateSnapshot({ ...empty(), journals, accountingAvailable:true }, today);
    const report = profitLossViewFromJournals(journals, { dateFrom:"2026-08-01", dateTo:"2026-08-06" });
    expect(snapshot.currentMonthRevenue).toBe(report.totalIncome);
    expect(snapshot.currentMonthExpenses).toBe(report.totalExpenses);
    expect(snapshot.currentMonthProfit).toBe(report.netResult);
  });

  it("keeps calculation helpers pure", () => {
    const data = empty();
    data.invoices.push({ id:"i", total:10, status:"Unpaid" });
    const before = JSON.stringify(data);
    buildBusinessInsights(data, today);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("logs the safe event once after successful loading and keeps analytics failure non-blocking", () => {
    const source = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
    expect(source.match(/logActivityEvent\("business_insights_viewed"/g)).toHaveLength(1);
    expect(source.indexOf("loadBusinessInsightsData(user,")).toBeLessThan(source.indexOf('logActivityEvent("business_insights_viewed"'));
    expect(source).toContain('void logActivityEvent("business_insights_viewed", createActivityIdempotencyKey())');
    expect(source.match(/logActivityEvent\("business_insights_upgrade_prompt_viewed"/g)).toHaveLength(1);
    expect(source.match(/logActivityEvent\("business_insights_upgrade_clicked"/g)).toHaveLength(1);
    expect(source).toContain("if(upgradePromptLogged) return");
    expect(source).toContain("if(visibility.upgradePrompt) logUpgradePromptView()");
    expect(source).toContain("if(!upgradeClickLogged)");
    expect(source).toContain("CHECKOUT_FUNCTION_URL");
    expect(source).toContain("await trackBeginCheckout()");
  });

  it("keeps the responsive no-overflow structure and visible focus treatment", () => {
    const html = readFileSync(new URL("../business-insights.html", import.meta.url), "utf8");
    const javascript = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
    expect(html).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(html).toContain(".snapshot-grid.snapshot-grid-starter{grid-template-columns:repeat(2,minmax(0,1fr))}");
    expect(html).toMatch(/@media\(max-width:700px\)[\s\S]*\.snapshot-grid\.snapshot-grid-starter\{grid-template-columns:1fr\}/);
    expect(html).toContain("minmax(0,1fr)");
    expect(html).toContain("a:focus-visible,button:focus-visible,summary:focus-visible");
    expect(javascript).toContain('target.classList.toggle("snapshot-grid-starter", visibility.snapshotLayout === "compact")');
    expect(javascript).toMatch(/if\(!visibility\.fullSnapshot\)\{\s*target\.innerHTML = preview\.join\(""\);\s*return;/);
    expect(javascript).toContain('document.getElementById("upgradeInsightsButton")?.addEventListener("click", startBusinessInsightsCheckout)');
  });
});
