import { businessInsightsPresentation } from "./business-insights-access.js?v=20260901-stripe-live1";

const money = value => new Intl.NumberFormat("en-GB", {
  style:"currency",
  currency:"GBP"
}).format(Number(value) || 0);

function signal(id, label, value){
  return Object.freeze({ id, label, value:String(value) });
}

export function buildDashboardBusinessHealth(model, access, failures = [], notices = []){
  const partial = failures.length > 0 || notices.length > 0;
  const health = model?.health;
  if(!model?.hasData || health?.score === null){
    return Object.freeze({
      state:"empty",
      health:health || Object.freeze({ score:null, status:"Not enough data yet", explanation:"Add some records to build a meaningful view." }),
      signals:Object.freeze([]),
      partial
    });
  }
  if(!Number.isFinite(health?.score) || health.score < 0 || health.score > 100 || !health.status){
    throw new Error("Business Health result is unavailable.");
  }

  const presentation = businessInsightsPresentation(model, access);
  const unavailable = new Set(failures);
  const signals = [];
  if(access.fullAccess){
    const attentionCount = (model.priorities || []).filter(item => item?.severity !== "positive").length;
    if(!partial) signals.push(signal("priorities", "Priorities needing attention", attentionCount));
    const month = model.forecasts?.calculations?.month;
    if(!unavailable.has("accounting journals") && month?.revenue?.state === "available"){
      signals.push(signal("revenue-forecast", "Expected month-end revenue", money(month.revenue.projected)));
    }
    const obligations = model.forecasts?.calculations?.obligations;
    if(!unavailable.has("bills") && obligations?.state === "available"){
      signals.push(signal("bills-due", "Bills due within 7 days", money(obligations.next7.amount)));
    }
  }else{
    if(!unavailable.has("invoices")){
      signals.push(signal("overdue-invoices", "Overdue invoices", presentation.snapshot.overdueInvoiceCount));
      signals.push(signal("outstanding-invoices", "Outstanding invoices", money(presentation.snapshot.outstandingInvoiceTotal)));
    }
    if(!unavailable.has("bills")){
      signals.push(signal("unpaid-bills", "Unpaid bills", money(presentation.snapshot.unpaidBillsTotal)));
    }
  }

  return Object.freeze({
    state:"ready",
    health,
    signals:Object.freeze(signals.slice(0, 3)),
    partial
  });
}
