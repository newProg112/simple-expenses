"use strict";

const {
  calendarMonthKey,
  normaliseUsageCount,
} = require("./plan-entitlements");

/**
 * Reads a user's current UTC monthly usage without writing any data.
 * @param {object} firestore Firestore service.
 * @param {string} uid Authenticated Firebase UID.
 * @param {Date} date Current server date.
 * @return {Promise<object>} Normalized monthly usage.
 */
async function readMonthlyUsage(firestore, uid, date = new Date()) {
  if (!firestore || typeof firestore.collection !== "function") {
    throw new TypeError("A Firestore service is required.");
  }
  if (typeof uid !== "string" || !uid || uid.includes("/")) {
    throw new TypeError("A valid Firebase UID is required.");
  }

  const monthKey = calendarMonthKey(date);
  const snapshot = await firestore
      .collection("userProfiles")
      .doc(uid)
      .collection("usage")
      .doc(monthKey)
      .get();
  const usage = snapshot.exists ? snapshot.data() : {};

  return Object.freeze({
    monthKey,
    aiAssistantSuccessfulUses:
      normaliseUsageCount(usage.aiAssistantSuccessfulUses),
    invoiceScanningSuccessfulUses:
      normaliseUsageCount(usage.invoiceScanningSuccessfulUses),
  });
}

module.exports = {
  readMonthlyUsage,
};
