/* eslint-disable max-len, require-jsdoc */

"use strict";

const {getFunctions} = require("firebase-admin/functions");

const ACCOUNT_DELETION_TASK_NAME = "processAccountDeletion";

function createAccountDeletionTaskEnqueuer(options = {}) {
  const functions = options.functions || getFunctions();
  const queue = functions.taskQueue(options.taskName || ACCOUNT_DELETION_TASK_NAME);
  return async function enqueueAccountDeletion(uid) {
    await queue.enqueue({uid}, {dispatchDeadlineSeconds: 1800});
  };
}

module.exports = {
  ACCOUNT_DELETION_TASK_NAME,
  createAccountDeletionTaskEnqueuer,
};
