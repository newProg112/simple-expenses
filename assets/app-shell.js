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

export const SIDEBAR_STATE_STORAGE_KEY = "simple-books:app-shell:sidebar-state:v1";
export const SIDEBAR_SCROLL_STORAGE_KEY = "simple-books:app-shell:sidebar-scroll:v1";

export const NAVIGATION_ICONS = Object.freeze({
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  invoices: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  clients: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  bills: '<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21V3Z"/><path d="M10 8h4M10 12h4M10 16h4"/>',
  expenses: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  projects: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/>',
  budgets: '<circle cx="12" cy="12" r="9"/><path d="M16 8.5c-.7-.8-1.8-1.2-3-1.2-1.7 0-3 1-3 2.3 0 3.5 6 1.5 6 5 0 1.3-1.3 2.3-3 2.3-1.2 0-2.3-.4-3-1.2M13 5.5v13"/>',
  cashflow: '<path d="M4 7h13M13 3l4 4-4 4M20 17H7M11 13l-4 4 4 4"/>',
  "trial-balance": '<path d="M12 3v18M5 6h14M7 6l-4 7h8L7 6ZM17 6l-4 7h8l-4-7ZM8 21h8"/>',
  "general-ledger": '<path d="M4 4h16v16H4zM8 4v16M12 8h5M12 12h5M12 16h3"/>',
  "profit-loss": '<path d="M4 19V5M4 19h16M7 15l4-4 3 2 5-6"/><path d="m16 7h3v3"/>',
  "balance-sheet": '<path d="M5 3h14v18H5zM9 3v18M12 8h4M12 12h4M12 16h4"/>',
  "ai-assistant": '<path d="m12 3 1.3 4.2L17 9l-3.7 1.8L12 15l-1.3-4.2L7 9l3.7-1.8L12 3ZM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3ZM5 3l.7 2.3L8 6l-2.3.7L5 9l-.7-2.3L2 6l2.3-.7L5 3Z"/>',
  exports: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
});

const ROUTE_ALIASES = Object.freeze({
  "/resources/tools/project-details.html": "projects"
});

export function normaliseSidebarState(value){
  return value === "collapsed" || value === "expanded" ? value : "expanded";
}

export function sidebarStateFromStorage(storage){
  return normaliseSidebarState(readStorage(storage, SIDEBAR_STATE_STORAGE_KEY));
}

export function nextSidebarState(state){
  return normaliseSidebarState(state) === "expanded" ? "collapsed" : "expanded";
}

export function parseStoredScrollPosition(value){
  if(value === null || value === undefined || value === ""){
    return null;
  }

  const position = Number(value);
  return Number.isFinite(position) && position >= 0 ? position : null;
}

export function clampScrollPosition(position, maximum){
  const safePosition = Number.isFinite(Number(position)) ? Number(position) : 0;
  const safeMaximum = Number.isFinite(Number(maximum)) ? Math.max(0, Number(maximum)) : 0;
  return Math.min(Math.max(0, safePosition), safeMaximum);
}

export function shouldSaveSidebarScroll(event, link, currentOrigin){
  if(!event || !link || event.defaultPrevented || event.button !== 0){
    return false;
  }

  if(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey){
    return false;
  }

  if(link.hasAttribute("download") || (link.target && link.target.toLowerCase() === "_blank")){
    return false;
  }

  try{
    const destination = new URL(link.href, currentOrigin);
    return destination.origin === currentOrigin;
  }catch(_error){
    return false;
  }
}

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

function readStorage(storage, key){
  try{
    return storage.getItem(key);
  }catch(_error){
    return null;
  }
}

