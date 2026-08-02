import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ALLOWED_ANALYTICS_EVENTS,
  analyticsRuntimeDisabled,
  createAnalyticsTracker,
  invoiceItemCountBucket,
  normalizeAnalyticsFileType,
  normalizeAnalyticsPlan,
  sanitizeAnalyticsParameters
} from "../assets/analytics-event-policy.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const adapter = read("assets/analytics-events.js");
const firebaseConfig = read("firebase-config.js");
const signup = read("signup.html");
const login = read("login.html");
const account = read("account.html");
const invoices = read("resources/tools/invoice-generator.html");
const bills = read("resources/tools/bills.html");
const expenses = read("resources/tools/expenses.html");
const assistant = read("resources/tools/ai-assistant.html");

function runtime(hostname = "simple-books.co.uk", emulator = false){
  return {
    location: { hostname },
    sessionStorage: { getItem: () => emulator ? "true" : null }
  };
}

describe("Analytics event privacy policy", () => {
  it("allows only the six Phase 1 events and never purchase", () => {
    expect(ALLOWED_ANALYTICS_EVENTS).toEqual([
      "sign_up",
      "login",
      "invoice_created",
      "invoice_scanned",
      "ai_question_asked",
      "begin_checkout"
    ]);
    expect(sanitizeAnalyticsParameters("purchase", { value: 15 })).toBeNull();
  });

  it("removes unknown parameters and rejects arbitrary or structured values", () => {
    expect(sanitizeAnalyticsParameters("invoice_created", {
      plan: "pro",
      has_vat: true,
      item_count_bucket: "2-3",
      email: "private@example.test",
      uid: "private-uid",
      customer: { name: "Private Customer" },
      amount: 999
    })).toEqual({ plan: "pro", has_vat: true, item_count_bucket: "2-3" });
    expect(sanitizeAnalyticsParameters("ai_question_asked", {
      plan: "arbitrary user value",
      prompt: "private question"
    })).toEqual({});
  });

  it.each([
    ["Pro", "pro"],
    ["pro", "pro"],
    ["Starter", "starter"],
    ["enterprise", "starter"],
    [{ currentPlan: "Pro" }, "starter"]
  ])("normalizes plan %j to %s", (value, expected) => {
    expect(normalizeAnalyticsPlan(value)).toBe(expected);
  });

  it.each([
    [1, "1"], [2, "2-3"], [3, "2-3"], [4, "4+"], [99, "4+"], [0, "1"], ["bad", "1"]
  ])("buckets item count %j as %s", (value, expected) => {
    expect(invoiceItemCountBucket(value)).toBe(expected);
  });

  it.each([
    ["invoice.pdf", "pdf"],
    ["PRIVATE CUSTOMER.JPG", "jpg"],
    ["scan.jpeg", "jpeg"],
    ["receipt.png?token=private", "png"],
    ["supplier-name.webp", "other"],
    ["document text", "other"]
  ])("reduces file input to a non-identifying type", (value, expected) => {
    expect(normalizeAnalyticsFileType(value)).toBe(expected);
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("disables Analytics on %s", hostname => {
    expect(analyticsRuntimeDisabled(runtime(hostname))).toBe(true);
  });

  it("disables emulator sessions and permits production hosting", () => {
    expect(analyticsRuntimeDisabled(runtime("simple-books.co.uk", true))).toBe(true);
    expect(analyticsRuntimeDisabled(runtime("simple-books.co.uk"))).toBe(false);
    expect(analyticsRuntimeDisabled(runtime("simple-books-office.web.app"))).toBe(false);
    expect(firebaseConfig).toContain("!analyticsHostIsLocal");
    expect(firebaseConfig).toContain("analytics = null");
  });

  it("swallows Analytics failures without breaking the successful action", async () => {
    const logEvent = vi.fn(() => { throw new Error("extension blocked analytics"); });
    const warn = vi.fn();
    const track = createAnalyticsTracker({ analytics: {}, logEvent, runtime: runtime(), warn });
    let actionCompleted = false;
    const actionResult = await (async () => {
      actionCompleted = true;
      await track("login", { method: "email" });
      return "success";
    })();
    expect(actionCompleted).toBe(true);
    expect(actionResult).toBe("success");
    expect(warn).toHaveBeenCalledWith("Analytics event unavailable: login");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("extension blocked analytics");
  });

  it("no-ops safely when parameter or runtime inspection is blocked", async () => {
    const logEvent = vi.fn();
    const blockedParameters = Object.defineProperty({}, "method", {
      get(){ throw new Error("blocked value"); }
    });
    const blockedRuntime = Object.defineProperty({}, "location", {
      get(){ throw new Error("blocked runtime"); }
    });
    const trackParameters = createAnalyticsTracker({ analytics: {}, logEvent, runtime: runtime() });
    const trackRuntime = createAnalyticsTracker({ analytics: {}, logEvent, runtime: blockedRuntime });
    await expect(trackParameters("login", blockedParameters)).resolves.toBe(false);
    await expect(trackRuntime("login", { method: "email" })).resolves.toBe(false);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("does not emit locally and deduplicates rapid identical events", async () => {
    const localLog = vi.fn();
    const localTrack = createAnalyticsTracker({ analytics: {}, logEvent: localLog, runtime: runtime("localhost") });
    expect(await localTrack("login", { method: "email" })).toBe(false);
    expect(localLog).not.toHaveBeenCalled();

    let timestamp = 100;
    const logEvent = vi.fn();
    const track = createAnalyticsTracker({ analytics: {}, logEvent, runtime: runtime(), now: () => timestamp });
    expect(await track("login", { method: "email" })).toBe(true);
    expect(await track("login", { method: "email" })).toBe(false);
    timestamp += 1001;
    expect(await track("login", { method: "email" })).toBe(true);
    expect(logEvent).toHaveBeenCalledTimes(2);
  });

  it("dispatches invoice_created through Firebase with the shared instance and sanitized parameters", async () => {
    const analytics = { instance: "shared-firebase-analytics" };
    const logEvent = vi.fn();
    const track = createAnalyticsTracker({ analytics, logEvent, runtime: runtime() });
    const parameters = {
      plan: "pro",
      has_vat: true,
      item_count_bucket: "2-3",
      customer: "must-not-send"
    };

    await expect(track("invoice_created", parameters)).resolves.toBe(true);
    const sanitizedParameters = {
      plan: "pro",
      has_vat: true,
      item_count_bucket: "2-3"
    };
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      analytics,
      "invoice_created",
      sanitizedParameters
    );
  });

  it("reports the full Firebase error when invoice_created dispatch fails", async () => {
    const dispatchError = new Error("Firebase Analytics dispatch failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const track = createAnalyticsTracker({
      analytics: {},
      logEvent: () => { throw dispatchError; },
      runtime: runtime()
    });
    await expect(track("invoice_created", {
      plan: "starter",
      has_vat: false,
      item_count_bucket: "1"
    })).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      "invoice_created logEvent failed",
      dispatchError
    );
    consoleError.mockRestore();
  });

  it("sends only approved values for every event wrapper", () => {
    expect(adapter).toContain('trackAnalyticsEvent("sign_up", { method: "email" })');
    expect(adapter).toContain('trackAnalyticsEvent("login", { method: "email" })');
    expect(adapter).toContain('trackAnalyticsEvent("invoice_created"');
    expect(adapter).toContain('trackAnalyticsEvent("invoice_scanned"');
    expect(adapter).toContain('trackAnalyticsEvent("ai_question_asked"');
    expect(adapter).toContain('trackAnalyticsEvent("begin_checkout"');
    expect(adapter).toContain('currency: "GBP"');
    expect(adapter).toContain("value: 15");
    expect(adapter).not.toMatch(/trackAnalyticsEvent\(["']purchase["']/);
    expect(adapter).toContain("createAnalyticsTracker({\n  analytics,\n  logEvent,");
  });
});

describe("Analytics success trigger integration", () => {
  it("tracks sign-up only after account creation succeeds", () => {
    expect(signup.indexOf("await createUserWithEmailAndPassword"))
      .toBeLessThan(signup.indexOf("await trackSignUp()"));
    expect(signup.indexOf("await trackSignUp()"))
      .toBeLessThan(signup.indexOf("}catch(error)"));
    expect(signup.match(/await trackSignUp\(\)/g)).toHaveLength(1);
  });

  it("tracks both successful email/password login paths and no failure path", () => {
    expect(login.match(/await trackLogin\(\)/g)).toHaveLength(2);
    const catchBlocks = [...login.matchAll(/catch\(error\)\{([\s\S]*?)(?=\n\s*\})/g)];
    expect(catchBlocks.every(match => !match[1].includes("trackLogin"))).toBe(true);
  });

  it("tracks only a newly saved invoice, never invoice editing", () => {
    const createCall = invoices.indexOf("await window.trackInvoiceCreated({");
    expect(createCall).toBeGreaterThan(invoices.indexOf("if(!invoiceSaved)"));
    expect(createCall).toBeGreaterThan(invoices.indexOf("await saveInvoiceToHistory"));
    expect(invoices).toContain("window.trackInvoiceCreated = async function(parameters)");
    expect(invoices).toContain("window.invoiceAnalyticsPlan = () =>");
    expect(invoices).toContain('doc(db, "userProfiles", user.uid)');
    expect(invoices).toContain('typeof window.invoiceAnalyticsPlan === "function"');
    expect(invoices).not.toContain("invoiceAnalyticsPlanPromise");
    expect(invoices).toContain("analyticsEvents.trackInvoiceCreated(parameters)");
    expect(invoices).toContain('console.error("invoice_created wrapper failed", analyticsError)');
    expect(invoices).toContain('console.error("invoice_created call failed", analyticsError)');
    expect(invoices).not.toMatch(/console\.log\("(?:invoice save succeeded|invoice_created wrapper called|analytics module imported|invoice_created fired)"\)/);
    expect(read("assets/analytics-event-policy.js")).not.toMatch(
      /console\.log\("(?:logEvent called|invoice_created dispatched to Firebase Analytics)"/
    );
    expect(invoices).toContain("Analytics must never interrupt a completed invoice save.");
    const editStart = invoices.indexOf("async function updateExistingInvoice");
    const editEnd = invoices.indexOf("function cancelInvoiceEdit", editStart);
    expect(editStart).toBeGreaterThan(-1);
    expect(invoices.slice(editStart, editEnd)).not.toContain("trackInvoiceCreated");
  });

  it("exports and imports the exact invoice-created tracker name", () => {
    expect(adapter).toMatch(/export const trackInvoiceCreated\s*=/);
    expect(invoices).toContain(
      '"/assets/analytics-events.js?v=20260802-analytics2"'
    );
    expect(invoices).toContain('typeof analyticsEvents.trackInvoiceCreated !== "function"');
  });

  it.each([
    [bills, "scanBillDocument", "trackInvoiceScanned", "renderBillScanResults"],
    [expenses, "scanReceiptDocument", "trackInvoiceScanned", "renderReceiptScanResults"]
  ])("tracks a scan only after a successful callable response", (source, callable, tracker, renderer) => {
    const response = source.indexOf(`await ${callable}({`);
    const validExtraction = source.indexOf("if (!extraction || typeof extraction !== \"object\")", response);
    const track = source.indexOf(`await ${tracker}({`, response);
    expect(response).toBeGreaterThan(-1);
    expect(validExtraction).toBeGreaterThan(response);
    expect(track).toBeGreaterThan(validExtraction);
    expect(track).toBeLessThan(source.indexOf(`${renderer}(extraction)`, track));
  });

  it("tracks only successful counted AI mode responses", () => {
    const successCondition = assistant.indexOf('if(result.data?.mode === "ai" && currentUsageUser)');
    const track = assistant.indexOf("await trackAiQuestionAsked(currentAnalyticsPlan)", successCondition);
    expect(track).toBeGreaterThan(successCondition);
    expect(track).toBeLessThan(assistant.indexOf("}catch(error)", track));
    expect(assistant.match(/trackAiQuestionAsked\(/g)).toHaveLength(1);
  });

  it("tracks checkout after a valid URL and Starter check but before redirect", () => {
    const urlCheck = account.indexOf("if(!session.url)");
    const starterCheck = account.indexOf('normalizePlan(billingProfile.currentPlan) === "Starter"', urlCheck);
    const track = account.indexOf("await trackBeginCheckout()", starterCheck);
    const redirect = account.indexOf("window.location.href = session.url", track);
    expect(urlCheck).toBeGreaterThan(-1);
    expect(starterCheck).toBeGreaterThan(urlCheck);
    expect(track).toBeGreaterThan(starterCheck);
    expect(redirect).toBeGreaterThan(track);
  });

  it("never sends private source values or emits purchase in frontend code", () => {
    const policyPayload = JSON.stringify({
      event: "invoice_scanned",
      parameters: sanitizeAnalyticsParameters("invoice_scanned", {
        plan: normalizeAnalyticsPlan("Pro"),
        file_type: normalizeAnalyticsFileType("customer-supplier-private.pdf"),
        email: "private@example.test",
        uid: "uid-private",
        customer: "Private Customer",
        prompt: "Private prompt",
        stripeSessionId: "cs_private"
      })
    });
    expect(policyPayload).toBe('{"event":"invoice_scanned","parameters":{"plan":"pro","file_type":"pdf"}}');
    for(const source of [signup, login, account, invoices, bills, expenses, assistant, adapter]){
      expect(source).not.toMatch(/trackAnalyticsEvent\(["']purchase["']/);
    }
  });
});
