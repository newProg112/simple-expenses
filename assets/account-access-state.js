import { resolveProductAccess } from "./demo-mode.js?v=20260901-stripe-live1";

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
