import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const bootstrap = readFileSync(
  new URL("../assets/sentry-monitoring.js", import.meta.url),
  "utf8"
);
const loaderUrl = "https://js-de.sentry-cdn.com/9ca6428f0668673bd5ba75766bdcdc9f.min.js";
const monitoredPages = [
  "index.html",
  "login.html",
  "signup.html",
  "dashboard.html",
  "account.html",
  "exports.html",
  "resources/tools/ai-assistant.html",
  "resources/tools/balance-sheet.html",
  "resources/tools/bills.html",
  "resources/tools/budgets.html",
  "resources/tools/cashflow.html",
  "resources/tools/client-tracker.html",
  "resources/tools/expenses.html",
  "resources/tools/general-ledger.html",
  "resources/tools/invoice-generator.html",
  "resources/tools/profit-loss.html",
  "resources/tools/project-details.html",
  "resources/tools/projects.html",
  "resources/tools/trial-balance.html"
];

function runBootstrap(hostname, existing = null) {
  const scripts = existing?.scripts || [];
  const elements = existing?.elements || new Map();
  const window = existing?.window || {
    location: {
      hostname,
      origin: `https://${hostname}`
    },
    __SIMPLE_BOOKS_SENTRY_TEST__: true
  };
  const document = existing?.document || {
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement(tagName) {
      return { tagName };
    },
    head: {
      appendChild(element) {
        scripts.push(element);
        if(element.id) elements.set(element.id, element);
      }
    }
  };

  vm.runInNewContext(bootstrap, {
    URL,
    document,
    window
  });

  return { document, elements, scripts, window };
}

describe("Sentry production bootstrap", () => {
  it.each([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "0.0.0.0",
    "www.simple-books.co.uk",
    "simple-books.co.uk.evil.example",
    "simple-books-office--preview.web.app",
    "preview.example"
  ])("does not initialise on %s", hostname => {
    const result = runBootstrap(hostname);

    expect(result.scripts).toHaveLength(0);
    expect(result.window.sentryOnLoad).toBeUndefined();
  });

  it.each([
    "simple-books.co.uk",
    "simple-books-office.web.app"
  ])("loads the exact official loader on %s", hostname => {
    const result = runBootstrap(hostname);

    expect(result.scripts).toHaveLength(1);
    expect(result.scripts[0]).toMatchObject({
      id: "simple-books-sentry-loader",
      src: loaderUrl,
      crossOrigin: "anonymous"
    });
    expect(result.window.sentryOnLoad).toBeTypeOf("function");
  });

  it("loads the SDK only once", () => {
    const result = runBootstrap("simple-books.co.uk");
    runBootstrap("simple-books.co.uk", result);

    expect(result.scripts).toHaveLength(1);
  });

  it("configures error monitoring without PII or a release", () => {
    const result = runBootstrap("simple-books.co.uk");
    let options;
    result.window.Sentry = {
      init(value) {
        options = value;
      }
    };

    result.window.sentryOnLoad();

    expect(options.environment).toBe("production");
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBeTypeOf("function");
    expect(options.beforeBreadcrumb).toBeTypeOf("function");
    expect(options.release).toBeUndefined();
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.replaysSessionSampleRate).toBeUndefined();
    expect(options.replaysOnErrorSampleRate).toBeUndefined();
    expect(options.profilesSampleRate).toBeUndefined();
    expect(options.enableLogs).toBeUndefined();
  });
});

describe("Sentry privacy filtering", () => {
  const api = runBootstrap("simple-books.co.uk").window.__SIMPLE_BOOKS_SENTRY_TEST_API__;

  it("removes request payloads, identity, extras, query strings and fragments", () => {
    const event = {
      request: {
        url: "https://simple-books.co.uk/resources/tools/project-details.html?id=private#summary",
        data: { invoice: "private" },
        headers: { Authorization: "Bearer private" },
        cookies: { session: "private" },
        query_string: "id=private"
      },
      user: {
        id: "firebase-user-id",
        email: "private@example.com",
        name: "Private Name",
        username: "private",
        ip_address: "127.0.0.1"
      },
      extra: {
        aiPrompt: "private",
        invoiceContents: "private"
      },
      exception: {
        values: [{
          stacktrace: {
            frames: [{
              filename: "https://simple-books.co.uk/dashboard.html?token=private#section"
            }]
          }
        }]
      }
    };

    expect(api.sanitiseEvent(event)).toEqual({
      request: {
        url: "https://simple-books.co.uk/resources/tools/project-details.html"
      },
      exception: {
        values: [{
          stacktrace: {
            frames: [{
              filename: "https://simple-books.co.uk/dashboard.html"
            }]
          }
        }]
      }
    });
  });

  it("keeps only sanitised navigation breadcrumbs", () => {
    expect(api.sanitiseBreadcrumb({
      category: "navigation",
      message: "private",
      data: {
        from: "https://simple-books.co.uk/dashboard.html?token=private",
        to: "/resources/tools/projects.html?id=private#details",
        privateValue: "private"
      }
    })).toEqual({
      category: "navigation",
      data: {
        from: "https://simple-books.co.uk/dashboard.html",
        to: "https://simple-books.co.uk/resources/tools/projects.html"
      }
    });
  });

  it.each(["console", "fetch", "xhr", "ui.click", "ui.input"])(
    "drops %s breadcrumbs",
    category => {
      expect(api.sanitiseBreadcrumb({
        category,
        message: "private user-entered content",
        data: { url: "https://example.test/?private=value" }
      })).toBeNull();
    }
  );
});

describe("Sentry HTML integration", () => {
  it.each(monitoredPages)("$file includes the shared bootstrap exactly once and before other scripts", file => {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const comment = "<!-- Sentry frontend error monitoring -->";
    const script = '<script src="/assets/sentry-monitoring.js"></script>';

    expect(html.match(/Sentry frontend error monitoring/g)).toHaveLength(1);
    expect(html.match(/\/assets\/sentry-monitoring\.js/g)).toHaveLength(1);
    expect(html.indexOf(comment)).toBeLessThan(html.indexOf(script));
    expect(html.indexOf(script)).toBeLessThan(
      html.indexOf("<script", html.indexOf(script) + script.length)
    );
  });

  it("keeps the deliberate manual error helper out of Firebase Hosting", () => {
    const firebase = JSON.parse(
      readFileSync(new URL("../firebase.json", import.meta.url), "utf8")
    );
    const manualHtml = readFileSync(
      new URL("../manual-tests/sentry-monitoring.html", import.meta.url),
      "utf8"
    );

    expect(firebase.hosting[0].ignore).toContain("manual-tests/**");
    expect(manualHtml).toContain('id="throw-test-error"');
    expect(manualHtml).toContain("Simple Books Sentry local manual verification error");
    expect(manualHtml).toContain('addEventListener("click"');
  });
});
