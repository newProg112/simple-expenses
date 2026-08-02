import { analytics } from "/firebase-config.js";
import { logEvent } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  createAnalyticsTracker,
  invoiceItemCountBucket,
  normalizeAnalyticsFileType,
  normalizeAnalyticsPlan
} from "./analytics-event-policy.js?v=20260802-analytics1";

export const trackAnalyticsEvent = createAnalyticsTracker({
  analytics,
  logEvent,
  runtime: typeof window === "undefined" ? null : window,
  warn: message => {
    if(typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)){
      console.warn(message);
    }
  }
});

export const trackSignUp = () => trackAnalyticsEvent("sign_up", { method: "email" });
export const trackLogin = () => trackAnalyticsEvent("login", { method: "email" });

export const trackInvoiceCreated = ({ plan, hasVat, itemCount } = {}) =>
  trackAnalyticsEvent("invoice_created", {
    plan: normalizeAnalyticsPlan(plan),
    has_vat: hasVat === true,
    item_count_bucket: invoiceItemCountBucket(itemCount)
  });

export const trackInvoiceScanned = ({ plan, fileName } = {}) =>
  trackAnalyticsEvent("invoice_scanned", {
    plan: normalizeAnalyticsPlan(plan),
    file_type: normalizeAnalyticsFileType(fileName)
  });

export const trackAiQuestionAsked = plan =>
  trackAnalyticsEvent("ai_question_asked", {
    plan: normalizeAnalyticsPlan(plan)
  });

export const trackBeginCheckout = () => trackAnalyticsEvent("begin_checkout", {
  currency: "GBP",
  value: 15,
  plan: "pro"
});

// Never emit `purchase` from browser code. A future purchase event must come
// only from the trusted Stripe webhook after payment has been confirmed.
