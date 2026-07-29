import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GUIDE_CATEGORIES,
  GUIDES,
  guideUrl,
  relatedGuides
} from "../assets/guides/guide-data.js";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);
const guidesIndex = readFileSync(projectFile("guide-pages/index.html"), "utf8");
const indexScript = readFileSync(projectFile("assets/guides/guides-index.js"), "utf8");
const guideScript = readFileSync(projectFile("assets/guides/guide-page.js"), "utf8");
const hosting = JSON.parse(readFileSync(projectFile("firebase.json"), "utf8"));

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

describe("public Guides data and index", () => {
  it("keeps all 20 unique guides in the seven requested categories", () => {
    expect(GUIDES).toHaveLength(20);
    expect(new Set(GUIDES.map((guide) => guide.slug)).size).toBe(20);
    expect(new Set(GUIDES.map((guide) => guide.category))).toEqual(new Set(GUIDE_CATEGORIES));
    expect(GUIDES.filter((guide) => guide.featured).map((guide) => guide.title)).toEqual([
      "How to create an invoice",
      "Recording business expenses",
      "Understanding Profit & Loss",
      "What is VAT?"
    ]);

    for (const guide of GUIDES) {
      expect(guide.description.length).toBeGreaterThan(30);
      expect(guide.keywords.length).toBeGreaterThan(2);
      expect(guide.readTime).toBeGreaterThan(0);
      expect(["article", "how-to"]).toContain(guide.format);
    }
  });

  it("pre-renders the guide catalogue and accessible filtering controls", () => {
    expect(guidesIndex).toContain("<h1>Simple Books Guides</h1>");
    expect(guidesIndex).toContain('<label class="search-label" for="guide-search">');
    expect(guidesIndex).toContain('aria-label="Filter guides by category"');
    expect(guidesIndex).toContain('id="empty-state" hidden');
    expect(guidesIndex).toContain('id="clear-filters"');
    expect(occurrences(guidesIndex, / data-guide-card/g)).toBe(20);

    for (const category of ["All guides", ...GUIDE_CATEGORIES]) {
      expect(guidesIndex).toContain(`data-category-filter="${category.replace(/&/g, "&amp;")}"`);
    }
    for (const guide of GUIDES) {
      expect(guidesIndex).toContain(`href="${guideUrl(guide)}"`);
      expect(guidesIndex).toContain(guide.title.replace(/&/g, "&amp;"));
    }
  });

  it("combines category and keyword search and provides a clear action", () => {
    expect(indexScript).toContain("categoryMatches && searchMatches");
    expect(indexScript).toContain("card.dataset.search");
    expect(indexScript).toContain('activeCategory = "All guides"');
    expect(indexScript).toContain('searchInput.value = ""');
    expect(indexScript).toContain("aria-pressed");
  });

  it("has complete homepage SEO metadata and collection structured data", () => {
    expect(guidesIndex).toContain("<title>Simple Books Guides | Product help and accounting basics</title>");
    expect(guidesIndex).toContain('<link rel="canonical" href="https://simple-books.co.uk/guides">');
    expect(guidesIndex).toContain('<meta property="og:url" content="https://simple-books.co.uk/guides">');
    expect(guidesIndex).toContain('"@type":"CollectionPage"');
    expect(occurrences(guidesIndex, /<h1>/g)).toBe(1);
  });
});

describe("generated guide pages", () => {
  it("creates a static, indexable page with complete SEO metadata for every slug", () => {
    GUIDES.forEach((guide) => {
      const path = `guide-pages/${guide.slug}.html`;
      expect(existsSync(projectFile(path))).toBe(true);
      const html = readFileSync(projectFile(path), "utf8");
      const canonical = `https://simple-books.co.uk${guideUrl(guide)}`;

      expect(html).toContain(`<title>${guide.title.replace(/&/g, "&amp;")} | Simple Books Guides</title>`);
      expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
      expect(html).toContain(`<meta property="og:url" content="${canonical}">`);
      expect(html).toContain(`<h1>${guide.title.replace(/&/g, "&amp;")}</h1>`);
      expect(html).toContain(guide.description.replace(/&/g, "&amp;"));
      expect(html).toContain("<h2>Introduction</h2>");
      expect(html).toContain("<h2>Summary</h2>");
      expect(html).toContain('aria-label="Breadcrumb"');
      expect(html).toContain('id="table-of-contents-list"');
      expect(html).toContain("Related guides");
      expect(html).toContain("Back to all Simple Books guides");
      expect(html).toContain(guide.format === "how-to" ? '"@type":"TechArticle"' : '"@type":"Article"');
      expect(occurrences(html, /<h1>/g)).toBe(1);
    });
  });

  it("derives related, previous and next navigation from the central ordering", () => {
    GUIDES.forEach((guide, index) => {
      const html = readFileSync(projectFile(`guide-pages/${guide.slug}.html`), "utf8");
      for (const related of relatedGuides(guide)) {
        expect(html).toContain(`href="${guideUrl(related)}"`);
      }
      if (index > 0) {
        expect(html).toContain(`<span>Previous guide</span><strong>${GUIDES[index - 1].title.replace(/&/g, "&amp;")}</strong>`);
      }
      if (index < GUIDES.length - 1) {
        expect(html).toContain(`<span>Next guide</span><strong>${GUIDES[index + 1].title.replace(/&/g, "&amp;")}</strong>`);
      }
    });
  });

  it("builds stable table-of-contents anchors from article H2 headings", () => {
    expect(guideScript).toContain('document.querySelectorAll(".guide-article h2")');
    expect(guideScript).toContain("heading.id = heading.id || stableAnchorId");
    expect(guideScript).toContain('link.href = `#${heading.id}`');
  });
});

describe("Firebase Hosting guide routes", () => {
  it("rewrites only the index and intended clean guide paths to static HTML", () => {
    const mainHosting = hosting.hosting.find((site) => site.target === "main");
    const guideRewrites = mainHosting.rewrites.filter((rewrite) => rewrite.source.startsWith("/guides"));
    const expectedRoutes = [
      { source: "/guides", destination: "/guide-pages/index.html" },
      ...GUIDES.map((guide) => ({
        source: guideUrl(guide),
        destination: `/guide-pages/${guide.slug}.html`
      }))
    ];

    expect(guideRewrites).toEqual(expectedRoutes);
    expect(guideRewrites).toHaveLength(21);
    expect(guideRewrites.some((rewrite) => rewrite.source.includes("**"))).toBe(false);
  });

  it("keeps invalid guide paths on the real 404 page with a guide-specific message", () => {
    const notFound = readFileSync(projectFile("404.html"), "utf8");
    expect(notFound).toContain('<meta name="robots" content="noindex">');
    expect(notFound).toContain('window.location.pathname.startsWith("/guides/")');
    expect(notFound).toContain("We couldn’t find that guide");
    expect(notFound).toContain('href="/guides"');
  });
});
