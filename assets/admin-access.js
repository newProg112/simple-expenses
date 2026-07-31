// Replace this placeholder with the owner's UID from Firebase Console >
// Authentication > Users. Until then, every account is denied admin access.
export const ADMIN_UIDS = Object.freeze([
  "nI2eUc4hLNg1AXMRnzQSyYS1D6B3"
]);

const UID_PLACEHOLDER = "REPLACE_WITH_OWNER_FIREBASE_UID";

export function isConfiguredAdminUid(uid){
  const value = typeof uid === "string" ? uid.trim() : "";
  return Boolean(value) && value !== UID_PLACEHOLDER;
}

export function isAdminUid(uid, allowedUids = ADMIN_UIDS){
  if(typeof uid !== "string" || !Array.isArray(allowedUids)){
    return false;
  }

  return allowedUids.some(allowedUid =>
    isConfiguredAdminUid(allowedUid) && allowedUid.trim() === uid
  );
}

export function adminAccessDecision(user, allowedUids = ADMIN_UIDS){
  if(!user){
    return "signed-out";
  }

  return isAdminUid(user.uid, allowedUids) ? "allowed" : "denied";
}
