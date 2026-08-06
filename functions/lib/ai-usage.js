/* eslint-disable require-jsdoc */

"use strict";

const {
  MONTHLY_LIMIT_IDS,
  PLAN_IDS,
  effectiveProductPlan,
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
const USAGE_TYPES = Object.freeze({
  AI_ASSISTANT: "aiAssistant",
  INVOICE_SCANNING: "invoiceScanning",
});
const USAGE_CONFIGURATIONS = Object.freeze({
  [USAGE_TYPES.AI_ASSISTANT]: Object.freeze({
    limitId: MONTHLY_LIMIT_IDS.AI_ASSISTANT,
    successfulUses: "successfulUses",
    reservations: "reservations",
    completedRequests: "completedRequests",
  }),
  [USAGE_TYPES.INVOICE_SCANNING]: Object.freeze({
    limitId: MONTHLY_LIMIT_IDS.INVOICE_SCANNING,
    successfulUses: "invoiceScanningSuccessfulUses",
    reservations: "invoiceScanningReservations",
    completedRequests: "invoiceScanningCompletedRequests",
  }),
});

function usageConfiguration(usageType) {
  const configuration = USAGE_CONFIGURATIONS[usageType];
  if (!configuration) {
    throw new TypeError("A supported usage type is required.");
  }
  return configuration;
}

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
 * @param {*} account Authoritative business account data.
 * @return {string} Starter or Pro plan identifier.
 */
function resolveAuthoritativePlan(profile, account = {}) {
  const source = profile && typeof profile === "object" ? profile : {};
  const plan = normalisePlan(source.currentPlan);

  if (account && account.demoMode === true) {
    return effectiveProductPlan(plan, true);
  }

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
 * Returns the authoritative Invoice Scanning monthly limit.
 * @param {*} profile Billing profile data.
 * @return {number|null} Monthly limit.
 */
function getAuthoritativeInvoiceScanningLimit(profile) {
  return getMonthlyLimit(
      resolveAuthoritativePlan(profile),
      MONTHLY_LIMIT_IDS.INVOICE_SCANNING,
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
    invoiceScanningReservations:
      normalizeReservations(source.invoiceScanningReservations, nowMillis),
    invoiceScanningCompletedRequests:
      normalizeCompletedRequests(source.invoiceScanningCompletedRequests),
  };
}

function usageWrite(state, serverTimestamp) {
  return {
    aiAssistantSuccessfulUses: state.successfulUses,
    invoiceScanningSuccessfulUses: state.invoiceScanningSuccessfulUses,
    aiAssistantReservations: state.reservations,
    aiAssistantCompletedRequests: state.completedRequests,
    invoiceScanningReservations: state.invoiceScanningReservations,
    invoiceScanningCompletedRequests: state.invoiceScanningCompletedRequests,
    updatedAt: serverTimestamp(),
  };
}

function documentReferences(firestore, uid, monthKey) {
  const profile = firestore.collection("userProfiles").doc(uid);
  return {
    account: firestore.collection("users").doc(uid),
    profile,
    usage: profile.collection("usage").doc(monthKey),
  };
}

/**
 * Creates the transactional monthly usage service.
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

  async function reserve({
    uid,
    requestId,
    enforceLimit = true,
    usageType = USAGE_TYPES.AI_ASSISTANT,
  }) {
    if (!UUID_PATTERN.test(String(requestId || ""))) {
      throw new TypeError("A valid request UUID is required.");
    }
    const now = new Date(nowProvider());
    const nowMillis = now.getTime();
    const monthKey = calendarMonthKey(now);
    const refs = documentReferences(firestore, uid, monthKey);
    const configuration = usageConfiguration(usageType);

    return firestore.runTransaction(async (transaction) => {
      const [accountSnapshot, profileSnapshot, usageSnapshot] =
        await Promise.all([
          transaction.get(refs.account),
          transaction.get(refs.profile),
          transaction.get(refs.usage),
        ]);
      const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
      const account = accountSnapshot.exists ? accountSnapshot.data() : {};
      const limit = getMonthlyLimit(
          resolveAuthoritativePlan(profile, account),
          configuration.limitId,
      );
      const state = usageState(
          usageSnapshot.exists ? usageSnapshot.data() : {},
          nowMillis,
      );

      if (Object.hasOwn(state[configuration.completedRequests], requestId)) {
        transaction.set(
            refs.usage,
            usageWrite(state, serverTimestamp),
            {merge: true},
        );
        return {state: "completed", monthKey, limit};
      }

      if (Object.hasOwn(state[configuration.reservations], requestId)) {
        transaction.set(
            refs.usage,
            usageWrite(state, serverTimestamp),
            {merge: true},
        );
        return {state: "in-progress", monthKey, limit};
      }

      const remaining = remainingAllowance(
          limit,
          state[configuration.successfulUses],
          Object.keys(state[configuration.reservations]).length,
      );
      if (enforceLimit && remaining !== null && remaining <= 0) {
        transaction.set(
            refs.usage,
            usageWrite(state, serverTimestamp),
            {merge: true},
        );
        return {state: "limit-reached", monthKey, limit};
      }

      state[configuration.reservations][requestId] = {
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

  async function finalize({
    uid,
    monthKey,
    requestId,
    usageType = USAGE_TYPES.AI_ASSISTANT,
  }) {
    const refs = documentReferences(firestore, uid, monthKey);
    const nowMillis = new Date(nowProvider()).getTime();
    const configuration = usageConfiguration(usageType);

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(refs.usage);
      const state = usageState(
          snapshot.exists ? snapshot.data() : {},
          nowMillis,
      );

      if (Object.hasOwn(state[configuration.completedRequests], requestId)) {
        return {
          counted: false,
          successfulUses: state[configuration.successfulUses],
        };
      }

      const reservation = state[configuration.reservations][requestId];
      if (!reservation) {
        throw new Error("AI usage reservation is unavailable.");
      }

      delete state[configuration.reservations][requestId];
      state[configuration.successfulUses] += 1;
      state[configuration.completedRequests][requestId] = nowMillis;
      transaction.set(
          refs.usage,
          usageWrite(state, serverTimestamp),
          {merge: true},
      );
      return {
        counted: true,
        successfulUses: state[configuration.successfulUses],
      };
    });
  }

  async function release({
    uid,
    monthKey,
    requestId,
    usageType = USAGE_TYPES.AI_ASSISTANT,
  }) {
    const refs = documentReferences(firestore, uid, monthKey);
    const nowMillis = new Date(nowProvider()).getTime();
    const configuration = usageConfiguration(usageType);

    return firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(refs.usage);
      const state = usageState(
          snapshot.exists ? snapshot.data() : {},
          nowMillis,
      );
      const reservation = state[configuration.reservations][requestId];
      const released = Boolean(reservation);
      if (released) delete state[configuration.reservations][requestId];
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
  USAGE_TYPES,
  createAiUsageManager,
  createMonthlyUsageManager: createAiUsageManager,
  getAuthoritativeAiLimit,
  getAuthoritativeInvoiceScanningLimit,
  normalizeUsageCount,
  remainingAllowance,
  resolveAuthoritativePlan,
  usageDocumentPath,
};
