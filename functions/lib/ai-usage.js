/* eslint-disable require-jsdoc */

"use strict";

const {
  MONTHLY_LIMIT_IDS,
  PLAN_IDS,
  calendarMonthKey,
  getMonthlyLimit,
  hasProAccess,
  isUnlimited,
  normalisePlan,
  normaliseUsageCount,
  remainingMonthlyAllowance,
} = require("./plan-entitlements");

const RESERVATION_TTL_MS = 2 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Normalises a stored usage counter.
 * @param {*} value Stored counter value.
 * @return {number} A non-negative integer.
 */
function normalizeUsageCount(value) {
  return normaliseUsageCount(value);
}

/**
 * Calculates remaining allowance.
 * @param {number|null} limit Plan allowance.
 * @param {*} successfulUses Stored successful uses.
 * @param {*} pendingUses Active reservations.
 * @return {number|null} Remaining uses, or null when unlimited.
 */
function remainingAllowance(limit, successfulUses, pendingUses = 0) {
  if (isUnlimited(limit)) return null;
  return remainingMonthlyAllowance(
      limit,
      normalizeUsageCount(successfulUses) +
        normalizeUsageCount(pendingUses),
  );
}

/**
 * Resolves an authoritative effective plan from a billing profile.
 * @param {*} profile Billing profile data.
 * @return {string} Starter or Pro plan identifier.
 */
function resolveAuthoritativePlan(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  const plan = normalisePlan(source.currentPlan);

  if (source.billingOverride === true && plan === PLAN_IDS.PRO) {
    return PLAN_IDS.PRO;
  }

  return hasProAccess(plan, source.subscriptionStatus) ?
    PLAN_IDS.PRO :
    PLAN_IDS.STARTER;
}

/**
 * Returns the authoritative AI Assistant monthly limit.
 * @param {*} profile Billing profile data.
 * @return {number|null} Monthly limit.
 */
function getAuthoritativeAiLimit(profile) {
  return getMonthlyLimit(
      resolveAuthoritativePlan(profile),
      MONTHLY_LIMIT_IDS.AI_ASSISTANT,
  );
}

/**
 * Forms the backend usage document path.
 * @param {string} uid Authenticated Firebase UID.
 * @param {string} monthKey UTC month key.
 * @return {string} Firestore document path.
 */
function usageDocumentPath(uid, monthKey) {
  if (typeof uid !== "string" || !uid || uid.includes("/")) {
    throw new TypeError("A valid Firebase UID is required.");
  }
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new TypeError("A valid UTC month key is required.");
  }
  return `userProfiles/${uid}/usage/${monthKey}`;
}

