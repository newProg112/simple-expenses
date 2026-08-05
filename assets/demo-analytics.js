export const DEMO_ANALYTICS_COLLECTION = "demoAnalyticsEvents";

export const DEMO_ANALYTICS_EVENTS = Object.freeze([
  "Login",
  "Logout",
  "Dashboard viewed",
  "Invoices page viewed",
  "Clients page viewed",
  "Bills page viewed",
  "Expenses page viewed",
  "Projects page viewed",
  "Budgets page viewed",
  "Cashflow page viewed",
  "Trial Balance viewed",
  "General Ledger viewed",
  "Profit & Loss viewed",
  "Balance Sheet viewed"
]);

const ALLOWED_EVENTS = new Set(DEMO_ANALYTICS_EVENTS);
const PAGE_VIEW_EVENTS = Object.freeze({
  dashboard: "Dashboard viewed",
  invoices: "Invoices page viewed",
  clients: "Clients page viewed",
  bills: "Bills page viewed",
  expenses: "Expenses page viewed",
  projects: "Projects page viewed",
  budgets: "Budgets page viewed",
  cashflow: "Cashflow page viewed",
  "trial-balance": "Trial Balance viewed",
  "general-ledger": "General Ledger viewed",
  "profit-loss": "Profit & Loss viewed",
  "balance-sheet": "Balance Sheet viewed"
});

export function demoPageViewEvent(navigationKey){
  return PAGE_VIEW_EVENTS[navigationKey] || null;
}

function readUserAgent(runtime){
  try{
    return String(runtime?.navigator?.userAgent || "").slice(0, 512);
  }catch(_error){
    return "";
  }
}

function readPage(runtime, suppliedPage){
  try{
    return String(suppliedPage || runtime?.location?.pathname || "").slice(0, 256);
  }catch(_error){
    return "";
  }
}

function pageViewStorageKey(uid, eventName, page){
  return `simple-books:demo-analytics:page-view:v1:${uid}:${eventName}:${page}`;
}

function wasPageViewTracked(storage, key){
  try{
    return storage?.getItem(key) === "true";
  }catch(_error){
    return false;
  }
}

function rememberPageView(storage, key){
  try{
    storage?.setItem(key, "true");
  }catch(_error){
    // Storage can be unavailable in privacy-focused browsers. In-memory
    // deduplication below still protects against repeated initialisation.
  }
}

export function createDemoAnalyticsTracker({
  addDoc,
  collection,
  db,
  doc,
  getDoc,
  serverTimestamp,
  runtime = globalThis
} = {}){
  const pageViewsInFlight = new Set();

  return async function trackDemoAnalyticsEvent(eventName, options = {}){
    try{
      if(!ALLOWED_EVENTS.has(eventName)) return false;

      const user = options.user;
      if(!user?.uid) return false;

      let accountData = options.accountData;
      if(!accountData){
        if(typeof getDoc !== "function" || typeof doc !== "function") return false;
        const accountSnapshot = await getDoc(doc(db, "users", user.uid));
        accountData = accountSnapshot.exists() ? accountSnapshot.data() : null;
      }

      if(accountData?.demoMode !== true) return false;

      const page = readPage(runtime, options.page);
      const isPageView = Object.values(PAGE_VIEW_EVENTS).includes(eventName);
      const storageKey = isPageView
        ? pageViewStorageKey(user.uid, eventName, page)
        : null;

      if(
        storageKey &&
        (pageViewsInFlight.has(storageKey) || wasPageViewTracked(runtime?.sessionStorage, storageKey))
      ){
        return false;
      }

      if(storageKey){
        pageViewsInFlight.add(storageKey);
        rememberPageView(runtime?.sessionStorage, storageKey);
      }

      await addDoc(collection(db, DEMO_ANALYTICS_COLLECTION), {
        timestamp: serverTimestamp(),
        uid: user.uid,
        eventName,
        page,
        userAgent: readUserAgent(runtime)
      });
      return true;
    }catch(_error){
      // Demo analytics is deliberately best-effort and must never interrupt
      // authentication, navigation, or any bookkeeping action.
      return false;
    }
  };
}

async function defaultFirebaseServices(){
  const [{ db }, firestoreSdk] = await Promise.all([
    import("/firebase-config.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
  ]);

  return {
    db,
    addDoc: firestoreSdk.addDoc,
    collection: firestoreSdk.collection,
    doc: firestoreSdk.doc,
    getDoc: firestoreSdk.getDoc,
    serverTimestamp: firestoreSdk.serverTimestamp
  };
}

let defaultTrackerPromise;

async function getDefaultTracker(){
  if(!defaultTrackerPromise){
    defaultTrackerPromise = defaultFirebaseServices()
      .then(services => createDemoAnalyticsTracker({
        ...services,
        runtime: typeof window === "undefined" ? globalThis : window
      }));
  }
  return defaultTrackerPromise;
}

export async function trackDemoAnalyticsEvent(eventName, options = {}){
  try{
    const tracker = await getDefaultTracker();
    return await tracker(eventName, options);
  }catch(_error){
    return false;
  }
}

export function trackDemoPageView(navigationKey, options = {}){
  const eventName = demoPageViewEvent(navigationKey);
  if(!eventName) return Promise.resolve(false);
  return trackDemoAnalyticsEvent(eventName, options);
}

export { PAGE_VIEW_EVENTS };
