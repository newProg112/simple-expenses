import {readFileSync} from "node:fs";
import {describe, expect, it, vi} from "vitest";
import {
  accountDeletionErrorMessage,
  clearSimpleBooksAccountCaches,
  createAccountDeletionController,
  normaliseAccountDeletionStatus,
  supportsPasswordReauthentication,
} from "../assets/account-deletion.js";
import {createRequestId} from "../resources/js/request-id.js";

const accountHtml = readFileSync(new URL("../account.html", import.meta.url), "utf8");
const homeHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

class FakeClassList {
  constructor() {
    this.values = new Set();
  }
  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(document) {
    this.document = document;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this.focusables = [];
  }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }
  dispatch(name, event = {}) {
    for (const listener of this.listeners.get(name) || []) listener({target: this, ...event});
  }
  focus() {
    this.document.activeElement = this;
  }
  getClientRects() {
    return [{}];
  }
  querySelectorAll() {
    return this.focusables;
  }
  setAttribute(name, value = "") {
    this.attributes.set(name, value);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

function harness(overrides = {}) {
  const document = {
    activeElement: null,
    body: {classList: new FakeClassList()},
    listeners: new Map(),
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    },
    removeEventListener(name) {
      this.listeners.delete(name);
    },
  };
  const element = () => new FakeElement(document);
  const elements = {
    section: element(), open: element(), modal: element(), close: element(),
    form: element(), confirmation: element(), password: element(), submit: element(),
    confirmationPanel: element(), processingPanel: element(), processingTitle: element(),
    status: element(), support: element(), background: [element(), element()],
  };
  elements.modal.hidden = true;
  elements.processingPanel.hidden = true;
  elements.support.hidden = true;
  elements.submit.disabled = true;
  elements.modal.focusables = [
    elements.close, elements.confirmation, elements.password, elements.submit,
  ];
  const timers = [];
  const localStorage = new MemoryStorage(overrides.localStorage);
  const sessionStorage = new MemoryStorage(overrides.sessionStorage);
  const location = {assign: vi.fn()};
  const runtime = {
    document, localStorage, sessionStorage, location,
    setTimeout: (callback, delay) => {
      const timer = {callback, delay, cancelled: false};
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
    addEventListener: vi.fn(),
  };
  let user = overrides.user === undefined ? {
    uid: "customer-a",
    email: "customer@example.test",
    providerData: [{providerId: "password"}],
  } : overrides.user;
  const services = {
    getCurrentUser: () => user,
    reauthenticate: vi.fn(async () => {}),
    requestDeletion: vi.fn(async () => ({accepted: true, status: "active"})),
    getStatus: vi.fn(async () => ({status: "processing", phase: "starting"})),
    authUserIsMissing: vi.fn(async () => false),
    signOut: vi.fn(async () => { user = null; }),
    ...overrides.services,
  };
  const controller = createAccountDeletionController({
    elements,
    services,
    runtime,
    createRequestId: () => "123e4567-e89b-42d3-a456-426614174000",
  });
  const nextTimer = async (delay) => {
    const timer = timers.find(candidate => !candidate.cancelled && candidate.delay === delay);
    expect(timer, `expected a ${delay}ms timer`).toBeTruthy();
    timer.cancelled = true;
    await timer.callback();
  };
  const enterConfirmation = (confirmation = "DELETE", password = "secret-password") => {
    controller.open();
    elements.confirmation.value = confirmation;
    elements.password.value = password;
    elements.confirmation.dispatch("input");
    elements.password.dispatch("input");
  };
  return {
    controller, document, elements, enterConfirmation, localStorage,
    location, nextTimer, services, sessionStorage, timers,
    setUser: (nextUser) => { user = nextUser; },
  };
}

describe("Delete account Account-page rendering", () => {
  it("renders a restrained Simple Books-only danger section with a real backup link", () => {
    expect(accountHtml).toContain('id="deleteAccountSection"');
    expect(accountHtml).toContain("Permanently delete your Simple Books account and associated data.");
    expect(accountHtml).toContain("Your Simple Books subscription will be cancelled");
    expect(accountHtml).toMatch(/does not delete a\s+separate Simple Expenses account/);
    expect(accountHtml).toContain('href="/exports.html">Download a backup first</a>');
  });

  it("uses one accessible responsive modal with labelled secure fields", () => {
    expect(accountHtml.match(/id="deleteAccountModal"/g)).toHaveLength(1);
    expect(accountHtml).toContain('role="dialog"');
    expect(accountHtml).toContain('aria-modal="true"');
    expect(accountHtml).toContain('for="deleteAccountConfirmation"');
    expect(accountHtml).toContain('for="deleteAccountPassword"');
    expect(accountHtml).toContain('autocomplete="current-password"');
    expect(accountHtml).toContain('id="deleteAccountStatus"');
    expect(accountHtml).toContain('aria-live="polite"');
    expect(accountHtml).toContain("@media (max-width:640px)");
  });

  it("reauthenticates in the browser and sends deletion only through callables", () => {
    expect(accountHtml).toContain("EmailAuthProvider.credential(user.email, password)");
    expect(accountHtml).toContain("reauthenticateWithCredential(user, credential)");
    expect(accountHtml).toContain('"requestAccountDeletion"');
    expect(accountHtml).toContain('"getAccountDeletionStatus"');
    expect(accountHtml).not.toMatch(/deleteUser\(|recursiveDelete\(|subscriptions\.cancel|bucket\.delete/);
  });

  it("shows a non-PII completion message on the existing homepage", () => {
    expect(homeHtml).toContain("Your Simple Books account has been deleted.");
    expect(homeHtml).toContain('completionParameters.get("account") === "deleted"');
  });
});

describe("Delete account confirmation and request", () => {
  it.each(["", "delete", "Delete", "DELETE "])(
      "keeps final deletion disabled for confirmation %j",
      (confirmation) => {
        const result = harness();
        result.enterConfirmation(confirmation, "password");
        expect(result.elements.submit.disabled).toBe(true);
      },
  );

  it("requires a password as well as exact DELETE", () => {
    const result = harness();
    result.enterConfirmation("DELETE", "");
    expect(result.elements.submit.disabled).toBe(true);
    result.elements.password.value = "password";
    result.elements.password.dispatch("input");
    expect(result.elements.submit.disabled).toBe(false);
  });

  it("reauthenticates and sends one UUID payload without UID or password", async () => {
    const result = harness();
    result.enterConfirmation();
    await result.controller.submit({preventDefault: () => {}});
    expect(result.services.reauthenticate)
        .toHaveBeenCalledWith("customer@example.test", "secret-password");
    expect(result.services.requestDeletion).toHaveBeenCalledTimes(1);
    expect(result.services.requestDeletion).toHaveBeenCalledWith({
      confirmation: "DELETE",
      requestId: "123e4567-e89b-42d3-a456-426614174000",
    });
    expect(JSON.stringify(result.services.requestDeletion.mock.calls))
        .not.toContain("secret-password");
    expect(result.elements.password.value).toBe("");
    expect(result.elements.processingPanel.hidden).toBe(false);
    expect(result.elements.status.textContent).not.toContain("deleted");
  });

  it("blocks duplicate submit calls in the same request flow", async () => {
    let releaseRequest;
    const request = vi.fn(() => new Promise(resolve => { releaseRequest = resolve; }));
    const result = harness({services: {requestDeletion: request}});
    result.enterConfirmation();
    const first = result.controller.submit({preventDefault: () => {}});
    await Promise.resolve();
    const duplicate = result.controller.submit({preventDefault: () => {}});
    await Promise.resolve();
    releaseRequest({accepted: true, status: "active"});
    await Promise.all([first, duplicate]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("clears the password and reports a wrong-password failure safely", async () => {
    const result = harness({services: {
      reauthenticate: vi.fn(async () => {
        throw Object.assign(new Error("bad password"), {code: "auth/invalid-credential"});
      }),
    }});
    result.enterConfirmation();
    await result.controller.submit({preventDefault: () => {}});
    expect(result.elements.password.value).toBe("");
    expect(result.elements.status.textContent).toContain("password was not accepted");
    expect(result.services.requestDeletion).not.toHaveBeenCalled();
  });

  it("fails gracefully for an account without a password provider", async () => {
    const result = harness({user: {
      uid: "customer-a", email: "customer@example.test",
      providerData: [{providerId: "google.com"}],
    }});
    result.enterConfirmation();
    await result.controller.submit({preventDefault: () => {}});
    expect(result.elements.status.textContent).toContain("does not use email and password");
    expect(result.services.reauthenticate).not.toHaveBeenCalled();
  });

  it("recovers an enqueue error by checking the durable server status", async () => {
    const result = harness({services: {
      requestDeletion: vi.fn(async () => {
        throw Object.assign(new Error("queue unavailable"), {code: "functions/unavailable"});
      }),
      getStatus: vi.fn(async () => ({status: "processing", phase: "starting"})),
    }});
    result.enterConfirmation();
    await result.controller.submit({preventDefault: () => {}});
    expect(result.services.getStatus).toHaveBeenCalledTimes(1);
    expect(result.elements.processingPanel.hidden).toBe(false);
    expect(result.elements.status.textContent).not.toContain("nothing happened");
  });

  it("maps stale-auth rejection without exposing backend details", () => {
    expect(accountDeletionErrorMessage({
      code: "functions/failed-precondition",
      details: {reason: "recent-authentication-required", internal: "do-not-show"},
    })).toBe("Your sign-in could not be refreshed. Enter your password again and retry.");
  });
});

describe("Delete account status, completion, and protected UX", () => {
  it("hides the destructive section for Demo and shows it for an ordinary user", () => {
    const result = harness();
    result.controller.renderAvailability({signedIn: true, demo: true});
    expect(result.elements.section.hidden).toBe(true);
    result.controller.renderAvailability({signedIn: true, demo: false});
    expect(result.elements.section.hidden).toBe(false);
  });

  it("resumes processing after reload and tolerates a temporary poll failure", async () => {
    const getStatus = vi.fn()
        .mockResolvedValueOnce({status: "processing", phase: "removing_files"})
        .mockRejectedValueOnce(Object.assign(new Error("offline"), {code: "functions/unavailable"}))
        .mockResolvedValueOnce({status: "completed"});
    const result = harness({services: {getStatus}});
    await expect(result.controller.resumeIfNeeded()).resolves.toBe(true);
    expect(result.elements.status.textContent).toContain("uploaded files");
    await result.nextTimer(3000);
    expect(result.location.assign).not.toHaveBeenCalled();
    await result.nextTimer(5000);
    expect(result.services.signOut).toHaveBeenCalledTimes(1);
    expect(result.location.assign).toHaveBeenCalledWith("/?account=deleted");
  });

  it("stops at needs_attention and exposes the existing support route", async () => {
    const result = harness({services: {
      getStatus: vi.fn(async () => ({status: "needs_attention"})),
    }});
    await expect(result.controller.resumeIfNeeded()).resolves.toBe(true);
    expect(result.elements.status.textContent).toContain("account remains locked");
    expect(result.elements.support.hidden).toBe(false);
    expect(result.timers.some(timer => !timer.cancelled && timer.delay >= 3000)).toBe(false);
  });

  it("clears only Simple Books account caches before sign-out and redirect", async () => {
    const result = harness({
      localStorage: {
        "simpleBooksAccount:customer-a": "private",
        simpleBooksAccountUid: "customer-a",
        simpleBooksInvoices: "private",
        simpleBooksBills: "private",
        simpleBooksClients: "private",
        simpleBooksExpenses: "private",
        simpleBooksCustomers: "private",
        simpleBooksDarkMode: "true",
        se_filters_q: "separate-simple-expenses-state",
        "simpleBooksLastAccountantPackGeneratedAt:customer-a": "2026-08-30T12:00:00.000Z",
        "simpleBooksLastRestoreCompletedAt:customer-a": "2026-08-31T09:30:00.000Z",
      },
      sessionStorage: {
        "simple-books:demo-analytics:page-view:v1:customer-a:Login:/": "true",
        "simple-books:app-shell:sidebar-scroll:v1": "120",
      },
      services: {getStatus: vi.fn(async () => ({status: "completed"}))},
    });
    await result.controller.resumeIfNeeded();
    expect(result.localStorage.getItem("simpleBooksInvoices")).toBeNull();
    expect(result.localStorage.getItem("simpleBooksAccount:customer-a")).toBeNull();
    expect(result.localStorage.getItem(
        "simpleBooksLastAccountantPackGeneratedAt:customer-a",
    )).toBeNull();
    expect(result.localStorage.getItem(
        "simpleBooksLastRestoreCompletedAt:customer-a",
    )).toBeNull();
    expect(result.localStorage.getItem("simpleBooksDarkMode")).toBe("true");
    expect(result.localStorage.getItem("se_filters_q"))
        .toBe("separate-simple-expenses-state");
    expect(result.sessionStorage.getItem(
        "simple-books:demo-analytics:page-view:v1:customer-a:Login:/",
    )).toBeNull();
    expect(result.sessionStorage.getItem("simple-books:app-shell:sidebar-scroll:v1"))
        .toBe("120");
  });

  it("uses cryptographically generated UUID request IDs", () => {
    expect(createRequestId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("normalises queued state without treating it as completion", () => {
    expect(normaliseAccountDeletionStatus({accepted: true, status: "active"}))
        .toEqual({status: "processing", phase: "starting"});
    expect(normaliseAccountDeletionStatus({status: "completed"}))
        .toEqual({status: "completed", phase: ""});
  });

  it("recognises only email/password users for reauthentication", () => {
    expect(supportsPasswordReauthentication({
      email: "customer@example.test", providerData: [{providerId: "password"}],
    })).toBe(true);
    expect(supportsPasswordReauthentication({
      email: "customer@example.test", providerData: [{providerId: "google.com"}],
    })).toBe(false);
  });
});
