import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_CONSENT_ACCEPTED,
  ANALYTICS_CONSENT_ESSENTIAL,
  ANALYTICS_CONSENT_STORAGE_KEY,
  analyticsConsentGranted,
  onAnalyticsConsentChange,
  prepareFirebaseAnalyticsConsent,
  readAnalyticsConsent,
  saveAnalyticsConsent
} from "../assets/analytics-consent.js";
import { createAnalyticsTracker } from "../assets/analytics-event-policy.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function storage(initial = {}){
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  };
}

function runtime(choice = null){
  const listeners = new Map();
  const localStorage = storage(choice ? {
    [ANALYTICS_CONSENT_STORAGE_KEY]: choice
  } : {});

  return {
    CustomEvent: class {
      constructor(type, options){
        this.type = type;
        this.detail = options.detail;
      }
    },
    addEventListener(type, listener){
      listeners.set(type, listener);
    },
    removeEventListener(type){
      listeners.delete(type);
    },
    dispatchEvent(event){
      listeners.get(event.type)?.(event);
    },
    localStorage,
    location: { hostname: "simple-books.co.uk" },
    sessionStorage: { getItem: () => null }
  };
}

describe("Firebase Analytics consent policy", () => {
  it("disables measurement and event dispatch before a decision", async () => {
    const browser = runtime();
    expect(prepareFirebaseAnalyticsConsent(browser, "G-TEST")).toBeNull();
    expect(browser["ga-disable-G-TEST"]).toBe(true);

    const logEvent = vi.fn();
    const track = createAnalyticsTracker({
      analytics: {},
      logEvent,
      runtime: browser,
      consentGranted: () => analyticsConsentGranted(browser)
    });
    await expect(track("login", { method: "email" })).resolves.toBe(false);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("accepting enables collection and persists across page runtimes", async () => {
    const browser = runtime();
    expect(saveAnalyticsConsent(browser, ANALYTICS_CONSENT_ACCEPTED)).toBe(true);
    expect(readAnalyticsConsent(browser.localStorage)).toBe(ANALYTICS_CONSENT_ACCEPTED);
    expect(analyticsConsentGranted(browser)).toBe(true);

    const nextPage = runtime(ANALYTICS_CONSENT_ACCEPTED);
    expect(prepareFirebaseAnalyticsConsent(nextPage, "G-TEST")).toBe(ANALYTICS_CONSENT_ACCEPTED);
    expect(nextPage["ga-disable-G-TEST"]).toBe(false);

    const logEvent = vi.fn();
    const track = createAnalyticsTracker({
      analytics: {}, logEvent, runtime: nextPage,
      consentGranted: () => analyticsConsentGranted(nextPage)
    });
    await expect(track("login", { method: "email" })).resolves.toBe(true);
    expect(logEvent).toHaveBeenCalledOnce();
  });

  it("essential-only persists and keeps collection disabled", () => {
    const browser = runtime();
    saveAnalyticsConsent(browser, ANALYTICS_CONSENT_ESSENTIAL);
    expect(readAnalyticsConsent(browser.localStorage)).toBe(ANALYTICS_CONSENT_ESSENTIAL);
    expect(analyticsConsentGranted(browser)).toBe(false);

    const nextPage = runtime(ANALYTICS_CONSENT_ESSENTIAL);
    expect(prepareFirebaseAnalyticsConsent(nextPage, "G-TEST")).toBe(ANALYTICS_CONSENT_ESSENTIAL);
    expect(nextPage["ga-disable-G-TEST"]).toBe(true);
  });

  it("withdrawal notifies Firebase to disable future collection", () => {
    const browser = runtime(ANALYTICS_CONSENT_ACCEPTED);
    const setCollectionEnabled = vi.fn();
    onAnalyticsConsentChange(browser, choice => {
      browser["ga-disable-G-TEST"] = choice !== ANALYTICS_CONSENT_ACCEPTED;
      setCollectionEnabled(choice === ANALYTICS_CONSENT_ACCEPTED);
    });

    saveAnalyticsConsent(browser, ANALYTICS_CONSENT_ESSENTIAL);
    expect(browser["ga-disable-G-TEST"]).toBe(true);
    expect(setCollectionEnabled).toHaveBeenCalledWith(false);
    expect(analyticsConsentGranted(browser)).toBe(false);
  });
});

describe("Consent integration boundaries", () => {
  const firebaseConfig = read("firebase-config.js");
  const consentRuntime = read("assets/analytics-consent.js");
  const activityLogger = read("assets/activity-logger.js");
  const demoAnalytics = read("assets/demo-analytics.js");
  const founderAnalytics = read("functions/lib/founder-analytics.js");
  const customerAnalytics = read("functions/lib/admin-customer-analytics.js");
  const sentry = read("assets/sentry-monitoring.js");
  const manifest = JSON.parse(read("hosting-runtime-files.json"));

  it("keeps essential Firebase services independent of Analytics consent", () => {
    for(const service of ["getAuth(app)", "getFirestore(app)", "getFunctions(app", "getStorage(app)"]){
      expect(firebaseConfig).toContain(service);
    }
    expect(firebaseConfig.indexOf("const auth = getAuth(app)")).toBeGreaterThan(
      firebaseConfig.indexOf("if(typeof window !== \"undefined\" && !analyticsHostIsLocal)")
    );
    expect(firebaseConfig).toContain("setAnalyticsCollectionEnabled");
    expect(firebaseConfig).toContain("prepareFirebaseAnalyticsConsent");
  });

  it("does not gate or remove operational Founder, Customer, or Demo analytics", () => {
    expect(activityLogger).toContain('httpsCallable(functions, "logActivityEvent")');
    expect(demoAnalytics).toContain('DEMO_ANALYTICS_COLLECTION = "demoAnalyticsEvents"');
    expect(founderAnalytics).toContain("buildFounderAnalytics");
    expect(customerAnalytics).toContain("aggregateCustomerAnalytics");
    for(const source of [activityLogger, demoAnalytics, founderAnalytics, customerAnalytics]){
      expect(source).not.toContain("analytics-consent");
    }
  });

  it("keeps privacy-conscious Sentry independent and intact", () => {
    expect(sentry).toContain("window.Sentry.init");
    expect(sentry).toContain("sendDefaultPii: false");
    expect(sentry).toContain("beforeSend: sanitiseEvent");
    expect(sentry).not.toContain("analytics-consent");
  });

  it("publishes the shared runtime through the reviewed Hosting allowlist", () => {
    expect(manifest.files).toContain("assets/analytics-consent.js");
    expect(manifest.files).toContain("assets/analytics-consent.css");
    expect(consentRuntime).toContain('stylesheet.href = "/assets/analytics-consent.css');
    expect(read("assets/app-shell.js")).toContain('import "./analytics-consent.js');
    expect(read("assets/guides/public-shell.js")).toContain('import "../analytics-consent.js');
    for(const page of [
      "index.html", "about.html", "faq.html", "features.html", "pricing.html",
      "security.html", "whats-new.html", "login.html", "signup.html"
    ]){
      expect(read(page)).toContain('src="/assets/analytics-consent.js');
    }
  });

  it("provides an accessible, neutral, site-wide choice control", () => {
    expect(consentRuntime).toContain('setAttribute("aria-labelledby"');
    expect(consentRuntime).toContain('setAttribute("aria-controls"');
    expect(consentRuntime).toContain('setAttribute("aria-expanded"');
    expect(consentRuntime).toContain('event.key === "Escape"');
    expect(consentRuntime).toContain(">Accept analytics</button>");
    expect(consentRuntime).toContain(">Essential only</button>");
    expect(consentRuntime).toContain('href="/privacy.html#storage"');
    expect(consentRuntime).toContain('choicesButton.textContent = "Privacy choices"');
    expect(read("assets/analytics-consent.css")).toContain("grid-template-columns: 1fr 1fr");
  });

  it("keeps checkout disabled in both browser and deployed Functions configuration", () => {
    expect(read("account.html")).toContain("const ACCOUNT_CHECKOUT_ENABLED = false;");
    expect(read("functions/.env.simple-books-office")).toMatch(/^STRIPE_CHECKOUT_ENABLED=false$/m);
  });
});
