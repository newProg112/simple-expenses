// Filtering is entirely local so the public catalogue never depends on Firebase.
const searchInput = document.querySelector("#guide-search");
const filterButtons = [...document.querySelectorAll("[data-category-filter]")];
const guideCards = [...document.querySelectorAll("[data-guide-card]")];
const featuredSection = document.querySelector("#featured-guides");
const guideCount = document.querySelector("#guide-count");
const emptyState = document.querySelector("#empty-state");
const clearFiltersButton = document.querySelector("#clear-filters");
let activeCategory = "All guides";

function normalise(value) {
  return value.toLocaleLowerCase("en-GB").trim();
}

function updateGuides() {
  const query = normalise(searchInput?.value || "");
  let visibleCount = 0;

  guideCards.forEach((card) => {
    const categoryMatches = activeCategory === "All guides"
      || card.dataset.category === activeCategory;
    const searchMatches = !query || normalise(card.dataset.search || "").includes(query);
    const isVisible = categoryMatches && searchMatches;

    card.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  if (guideCount) {
    guideCount.textContent = `${visibleCount} ${visibleCount === 1 ? "guide" : "guides"}`;
  }
  if (emptyState) emptyState.hidden = visibleCount !== 0;
  if (featuredSection) {
    featuredSection.hidden = activeCategory !== "All guides" || Boolean(query);
  }
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeCategory = button.dataset.categoryFilter;
    filterButtons.forEach((candidate) => {
      const selected = candidate === button;
      candidate.classList.toggle("is-active", selected);
      candidate.setAttribute("aria-pressed", String(selected));
    });
    updateGuides();
  });
});

searchInput?.addEventListener("input", updateGuides);
clearFiltersButton?.addEventListener("click", () => {
  activeCategory = "All guides";
  if (searchInput) searchInput.value = "";
  filterButtons.forEach((button) => {
    const selected = button.dataset.categoryFilter === "All guides";
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  searchInput?.focus();
  updateGuides();
});

updateGuides();
