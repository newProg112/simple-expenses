import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);
const html = readFileSync(projectFile("security.html"), "utf8");
const css = readFileSync(projectFile("assets/security.css"), "utf8");
const sharedCss = readFileSync(projectFile("assets/guides/guides.css"), "utf8");
const firebase = JSON.parse(readFileSync(projectFile("firebase.json"), "utf8"));
const firestoreRules = readFileSync(projectFile("firestore.rules"), "utf8");
const authGuard = readFileSync(projectFile("auth-guard.js"), "utf8");
const login = readFileSync(projectFile("login.html"), "utf8");
const signup = readFileSync(projectFile("signup.html"), "utf8");
const account = readFileSync(projectFile("account.html"), "utf8");
const functionsSource = readFileSync(projectFile("functions/index.js"), "utf8");
const assistant = readFileSync(projectFile("functions/ai-assistant.js"), "utf8");
const assistantPrompt = readFileSync(projectFile("functions/lib/assistant-prompt.js"), "utf8");
const scanner = readFileSync(projectFile("functions/business-document-scan.js"), "utf8");
const banking = readFileSync(projectFile("resources/tools/banking.html"), "utf8");
const bankImport = readFileSync(projectFile("resources/js/bank-transaction-import.js"), "utf8");
const bankMatches = readFileSync(projectFile("resources/js/bank-match-suggestions.js"), "utf8");
const exportsPage = readFileSync(projectFile("exports.html"), "utf8");
const monitoring = readFileSync(projectFile("assets/sentry-monitoring.js"), "utf8");
const storageRules = readFileSync(projectFile("storage.rules"), "utf8");
const projectRoot = fileURLToPath(projectFile(""));

