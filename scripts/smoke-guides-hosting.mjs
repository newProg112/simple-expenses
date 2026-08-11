import { GUIDES, guideUrl } from "../assets/guides/guide-data.js";

const baseUrl = process.env.GUIDES_TEST_BASE_URL || "http://127.0.0.1:5000";

async function expectPage(path, expectedText, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  const body = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}; expected ${expectedStatus}`);
  }
  if (!body.includes(expectedText)) {
    throw new Error(`${path} did not contain the expected text: ${expectedText}`);
  }
}

await expectPage("/guides", "<h1>Simple Books Guides</h1>");
await expectPage(
  "/about",
  "<h1>Business software built to keep things understandable</h1>"
);
await expectPage(
  "/whats-new",
  "<h1>See what's new in Simple Books</h1>"
);
await expectPage("/admin", "<h1>Admin Dashboard</h1>");

for (const guide of GUIDES) {
  await expectPage(guideUrl(guide), `<h1>${guide.title.replace(/&/g, "&amp;")}</h1>`);
}

await expectPage("/guides/not-a-real-guide", "Page not found", 404);

console.log(`Firebase Hosting smoke test passed for /about, /whats-new, /admin, /guides, ${GUIDES.length} clean guide URLs, and the guide 404.`);
