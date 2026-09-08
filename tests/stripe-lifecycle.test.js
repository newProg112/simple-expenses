import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import { fixture, UID, configuration, pageFunctions, requestHandler } from "./helpers/billing-lifecycle-fixture.js";
import { effectiveBillingPlan as clientPlan } from "../resources/js/plan-entitlements.js";
import { getFinancialReportAccess } from "../resources/js/financial-report-access.js";
import { getAccountantPackAccess } from "../resources/js/accountant-pack-access.js";
import { canSaveProjectStatus, canUseAnotherActiveProject, PROJECT_STATUS } from "../resources/js/project-access.js";
import { buildCanonicalExportWorkbook } from "../resources/js/canonical-workbook-export.js";
import { createJsonBackupV2 } from "../resources/js/json-backup-schema.js";
const require = createRequire(import.meta.url);
const { effectiveBillingPlan } = require("../functions/lib/plan-entitlements.js");
const { readMonthlyUsage } = require("../functions/lib/monthly-usage-reader.js");
const { createStripePortalService } = require("../functions/lib/stripe-portal-service.js");
const { createSubscriptionProjectionReader } = require("../functions/lib/stripe-webhook-processor.js");
const { STRIPE_PROFILE_PROJECTION_VERSION } = require("../functions/lib/stripe-profile-writer.js");
const {createStripeWebhookProcessor} = require("../functions/lib/stripe-webhook-processor.js");

