/* eslint-disable max-len, require-jsdoc */

"use strict";

const {normalisePlan} = require("./plan-entitlements");
const {isDemoAuthUser} = require("./admin-authorization");
const {safeIsoDate} = require("./admin-user-details");

const ADMIN_USER_SEARCH_PAGE_SIZE = 1000;
const ADMIN_USER_SEARCH_RESULT_LIMIT = 20;
const ADMIN_USER_SEARCH_SCAN_LIMIT = 5000;

function safeText(value, maximum = 160) {
  if (typeof value !== "string") return "";
  return [...value].filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join("").trim().slice(0, maximum);
}

function isAuthNotFound(error) {
  return error && (error.code === "auth/user-not-found" || error.code === "auth/invalid-uid");
}

async function exactAuthUser(auth, query) {
  if (auth && typeof auth.getUser === "function") {
    try {
      return await auth.getUser(query);
    } catch (error) {
      if (!isAuthNotFound(error)) throw error;
    }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query) && auth && typeof auth.getUserByEmail === "function") {
    try {
      return await auth.getUserByEmail(query.toLowerCase());
    } catch (error) {
      if (!isAuthNotFound(error)) throw error;
    }
  }
  return null;
}

async function findMatchingAuthUsers(auth, query) {
  if (!auth || typeof auth.listUsers !== "function") throw new TypeError("Firebase Auth Admin is required.");
  const exact = await exactAuthUser(auth, query);
  if (exact) return {users: [exact], truncated: false, exact: true};
  if (query.length < 2) return {users: [], truncated: false, exact: false};

  const normalizedQuery = query.toLowerCase();
  const users = [];
  const seenPageTokens = new Set();
  let pageToken;
  let scanned = 0;
  let truncated = false;
  do {
    const remaining = ADMIN_USER_SEARCH_SCAN_LIMIT - scanned;
    if (remaining <= 0) {
      truncated = Boolean(pageToken);
      break;
    }
    const page = await auth.listUsers(Math.min(ADMIN_USER_SEARCH_PAGE_SIZE, remaining), pageToken);
    const pageUsers = Array.isArray(page.users) ? page.users : [];
    scanned += pageUsers.length;
    for (const user of pageUsers) {
      const email = safeText(user.email, 320).toLowerCase();
      const displayName = safeText(user.displayName).toLowerCase();
      if ((email.includes(normalizedQuery) || displayName.includes(normalizedQuery)) &&
        !users.some((existing) => existing.uid === user.uid)) {
        users.push(user);
        if (users.length === ADMIN_USER_SEARCH_RESULT_LIMIT) break;
      }
    }
    if (users.length === ADMIN_USER_SEARCH_RESULT_LIMIT) {
      truncated = Boolean(page.pageToken) || pageUsers.length > users.length;
      break;
    }
    pageToken = page.pageToken || undefined;
    if (pageToken && seenPageTokens.has(pageToken)) throw new Error("Firebase Auth pagination returned a repeated token.");
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);
  return {users, truncated, exact: false};
}

async function findExactFullNameUsers(auth, firestore, query, excludedUids, limit) {
  const accounts = firestore.collection("users");
  if (!accounts || typeof accounts.where !== "function" || limit <= 0) return {users: [], truncated: false};
  const snapshot = await accounts.where("fullName", "==", query)
      .limit(limit + excludedUids.size + 1)
      .select("fullName", "businessName", "demoMode")
      .get();
  const users = [];
  const candidateDocuments = (snapshot.docs || []).filter((documentSnapshot) => !excludedUids.has(documentSnapshot.id));
  for (const documentSnapshot of candidateDocuments.slice(0, limit)) {
    try {
      users.push(await auth.getUser(documentSnapshot.id));
    } catch (error) {
      if (!isAuthNotFound(error)) throw error;
    }
  }
  return {users, truncated: candidateDocuments.length > limit};
}

function accountBadges(user, account, adminUids, demoIdentifiers) {
  const badges = [];
  if (user.disabled === true) badges.push("Disabled");
  if (account.demoMode === true || isDemoAuthUser(user, demoIdentifiers)) badges.push("Demo");
  if (adminUids.has(user.uid)) badges.push("Admin");
  if (user.emailVerified !== true) badges.push("Email unverified");
  if (badges.length === 0) badges.push("Active");
  return badges;
}

async function searchResultForUser(firestore, user, adminUids, demoIdentifiers) {
  const [accountSnapshot, profileSnapshot] = await Promise.all([
    firestore.collection("users").doc(user.uid).get(),
    firestore.collection("userProfiles").doc(user.uid).get(),
  ]);
  const account = accountSnapshot.exists ? accountSnapshot.data() || {} : {};
  const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};
  const metadata = user.metadata || {};
  return {
    uid: safeText(user.uid, 128),
    email: safeText(user.email, 320),
    fullName: safeText(user.displayName || account.fullName),
    businessName: safeText(account.businessName),
    plan: normalisePlan(profile.currentPlan),
    accountStatus: accountBadges(user, account, adminUids, demoIdentifiers),
    signupDate: safeIsoDate(metadata.creationTime),
    lastActivityDate: safeIsoDate(metadata.lastSignInTime),
  };
}

async function searchAdminUsers({auth, firestore, demoIdentifiers, adminUids, query}) {
  if (!firestore || typeof firestore.collection !== "function") throw new TypeError("Firestore Admin is required.");
  const matches = await findMatchingAuthUsers(auth, query);
  const users = matches.users.slice();
  if (!matches.exact && users.length < ADMIN_USER_SEARCH_RESULT_LIMIT) {
    const fullNameMatches = await findExactFullNameUsers(
        auth,
        firestore,
        query,
        new Set(users.map((user) => user.uid)),
        ADMIN_USER_SEARCH_RESULT_LIMIT - users.length,
    );
    users.push(...fullNameMatches.users);
    matches.truncated = matches.truncated || fullNameMatches.truncated;
  }
  const results = await Promise.all(users.map((user) =>
    searchResultForUser(firestore, user, adminUids, demoIdentifiers)));
  return {
    results,
    truncated: matches.truncated,
    businessNameSearchSupported: false,
  };
}

module.exports = {
  ADMIN_USER_SEARCH_PAGE_SIZE,
  ADMIN_USER_SEARCH_RESULT_LIMIT,
  ADMIN_USER_SEARCH_SCAN_LIMIT,
  accountBadges,
  exactAuthUser,
  findExactFullNameUsers,
  findMatchingAuthUsers,
  safeText,
  searchAdminUsers,
  searchResultForUser,
};