function textContent(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rarr;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("public Security page", () => {
  it("has unique metadata, one H1 and the clean public route", () => {
    expect(html).toContain("<title>Security and data handling | Simple Books</title>");
    expect(html).toContain(
      '<meta name="description" content="Learn how Simple Books handles account access, business records, payments, AI features, bank statement imports and data exports.">'
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://simple-books.co.uk/security">'
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://simple-books.co.uk/security">'
    );
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain("<h1>Clear account controls. Clear data handling.</h1>");
    expect(firebase.hosting[0].rewrites).toContainEqual({
      source: "/security",
      destination: "/security.html"
    });
  });

  it("uses consistent public navigation, current-page state and restrained CTAs", () => {
    const desktopNavigation = html.match(
      /<nav aria-label="Primary navigation">([\s\S]*?)<\/nav>/
    )?.[1] || "";
    const mobileNavigation = html.match(
      /<nav class="mobile-navigation"[\s\S]*?>([\s\S]*?)<\/nav>/
    )?.[1] || "";

    expect(textContent(desktopNavigation)).toBe(
      "Features Pricing About What's New Security Guides Contact"
    );
    expect(textContent(mobileNavigation)).toBe(
      "Features Pricing About What's New Security Guides FAQ Contact Login Sign Up"
    );
    expect(html).toContain(
      'href="/security" aria-current="page">Security</a>'
    );
    expect(html).toContain('href="/features">View Features</a>');
    expect(html).toContain('href="/login.html?demo=1">Explore the demo</a>');
    expect(html).toContain('href="/pricing">View Pricing');
  });

  it("describes the verified email/password authentication and Firestore ownership rules", () => {
    expect(signup).toContain("createUserWithEmailAndPassword");
    expect(login).toContain("signInWithEmailAndPassword");
    expect(login).toContain("sendPasswordResetEmail");
    expect(authGuard).toContain('window.location.replace("/login.html")');
    expect(firestoreRules).toContain("request.auth.uid == uid");
    expect(firestoreRules).toContain("allow read, write: if isOwner(uid)");

    expect(html).toContain("email and password sign-in through Firebase Authentication");
    expect(html).toContain("is not written into Simple Books business records or browser storage");
    expect(html).toContain("signed-in user ID to match the owner");
  });

  it("describes the verified user-specific Storage paths without broad guarantees", () => {
    expect(storageRules).toContain("request.auth.uid == userId");
    expect(storageRules).toContain("match /users/{userId}/attachments/bills/{billId}/{fileName}");
    expect(storageRules).toContain("match /users/{userId}/branding/company-logo");
    expect(html).toContain("authenticated, user-specific Firebase Storage paths");
    expect(html).toContain("retain the file path and a download link");
  });

  it("states the implemented Stripe flow without claiming full card storage", () => {
    expect(functionsSource).toContain("stripe.checkout.sessions.create");
    expect(functionsSource).toContain("stripe.billingPortal.sessions.create");
    expect(functionsSource).toContain("paymentMethodBrand: card.brand");
    expect(functionsSource).toContain("paymentMethodLast4: card.last4");
    expect(account).toContain("CHECKOUT_FUNCTION_URL");
    expect(account).toContain("BILLING_PORTAL_FUNCTION_URL");

    expect(html).toContain("Card entry takes place on Stripe's pages");
    expect(html).toContain("does not store the full card number");
    expect(html).not.toMatch(/PCI(?: DSS)? compliant|PCI certification/i);
  });

  it("explains AI inputs, review controls and enforced allowances accurately", () => {
    expect(assistant).toContain("buildOpenAIRequest(summary, validated.question");
    expect(assistantPrompt).toContain("sanitizeBusinessSummary");
    expect(assistantPrompt).toContain("[email removed]");
    expect(assistantPrompt).toContain("[link removed]");
    expect(assistant).toContain("AI_USAGE_ENFORCEMENT_ENABLED = true");
    expect(scanner).toContain('file_data: fileData');
    expect(scanner).toContain("INVOICE_SCANNING_USAGE_ENFORCEMENT_ENABLED = true");

    expect(html).toContain("use OpenAI through authenticated Firebase Functions");
    expect(html).toContain("limited, question-relevant summary");
    expect(html).toContain("does not create, edit or delete your records");
    expect(html).toContain("not saved until you complete the normal save action");
    expect(html).not.toMatch(/OpenAI (?:never|does not) (?:retain|train)|processed entirely (?:in|inside) Firebase/i);
  });

  it("explains browser-side CSV handling and review-only matches", () => {
    expect(banking).toContain("parseCsvPreview(await file.text())");
    expect(bankImport).toContain('services.collection(db,"users",ownerId,"bankTransactions")');
    expect(bankMatches).toContain("suggestBankMatches");

    expect(html).toContain("read, previewed and mapped in your browser");
    expect(html).toContain("does not upload the raw statement file");
    expect(html).toContain("does not ask for online-banking credentials");
    expect(html).toContain("are not applied automatically");
  });

  it("describes existing exports, demo data and monitoring without guarantees", () => {
    expect(exportsPage).toContain("buildFirestoreBackupData");
    expect(exportsPage).toContain("downloadExcelExport");
    expect(exportsPage).toContain("generateAccountantPackZip");
    expect(monitoring).toContain("sendDefaultPii: false");
    expect(monitoring).toContain("delete event.user");
    expect(monitoring).toContain("delete event.request.data");

    expect(html).toContain("Download core account, invoice, bill and client or customer records");
    expect(html).toContain("not presented as an automatic backup service or a disaster-recovery guarantee");
    expect(html).toContain("Do not enter real business or personal information into the demo");
    expect(html).toContain("removes user identity fields, request payloads, headers, cookies, query strings");
  });

  it("avoids unsupported security, compliance, retention and Storage-isolation claims", () => {
    expect(html).not.toMatch(
      /bank-grade|military-grade|unbreakable|ISO\s*27001|SOC\s*2|PCI\s*DSS|Cyber Essentials|FCA regulated|HMRC approved|GDPR certified|independently audited|penetration tested|encrypted at rest/i
    );
    expect(html).not.toMatch(
      /permanently delete (?:all|your)|retained for \d+|daily backups|automatic backups|99\.\d+% uptime|only you can access (?:files|uploads)|user-scoped (?:files|storage)/i
    );
    expect(html).toContain("Those claims are omitted unless they can be supported");
  });

  it("has no broken local links or assets", () => {
    const rewrites = new Set(
      firebase.hosting[0].rewrites.map(({ source }) => source)
    );
    const links = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((match) => match[1]);

    for (const link of links) {
      if (/^(?:https?:|mailto:)/.test(link)) continue;

      const [pathname, fragment] = link.split(/[?#]/);
      if (pathname === "/" && fragment) {
        const landingPage = readFileSync(projectFile("index.html"), "utf8");
        expect(landingPage, `${link} should point to a homepage section`)
          .toContain(`id="${fragment}"`);
        continue;
      }
      if (pathname === "/" || pathname === "") continue;
      if (rewrites.has(pathname)) continue;
      expect(
        existsSync(`${projectRoot}${pathname}`),
        `${link} should resolve to a local file`
      ).toBe(true);
    }
  });

  it("uses the shared accessible shell and responsive layouts", () => {
    expect(html).toContain(
      '<link rel="stylesheet" href="/assets/guides/guides.css">'
    );
    expect(html).toContain(
      '<script type="module" src="/assets/guides/public-shell.js"></script>'
    );
    expect(sharedCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.site-links[\s\S]*?display: none[\s\S]*?\.site-actions \.menu-button[\s\S]*?display: inline-flex/
    );
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.data-grid,[\s\S]*?grid-template-columns: 1fr/
    );
  });
});
