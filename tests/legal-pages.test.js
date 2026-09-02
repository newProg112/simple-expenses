import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectFile = path => new URL(`../${path}`, import.meta.url);
const privacy = readFileSync(projectFile("privacy.html"), "utf8");
const terms = readFileSync(projectFile("terms.html"), "utf8");
const css = readFileSync(projectFile("assets/legal.css"), "utf8");
const signup = readFileSync(projectFile("signup.html"), "utf8");
const publicShell = readFileSync(projectFile("assets/guides/public-shell.js"), "utf8");
const projectRoot = fileURLToPath(projectFile(""));

function localReferences(html) {
  return [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map(match => match[1])
    .filter(link => !/^(?:https?:|mailto:|#)/.test(link));
}

describe("draft legal pages", () => {
  it("provides accessible, responsive draft pages with one clear H1 each", () => {
    expect(privacy).toContain("<title>Privacy Policy | Simple Books</title>");
    expect(terms).toContain("<title>Terms of Service | Simple Books</title>");
    expect(privacy.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(terms.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    for (const page of [privacy, terms]) {
      expect(page).toContain('class="skip-link"');
      expect(page).toContain("Draft for owner and legal review");
      expect(page).toContain('<link rel="stylesheet" href="/assets/guides/guides.css">');
      expect(page).toContain('<link rel="stylesheet" href="/assets/legal.css">');
      expect(page).toContain('aria-labelledby="');
    }
    expect(css).toMatch(/@media \(max-width: 860px\)[\s\S]*?\.legal-layout\s*\{[\s\S]*?grid-template-columns: 1fr/);
  });

  it("marks the proposed operator and unresolved privacy decisions honestly", () => {
    expect(privacy).toContain("Adam Elvin trading as Simple Books");
    expect(privacy).toContain('href="mailto:adam@simple-books.co.uk"');
    expect(privacy).toContain("appropriate business or correspondence address to publish");
    expect(privacy).toContain("data-processing terms");
    expect(privacy).toContain("Analytics currently initializes without a visible consent choice");
    expect(privacy).toContain("approve a retention schedule");
    expect(privacy).toContain("international-transfer safeguards");
    expect(privacy).toContain("ICO complaint service");
  });

  it("accurately distinguishes account data, customer content, AI inputs and deletion", () => {
    expect(privacy).toContain("customer may be the controller and Simple Books may process");
    expect(privacy).toContain("the user&rsquo;s question and a limited, question-relevant summary are sent");
    expect(privacy).toContain("selected supported image or PDF content");
    expect(privacy).toContain("removes email-address patterns and web links from the generated summary");
    expect(privacy).toContain("The current provider requests set <code>store: false</code>");
    expect(privacy).toContain("cancels a linked Simple Books subscription");
    expect(privacy).toContain("removes user-uploaded files");
    expect(privacy).toContain("deletes the Firebase Authentication user");
    expect(privacy).toContain("Provider-side transaction, security, backup or legal records may not be erased");
  });

  it("states the intended plan and billing behaviour without inventing commercial terms", () => {
    expect(terms).toContain("&pound;15 GBP per month");
    expect(terms).toContain("intended to renew each month until cancelled");
    expect(terms).toContain("cancellation is scheduled for the end of the current billing period");
    expect(terms).toContain("No VAT treatment is asserted in this draft");
    expect(terms).toContain("does not create a refund, credit, proration or cooling-off policy");
    expect(terms).toContain("No final warranty disclaimer, liability allocation or financial cap has been selected");
    expect(terms).toContain("No governing law, court jurisdiction or formal dispute process has been selected");
    expect(terms).toContain("does not by itself determine whether a particular user is legally a business customer or consumer");
  });

  it("describes export and AI limitations without unsupported guarantees", () => {
    expect(terms).toContain("Exports are not complete copies of everything held by the service");
    expect(terms).toContain("not presented as an automatic backup service");
    expect(terms).toContain("AI output may be incomplete, inaccurate or unsuitable");
    expect(terms).toContain("not accounting, tax, legal or financial advice");
    for (const page of [privacy, terms]) {
      expect(page).not.toMatch(/ISO\s*27001|SOC\s*2|PCI\s*DSS|fully GDPR compliant|hosted (?:only )?in the UK|never (?:used )?to train|standard contractual clauses|adequacy decision applies/i);
    }
  });

  it("adds neutral signup links without adding consent or acceptance state", () => {
    expect(signup).toContain('<a href="/privacy.html">Privacy Policy</a>');
    expect(signup).toContain('<a href="/terms.html">Terms of Service</a>');
    expect(signup).toContain("before creating an account");
    expect(signup).not.toMatch(/by (?:signing up|creating an account).*(?:agree|consent)/i);
    expect(signup).not.toMatch(/privacyAccepted|termsAccepted|consentAccepted|acceptTerms|acceptPrivacy/);
    expect(signup).toContain("createUserWithEmailAndPassword");
    expect(signup).toContain('signupForm.addEventListener("submit"');
  });

  it("links both drafts from top-level footers and the shared guide footer shell", () => {
    const guideFiles = readdirSync(fileURLToPath(projectFile("guide-pages")))
      .filter(file => file.endsWith(".html"))
      .map(file => `guide-pages/${file}`);
    const files = [
      "index.html", "features.html", "pricing.html", "about.html",
      "whats-new.html", "security.html", "faq.html"
    ];
    for (const file of files) {
      const page = readFileSync(projectFile(file), "utf8");
      const footer = page.match(/<footer[\s\S]*?<\/footer>/)?.[0] || "";
      expect(footer, `${file} privacy footer link`).toContain('href="/privacy.html"');
      expect(footer, `${file} terms footer link`).toContain('href="/terms.html"');
    }
    expect(publicShell).toContain('[["/privacy.html", "Privacy"], ["/terms.html", "Terms"]]');
    expect(publicShell).toContain("footerNavigation.insertBefore(link, contactLink)");
    for (const file of guideFiles) {
      const page = readFileSync(projectFile(file), "utf8");
      expect(page, `${file} shared public footer shell`).toContain(
        '<script type="module" src="/assets/guides/public-shell.js"></script>'
      );
    }
  });

  it("uses resolvable local page and asset routes", () => {
    for (const [name, page] of [["privacy.html", privacy], ["terms.html", terms]]) {
      for (const link of localReferences(page)) {
        const pathname = link.split(/[?#]/)[0];
        if (!pathname || pathname === "/") continue;
        const staticPath = ["/features", "/pricing", "/about", "/security", "/faq", "/guides"]
          .includes(pathname) ? `${pathname}.html` : pathname;
        const resolved = staticPath === "/guides.html" ? "/guide-pages/index.html" : staticPath;
        expect(existsSync(`${projectRoot}${resolved}`), `${name}: ${link} should resolve`).toBe(true);
      }
    }
  });
});
