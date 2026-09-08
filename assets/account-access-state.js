import { resolveProductAccess } from "./demo-mode.js?v=20260902-stripe-live2";

export function resolveAccountAccessSnapshot(accountSnapshot, billingProfile = {}){
  const accountData = accountSnapshot?.exists?.() === true
    ? accountSnapshot.data() || {}
    : {};
  return Object.freeze({
    accountData,
    productAccess: resolveProductAccess(accountData, billingProfile)
  });
}

export function createAccountAccessRequestTracker(){
  let version = 0;

  function begin(uid){
    return Object.freeze({
      uid: String(uid || ""),
      version: ++version
    });
  }

  function isCurrent(request, uid){
    return Boolean(
      request &&
      request.version === version &&
      request.uid === String(uid || "")
    );
  }

  return Object.freeze({ begin, isCurrent });
}

// Profile reads only: never opens a portal session or grants access from URL data.
export function createBillingPortalReturnTracker(storage, now = Date.now){
  const key = "simpleBooksPendingBillingReturn";
  function clear(){
    try { storage.removeItem(key); } catch { /* Storage can be disabled. */ }
  }
  function mark(uid){
    try { storage.setItem(key, JSON.stringify({uid, startedAt: now()})); }
    catch { /* Returning users can still refresh manually. */ }
  }
  function consume(uid, search){
    if(new URLSearchParams(search).get("billing") !== "return") return false;
    let pending;
    try { pending = JSON.parse(storage.getItem(key)); } catch { /* Invalid marker. */ }
    clear();
    const age = now() - pending?.startedAt;
    return Boolean(uid && pending?.uid === uid && Number.isFinite(age) &&
      age >= 0 && age <= 15 * 60 * 1000);
  }
  return Object.freeze({mark, consume, clear});
}

export function createBillingProfilePoller({
  readProfile, applyProfile, isCurrent,
  schedule = setTimeout, cancel = clearTimeout,
  attempts = 6, intervalMs = 2500, deadlineMs = 20000
}){
  let generation = 0;
  let timer;
  let deadline;
  let runningUid = "";
  function stop(){
    generation++;
    runningUid = "";
    cancel(timer);
    cancel(deadline);
  }
  function start(uid){
    if(!uid || runningUid === uid) return;
    stop();
    runningUid = uid;
    const request = generation;
    let remaining = attempts;
    const current = () => request === generation && isCurrent(uid);
    deadline = schedule(stop, deadlineMs);
    async function poll(){
      if(!current()) { stop(); return; }
      try {
        const profile = await readProfile(uid);
        if(current()) await applyProfile(profile, current);
      } catch { /* A later bounded attempt may recover a transient read failure. */ }
      if(request !== generation) return;
      if(!current() || --remaining <= 0) { stop(); return; }
      timer = schedule(poll, intervalMs);
    }
    void poll();
  }
  return Object.freeze({start, stop});
}
