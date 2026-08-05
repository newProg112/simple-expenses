export const ACTIVITY_FILTERS = Object.freeze({
  all: null,
  accounts: ["user_signed_up", "user_logged_in"],
  invoices: ["invoice_created"],
  ai: ["ai_question_asked"],
  scanning: ["invoice_scanned"],
  billing: ["checkout_started", "upgraded_to_pro", "subscription_cancelled"]
});

export const ACTIVITY_PRESENTATION = Object.freeze({
  user_signed_up: { title: "New account registered", marker: "A" },
  user_logged_in: { title: "Customer logged in", marker: "A" },
  invoice_created: { title: "Invoice created", marker: "I" },
  invoice_scanned: { title: "Invoice scanned", marker: "S" },
  ai_question_asked: { title: "AI Assistant used", marker: "AI" },
  checkout_started: { title: "Pro checkout started", marker: "B" },
  upgraded_to_pro: { title: "Upgraded to Pro", marker: "B" },
  subscription_cancelled: { title: "Subscription cancelled", marker: "B" },
  bill_created: { title: "Bill created", marker: "BL" },
  expense_created: { title: "Expense created", marker: "E" },
  mileage_created: { title: "Mileage claim created", marker: "M" },
  project_created: { title: "Project created", marker: "P" },
  budget_created: { title: "Budget created", marker: "BG" },
  accountant_pack_generated: { title: "Accountant Pack generated", marker: "AP" },
  trial_balance_viewed: { title: "Trial Balance opened", marker: "TB" },
  general_ledger_viewed: { title: "General Ledger opened", marker: "GL" },
  profit_and_loss_viewed: { title: "Profit & Loss opened", marker: "PL" },
  balance_sheet_viewed: { title: "Balance Sheet opened", marker: "BS" }
});

export function filterActivityEvents(events, filter){
  const allowed = ACTIVITY_FILTERS[filter] || null;
  const list = Array.isArray(events) ? events : [];
  return allowed ? list.filter(event => allowed.includes(event?.eventType)) : list;
}

export function formatActivityExactTime(value, locale = "en-GB"){
  const date = new Date(value);
  if(!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function formatActivityRelativeTime(value, now = new Date()){
  const date = new Date(value);
  const nowDate = new Date(now);
  if(!Number.isFinite(date.getTime()) || !Number.isFinite(nowDate.getTime())){
    return "Time unavailable";
  }
  const seconds = Math.max(0, Math.round((nowDate.getTime() - date.getTime()) / 1000));
  if(seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if(minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  const today = new Date(nowDate);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(nowDate);
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  if(date >= yesterday && date < today){
    return `Yesterday at ${new Intl.DateTimeFormat("en-GB", {hour: "2-digit", minute: "2-digit"}).format(date)}`;
  }
  if(hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if(days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatActivityExactTime(date);
}

export function activityErrorState(error){
  const code = String(error?.code || "").replace(/^functions\//, "");
  if(code === "unauthenticated") return {kind: "unauthenticated"};
  if(code === "permission-denied") return {kind: "permission-denied"};
  if(code === "failed-precondition"){
    return {kind: "error", title: "Activity feed is not configured", message: "The secure owner and demo-account configuration needs attention."};
  }
  return {kind: "error", title: "Recent activity could not be loaded", message: "Check your connection and try again."};
}
