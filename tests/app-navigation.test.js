import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  NAVIGATION_GROUPS,
  NAVIGATION_ICONS,
  SIDEBAR_SCROLL_STORAGE_KEY,
  SIDEBAR_STATE_STORAGE_KEY,
  activeNavigationKey,
  clampScrollPosition,
  nextSidebarState,
  normaliseSidebarState,
  normalizePathname,
  parseStoredScrollPosition,
  shouldSaveSidebarScroll,
  sidebarStateFromStorage
} from "../assets/app-shell.js";

const items = NAVIGATION_GROUPS.flatMap(group => group.items);
const expectedRoutes = [
  "/dashboard.html",
  "/resources/tools/invoice-generator.html",
  "/resources/tools/client-tracker.html",
  "/resources/tools/bills.html",
  "/resources/tools/expenses.html",
  "/resources/tools/projects.html",
  "/resources/tools/budgets.html",
  "/resources/tools/cashflow.html",
  "/resources/tools/trial-balance.html",
  "/resources/tools/general-ledger.html",
  "/resources/tools/profit-loss.html",
  "/resources/tools/balance-sheet.html",
  "/resources/tools/ai-assistant.html",
  "/exports.html",
  "/account.html"
];
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
    expect(routes).toEqual(expectedRoutes);
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

  it("provides a dependency-free icon for every collapsed navigation item", () => {
    expect(Object.keys(NAVIGATION_ICONS).sort()).toEqual(items.map(item => item.key).sort());

    for(const item of items){
      expect(NAVIGATION_ICONS[item.key]).toBeTruthy();
      expect(NAVIGATION_ICONS[item.key]).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("normalises and toggles expanded and collapsed states", () => {
    expect(normaliseSidebarState("expanded")).toBe("expanded");
    expect(normaliseSidebarState("collapsed")).toBe("collapsed");
    expect(nextSidebarState("expanded")).toBe("collapsed");
    expect(nextSidebarState("collapsed")).toBe("expanded");
  });

  it("restores only valid persisted sidebar states", () => {
    const storage = {
      value: "collapsed",
      getItem(key){
        expect(key).toBe(SIDEBAR_STATE_STORAGE_KEY);
        return this.value;
      }
    };

    expect(sidebarStateFromStorage(storage)).toBe("collapsed");
    storage.value = "expanded";
    expect(sidebarStateFromStorage(storage)).toBe("expanded");
    storage.value = "unexpected";
    expect(sidebarStateFromStorage(storage)).toBe("expanded");
    expect(sidebarStateFromStorage(null)).toBe("expanded");
  });

  it("parses and clamps restored sidebar scroll positions", () => {
    expect(parseStoredScrollPosition("180.5")).toBe(180.5);
    expect(parseStoredScrollPosition("-1")).toBeNull();
    expect(parseStoredScrollPosition("not-a-number")).toBeNull();
    expect(parseStoredScrollPosition(null)).toBeNull();
    expect(clampScrollPosition(180, 500)).toBe(180);
    expect(clampScrollPosition(700, 500)).toBe(500);
    expect(clampScrollPosition(-20, 500)).toBe(0);
  });

  it("saves scroll only for ordinary same-origin navigation", () => {
    const event = {
      button: 0,
      defaultPrevented: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false
    };
    const link = {
      href: "https://simple-books.test/dashboard.html",
      target: "",
      hasAttribute: () => false
    };

    expect(shouldSaveSidebarScroll(event, link, "https://simple-books.test")).toBe(true);
    expect(SIDEBAR_SCROLL_STORAGE_KEY).toBe("simple-books:app-shell:sidebar-scroll:v1");
  });

  it.each([
    ["Ctrl-click", { ctrlKey: true }],
    ["Cmd-click", { metaKey: true }],
    ["Shift-click", { shiftKey: true }],
    ["Alt-click", { altKey: true }],
    ["middle-click", { button: 1 }],
    ["prevented click", { defaultPrevented: true }]
  ])("does not save sidebar scroll for %s", (_label, override) => {
    const event = {
      button: 0,
      defaultPrevented: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...override
    };
    const link = {
      href: "https://simple-books.test/dashboard.html",
      target: "",
      hasAttribute: () => false
    };

    expect(shouldSaveSidebarScroll(event, link, "https://simple-books.test")).toBe(false);
  });

  it("does not save scroll for external, new-window, or download links", () => {
    const event = {
      button: 0,
      defaultPrevented: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false
    };
    const link = {
      href: "https://external.test/page",
      target: "",
      hasAttribute: () => false
    };

    expect(shouldSaveSidebarScroll(event, link, "https://simple-books.test")).toBe(false);
    link.href = "https://simple-books.test/dashboard.html";
    link.target = "_blank";
    expect(shouldSaveSidebarScroll(event, link, "https://simple-books.test")).toBe(false);
    link.target = "";
    link.hasAttribute = attribute => attribute === "download";
    expect(shouldSaveSidebarScroll(event, link, "https://simple-books.test")).toBe(false);
  });

  it("renders the collapse and collapsed-navigation accessibility contracts", () => {
    const javascript = readFileSync(new URL("../assets/app-shell.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("../assets/app-shell.css", import.meta.url), "utf8");

    expect(javascript).toContain('className = "sb-shell-collapse-button"');
    expect(javascript).toContain('"aria-expanded"');
    expect(javascript).toContain('link.append(createNavigationIcon(item.key), label)');
    expect(javascript).toContain('link.setAttribute("aria-label", item.label)');
    expect(css).toContain('body[data-sidebar-state="collapsed"]');
    expect(css).toContain("--app-sidebar-collapsed-width:76px");
    expect(css).toContain("@media (max-width:900px)");
    expect(css).toMatch(/@media \(max-width:900px\)[\s\S]*?\.sb-shell-collapse-button\{\s*display:none;/);
    expect(css).toMatch(/@media \(max-width:900px\)[\s\S]*?width:min\(84vw, 310px\)/);
  });
});
