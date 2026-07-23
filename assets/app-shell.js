export const NAVIGATION_GROUPS = Object.freeze([
  Object.freeze({
    label: "",
    items: Object.freeze([
      Object.freeze({ key: "dashboard", label: "Dashboard", href: "/dashboard.html" })
    ])
  }),
  Object.freeze({
    label: "Sales",
    items: Object.freeze([
      Object.freeze({ key: "invoices", label: "Invoices", href: "/resources/tools/invoice-generator.html" }),
      Object.freeze({ key: "clients", label: "Clients", href: "/resources/tools/client-tracker.html" })
    ])
  }),
  Object.freeze({
    label: "Purchases",
    items: Object.freeze([
      Object.freeze({ key: "bills", label: "Bills", href: "/resources/tools/bills.html" }),
      Object.freeze({ key: "expenses", label: "Expenses", href: "/resources/tools/expenses.html" })
    ])
  }),
  Object.freeze({
    label: "Work",
    items: Object.freeze([
      Object.freeze({ key: "projects", label: "Projects", href: "/resources/tools/projects.html" })
    ])
  }),
  Object.freeze({
    label: "Planning",
    items: Object.freeze([
      Object.freeze({ key: "budgets", label: "Budgets", href: "/resources/tools/budgets.html" }),
      Object.freeze({ key: "cashflow", label: "Cashflow", href: "/resources/tools/cashflow.html" })
    ])
  }),
  Object.freeze({
    label: "Accounting",
    items: Object.freeze([
      Object.freeze({ key: "trial-balance", label: "Trial Balance", href: "/resources/tools/trial-balance.html" }),
      Object.freeze({ key: "general-ledger", label: "General Ledger", href: "/resources/tools/general-ledger.html" }),
      Object.freeze({ key: "profit-loss", label: "Profit & Loss", href: "/resources/tools/profit-loss.html" }),
      Object.freeze({ key: "balance-sheet", label: "Balance Sheet", href: "/resources/tools/balance-sheet.html" })
    ])
  }),
  Object.freeze({
    label: "",
    items: Object.freeze([
      Object.freeze({ key: "ai-assistant", label: "AI Assistant", href: "/resources/tools/ai-assistant.html" }),
      Object.freeze({ key: "exports", label: "Exports", href: "/exports.html" }),
      Object.freeze({ key: "account", label: "Account", href: "/account.html" })
    ])
  })
]);

const ROUTE_ALIASES = Object.freeze({
  "/resources/tools/project-details.html": "projects"
});

