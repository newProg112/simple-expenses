import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const file = path => new URL(`../${path}`, import.meta.url);
const privacy = readFileSync(file("privacy.html"), "utf8");
const terms = readFileSync(file("terms.html"), "utf8");
const css = readFileSync(file("assets/legal.css"), "utf8");
const root = fileURLToPath(file(""));

function numberedSections(page) {
  return [...page.matchAll(/<section id="([^"]+)"><h2>(\d+\. [^<]+)<\/h2>/g)]
    .map(([, id, label]) => ({ id, label }));
}

function contentsEntries(page) {
  const contents = page.match(/<aside class="legal-toc"[\s\S]*?<ol>([\s\S]*?)<\/ol><\/aside>/)?.[1] || "";
  return [...contents.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)]
    .map(([, id, label]) => ({ id, label }));
}

describe("launch legal pages", () => {
  it("provides accessible responsive final pages", () => {
    for (const page of [privacy, terms]) {
      expect(page.match(/<h1(?:\s|>)/g)).toHaveLength(1);
      expect(page).toContain('class="skip-link"');
      expect(page).toContain("Effective: 10 September 2026");
      expect(page).not.toMatch(/draft|publication blocker|owner.review/i);
      expect(page).toContain('/assets/legal.css');
    }
    expect(css).toMatch(/@media \(max-width: 860px\)[\s\S]*?\.legal-layout\s*\{[\s\S]*?grid-template-columns: 1fr/);
  });
  it("states confirmed identity and commercial facts", () => {
    for (const page of [privacy, terms]) {
      expect(page).toContain("Adam Elvin trading as Simple Books");
      expect(page).toContain("Loxley House<br>Station Street<br>Nottingham<br>NG2 3NG<br>United Kingdom");
      expect(page).toContain("mailto:hello@simple-books.co.uk");
    }
    expect(terms).toContain("only to people acting for business purposes, including sole traders");
    expect(terms).toContain("not a consumer service");
    expect(terms).toContain("&pound;15 per month");
    expect(terms).toContain("not VAT registered and does not charge VAT");
    expect(terms).toContain("There is no free Pro trial");
    expect(terms).toContain("If cancellation is scheduled, Pro access continues until the paid billing period ends");
  });
  it("matches every contents entry to each numbered section", () => {
    expect(contentsEntries(privacy)).toEqual(numberedSections(privacy));
    expect(contentsEntries(privacy)).toHaveLength(11);
    expect(contentsEntries(terms)).toEqual(numberedSections(terms));
    expect(contentsEntries(terms)).toHaveLength(13);
  });
  it("describes subscription access consistently with the deployed lifecycle", () => {
    expect(terms).toContain("payment becomes overdue, Pro access continues temporarily");
    expect(terms).toContain("subscription setup is incomplete or expires");
    expect(terms).toContain("payment remains unpaid");
    expect(terms).toContain("subscription is paused");
    expect(terms).toContain("or it is cancelled");
    expect(terms).not.toMatch(/past due[^.]*Starter|overdue[^.]*lose Pro access/i);
  });
  it("covers required protections and implementation qualifications", () => {
    expect(privacy).toContain("data controller");
    expect(privacy).toContain("acts on the customer&rsquo;s behalf");
    expect(privacy).toContain("Provider requests currently set <code>store: false</code>");
    expect(privacy).toContain("We do not apply one fixed period to every category");
    expect(privacy).toContain("ICO complaint service");
    expect(terms).toContain("You retain ownership");
    expect(terms).toContain("Exports are not complete copies");
    expect(terms).toContain("AI output is not professional advice");
    expect(terms).toContain("law of England and Wales");
    expect(terms).toContain("total liability");
    for (const page of [privacy, terms]) {
      expect(page).not.toMatch(/is ICO registered|Simple Books submits Making Tax Digital|is HMRC.recognised/i);
      expect(page).not.toMatch(/ISO\s*27001|SOC\s*2|fully GDPR compliant|hosted (?:only )?in the UK/i);
    }
  });
  it("keeps publication links and local references resolvable", () => {
    const signup = readFileSync(file("signup.html"), "utf8");
    expect(signup).toContain('href="/privacy.html"');
    expect(signup).toContain('href="/terms.html"');
    for (const page of [privacy, terms]) for (const match of page.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const link = match[1];
      if (/^(?:https?:|mailto:|#|\/$)/.test(link)) continue;
      const pathname = link.split(/[?#]/)[0];
      const staticPath = ["/features", "/pricing", "/about", "/security", "/faq", "/guides"].includes(pathname) ? `${pathname}.html` : pathname;
      const resolved = staticPath === "/guides.html" ? "/guide-pages/index.html" : staticPath;
      expect(existsSync(`${root}${resolved}`), link).toBe(true);
    }
  });
});
