import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../business-insights.html", import.meta.url), "utf8");
const javascript = readFileSync(new URL("../assets/business-insights.js", import.meta.url), "utf8");
const forecasts = readFileSync(new URL("../assets/business-insights-forecasts.js", import.meta.url), "utf8");

describe("Business Insights production presentation", () => {
  it("keeps a coherent section hierarchy with Business Health as the introduction", () => {
    const sections = [
      'id="healthTitle"',
      'id="prioritiesTitle"',
      'id="actionableSection"',
      'id="forecastsSection"',
      'id="trendsSection"',
      'id="snapshotTitle"'
    ];
    sections.reduce((previous, marker) => {
      const position = html.indexOf(marker);
      expect(position).toBeGreaterThan(previous);
      return position;
    }, -1);
    expect(html).toContain('class="panel health-panel"');
    expect(html).toContain(".health-panel{border-color:#c9e3f0");
    expect(html).toContain(".layout{gap:18px}");
  });

  it("keeps priorities and actionable cards readable without forcing busy equal-height layouts", () => {
    expect(html).toContain(".priority>div>strong{display:block;line-height:1.4;overflow-wrap:anywhere}");
    expect(html).toContain(".priority a{align-self:center;justify-content:center;white-space:nowrap");
    expect(html).toContain(".actionable-grid,.forecast-grid{align-items:start}");
    expect(html).toContain(".actionable-card{display:flex;flex-direction:column;align-items:flex-start");
    expect(javascript).toContain('class="priority priority-${item.severity}"');
    expect(javascript).toContain('class="actionable-card actionable-${escapeHtml(item.status)}"');
  });

  it("makes forecast values prominent and unavailable states intentional", () => {
    expect(html).toContain(".forecast-value{font-size:1.65rem");
    expect(html).toContain(".forecast-unavailable{border-style:solid;border-color:#dbe3ec");
    expect(html).toContain(".forecast-unavailable .forecast-value{font-size:1.3rem;color:#526174");
    expect(html).toContain(".forecast-method summary{min-height:44px");
    expect(javascript).toContain('class="forecast-card forecast-${escapeHtml(card.status)}"');
    expect(javascript).toContain('class="forecast-value"');
  });

  it("keeps trend and snapshot amounts aligned and wrap-safe", () => {
    expect(html).toContain("font-variant-numeric:tabular-nums");
    expect(html).toContain(".trend-card>strong{display:block;line-height:1.25;overflow-wrap:anywhere}");
    expect(html).toContain(".snapshot-metric{display:flex;min-height:108px");
    expect(html).toContain(".snapshot-grid.snapshot-grid-starter{grid-template-columns:repeat(2,minmax(0,1fr))}");
  });

  it("uses concise Starter preview labels and retains one main upgrade CTA", () => {
    expect(html.match(/>Preview<\/span>/g)).toHaveLength(2);
    expect(html.match(/>Pro feature<\/span>/g)).toHaveLength(1);
    expect(html.match(/id="upgradeInsightsButton"/g)).toHaveLength(1);
    expect(html).toMatch(/id="actionablePreviewSection"[^>]*hidden/);
    expect(html).toMatch(/id="forecastPreviewSection"[^>]*hidden/);
    expect(html).toMatch(/id="insightsUpgradePanel"[^>]*hidden/);
  });

  it("preserves semantic disclosures, focus treatment and responsive stacking", () => {
    expect(html).toContain('<details class="forecast-method"><summary>How forecasts are calculated</summary>');
    expect(javascript).toContain('<details class="calculation-details"><summary>View score breakdown</summary>');
    expect(html).toContain(".calculation-details summary::after,.forecast-method summary::after");
    expect(html).toContain("border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);transition:transform .2s ease");
    expect(html).toContain(".calculation-details[open]>summary::after,.forecast-method[open]>summary::after{transform:rotate(225deg)}");
    expect(html).toContain("justify-content:space-between;gap:12px;width:100%");
    expect(html).toContain("@media(prefers-reduced-motion:reduce)");
    expect(html).toContain("a:focus-visible,button:focus-visible,summary:focus-visible");
    expect(html).toContain("@media(max-width:900px)");
    expect(html).toContain("@media(max-width:700px)");
    expect(html).toContain("@media(max-width:420px)");
    expect(html).toMatch(/@media\(max-width:700px\)[\s\S]*?\.trend-grid,\.actionable-grid,\.forecast-grid,\.snapshot-grid,\.snapshot-grid\.snapshot-grid-starter\{grid-template-columns:1fr\}/);
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("retains understandable loading, error, empty and partial states", () => {
    expect(html).toContain('id="pageStatus" class="sr-only" role="status" aria-live="polite"');
    expect(html).toContain('id="loadingState" class="state"');
    expect(html).toContain('id="errorState" class="state" hidden');
    expect(html).toContain('id="emptyState" class="state" hidden');
    expect(html).toContain('id="partialWarning" class="partial-warning" role="status" hidden');
    expect(javascript).toContain("No actionable recommendations are available yet.");
    expect(forecasts).toContain("Insufficient history");
  });
});