export function normalizePathname(pathname = "/"){
  const withoutQueryOrHash = String(pathname).split(/[?#]/, 1)[0] || "/";
  let normalized = withoutQueryOrHash.startsWith("/")
    ? withoutQueryOrHash
    : `/${withoutQueryOrHash}`;

  normalized = normalized.replace(/\/{2,}/g, "/");

  if(normalized.length > 1){
    normalized = normalized.replace(/\/+$/, "");
  }

  return normalized.toLowerCase();
}

export function activeNavigationKey(pathname){
  const normalizedPath = normalizePathname(pathname);

  if(ROUTE_ALIASES[normalizedPath]){
    return ROUTE_ALIASES[normalizedPath];
  }

  for(const group of NAVIGATION_GROUPS){
    const item = group.items.find(candidate =>
      normalizePathname(candidate.href) === normalizedPath
    );

    if(item){
      return item.key;
    }
  }

  return "";
}

function createNavigationLink(item, activeKey){
  const link = document.createElement("a");
  link.className = "sb-shell-link";
  link.href = item.href;
  link.dataset.navKey = item.key;
  link.textContent = item.label;

  if(item.key === activeKey){
    link.classList.add("is-active");
    link.setAttribute("aria-current", "page");
  }

  return link;
}

function buildNavigation(activeKey){
  const navigation = document.createElement("nav");
  navigation.className = "sb-shell-navigation";
  navigation.setAttribute("aria-label", "Main navigation");

  for(const group of NAVIGATION_GROUPS){
    const section = document.createElement("section");
    section.className = "sb-shell-group";

    if(group.label){
      const heading = document.createElement("h2");
      heading.className = "sb-shell-group-title";
      heading.textContent = group.label;
      section.append(heading);
    }else{
      section.classList.add("sb-shell-group-ungrouped");
    }

    const links = document.createElement("div");
    links.className = "sb-shell-links";

    for(const item of group.items){
      links.append(createNavigationLink(item, activeKey));
    }

    section.append(links);
    navigation.append(section);
  }

  return navigation;
}

function renderShell(mount){
  const drawerId = "simpleBooksNavigationDrawer";
  const activeKey = activeNavigationKey(window.location.pathname);

  const mobileHeader = document.createElement("header");
  mobileHeader.className = "sb-shell-mobile-header";

  const mobileBrand = document.createElement("a");
  mobileBrand.className = "sb-shell-mobile-brand";
  mobileBrand.href = "/dashboard.html";
  mobileBrand.innerHTML = '<img src="/assets/logo.png" alt="Simple Books">';

  const menuButton = document.createElement("button");
  menuButton.className = "sb-shell-menu-button";
  menuButton.type = "button";
  menuButton.setAttribute("aria-label", "Open navigation");
  menuButton.setAttribute("aria-controls", drawerId);
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.innerHTML = "<span></span><span></span><span></span>";

  mobileHeader.append(mobileBrand, menuButton);

  const backdrop = document.createElement("button");
  backdrop.className = "sb-shell-backdrop";
  backdrop.type = "button";
  backdrop.tabIndex = -1;
  backdrop.setAttribute("aria-label", "Close navigation");
  backdrop.hidden = true;

  const sidebar = document.createElement("aside");
  sidebar.className = "sb-shell-sidebar";
  sidebar.id = drawerId;
  sidebar.setAttribute("aria-label", "Application navigation");

  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "sb-shell-sidebar-header";

  const brand = document.createElement("a");
  brand.className = "sb-shell-brand";
  brand.href = "/dashboard.html";
  brand.innerHTML = '<img src="/assets/logo.png" alt="Simple Books">';

  const closeButton = document.createElement("button");
  closeButton.className = "sb-shell-close-button";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close navigation");
  closeButton.innerHTML = "&times;";

  sidebarHeader.append(brand, closeButton);
  sidebar.append(sidebarHeader, buildNavigation(activeKey));
  mount.replaceChildren(mobileHeader, backdrop, sidebar);

  let focusBeforeOpen = null;
  const appContent = document.querySelector(".app-content");

  function focusableElements(){
    return [...sidebar.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.hidden);
  }

  function closeDrawer({ restoreFocus = true } = {}){
    if(!document.body.classList.contains("sb-drawer-open")){
      return;
    }

    document.body.classList.remove("sb-drawer-open");
    document.documentElement.classList.remove("sb-drawer-scroll-locked");
    backdrop.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Open navigation");

    if(appContent){
      appContent.inert = false;
    }

    if(restoreFocus && focusBeforeOpen instanceof HTMLElement){
      focusBeforeOpen.focus();
    }
  }

  function openDrawer(){
    focusBeforeOpen = document.activeElement;
    document.body.classList.add("sb-drawer-open");
    document.documentElement.classList.add("sb-drawer-scroll-locked");
    backdrop.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    menuButton.setAttribute("aria-label", "Close navigation");

    if(appContent){
      appContent.inert = true;
    }

    closeButton.focus();
  }

  menuButton.addEventListener("click", () => {
    if(document.body.classList.contains("sb-drawer-open")){
      closeDrawer();
    }else{
      openDrawer();
    }
  });

  closeButton.addEventListener("click", () => closeDrawer());
  backdrop.addEventListener("click", () => closeDrawer());

  sidebar.addEventListener("click", event => {
    if(event.target.closest("a[href]")){
      closeDrawer({ restoreFocus: false });
    }
  });

  document.addEventListener("keydown", event => {
    if(!document.body.classList.contains("sb-drawer-open")){
      return;
    }

    if(event.key === "Escape"){
      event.preventDefault();
      closeDrawer();
      return;
    }

    if(event.key !== "Tab"){
      return;
    }

    const focusable = focusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if(!first || !last){
      event.preventDefault();
      return;
    }

    if(event.shiftKey && document.activeElement === first){
      event.preventDefault();
      last.focus();
    }else if(!event.shiftKey && document.activeElement === last){
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener("resize", () => {
    if(window.matchMedia("(min-width: 901px)").matches){
      closeDrawer({ restoreFocus: false });
    }
  });

  mount.dataset.shellReady = "true";
}

function setShellVisible(visible){
  const mount = document.querySelector("[data-app-navigation]");

  if(!mount){
    return;
  }

  mount.hidden = !visible;
  document.body.classList.toggle("app-shell-active", visible);

  if(!visible){
    document.body.classList.remove("sb-drawer-open");
    document.documentElement.classList.remove("sb-drawer-scroll-locked");

    const appContent = document.querySelector(".app-content");
    const backdrop = mount.querySelector(".sb-shell-backdrop");
    const menuButton = mount.querySelector(".sb-shell-menu-button");

    if(appContent){
      appContent.inert = false;
    }

    if(backdrop){
      backdrop.hidden = true;
    }

    if(menuButton){
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-label", "Open navigation");
    }
  }
}

export function initialiseApplicationShell(){
  const mount = document.querySelector("[data-app-navigation]");

  if(!mount || mount.dataset.shellReady === "true"){
    return;
  }

  renderShell(mount);
  setShellVisible(!mount.hasAttribute("data-auth-controlled"));
}

if(typeof window !== "undefined" && typeof document !== "undefined"){
  window.SimpleBooksAppShell = Object.freeze({
    setVisible: setShellVisible
  });

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initialiseApplicationShell, { once: true });
  }else{
    initialiseApplicationShell();
  }
}
