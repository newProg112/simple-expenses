import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildForecasts,
  calculateBudgetForecasts,
  calculateMonthEndForecasts,
  calculateObligationForecast,
  calculatePaymentBehaviour
} from "../assets/business-insights-forecasts.js";
import { businessInsightsPresentation, resolveBusinessInsightsAccess } from "../assets/business-insights-access.js";
import { LIVE_PRO_PRICE_ID } from "../resources/js/stripe-billing-config.js";

const today = new Date(2026, 7, 10);
const snap = data => ({ exists:() => true, data:() => data });
const liveProProfile = {
  currentPlan: "Pro", subscriptionStatus: "active", stripeMode: "live",
  stripePriceId: LIVE_PRO_PRICE_ID, stripeCustomerId: "cus_live",
  stripeSubscriptionId: "sub_live"
};
const journal = (id, date, revenue = 0, expense = 0, outputVat = 0, inputVat = 0) => ({
  id, date, sourceType:"test", sourceId:id, description:id, userId:"user",
  lines:[
    ...(revenue ? [{accountCode:"1100", debit:revenue + outputVat, credit:0}, {accountCode:"4000", debit:0, credit:revenue}] : []),
    ...(outputVat ? [{accountCode:"2100", debit:0, credit:outputVat}] : []),
    ...(expense ? [{accountCode:"5000", debit:expense, credit:0}, {accountCode:"2200", debit:0, credit:expense + inputVat}] : []),
    ...(inputVat ? [{accountCode:"1200", debit:inputVat, credit:0}] : [])
  ]
});

