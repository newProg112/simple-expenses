import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildActionableInsights,
  calculateLargestExpenseCategory,
  calculateSlowestPayingCustomer,
  calculateTopCustomer,
  calculateUpcomingBills,
  calculateVatPosition,
  selectProjectPerformance
} from "../assets/business-insights-actionable.js";
import { businessInsightsPresentation, resolveBusinessInsightsAccess } from "../assets/business-insights-access.js";

const today = new Date(2026, 7, 6);
const period = { currentStart:new Date(2026, 7, 1), currentEnd:today };
const snap = value => ({ exists:() => true, data:() => value });

describe("Business Insights Phase 2 actionable calculations", () => {
  it("ranks top customers by net invoice revenue with percentage and stable tie-breaks", () => {
    const result = calculateTopCustomer([
      { id:"z", date:"2026-08-02", client:"Zulu", amount:100 },
      { id:"a", date:"2026-08-03", client:"Alpha", total:120, vat:20 },
      { id:"old", date:"2026-07-31", client:"Old", amount:500 },
      { id:"bad", date:"bad", client:"Bad", amount:900 }
    ], period);
    expect(result).toMatchObject({ name:"Alpha", amount:100, total:200, percentage:50 });
  });

  it("combines expenses and mileage once without journal double counting", () => {
    const result = calculateLargestExpenseCategory([
      { id:"e", type:"expense", date:"2026-08-01", category:"Travel", gross:120 },
      { id:"m", type:"mileage", date:"2026-08-02", category:"Travel", amount:80 },
      { id:"o", type:"expense", date:"2026-08-03", category:"Office", gross:100 }
    ], period);
    expect(result).toMatchObject({ category:"Travel", amount:120, total:300, percentage:40 });
  });

  it("selects best margin and prioritises the lowest loss-making active project", () => {
    const projects = [
      { id:"best", name:"Best", status:"Active", revenue:200, costs:50, profit:150, margin:75 },
      { id:"loss", name:"Loss", status:"Active", revenue:100, costs:130, profit:-30, margin:-30 },
      { id:"closed", name:"Closed", status:"Closed", revenue:500, costs:10, profit:490, margin:98 }
    ];
    expect(selectProjectPerformance(projects)).toEqual({ best:projects[0], lowest:projects[1] });
    expect(selectProjectPerformance([{ id:"only", name:"Only", status:"Active", revenue:100, costs:20, profit:80, margin:80 }]).lowest).toBeNull();
  });

  it("requires two reliable paid invoices and skips negative or malformed durations", () => {
    const result = calculateSlowestPayingCustomer([
      { id:"1", client:"Slow Ltd", status:"Paid", date:"2026-01-01", paidAt:"2026-02-10" },
      { id:"2", client:"Slow Ltd", status:"Paid", date:"2026-03-01", paidDate:"2026-04-10" },
      { id:"3", client:"One only", status:"Paid", date:"2026-01-01", paidAt:"2026-06-01" },
      { id:"4", client:"Invalid", status:"Paid", date:"2026-02-01", paidAt:"2026-01-01" },
      { id:"5", client:"Invalid", status:"Paid", date:"bad", paidAt:"2026-03-01" }
    ]);
    expect(result).toMatchObject({ name:"Slow Ltd", averageDays:40, invoiceCount:2 });
  });

  it("includes unpaid bills due today through exactly seven days and excludes overdue and paid", () => {
    const result = calculateUpcomingBills([
      { dueDate:"2026-08-06", status:"Unpaid", total:100 },
      { dueDate:"2026-08-13", status:"Unpaid", total:200 },
      { dueDate:"2026-08-05", status:"Unpaid", total:900 },
      { dueDate:"2026-08-10", status:"Paid", total:800 },
      { dueDate:"bad", status:"Unpaid", total:700 }
    ], today);
    expect(result).toEqual({ count:2, amount:300 });
  });

  it("distinguishes VAT payable, reclaimable, nil, registration and data availability", () => {
    const journal = (output, input) => ({ date:"2026-08-03", lines:[
      { accountCode:"2100", debit:0, credit:output },
      { accountCode:"1200", debit:input, credit:0 }
    ] });
    expect(calculateVatPosition([journal(100, 40)], true, period)).toMatchObject({ state:"payable", amount:60 });
    expect(calculateVatPosition([journal(40, 100)], true, period)).toMatchObject({ state:"reclaimable", amount:60 });
    expect(calculateVatPosition([journal(40, 40)], true, period)).toMatchObject({ state:"nil", amount:0 });
    expect(calculateVatPosition([journal(100, 40)], false, period).state).toBe("not-registered");
    expect(calculateVatPosition([], true, period).state).toBe("insufficient-data");
    expect(calculateVatPosition([journal(100, 40)], true, period, false).state).toBe("insufficient-data");
  });

  it("orders and caps detailed recommendations while capping redacted teasers at two", () => {
    const model = { priorities:[], snapshot:{}, actionable:buildActionableInsights({
      invoices:[{ id:"i", date:"2026-08-02", client:"Secret Customer", amount:100 }],
      bills:[{ dueDate:"2026-08-10", status:"Unpaid", total:50 }], expenses:[], journals:[], accountingAvailable:true
    }, { referenceDate:today, period, projectSummaries:[], vatRegistered:false, formatMoney:value => `£${value}` }) };
    const starter = resolveBusinessInsightsAccess(snap({demoMode:false}), snap({currentPlan:"Starter"}));
    const pro = resolveBusinessInsightsAccess(snap({demoMode:false}), snap({currentPlan:"Pro"}));
    const demo = resolveBusinessInsightsAccess(snap({demoMode:true}), snap({currentPlan:"Starter"}));
    const starterView = businessInsightsPresentation(model, starter);
    expect(starterView.actionable).toEqual([]);
    expect(starterView.actionableTeasers).toHaveLength(2);
    expect(JSON.stringify(starterView.actionableTeasers)).not.toMatch(/Secret|£|%|\d/);
    expect(businessInsightsPresentation(model, pro).actionable.map(item => item.id)).toEqual(["upcoming-bills", "top-customer"]);
    expect(businessInsightsPresentation(model, demo).actionable).toHaveLength(2);
    expect(demo).toMatchObject({ fullAccess:true, demo:true });
    expect(businessInsightsPresentation(model, demo).visibility.billingActions).toBe(false);
  });

  it("provides empty and partial-safe UI, responsive cards, one checkout and bounded safe activity", () => {
    const html = readFileSync(new URL("../business-insights.html", import.meta.url), "utf8");
    const source = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
    expect(html.indexOf('id="actionableSection"')).toBeLessThan(html.indexOf('id="trendsSection"'));
    expect(html.indexOf('id="actionablePreviewSection"')).toBeLessThan(html.indexOf('id="insightsUpgradePanel"'));
    expect(html).toMatch(/@media\(max-width:700px\)[\s\S]*\.actionable-grid/);
    expect(html.match(/id="upgradeInsightsButton"/g)).toHaveLength(1);
    expect(source).toContain("No actionable recommendations are available yet.");
    expect(source).toContain("partialJournalDataMessage(failures, notices)");
    expect(source.match(/logActivityEvent\("business_insights_actionable_viewed"/g)).toHaveLength(1);
    expect(source).toContain("if(rendered && !actionableViewLogged)");
    expect(source).not.toMatch(/logActivityEvent\("business_insights_actionable_viewed"[^\n]*[,{]\s*(amount|name|text)/);
  });
});
