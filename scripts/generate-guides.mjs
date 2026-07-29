import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  GUIDE_CATEGORIES,
  GUIDE_LAST_UPDATED,
  GUIDES,
  guideUrl,
  relatedGuides
} from "../assets/guides/guide-data.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
// Generated HTML lives outside /guides so Firebase does not add a trailing slash
// before evaluating the clean-URL rewrites.
const guidesRoot = fileURLToPath(new URL("../guide-pages/", import.meta.url));
const productionDomain = "https://simple-books.co.uk";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function publicHeader({ guidesCurrent = false } = {}) {
  return `<header class="site-header">
  <div class="wrap">
    <div class="site-nav">
      <a href="/" aria-label="Simple Books home">
        <img class="logo" src="/assets/logo.png" alt="Simple Books">
      </a>
      <nav aria-label="Primary navigation">
        <ul class="site-links">
          <li><a href="/#features">Features</a></li>
          <li><a href="/#pricing">Pricing</a></li>
          <li><a href="/guides"${guidesCurrent ? ' aria-current="page"' : ""}>Guides</a></li>
          <li><a href="/#contact">Contact</a></li>
        </ul>
      </nav>
      <div class="site-actions">
        <a class="button" href="/login.html">Login</a>
        <a class="button primary" href="/signup.html">Sign Up</a>
        <button class="button menu-button" id="menu-button" type="button" aria-expanded="false" aria-controls="mobile-navigation">Menu</button>
      </div>
    </div>
    <nav class="mobile-navigation" id="mobile-navigation" aria-label="Mobile navigation">
      <a href="/#features">Features</a>
      <a href="/#pricing">Pricing</a>
      <a href="/guides"${guidesCurrent ? ' aria-current="page"' : ""}>Guides</a>
      <a href="/#contact">Contact</a>
      <a href="/login.html">Login</a>
      <a href="/signup.html">Sign Up</a>
    </nav>
  </div>
</header>`;
}

function publicFooter() {
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <strong>Simple Books</strong><br>
        Simple business software for work, finances, planning and reporting.
      </div>
      <nav class="footer-links" aria-label="Footer navigation">
        <a href="/">Home</a>
        <a href="/guides">Guides</a>
        <a href="/login.html">Login</a>
        <a href="/signup.html">Sign Up</a>
        <a href="mailto:adam@simple-books.co.uk">Contact</a>
      </nav>
    </div>
    <p class="footer-fine">Simple Books is business management software and is not a substitute for professional financial or tax advice.</p>
    <p class="footer-fine">&copy; <span id="footer-year"></span> Simple Books. All rights reserved.</p>
  </div>
</footer>`;
}

function guideCard(guide, { compact = false } = {}) {
  const searchText = [
    guide.title,
    guide.description,
    guide.category,
    ...guide.keywords
  ].join(" ");
  const classes = `guide-card${guide.featured ? " featured" : ""}`;

  return `<a class="${classes}" href="${guideUrl(guide)}"${compact ? "" : ` data-guide-card data-category="${escapeHtml(guide.category)}" data-search="${escapeHtml(searchText)}"`}>
  <div class="card-badges">
    <span class="category-badge">${escapeHtml(guide.category)}</span>
    ${guide.featured ? '<span class="featured-badge">Featured</span>' : ""}
  </div>
  <h3>${escapeHtml(guide.title)}</h3>
  <p>${escapeHtml(guide.description)}</p>
  <div class="card-meta">
    <span>${guide.readTime} min read</span>
    <span class="card-arrow" aria-hidden="true">&rarr;</span>
  </div>
</a>`;
}

function guidesIndexHtml() {
  const canonicalUrl = `${productionDomain}/guides`;
  const description = "Learn how to use Simple Books and understand key accounting concepts with clear guides for small businesses.";
  const featuredCards = GUIDES.filter((guide) => guide.featured)
    .map((guide) => guideCard(guide, { compact: true }))
    .join("\n");
  const allCards = GUIDES.map((guide) => guideCard(guide)).join("\n");
  const categoryButtons = ["All guides", ...GUIDE_CATEGORIES]
    .map((category, index) => `<button class="filter-button${index === 0 ? " is-active" : ""}" type="button" data-category-filter="${escapeHtml(category)}" aria-pressed="${index === 0}">${escapeHtml(category)}</button>`)
    .join("\n");
  const itemList = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Simple Books Guides",
    description,
    url: canonicalUrl,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: GUIDES.map((guide, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: guide.title,
        url: `${productionDomain}${guideUrl(guide)}`
      }))
    }
  };

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Simple Books Guides | Product help and accounting basics</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Simple Books Guides">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <script type="application/ld+json">${JSON.stringify(itemList)}</script>
  <link rel="stylesheet" href="/assets/guides/guides.css">
  <script src="/assets/sentry-monitoring.js"></script>
</head>
<body>
${publicHeader({ guidesCurrent: true })}
<main>
  <section class="guide-hero">
    <div class="wrap">
      <div class="hero-panel">
        <h1>Simple Books Guides</h1>
        <p class="hero-intro">Learn how to use Simple Books and understand key accounting concepts with practical, easy-to-follow guides.</p>
        <div class="search-form" role="search">
          <label class="search-label" for="guide-search">Search the guides</label>
          <input class="search-input" id="guide-search" type="search" placeholder="Search by topic, task or accounting term" autocomplete="off">
        </div>
      </div>
    </div>
  </section>

  <section class="content-section" aria-labelledby="categories-heading">
    <div class="wrap">
      <div class="section-heading">
        <div>
          <h2 id="categories-heading">Browse by category</h2>
          <p>Choose a topic or view every guide.</p>
        </div>
      </div>
      <div class="filters" aria-label="Filter guides by category">
        ${categoryButtons}
      </div>
    </div>
  </section>

  <section class="content-section" id="featured-guides" aria-labelledby="featured-heading">
    <div class="wrap">
      <div class="section-heading">
        <div>
          <h2 id="featured-heading">Featured guides</h2>
          <p>Useful places to begin with Simple Books and everyday accounting.</p>
        </div>
      </div>
      <div class="guide-grid featured-grid">
        ${featuredCards}
      </div>
    </div>
  </section>

  <section class="content-section" aria-labelledby="all-guides-heading">
    <div class="wrap">
      <div class="section-heading">
        <div>
          <h2 id="all-guides-heading">All guides</h2>
          <p>Product guidance and approachable accounting explanations.</p>
        </div>
        <p class="guide-count" id="guide-count" aria-live="polite">${GUIDES.length} guides</p>
      </div>
      <div class="guide-grid" id="guide-results">
        ${allCards}
      </div>
      <div class="empty-state" id="empty-state" hidden>
        <h3>No guides found</h3>
        <p>Try a different search term or clear the current category.</p>
        <button class="button primary" id="clear-filters" type="button">Clear filters</button>
      </div>
    </div>
  </section>
</main>
${publicFooter()}
<script type="module" src="/assets/guides/guides-index.js"></script>
<script type="module" src="/assets/guides/public-shell.js"></script>
</body>
</html>
`;
}