describe("Business Insights Phase 3 forecast calculations", () => {
  it("projects revenue, expenses and profit by elapsed calendar days", () => {
    const result = calculateMonthEndForecasts([journal("current", "2026-08-05", 1000, 200)], today, true);
    expect(result.period).toMatchObject({ elapsedDays:10, totalDays:31 });
    expect(result.revenue).toMatchObject({ state:"available", toDate:1000, dailyAverage:100, projected:3100 });
    expect(result.expenses).toMatchObject({ state:"available", toDate:200, dailyAverage:20, projected:620 });
    expect(result.profit).toEqual({ state:"available", projected:2480 });
  });

  it("compares only equivalent elapsed periods", () => {
    const result = calculateMonthEndForecasts([
      journal("old-inside", "2026-07-08", 800),
      journal("old-outside", "2026-07-20", 5000),
      journal("current", "2026-08-08", 1000)
    ], today, true);
    expect(result.revenue.comparison).toEqual({ previous:800, percentage:25 });
  });

  it("handles month ends and leap-year February", () => {
    const leap = calculateMonthEndForecasts([journal("leap", "2028-02-10", 1400, 280)], new Date(2028, 1, 14), true);
    expect(leap.period).toMatchObject({ elapsedDays:14, totalDays:29 });
    expect(leap.revenue.projected).toBe(2900);
    const monthEnd = calculateMonthEndForecasts([journal("end", "2026-04-30", 3000, 900)], new Date(2026, 3, 30), true);
    expect(monthEnd.revenue.projected).toBe(3000);
    expect(monthEnd.expenses.projected).toBe(900);
  });

  it("distinguishes no journal data, malformed calculation and permission failure", () => {
    expect(calculateMonthEndForecasts([], today, true).revenue.state).toBe("insufficient-data");
    expect(calculateMonthEndForecasts([{date:"bad", lines:[]}], today, true).state).toBe("calculation-unavailable");
    expect(calculateMonthEndForecasts([journal("valid", "2026-08-02", 100)], today, false).state).toBe("source-unavailable");
    const afterSkippedMalformed = calculateMonthEndForecasts([journal("valid", "2026-08-02", 100)], today, true);
    expect(afterSkippedMalformed.revenue.state).toBe("available");
  });

  it("uses non-overlapping overdue, 0–7 day and 8–30 day bill buckets", () => {
    const result = calculateObligationForecast([
      {dueDate:"2026-08-09", status:"Unpaid", total:10},
      {dueDate:"2026-08-10", status:"Unpaid", total:20},
      {dueDate:"2026-08-17", status:"Unpaid", total:30},
      {dueDate:"2026-08-18", status:"Unpaid", total:40},
      {dueDate:"2026-09-09", status:"Unpaid", total:50},
      {dueDate:"2026-09-10", status:"Unpaid", total:900},
      {dueDate:"2026-08-15", status:"Paid", total:800},
      {dueDate:"bad", status:"Unpaid", total:700}
    ], today, true);
    expect(result).toMatchObject({ overdue:{count:1, amount:10}, next7:{count:2, amount:50}, days8To30:{count:2, amount:90} });
    expect(calculateObligationForecast([], today, false).state).toBe("source-unavailable");
  });

  it("projects budget overspend and underspend and rejects invalid budgets", () => {
    const summaries = [
      {id:"over", name:"Alpha", status:"Active", planned:1000, actual:500},
      {id:"under", name:"Beta", status:"Active", planned:1000, actual:100},
      {id:"zero", name:"Zero", status:"Active", planned:0, actual:20},
      {id:"invalid", name:"Invalid", status:"Active", planned:100, actual:20}
    ];
    const budgets = [
      {id:"over", startDate:"2026-08-01", endDate:"2026-08-31"},
      {id:"under", startDate:"2026-08-01", endDate:"2026-08-31"},
      {id:"zero", startDate:"2026-08-01", endDate:"2026-08-31"},
      {id:"invalid", startDate:"bad", endDate:"2026-08-31"}
    ];
    const result = calculateBudgetForecasts(summaries, budgets, today, true);
    expect(result.selected).toMatchObject({ id:"over", projected:1550, difference:550, status:"projected-over" });
    expect(result.budgets.find(item => item.id === "under")).toMatchObject({ projected:310, difference:-690, status:"on-track" });
    expect(result.budgets.map(item => item.id)).toEqual(["over", "under"]);
    expect(calculateBudgetForecasts(summaries, budgets, today, false).state).toBe("source-unavailable");
  });

  it("classifies payment history deterministically and skips invalid durations", () => {
    const invoices = [
      {id:"2", client:"Zeta Ltd", status:"Paid", date:"2026-01-01", dueDate:"2026-01-15", paidAt:"2026-01-20"},
      {id:"3", client:"Zeta Ltd", status:"Paid", date:"2026-02-01", dueDate:"2026-02-15", paidAt:"2026-02-18"},
      {id:"4", client:"Zeta Ltd", status:"Unpaid", date:"2026-06-01", dueDate:"2026-07-01"},
      {id:"a", client:"Alpha Ltd", status:"Paid", date:"2026-01-01", dueDate:"2026-01-20", paidAt:"2026-01-10"},
      {id:"b", client:"Alpha Ltd", status:"Paid", date:"2026-02-01", dueDate:"2026-02-20", paidAt:"2026-02-10"},
      {id:"bad1", client:"Broken", status:"Paid", date:"2026-03-10", paidAt:"2026-03-01"},
      {id:"bad2", client:"Broken", status:"Paid", date:"bad", paidAt:"2026-03-01"}
    ];
    const result = calculatePaymentBehaviour(invoices, today, true);
    expect(result.selected).toMatchObject({ name:"Zeta Ltd", risk:"Frequently late", invoiceCount:2, latePaidCount:2, overdueCount:1 });
    expect(result.customers.find(item => item.name === "Alpha Ltd").risk).toBe("Usually on time");
    expect(result.customers.some(item => item.name === "Broken")).toBe(false);
    expect(calculatePaymentBehaviour(invoices.slice(-2), today, true).state).toBe("insufficient-history");
  });

  it("reuses VAT states and isolates partial source failures", () => {
    const result = buildForecasts({
      journals:[journal("vat", "2026-08-02", 100, 20, 20, 4)], accountingAvailable:true,
      bills:[], budgets:[], invoices:[], sourceAvailability:{bills:false, budgets:false, invoices:false}
    }, {referenceDate:today, period:{currentStart:new Date(2026,7,1), currentEnd:today}, budgetSummaries:[], vatRegistered:true, formatMoney:value => `£${value}`});
    expect(result.calculations.vat).toMatchObject({state:"payable", amount:16});
    expect(result.calculations.obligations.state).toBe("source-unavailable");
    expect(result.calculations.budgets.state).toBe("source-unavailable");
    expect(result.calculations.payments.state).toBe("source-unavailable");
    expect(result.cards.find(card => card.id === "revenue").available).toBe(true);
    expect(result.cards.find(card => card.id === "cash")).toMatchObject({available:false, value:"Unavailable"});
  });
});

