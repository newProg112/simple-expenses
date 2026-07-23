import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  NAVIGATION_GROUPS,
  activeNavigationKey,
  normalizePathname
} from "../assets/app-shell.js";

const items = NAVIGATION_GROUPS.flatMap(group => group.items);
const shellPages = [
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

describe("application navigation", () => {
  it("defines the expected navigation groups", () => {
    expect(NAVIGATION_GROUPS.filter(group => group.label).map(group => group.label)).toEqual([
      "Sales",
      "Purchases",
      "Work",
      "Planning",
      "Accounting"
    ]);
  });

  it("defines every application route once", () => {
    const routes = items.map(item => item.href);

    expect(items).toHaveLength(15);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it.each(items)("matches $label to its route", item => {
    expect(activeNavigationKey(item.href)).toBe(item.key);
  });

  it("normalises trailing slashes, queries and hashes", () => {
    expect(normalizePathname("/dashboard.html/?from=test#summary")).toBe("/dashboard.html");
    expect(activeNavigationKey("/dashboard.html/?from=test")).toBe("dashboard");
  });

  it("highlights Projects on the project details route", () => {
    expect(activeNavigationKey("/resources/tools/project-details.html?id=project-1")).toBe("projects");
  });

  it("does not select a navigation item for an unknown route", () => {
    expect(activeNavigationKey("/unknown.html")).toBe("");
  });

  it.each(shellPages)("$file consumes only the shared application shell", file => {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

    expect(html.match(/data-app-navigation/g)).toHaveLength(1);
    expect(html.match(/class="app-content"/g)).toHaveLength(1);
    expect(html.match(/\/assets\/app-shell\.css/g)).toHaveLength(1);
    expect(html.match(/\/assets\/app-shell\.js/g)).toHaveLength(1);
    expect(html).not.toContain('class="app-nav');
    expect(html).not.toContain('class="app-header');
    expect(html).not.toContain("/assets/app-nav.css");
  });
});