function writeStorage(storage, key, value){
  try{
    storage.setItem(key, value);
  }catch(_error){
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function getBrowserStorage(name){
  try{
    return window[name];
  }catch(_error){
    return null;
  }
}

function createNavigationIcon(key){
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.classList.add("sb-shell-link-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.8");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.innerHTML = NAVIGATION_ICONS[key] || "";
  return icon;
}

function createNavigationLink(item, activeKey){
  const link = document.createElement("a");
  link.className = "sb-shell-link";
  link.href = item.href;
  link.dataset.navKey = item.key;
  link.title = item.label;
  link.setAttribute("aria-label", item.label);

  const label = document.createElement("span");
  label.className = "sb-shell-link-label";
  label.textContent = item.label;
  link.append(createNavigationIcon(item.key), label);

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

  const collapseButton = document.createElement("button");
  collapseButton.className = "sb-shell-collapse-button";
  collapseButton.type = "button";
  collapseButton.setAttribute("aria-controls", drawerId);
  collapseButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 7-5 5 5 5"/></svg>';

  const navigation = buildNavigation(activeKey);
  sidebarHeader.append(brand, collapseButton, closeButton);
  sidebar.append(sidebarHeader, navigation);
  mount.replaceChildren(mobileHeader, backdrop, sidebar);

  let focusBeforeOpen = null;
  let desktopSidebarState = sidebarStateFromStorage(getBrowserStorage("localStorage"));
  let wasDesktop = window.matchMedia("(min-width: 901px)").matches;
  const appContent = document.querySelector(".app-content");

  function applyDesktopSidebarState(state, persist = false){
    desktopSidebarState = normaliseSidebarState(state);
    const expanded = desktopSidebarState === "expanded";

    document.body.dataset.sidebarState = desktopSidebarState;
    document.body.classList.toggle("sidebar-collapsed", !expanded);
    collapseButton.setAttribute("aria-expanded", String(expanded));
    collapseButton.setAttribute(
      "aria-label",
      expanded ? "Collapse sidebar" : "Expand sidebar"
    );
    collapseButton.title = expanded ? "Collapse sidebar" : "Expand sidebar";

    if(persist){
      writeStorage(
        getBrowserStorage("localStorage"),
        SIDEBAR_STATE_STORAGE_KEY,
        desktopSidebarState
      );
    }
  }

  function ensureActiveLinkVisible(){
    const activeLink = navigation.querySelector('[aria-current="page"]');

    if(!activeLink){
      return;
    }

    const navigationRect = navigation.getBoundingClientRect();
    const activeRect = activeLink.getBoundingClientRect();

    if(activeRect.top < navigationRect.top){
      navigation.scrollTop = clampScrollPosition(
        navigation.scrollTop - (navigationRect.top - activeRect.top) - 8,
        navigation.scrollHeight - navigation.clientHeight
      );
    }else if(activeRect.bottom > navigationRect.bottom){
      navigation.scrollTop = clampScrollPosition(
        navigation.scrollTop + (activeRect.bottom - navigationRect.bottom) + 8,
        navigation.scrollHeight - navigation.clientHeight
      );
    }
  }

  function restoreSidebarScroll(){
    if(!window.matchMedia("(min-width: 901px)").matches){
      return;
    }

    const storedPosition = parseStoredScrollPosition(
      readStorage(getBrowserStorage("sessionStorage"), SIDEBAR_SCROLL_STORAGE_KEY)
    );

    if(storedPosition !== null){
      navigation.scrollTop = clampScrollPosition(
        storedPosition,
        navigation.scrollHeight - navigation.clientHeight
      );
    }

    ensureActiveLinkVisible();
  }

  function saveSidebarScroll(){
    writeStorage(
      getBrowserStorage("sessionStorage"),
      SIDEBAR_SCROLL_STORAGE_KEY,
      String(Math.max(0, navigation.scrollTop))
    );
  }

  applyDesktopSidebarState(desktopSidebarState);
  requestAnimationFrame(restoreSidebarScroll);

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
  collapseButton.addEventListener("click", () => {
    applyDesktopSidebarState(nextSidebarState(desktopSidebarState), true);
  });

  sidebar.addEventListener("click", event => {
    const link = event.target.closest("a[href]");

    if(link){
      if(
        window.matchMedia("(min-width: 901px)").matches &&
        shouldSaveSidebarScroll(event, link, window.location.origin)
      ){
        saveSidebarScroll();
      }

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
    const isDesktop = window.matchMedia("(min-width: 901px)").matches;

    if(isDesktop){
      closeDrawer({ restoreFocus: false });
    }

    if(isDesktop && !wasDesktop){
      requestAnimationFrame(restoreSidebarScroll);
    }

    wasDesktop = isDesktop;
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
