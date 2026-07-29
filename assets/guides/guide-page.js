// Build the table of contents from the static article headings.
const tocList = document.querySelector("#table-of-contents-list");
const articleHeadings = [...document.querySelectorAll(".guide-article h2")];

function stableAnchorId(text) {
  return text
    .toLocaleLowerCase("en-GB")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

if (tocList) {
  articleHeadings.forEach((heading) => {
    heading.id = heading.id || stableAnchorId(heading.textContent);
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent;
    item.append(link);
    tocList.append(item);
  });
}