function guideStructuredData(guide) {
  const canonicalUrl = `${productionDomain}${guideUrl(guide)}`;
  return {
    "@context": "https://schema.org",
    "@type": guide.format === "how-to" ? "TechArticle" : "Article",
    headline: guide.title,
    description: guide.description,
    dateModified: GUIDE_LAST_UPDATED,
    datePublished: GUIDE_LAST_UPDATED,
    inLanguage: "en-GB",
    mainEntityOfPage: canonicalUrl,
    author: {
      "@type": "Organization",
      name: "Simple Books",
      url: productionDomain
    },
    publisher: {
      "@type": "Organization",
      name: "Simple Books",
      url: productionDomain
    }
  };
}

function guideBreadcrumbData(guide) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: productionDomain },
      { "@type": "ListItem", position: 2, name: "Guides", item: `${productionDomain}/guides` },
      { "@type": "ListItem", position: 3, name: guide.category, item: `${productionDomain}/guides#all-guides-heading` },
      { "@type": "ListItem", position: 4, name: guide.title, item: `${productionDomain}${guideUrl(guide)}` }
    ]
  };
}

function guidePageHtml(guide, index) {
  const canonicalUrl = `${productionDomain}${guideUrl(guide)}`;
  const previousGuide = GUIDES[index - 1];
  const nextGuide = GUIDES[index + 1];
  const related = relatedGuides(guide);
  const updatedDisplay = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${GUIDE_LAST_UPDATED}T00:00:00Z`));
  const relatedCards = related.map((item) => `<a class="related-card" href="${guideUrl(item)}">
  <span class="related-card-meta">${escapeHtml(item.category)} · ${item.readTime} min read</span>
  <span class="related-card-title"><strong>${escapeHtml(item.title)}</strong><span class="card-arrow" aria-hidden="true">&rarr;</span></span>
</a>`).join("\n");

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(guide.title)} | Simple Books Guides</title>
  <meta name="description" content="${escapeHtml(guide.description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(guide.title)} | Simple Books Guides">
  <meta property="og:description" content="${escapeHtml(guide.description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <script type="application/ld+json">${JSON.stringify(guideStructuredData(guide))}</script>
  <script type="application/ld+json">${JSON.stringify(guideBreadcrumbData(guide))}</script>
  <link rel="stylesheet" href="/assets/guides/guides.css">
  <script src="/assets/sentry-monitoring.js"></script>
</head>
<body>
${publicHeader({ guidesCurrent: true })}
<main>
  <div class="wrap">
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li><a href="/">Home</a></li>
        <li><a href="/guides">Guides</a></li>
        <li><a href="/guides#all-guides-heading">${escapeHtml(guide.category)}</a></li>
        <li aria-current="page">${escapeHtml(guide.title)}</li>
      </ol>
    </nav>
    <header class="guide-header">
      <p class="eyebrow">${escapeHtml(guide.category)}</p>
      <h1>${escapeHtml(guide.title)}</h1>
      <p class="guide-intro">${escapeHtml(guide.description)}</p>
      <p class="guide-meta">
        <span>${guide.readTime} minute read</span>
        <span>Last updated <time datetime="${GUIDE_LAST_UPDATED}">${updatedDisplay}</time></span>
      </p>
    </header>

    <div class="guide-layout">
      <article class="guide-article">
        <section>
          <h2>Introduction</h2>
          <p>This guide is currently being prepared. It will soon contain clear, practical guidance on ${escapeHtml(guide.title)}.</p>
          <div class="placeholder-note">
            <strong>Coming soon</strong>
            Detailed step-by-step guidance and practical examples will be added here.
          </div>
        </section>
        <section>
          <h2>What this guide will cover</h2>
          <p>The completed guide will explain the key ideas, the information to have ready and where this topic fits within Simple Books.</p>
        </section>
        <section>
          <h2>Step-by-step guidance</h2>
          <p>A concise sequence of product steps or learning points will appear here, with clear outcomes and supporting screenshots where they add value.</p>
        </section>
        <section>
          <h2>Example</h2>
          <p>A realistic small-business example will show how the topic works in practice without using personal or customer data.</p>
        </section>
        <section>
          <h2>Things to remember</h2>
          <ul class="remember-list">
            <li>Review the completed record before relying on it for reporting.</li>
            <li>Keep supporting information organised and easy to find.</li>
            <li>Ask a qualified professional when you need advice specific to your circumstances.</li>
          </ul>
        </section>
        <section>
          <h2>Summary</h2>
          <p>The finished summary will recap the important points and direct you to the most useful next guide.</p>
        </section>
      </article>

      <aside class="table-of-contents" aria-labelledby="contents-heading">
        <h2 id="contents-heading">On this page</h2>
        <ol id="table-of-contents-list"></ol>
      </aside>
    </div>
  </div>

  <div class="guide-footer-content">
    <div class="wrap">
      <section class="related-guides" aria-labelledby="related-heading">
        <h2 id="related-heading">Related guides</h2>
        <div class="related-grid">
          ${relatedCards}
        </div>
      </section>
      <nav class="guide-pagination" aria-labelledby="continue-heading">
        <h2 id="continue-heading">Continue reading</h2>
        <div class="pagination-links${!previousGuide ? " only-next" : !nextGuide ? " only-previous" : ""}">
          ${previousGuide ? `<a class="pagination-link previous" href="${guideUrl(previousGuide)}"><span>Previous guide</span><strong>${escapeHtml(previousGuide.title)}</strong></a>` : ""}
          ${nextGuide ? `<a class="pagination-link next" href="${guideUrl(nextGuide)}"><span>Next guide</span><strong>${escapeHtml(nextGuide.title)}</strong></a>` : ""}
        </div>
      </nav>
      <a class="back-link" href="/guides">Back to all Simple Books guides</a>
    </div>
  </div>
</main>
${publicFooter()}
<script type="module" src="/assets/guides/guide-page.js"></script>
<script type="module" src="/assets/guides/public-shell.js"></script>
</body>
</html>
`;
}

await mkdir(guidesRoot, { recursive: true });
await writeFile(`${guidesRoot}index.html`, guidesIndexHtml(), "utf8");

await Promise.all(
  GUIDES.map((guide, index) =>
    writeFile(`${guidesRoot}${guide.slug}.html`, guidePageHtml(guide, index), "utf8")
  )
);

console.log(`Generated the Guides index and ${GUIDES.length} guide pages in ${projectRoot}`);
