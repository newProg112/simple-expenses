import {createRequire} from "node:module";
import {describe, expect, it} from "vitest";

const require = createRequire(import.meta.url);
const {
  createGetAccountDeletionStatusHandler,
  safeDeletionStatus,
} = require("../functions/lib/account-deletion-status-handler.js");

const UID = "customer-a";
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

function job(stage, status = "active") {
  return {schemaVersion: 1, uid: UID, requestId: REQUEST_ID, stage, status};
}

describe("safe account deletion status", () => {
  it.each([
    ["requested", "starting"],
    ["stripe", "cancelling_subscription"],
    ["storage", "removing_files"],
    ["firestore", "removing_account_data"],
    ["auth", "finalising"],
  ])("projects %s to a coarse processing phase", (stage, phase) => {
    expect(safeDeletionStatus(job(stage), UID)).toEqual({
      status: "processing", phase,
    });
  });

  it("returns only completed for a completion tombstone", () => {
    expect(safeDeletionStatus({
      schemaVersion: 1, uid: UID, stage: "completed", status: "completed",
      retryCount: 99, lastErrorCode: "private-internal-code",
    }, UID)).toEqual({status: "completed"});
  });

  it("maps needs-attention, malformed jobs, and orphan barriers safely", () => {
    expect(safeDeletionStatus(job("stripe", "needs_attention"), UID))
        .toEqual({status: "needs_attention"});
    expect(safeDeletionStatus({uid: UID, stage: "private"}, UID))
        .toEqual({status: "needs_attention"});
    expect(safeDeletionStatus(null, UID, {deletionInProgress: true}))
        .toEqual({status: "needs_attention"});
    expect(safeDeletionStatus(null, UID, {}))
        .toEqual({status: "not_requested"});
  });

  it("derives UID from auth and never accepts client UID data", async () => {
    const reads = [];
    const firestore = {collection: (collection) => ({doc: (uid) => ({
      get: async () => {
        reads.push(`${collection}/${uid}`);
        return {exists: false, data: () => undefined};
      },
    })})};
    const handler = createGetAccountDeletionStatusHandler({firestore});
    await expect(handler({auth: {uid: UID}, data: {uid: "customer-b"}}))
        .resolves.toEqual({status: "not_requested"});
    expect(reads).toEqual([
      `accountDeletionJobs/${UID}`,
      `users/${UID}`,
    ]);
  });

  it("rejects unauthenticated status reads", async () => {
    const handler = createGetAccountDeletionStatusHandler({
      firestore: {collection: () => ({})},
    });
    await expect(handler({data: {}})).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });
});
