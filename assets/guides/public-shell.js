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

const footerNavigation = document.querySelector(".footer-links");
const contactLink = footerNavigation?.querySelector('a[href^="mailto:"]') || null;

for (const [href, label] of [["/privacy.html", "Privacy"], ["/terms.html", "Terms"]]) {
  if (!footerNavigation || footerNavigation.querySelector(`a[href="${href}"]`)) continue;
  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;
  footerNavigation.insertBefore(link, contactLink);
}
