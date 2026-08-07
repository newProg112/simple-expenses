import { loadOwnedJournals } from "../resources/js/journal-source.js";

const COLLECTIONS = Object.freeze(["invoices", "bills", "expenses", "projects", "budgets"]);

function rows(snapshot){
  return snapshot.docs.map(document => ({ id:document.id, ...document.data() }));
}

export async function loadBusinessInsightsData(user, services){
  if(!user?.uid || !services?.db || typeof services.collection !== "function" || typeof services.getDocs !== "function"){
    throw new Error("Business Insights data services are unavailable.");
  }
  const requests = COLLECTIONS.map(name => services.getDocs(services.collection(services.db, "users", user.uid, name)));
  requests.push(loadOwnedJournals(services.db, user.uid, services));
  const results = await Promise.allSettled(requests);
  const data = { sourceAvailability:{} };
  const failures = [];
  const notices = [];
  COLLECTIONS.forEach((name, index) => {
    if(results[index].status === "fulfilled"){
      data[name] = rows(results[index].value);
      data.sourceAvailability[name] = true;
    }else{
      data[name] = [];
      data.sourceAvailability[name] = false;
      failures.push(name);
    }
  });
  const journalResult = results[COLLECTIONS.length];
  if(journalResult.status === "fulfilled"){
    data.journals = journalResult.value.journals;
    data.accountingAvailable = true;
    if(journalResult.value.skippedCount){
      const count = journalResult.value.skippedCount;
      notices.push(`${count} malformed accounting ${count === 1 ? "journal was" : "journals were"} skipped`);
    }
  }else{
    data.journals = [];
    data.accountingAvailable = false;
    failures.push("accounting journals");
  }
  if(failures.length === results.length) throw new Error("No Business Insights data could be loaded.");
  return { data, failures, notices };
}