describe("Business Insights Phase 3 access, UI and privacy", () => {
  const forecastModel = {
    priorities:[], snapshot:{}, actionable:{recommendations:[], teasers:[]},
    forecasts:{cards:[{id:"payments", title:"Secret Customer", available:true}], teasers:["A customer payment-behaviour forecast is available.", "A budget projection is available.", "Third"]}
  };

  it("redacts and caps Starter while Pro and Demo receive details without Demo billing", () => {
    const starter = resolveBusinessInsightsAccess(snap({demoMode:false}), snap({currentPlan:"Starter"}));
    const pro = resolveBusinessInsightsAccess(snap({demoMode:false}), snap(liveProProfile));
    const demo = resolveBusinessInsightsAccess(snap({demoMode:true}), snap({currentPlan:"Starter"}));
    const starterView = businessInsightsPresentation(forecastModel, starter);
    expect(starterView.forecasts).toEqual([]);
    expect(starterView.forecastTeasers).toHaveLength(2);
    expect(JSON.stringify(starterView.forecastTeasers)).not.toMatch(/Secret|£|%|\d/);
    expect(businessInsightsPresentation(forecastModel, pro).forecasts).toHaveLength(1);
    const demoView = businessInsightsPresentation(forecastModel, demo);
    expect(demoView.forecasts).toHaveLength(1);
    expect(demoView.visibility).toMatchObject({forecastDetails:true, upgradePrompt:false, billingActions:false});
  });

  it("keeps forecast gating neutral, responsive, accessible and singular-upgrade", () => {
    const html = readFileSync(new URL("../business-insights.html", import.meta.url), "utf8");
    const source = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
    expect(html).toMatch(/id="forecastsSection"[^>]*hidden/);
    expect(html).toMatch(/id="forecastPreviewSection"[^>]*hidden/);
    expect(html.indexOf('id="forecastsSection"')).toBeLessThan(html.indexOf('id="trendsSection"'));
    expect(html.indexOf('id="forecastPreviewSection"')).toBeLessThan(html.indexOf('id="insightsUpgradePanel"'));
    expect(html.match(/id="upgradeInsightsButton"/g)).toHaveLength(1);
    expect(html).toContain("How forecasts are calculated");
    expect(html).toMatch(/@media\(max-width:700px\)[\s\S]*\.forecast-grid/);
    expect(html).toContain("a:focus-visible,button:focus-visible,summary:focus-visible");
    expect(source).toContain("business-insights-access-unavailable");
    expect(source).toContain("We could not confirm your Business Insights access");
  });

  it("uses no AI, writes no records and logs one privacy-safe bounded event", () => {
    const source = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
    const forecasts = readFileSync(new URL("../assets/business-insights-forecasts.js", import.meta.url), "utf8");
    expect(`${source}\n${forecasts}`).not.toMatch(/openai|httpsCallable\([^)]*ai/i);
    expect(`${source}\n${forecasts}`).not.toMatch(/addDoc|setDoc|updateDoc|deleteDoc/);
    expect(source.match(/logActivityEvent\("business_insights_forecasts_viewed"/g)).toHaveLength(1);
    expect(source).toContain("if(meaningful && !forecastsViewLogged)");
    expect(source).not.toMatch(/logActivityEvent\("business_insights_forecasts_viewed"[^\n]*(value|customer|budget|text|metadata)/);
  });

  it("returns no Starter teaser for an empty account and documents cash unavailability", () => {
    const result = buildForecasts({journals:[], bills:[], budgets:[], invoices:[], accountingAvailable:true, sourceAvailability:{}}, {
      referenceDate:today, period:{currentStart:new Date(2026,7,1), currentEnd:today}, budgetSummaries:[], vatRegistered:false
    });
    expect(result.teasers).toEqual([]);
    expect(result.calculations.cash.state).toBe("unavailable-no-authoritative-source");
    expect(result.cards).toHaveLength(8);
  });
});
