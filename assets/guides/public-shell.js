// Shared public navigation behavior for the index and individual guides.
const menuButton = document.querySelector("#menu-button");
const mobileNavigation = document.querySelector("#mobile-navigation");

menuButton?.addEventListener("click", () => {
  const isOpen = mobileNavigation.classList.toggle("is-open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

mobileNavigation?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mobileNavigation.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
  });
});

const year = document.querySelector("#footer-year");
if (year) year.textContent = new Date().getFullYear();