describe("canonical subscription lifecycle", () => {
  it.each([
    ["active", "Pro"], ["trialing", "Pro"], ["past_due", "Pro"],
    ["incomplete", "Starter"], ["unpaid", "Starter"], ["paused", "Starter"],
    ["incomplete_expired", "Starter"], ["canceled", "Starter"], ["unknown", "Starter"]
  ])("projects %s through processor, writer and both entitlement paths", async (status, plan) => {
    const f = fixture();
    await f.process(f.event());
    f.change({status});
    await f.process(f.event());
    expect(f.profile()).toMatchObject({currentPlan: plan, subscriptionStatus: status === "unknown" ? "" : status});
    expect(effectiveBillingPlan(f.profile(), false, configuration)).toBe(plan);
    expect(clientPlan(f.profile(), false, configuration)).toBe(plan);
  });

  it("retains Pro until scheduled cancellation becomes canonical cancellation", async () => {
    const f = fixture();
    f.change({cancel_at_period_end: true, current_period_end: 2000000000});
    await f.process(f.event());
    expect(f.profile()).toMatchObject({currentPlan: "Pro", cancelAtPeriodEnd: true, subscriptionCurrentPeriodEnd: 2000000000});
    f.change({status: "canceled"});
    await f.process(f.event("customer.subscription.deleted"));
    expect(f.profile()).toMatchObject({currentPlan: "Starter", subscriptionStatus: "canceled"});
  });

  it("keeps both monthly counters unchanged through failure, downgrade and recovery", async () => {
    const f = fixture();
    const path = `userProfiles/${UID}/usage/2026-09`;
    const usage = {aiAssistantSuccessfulUses: 30, invoiceScanningSuccessfulUses: 45};
    f.db.put(path, usage);
    for(const [status, limit] of [["active", 500], ["past_due", 500], ["unpaid", 10], ["active", 500]]) {
      f.change({status});
      await f.process(f.event());
      expect(f.db.read(path)).toEqual(usage);
      expect(await readMonthlyUsage(f.db, UID, new Date("2026-09-08"), configuration)).toMatchObject({
        ...usage, aiAssistantAllowance: limit, invoiceScanningAllowance: limit,
        aiAssistantRemaining: Math.max(0, limit - 30), invoiceScanningRemaining: Math.max(0, limit - 45)
      });
    }
  });

  it.each(["invoice.payment_failed", "invoice.paid", "invoice.payment_succeeded"])(
    "%s uses canonical status even when invoice fields disagree", async type => {
      const f = fixture();
      for(const status of ["past_due", "unpaid", "active"]) {
        f.change({status});
        const invoice = {...f.invoice(), paid: status !== "active", metadata: {firebaseUid: "untrusted"}};
        await f.process(f.event(type, invoice));
        expect(f.profile()).toMatchObject({subscriptionStatus: status, currentPlan: status === "unpaid" ? "Starter" : "Pro"});
      }
    }
  );

  it("accepts legacy invoice subscription references", async () => {
    const f = fixture();
    const invoice = {...f.invoice(), parent: null, subscription: {id: "sub_owned"}};
    await f.process(f.event("invoice.paid", invoice));
    expect(f.profile().currentPlan).toBe("Pro");
  });

  it.each([null, "", "sub_bad/path", 17, {}, {id: "sub_owned", deleted: true}])(
    "acknowledges invalid invoice subscription reference %j without an API read", async reference => {
      const f = fixture();
      const invoice = {...f.invoice(), parent: null, subscription: reference};
      expect(await f.process(f.event("invoice.paid", invoice))).toMatchObject({handled: false});
      expect(f.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
      expect(f.db.writes).toEqual([]);
    }
  );

  it("ignores conflicting parent/legacy references and deleted invoices", async () => {
    const f = fixture();
    for(const invoice of [{...f.invoice(), subscription: "sub_other"}, {...f.invoice(), deleted: true}]) {
      expect(await f.process(f.event("invoice.paid", invoice))).toMatchObject({handled: false});
    }
    expect(f.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it.each(["missing", "deleted"])("acknowledges a %s invoice subscription without changing an existing plan", async kind => {
    const f = fixture(); await f.process(f.event()); const before = f.profile();
    if(kind === "missing") f.stripe.subscriptions.retrieve.mockRejectedValue({type: "StripeInvalidRequestError", code: "resource_missing"});
    else f.stripe.subscriptions.retrieve.mockResolvedValue({deleted: true});
    expect(await f.process(f.event("invoice.paid", f.invoice()))).toMatchObject({reason: "missing-invoice-subscription"});
    expect(f.profile()).toEqual(before);
  });

  it.each(["timeout", "deleted-customer", "invalid-uid"])("leaves %s retryable without any receipt or profile write", async failure => {
    const f = fixture();
    if(failure === "timeout") f.stripe.subscriptions.retrieve.mockRejectedValue(new Error("timeout"));
    if(failure === "deleted-customer") f.stripe.customers.retrieve.mockResolvedValue({deleted: true});
    if(failure === "invalid-uid") f.change({metadata: {firebaseUid: "bad/uid"}});
    await expect(f.process(f.event("invoice.paid", f.invoice()))).rejects.toThrow();
    expect(f.db.writes).toEqual([]);
  });

  it.each([0, undefined, null, "1", 2, -1])("past_due cannot retain Pro with quantity %j", async quantity => {
    const f = fixture(); await f.process(f.event());
    f.change({status: "past_due", items: {data: [{price: {id: configuration.proPriceId}, quantity}]}});
    await f.process(f.event());
    expect(f.profile().currentPlan).toBe("Starter");
  });

  it("acknowledges irrelevant events and one-off/unowned invoices without writes", async () => {
    const f = fixture();
    expect(await f.process(f.event("invoice.created", f.invoice()))).toMatchObject({handled: false});
    expect(await f.process(f.event("invoice.paid", {...f.invoice(), parent: null}))).toMatchObject({reason: "non-subscription-invoice"});
    f.change({metadata: {}});
    expect(await f.process(f.event("invoice.paid", f.invoice()))).toMatchObject({reason: "unowned-subscription-invoice"});
    expect(f.db.writes).toEqual([]);
  });

  it.each(["invoice-mode", "subscription-mode", "customer", "uid", "customer-mode"])(
    "rejects invoice %s mismatch without projection", async mismatch => {
      const f = fixture();
      const invoice = f.invoice();
      if(mismatch === "invoice-mode") invoice.livemode = false;
      if(mismatch === "subscription-mode") f.change({livemode: false});
      if(mismatch === "customer") invoice.customer = "cus_other";
      if(mismatch === "uid") f.stripe.customers.retrieve.mockResolvedValue({livemode: true, metadata: {firebaseUid: "other"}});
      if(mismatch === "customer-mode") f.stripe.customers.retrieve.mockResolvedValue({livemode: false, metadata: {firebaseUid: UID}});
      await expect(f.process(f.event("invoice.paid", invoice))).rejects.toThrow();
      expect(f.db.writes).toEqual([]);
    }
  );

  it("rechecks invoice ownership after discovery and rejects a changed UID", async () => {
    const f = fixture();
    const sub = f.canonical();
    f.stripe.subscriptions.retrieve.mockResolvedValueOnce(sub)
      .mockResolvedValue({...sub, metadata: {firebaseUid: "other"}});
    await expect(f.process(f.event("invoice.paid", f.invoice()))).rejects.toThrow();
    expect(f.db.writes).toEqual([]);
  });

  it.each([{price: {id: "price_other"}, quantity: 1}, {price: {id: configuration.proPriceId}, quantity: 2}])(
    "invoice reconciliation cannot retain Pro with nonqualifying items %j", async item => {
      const f = fixture();
      await f.process(f.event());
      f.change({items: {data: [item]}});
      await f.process(f.event("invoice.paid", f.invoice()));
      expect(f.profile().currentPlan).toBe("Starter");
    }
  );

  it.each([true, "true", false])("does not elevate Starter with override %j", async billingOverride => {
    const f = fixture({currentPlan: "Starter", billingOverride});
    f.change({status: "unpaid"});
    await f.process(f.event());
    expect(f.profile()).toMatchObject({currentPlan: "Starter", billingOverride: false});
    f.change({status: "active"});
    await f.process(f.event());
    f.change({status: "canceled"});
    await f.process(f.event());
    expect(f.profile().currentPlan).toBe("Starter");
  });

  it("preserves an intentional Pro override and excludes Demo/deleting accounts", async () => {
    const f = fixture({currentPlan: "Pro", billingOverride: true});
    f.change({status: "canceled"});
    await f.process(f.event());
    expect(f.profile()).toMatchObject({currentPlan: "Pro", billingOverride: true});
    for(const account of [{demoMode: true}, {deletionInProgress: true}]) {
      f.db.put(`users/${UID}`, account);
      const before = f.profile();
      expect((await f.process(f.event())).profileUpdate.updated).toBe(false);
      expect(f.profile()).toEqual(before);
    }
  });

  it("suppresses duplicate events and reprojects a legacy receipt once", async () => {
    const f = fixture();
    const event = f.event();
    f.db.put(`stripeWebhookEvents/${event.id}`, {profileProjectionVersion: 1});
    const results = await Promise.all([f.process(event), f.process(event)]);
    expect(results.filter(r => r.profileUpdate.updated)).toHaveLength(1);
    expect(f.db.read(`stripeWebhookEvents/${event.id}`).profileProjectionVersion).toBe(STRIPE_PROFILE_PROJECTION_VERSION);
    expect((await f.process(event)).profileUpdate.reason).toBe("duplicate-event");
  });

  it.each([200, 100, 300])("reretrieves canonical state after a conflicting event (created=%i)", async created => {
    const f = fixture();
    let release, entered;
    const waiting = new Promise(resolve => {entered = resolve;});
    const gate = new Promise(resolve => {release = resolve;});
    let reads = 0;
    f.stripe.subscriptions.retrieve.mockImplementation(async () => {
      const snapshot = f.canonical();
      if(++reads === 1) { entered(); await gate; }
      return snapshot;
    });
    const older = f.process(f.event("customer.subscription.updated", f.canonical(), created));
    await waiting;
    f.change({status: "unpaid"});
    await f.process(f.event("customer.subscription.updated", f.canonical(), 200));
    release();
    await older;
    expect(reads).toBe(3); // Old read, competing update, fresh read after failed CAS.
    expect(f.profile().stripeProjectionRevision).toBe(2);
    expect(f.profile()).toMatchObject({currentPlan: "Starter", subscriptionStatus: "unpaid"});
  });

  it("does not multiply API reads during Firestore callback retries", async () => {
    const f = fixture();
    f.db.forceWriteRetry = 2;
    f.stripe.subscriptions.retrieve.mockImplementation(async (_id, _params, options) => {
      expect(f.db.activeTransactions).toBe(0);
      expect(options).toEqual({timeout: 3000, maxNetworkRetries: 0});
      return f.canonical();
    });
    await f.process(f.event());
    expect(f.db.retries).toBe(2);
    expect(f.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(1);
    expect(f.stripe.customers.retrieve).toHaveBeenCalledTimes(1);
    expect(f.profile().stripeProjectionRevision).toBe(1);
  });

  it("stops after three CAS conflicts and leaves delivery retryable", async () => {
    const f = fixture();
    f.stripe.subscriptions.retrieve.mockImplementation(async () => {
      f.db.put(`userProfiles/${UID}`, {...f.profile(), stripeProjectionRevision: (f.profile().stripeProjectionRevision || 0) + 1});
      return f.canonical();
    });
    const event = f.event();
    await expect(f.process(event)).rejects.toThrow("contention");
    expect(f.stripe.subscriptions.retrieve).toHaveBeenCalledTimes(3);
    expect(f.db.read(`stripeWebhookEvents/${event.id}`)).toBeUndefined();
    expect(f.db.writes).toEqual([]);
  });

  it("keeps a failed transaction retryable and re-reads canonical state on redelivery", async () => {
    const f = fixture(); const event = f.event(); f.db.forceWriteRetry = 3;
    await expect(f.process(event)).rejects.toThrow("retries exhausted");
    expect(f.db.read(`stripeWebhookEvents/${event.id}`)).toBeUndefined();
    f.change({status: "unpaid"}); await f.process(event);
    expect(f.profile().subscriptionStatus).toBe("unpaid");
  });

  it("an old event arriving after recovery reads active, not its stale unpaid payload", async () => {
    const f = fixture();
    f.change({status: "unpaid"});
    const old = f.event();
    await f.process(old);
    f.change({status: "active"});
    await f.process(f.event());
    old.id = "evt_latedifferent";
    await f.process(old);
    expect(f.profile().currentPlan).toBe("Pro");
  });

  it("leaves equal-timestamp different subscriptions retryable instead of guessing", async () => {
    const f = fixture();
    await f.process(f.event());
    f.change({id: "sub_other", status: "canceled"});
    await expect(f.process(f.event())).rejects.toThrow("Ambiguous");
    expect(f.profile().stripeSubscriptionId).toBe("sub_owned");
  });

  it("does not replace Pro with an invoice for an unrelated product", async () => {
    const f = fixture();
    await f.process(f.event());
    const before = f.profile();
    f.change({id: "sub_unrelated", created: 300, items: {data: [{price: {id: "price_unrelated"}}]}});
    const invoice = {...f.invoice(), parent: null, subscription: "sub_unrelated"};
    expect((await f.process(f.event("invoice.paid", invoice))).profileUpdate.reason).toBe("irrelevant-invoice");
    expect(f.profile()).toEqual(before);
  });

  it.each([0, undefined])("does not guess a replacement when stored creation time is %j", async created => {
    const f = fixture({stripeSubscriptionId: "sub_other", stripeSubscriptionCreated: created});
    await expect(f.process(f.event())).rejects.toThrow("Ambiguous");
    expect(f.profile().stripeSubscriptionId).toBe("sub_other");
  });

  it("repairs a missed cancellation when billing management is requested, without opening a terminal session", async () => {
    const f = fixture();
    await f.process(f.event());
    f.change({status: "canceled"});
    const portal = createStripePortalService({
      stripe: f.stripe, billingConfiguration: configuration,
      reconcileSubscription: async (uid, subscription) => {
        const read = createSubscriptionProjectionReader({stripe: f.stripe, billingConfiguration: configuration,
          billingDetails: f.billingDetails, uid, subscriptionId: subscription.id, customerId: subscription.customer});
        await f.writer(uid, {}, {refreshData: async () => (await read()).data});
      }
    });
    await expect(portal({uid: UID, profile: f.profile(), returnUrl: "https://example.test"})).rejects.toMatchObject({code: "portal-unavailable"});
    expect(f.profile()).toMatchObject({currentPlan: "Starter", subscriptionStatus: "canceled"});
    expect(f.stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

describe("downgrade preservation and project capacity", () => {
  it("preserves records/attachment references and produces standard exports while Pro outputs lock", async () => {
    const f = fixture();
    const source = {
      invoices: [{id: "invoice1", invoiceNo: "INV-1", client: "Customer", status: "Unpaid", items: [{description: "Work", amount: 50}]}],
      bills: [{id: "bill1", billNumber: "B-1", supplier: "Supplier", status: "Unpaid",
        attachmentPath: `users/${UID}/attachments/bills/bill1/file.pdf`, total: 20}],
      projects: Array.from({length: 6}, (_, i) => ({id: `project${i}`, name: `Project ${i}`, reference: `P-${i}`, status: "Active"}))
    };
    for(const [name, records] of Object.entries(source)) {
      for(const record of records) f.db.put(`users/${UID}/${name}/${record.id}`, record);
    }
    const originals = [...f.db.documents].filter(([path]) => path.startsWith("users/"));
    await f.process(f.event());
    expect(getAccountantPackAccess(f.profile()).allowed).toBe(true);
    f.change({status: "unpaid"});
    await f.process(f.event());
    expect(f.profile().currentPlan).toBe("Starter");
    for(const [path, record] of originals) expect(f.db.read(path)).toEqual(record);
    expect(f.db.writes.every(path => path.startsWith("userProfiles/") || path.startsWith("stripeWebhookEvents/"))).toBe(true);
    for(const id of ["trialBalance", "generalLedger", "profitLoss", "balanceSheet"])
      expect(getFinancialReportAccess(f.profile(), id).allowed).toBe(false);
    expect(getAccountantPackAccess(f.profile()).allowed).toBe(false);
    expect(canSaveProjectStatus({profile: f.profile(), projects: source.projects,
      projectId: "project0", nextStatus: "Active"})).toBe(true);

    // Export the records read back after projection, not the original fixture.
    const preserved = Object.fromEntries(Object.entries(source).map(([name, records]) =>
      [name, records.map(record => f.db.read(`users/${UID}/${name}/${record.id}`))]));
    const {workbook} = buildCanonicalExportWorkbook(XLSX, preserved);
    const exported = XLSX.read(XLSX.write(workbook, {type: "buffer", bookType: "xlsx"}), {type: "buffer"});
    expect(XLSX.utils.sheet_to_json(exported.Sheets.Projects)).toHaveLength(6);
    expect(XLSX.utils.sheet_to_json(exported.Sheets.Invoices)).toHaveLength(1);
    const backup = createJsonBackupV2({account: f.db.read(`users/${UID}`), collections:
      Object.fromEntries(Object.entries(preserved).map(([name, records]) => [name, records.map(({id, ...data}) => ({id, data}))]))});
    const decoded = JSON.parse(JSON.stringify(backup));
    expect(decoded.collections.projects).toHaveLength(6);
    expect(decoded.collections.bills[0].data.attachmentPath).toBe(source.bills[0].attachmentPath);
    expect(decoded.manifest.storageBinariesIncluded).toBe(false);

    const exportsHtml = readFileSync(new URL("../exports.html", import.meta.url), "utf8");
    let jsonDownloaded = 0, excelDownloaded = 0;
    const alerts = [];
    const context = vm.createContext({
      billingProfile: f.profile(), Blob, Date, URL: {createObjectURL: () => "blob:test", revokeObjectURL() {}},
      document: {createElement: () => ({click() {jsonDownloaded++;}})},
      buildFullBackupData: async () => backup, saveBackupDownloadedAt: async () => {},
      getBackupUserAndServices: async () => ({user: {uid: UID}, services: {}}),
      loadExcelLibrary: async () => ({...XLSX, writeFile: () => {excelDownloaded++;}}),
      buildFirestoreExcelData: async () => preserved, exportTimestamp: () => "test",
      window: {simpleBooksCanonicalWorkbookExport: {buildWorkbook: buildCanonicalExportWorkbook}},
      alert(message) {alerts.push(message);}, console
    });
    vm.runInContext(pageFunctions(exportsHtml, ["downloadFullBackup", "downloadExcelExport"]), context);
    await vm.runInContext("downloadFullBackup()", context);
    await vm.runInContext("downloadExcelExport()", context);
    expect(jsonDownloaded).toBe(1);
    expect(excelDownloaded).toBe(1);
    expect(alerts.every(message => message.startsWith("Excel export completed"))).toBe(true);
  });

  it.each(["On Hold", "Completed"])("opens the new-project form at capacity and allows %s, but blocks another Active", status => {
    const projects = Array.from({length: 5}, (_, i) => ({id: `p${i}`, status: "Active"}));
    const profile = {currentPlan: "Starter"};
    const html = readFileSync(new URL("../resources/tools/projects.html", import.meta.url), "utf8");
    const body = pageFunctions(html, ["openProjectForm", "renderProjectCreationAvailability"]);
    const elements = Object.fromEntries(["modalTitle", "modalSubtitle", "saveButton", "name", "reference", "description",
      "status", "budget", "startDate", "endDate", "projectOverlay",
      "newProjectButton", "emptyNewProjectButton", "projectLimitMessage"].map(name => [name, {}]));
    elements.form = {reset() {}};
    const context = vm.createContext({elements, projects, currentBillingProfile: profile, currentDemoMode: false,
      PROJECT_STATUS, canUseAnotherActiveProject, productAccessLoaded: true,
      activeProjectLimitMessage: () => "At capacity", clearValidation() {}, nextProjectReference: () => "P-6",
      renderCustomerOptions() {}, openOverlay: element => {element.hidden = false;}});
    vm.runInContext(`${body}; renderProjectCreationAvailability(); openProjectForm();`, context);
    expect(elements.newProjectButton.disabled).toBe(false);
    expect(elements.emptyNewProjectButton.disabled).toBe(false);
    expect(elements.projectOverlay.hidden).toBe(false);
    expect(elements.status.value).toBe("On Hold");
    expect(canSaveProjectStatus({profile, projects, nextStatus: status})).toBe(true);
    expect(canSaveProjectStatus({profile, projects, nextStatus: "Active"})).toBe(false);
    expect(canSaveProjectStatus({profile, projects: [...projects, {id: "completed", status}], projectId: "completed", nextStatus: "Active"})).toBe(false);
  });

  it.each([
    ["new On Hold", "On Hold", null, 5, 5, "add"],
    ["new Completed", "Completed", null, 5, 5, "add"],
    ["new Active", "Active", null, 5, 5, "blocked"],
    ["reactivation", "Active", "completed", 5, 5, "blocked"],
    ["existing Active edit", "Active", "p0", 6, 6, "update"],
    ["capacity changed before save", "Active", null, 4, 5, "blocked"]
  ])("executes saveProject for %s", async (_label, status, editingId, initialCount, freshCount, expected) => {
    const active = count => Array.from({length: count}, (_, i) => ({id: `p${i}`, status: "Active"}));
    const initial = [...active(initialCount), {id: "completed", status: "Completed"}];
    const fresh = [...active(freshCount), {id: "completed", status: "Completed"}];
    const elements = Object.fromEntries(["name", "reference", "description", "startDate", "endDate", "budget"]
      .map(key => [key, {value: key === "name" ? "Edited project" : ""}]));
    Object.assign(elements, {status: {value: status}, saveButton: {}, projectOverlay: {}});
    const addDoc = vi.fn(async () => ({id: "new"})), updateDoc = vi.fn(async () => {});
    const setFormFeedback = vi.fn();
    const context = vm.createContext({
      elements, isSaving: false, editingProjectId: editingId, projects: initial,
      auth: {currentUser: {uid: UID}}, db: {}, currentBillingProfile: {currentPlan: "Starter"},
      currentDemoMode: false, PROJECT_STATUS, canSaveProjectStatus,
      activeProjectLimitMessage: () => "At capacity", allowedStatuses: Object.values(PROJECT_STATUS),
      validateForm: () => true, selectedCustomer: () => ({id: "customer", name: "Customer"}),
      nextProjectReference: () => "P-7", serverTimestamp: () => "timestamp",
      doc: (_db, ...parts) => parts.join("/"), collection: (_db, ...parts) => parts.join("/"),
      getDoc: async path => ({exists: () => true, data: () => path.startsWith("userProfiles/") ? {currentPlan: "Starter"} : {}}),
      getDocs: async () => ({docs: fresh.map(project => ({id: project.id, data: () => project}))}),
      normaliseProject: snapshot => snapshot.data(), projectSortValue: () => 0,
      addDoc, updateDoc, setFormFeedback, showPageFeedback() {}, renderProjects() {}, renderPortfolio() {},
      logActivityEvent: async () => {}, createActivityIdempotencyKey: () => "activity", closeOverlay() {},
      console: {error: vi.fn()}
    });
    const html = readFileSync(new URL("../resources/tools/projects.html", import.meta.url), "utf8");
    vm.runInContext(pageFunctions(html, ["saveProject"]), context);
    await vm.runInContext("saveProject({preventDefault() {}})", context);
    expect(addDoc).toHaveBeenCalledTimes(expected === "add" ? 1 : 0);
    expect(updateDoc).toHaveBeenCalledTimes(expected === "update" ? 1 : 0);
    expect(setFormFeedback).toHaveBeenCalledTimes(expected === "blocked" ? 1 : 0);
    expect(context.console.error).not.toHaveBeenCalled();
    if(expected === "add") expect(addDoc.mock.calls[0][1]).toMatchObject({status});
    if(expected === "update") expect(updateDoc.mock.calls[0][1]).toMatchObject({name: "Edited project"});
    expect(context.isSaving).toBe(false);
  });
});

describe("actual HTTP webhook callback with real local signature validation", () => {
  it.each(["invalid-signature", "unsupported", "invoice", "ownership-error", "duplicate"])("handles %s safely", async scenario => {
    const f = fixture();
    const Stripe = require("../functions/node_modules/stripe");
    const signatures = new Stripe("local-unit-fixture").webhooks;
    f.stripe.webhooks = signatures;
    f.change({status: "unpaid"});
    const invoice = {...f.invoice(), description: "private-invoice-text"};
    if(scenario === "ownership-error") invoice.customer = "cus_foreign";
    const event = f.event(scenario === "unsupported" ? "invoice.created" : "invoice.paid", invoice);
    const payload = JSON.stringify(event);
    const secret = "local-signature-fixture";
    const signature = scenario === "invalid-signature" ? "bad-signature" :
      signatures.generateTestHeaderString({payload, secret});
    const logs = [];
    const factory = vi.fn(createStripeWebhookProcessor);
    const context = vm.createContext({
      configuredStripeClient: () => ({stripe: f.stripe, configuration}),
      stripeWebhookSecret: {value: () => secret}, createStripeWebhookProcessor: factory,
      updateSubscriptionProfile: f.writer, subscriptionBillingDetails: f.billingDetails,
      console: {error: (...args) => logs.push(args), warn: (...args) => logs.push(args)}
    });
    const source = readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
    const handler = vm.runInContext(`(${requestHandler(source, "stripeWebhook")})`, context);
    let status = 200, body;
    const response = {status: code => {status = code; return response;}, json: data => {body = data;}, send: data => {body = data;}};
    const request = {method: "POST", rawBody: Buffer.from(payload), get: () => signature};
    await handler(request, response);
    if(scenario === "duplicate") {
      const revision = f.profile().stripeProjectionRevision;
      await handler(request, response);
      expect(f.profile().stripeProjectionRevision).toBe(revision);
    }
    expect(status).toBe(scenario === "invalid-signature" ? 400 : scenario === "ownership-error" ? 500 : 200);
    if(scenario === "invalid-signature") expect(factory).not.toHaveBeenCalled();
    if(["invoice", "duplicate"].includes(scenario)) expect(f.profile().currentPlan).toBe("Starter");
    else expect(f.db.writes).toEqual([]);
    if(status === 200) expect(body).toEqual({received: true});
    expect(JSON.stringify(logs)).not.toContain("private-invoice-text");
  });
});
