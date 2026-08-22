# Pre-launch Simple Books legacy cleanup

This is a deliberate, admin-only procedure for the `simple-books-office`
Firebase project. It must never be pointed at the separate Simple Expenses
project. Nothing in this procedure is run automatically by account deletion.

No production cleanup was performed while this document was created.

## Safety gates

Before adding or running an apply-mode cleanup utility:

1. Confirm the active Firebase project ID is exactly `simple-books-office`.
2. Export the current public Demo UID and every UID in
   `SIMPLE_BOOKS_ADMIN_UIDS` and `SIMPLE_BOOKS_PROTECTED_UIDS` into an explicit
   protected list. Abort if any required configuration is empty or malformed.
3. Take dated Firestore and Storage backups and record their locations.
4. Stop writes or use a maintenance window so the inventory does not drift.
5. Run inventory/dry-run mode first, save the machine-readable report, and
   have a second person approve it.
6. Require a separate `--apply` flag plus a typed confirmation containing the
   exact project ID. Never make apply mode the default.

## Inventory scope

Inventory only Simple Books resources:

- historical top-level `invoices` documents;
- obsolete/test `users/{uid}` trees and their `userProfiles/{uid}` data;
- matching top-level `journals`, admin notes/activity, and usage records;
- legacy Storage objects without the current `users/{uid}/...` prefix;
- migration backup/quarantine objects and reports that have passed their
  agreed retention period;
- test Firebase Auth users, identified by an explicit reviewed UID list.

The inventory report should contain paths, UIDs, counts, byte totals, and
reason codes, but should avoid copying business or financial field values.
Every candidate associated with the Demo or another protected UID must be
classified as protected and excluded from apply mode.

Use the existing read-only tooling where applicable:

- `npm run migration:legacy-storage:dry-run`
- `scripts/probe-top-level-invoice-metadata.cjs`
- `scripts/audit-production-reference-registry.cjs`

These tools help classify legacy material; their output is not authority to
delete it.

## Deliberate cleanup order

After review, a purpose-built cleanup command should process only the frozen
manifest, checkpoint each item, and be safe to rerun:

1. Remove obsolete legacy Storage objects and expired migration
   backup/quarantine objects.
2. Remove historical top-level `invoices` and confirmed orphaned journals.
3. For each explicitly approved disposable UID, cancel/test-clean any Stripe
   objects deliberately, then remove UID-scoped Storage and Firestore data.
4. Delete an approved disposable Firebase Auth user last.
5. Re-run inventory and the Firestore/Storage rules test suites.

Do not fold this pre-launch cleanup into the customer account-deletion worker.
The Phase 2 worker needs its own Stripe discovery, checkpointing, retries,
recursive deletion, and Auth-last semantics.

The permanent Phase 2 worker removes only the canonical `users/{uid}/` Storage
prefix and exact non-UID object paths named by allow-listed path fields in the
current user-owned Firestore tree. Ambiguous legacy objects, historical
top-level `invoices`, and any obsolete top-level record without a reliable UID
query remain in this deliberate pre-launch process; filenames are never used
as ownership evidence.

## Acceptance record

Retain the dry-run report, approved manifest hash, operator, timestamp, backup
locations, apply report, and post-run zero/orphan counts. Stop and investigate
on any unknown UID, protected UID, project mismatch, partial Stripe result, or
unclassified path.
