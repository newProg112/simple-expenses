import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../resources/tools/banking.html", import.meta.url), "utf8");

describe("Banking Phase 1 page", () => {
  it("uses the authenticated shared application shell", () => {
    expect(html).toContain('<script type="module" src="/auth-guard.js"></script>');
    expect(html).toContain('<div data-app-navigation></div>');
    expect(html).toContain('class="app-content"');
    expect(html.match(/\/assets\/app-shell\.css/g)).toHaveLength(1);
    expect(html.match(/\/assets\/app-shell\.js/g)).toHaveLength(1);
    expect(html).not.toContain('class="app-nav');
    expect(html).not.toContain('class="app-header');
  });

  it("renders the Phase 1 heading and four zero-value KPIs", () => {
    expect(html).toContain("<h1>Banking</h1>");
    expect(html).toContain("Import bank transactions, review payments and keep your Simple Books records up to date.");
    expect(html).toContain('aria-label="Banking summary"');
    for(const label of ["Bank accounts", "Transactions", "Needs review", "Matched"]){
      expect(html).toContain(`<div class="kpi-label">${label}</div><div class="kpi-value">0</div>`);
    }
  });

  it("provides an honest non-functional import empty state and bank-account placeholder", () => {
    expect(html).toContain("Connect your banking records");
    expect(html).toContain("Import a bank statement to review transactions, match payments and keep your accounts up to date.");
    expect(html).toContain('<button class="btn" type="button" disabled aria-describedby="importPhaseNote">Import bank statement</button>');
    expect(html).toContain("Bank statement import is coming in the next phase.");
    expect(html).toContain("No bank accounts added yet.");
  });

  it("remains responsive without horizontal fixed-width content", () => {
    expect(html).toContain("grid-template-columns:repeat(4,minmax(0,1fr))");
    expect(html).toMatch(/@media\(max-width:820px\)[\s\S]*?\.kpi-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
    expect(html).toMatch(/@media\(max-width:640px\)[\s\S]*?\.kpi-grid\{grid-template-columns:1fr\}/);
    expect(html).toContain(".app-content{min-width:0}");
    expect(html).toContain(".card{min-width:0");
  });

  it("adds no gating, persistence, import parsing, APIs, or accounting behavior", () => {
    expect(html).not.toMatch(/plan-entitlements|financial-report-access|starter|pro feature|upgrade/i);
    expect(html).not.toMatch(/firebase-firestore|collection\(|addDoc|setDoc|updateDoc|deleteDoc/);
    expect(html).not.toMatch(/csv|open banking|plaid|truelayer|matchTransaction|reconcil|journal/i);
    expect(html).not.toContain("<script type=\"module\">\n");
  });
});