function plainObject(value) {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeReservations(value, nowMillis) {
  if (!plainObject(value)) return {};
  const reservations = {};

  Object.entries(value).forEach(([requestId, reservation]) => {
    if (!UUID_PATTERN.test(requestId) || !plainObject(reservation)) return;
    const reservedAtMillis = Number(reservation.reservedAtMillis);
    const expiresAtMillis = Number(reservation.expiresAtMillis);
    if (!Number.isFinite(reservedAtMillis) ||
      !Number.isFinite(expiresAtMillis) ||
      expiresAtMillis <= nowMillis) {
      return;
    }
    reservations[requestId] = {
      reservedAtMillis,
      expiresAtMillis,
    };
  });

  return reservations;
}

function normalizeCompletedRequests(value) {
  if (!plainObject(value)) return {};
  const completed = {};

  Object.entries(value).forEach(([requestId, completedAtMillis]) => {
    const timestamp = Number(completedAtMillis);
    if (UUID_PATTERN.test(requestId) && Number.isFinite(timestamp)) {
      completed[requestId] = timestamp;
    }
  });

  return completed;
}

function usageState(data, nowMillis) {
  const source = data && typeof data === "object" ? data : {};
  return {
    successfulUses: normalizeUsageCount(source.aiAssistantSuccessfulUses),
    invoiceScanningSuccessfulUses:
      normalizeUsageCount(source.invoiceScanningSuccessfulUses),
    reservations:
      normalizeReservations(source.aiAssistantReservations, nowMillis),
    completedRequests:
      normalizeCompletedRequests(source.aiAssistantCompletedRequests),
  };
}

function usageWrite(state, serverTimestamp) {
  return {
    aiAssistantSuccessfulUses: state.successfulUses,
    invoiceScanningSuccessfulUses: state.invoiceScanningSuccessfulUses,
    aiAssistantReservations: state.reservations,
    aiAssistantCompletedRequests: state.completedRequests,
    updatedAt: serverTimestamp(),
  };
}

function documentReferences(firestore, uid, monthKey) {
  const profile = firestore.collection("userProfiles").doc(uid);
  return {
    profile,
    usage: profile.collection("usage").doc(monthKey),
  };
}

/**
 * Creates the transactional AI usage service.
 * @param {object} options Service dependencies.
 * @return {object} Reservation, finalisation, and release methods.
 */
function createAiUsageManager(options) {
  const firestore = options && options.firestore;
  if (!firestore || typeof firestore.runTransaction !== "function") {
    throw new TypeError("A Firestore transaction service is required.");
  }
  const nowProvider = options.now || (() => new Date());
  const serverTimestamp = options.serverTimestamp || (() => new Date());

  async function reserve({uid, requestId, enforceLimit = true}) {
    if (!UUID_PATTERN.test(String(requestId || ""))) {
      throw new TypeError("A valid request UUID is required.");
    }
    const now = new Date(nowProvider());
    const nowMillis = now.getTime();
    const monthKey = calendarMonthKey(now);
    const refs = documentReferences(firestore, uid, monthKey);

    return firestore.runTransaction(async (transaction) => {
      const [profileSnapshot, usageSnapshot] = await Promise.all([
        transaction.get(refs.profile),
        transaction.get(refs.usage),
      ]);
      const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
      const limit = getAuthoritativeAiLimit(profile);
      const state = usageState(
          usageSnapshot.exists ? usageSnapshot.data() : {},
          nowMillis,
      );

      if (Object.hasOwn(state.completedRequests, requestId)) {
        transaction.set(
            refs.usage,
            usageWrite(state, serverTimestamp),
            {merge: true},
        );
        return {state: "completed", monthKey, limit};
      }

      if (Object.hasOwn(state.reservations, requestId)) {
        transaction.set(
            refs.usage,
            usageWrite(state, serverTimestamp),
            {merge: true},
        );
        return {state: "in-progress", monthKey, limit};
      }

      const remaining = remainingAllowance(
          limit,
          state.successfulUses,
          Object.keys(state.reservations).length,
      );
      if (enforceLimit && remaining !== null && remaining <= 0) {
        transaction.set(
            refs.usage,
            usageWrite(state, serverTimestamp),
            {merge: true},
        );
        return {state: "limit-reached", monthKey, limit};
      }

      state.reservations[requestId] = {
        reservedAtMillis: nowMillis,
        expiresAtMillis: nowMillis + RESERVATION_TTL_MS,
      };
      transaction.set(
          refs.usage,
          usageWrite(state, serverTimestamp),
          {merge: true},
      );
      return {state: "reserved", monthKey, limit};
    });
  }

  async function finalize({uid, monthKey, requestId}) {
    const refs = documentReferences(firestore, uid, monthKey);
    const nowMillis = new Date(nowProvider()).getTime();

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(refs.usage);
      const state = usageState(
          snapshot.exists ? snapshot.data() : {},
          nowMillis,
      );

      if (Object.hasOwn(state.completedRequests, requestId)) {
        return {counted: false, successfulUses: state.successfulUses};
      }

      const reservation = state.reservations[requestId];
      if (!reservation) {
        throw new Error("AI usage reservation is unavailable.");
      }

      delete state.reservations[requestId];
      state.successfulUses += 1;
      state.completedRequests[requestId] = nowMillis;
      transaction.set(
          refs.usage,
          usageWrite(state, serverTimestamp),
          {merge: true},
      );
      return {counted: true, successfulUses: state.successfulUses};
    });
  }

  async function release({uid, monthKey, requestId}) {
    const refs = documentReferences(firestore, uid, monthKey);
    const nowMillis = new Date(nowProvider()).getTime();

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(refs.usage);
      const state = usageState(
          snapshot.exists ? snapshot.data() : {},
          nowMillis,
      );
      const reservation = state.reservations[requestId];
      const released = Boolean(reservation);
      if (released) delete state.reservations[requestId];
      transaction.set(
          refs.usage,
          usageWrite(state, serverTimestamp),
          {merge: true},
      );
      return {released};
    });
  }

  return Object.freeze({reserve, finalize, release});
}

module.exports = {
  RESERVATION_TTL_MS,
  createAiUsageManager,
  getAuthoritativeAiLimit,
  normalizeUsageCount,
  remainingAllowance,
  resolveAuthoritativePlan,
  usageDocumentPath,
};
