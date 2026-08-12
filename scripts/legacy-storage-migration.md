# Legacy Firebase Storage attachment migration

This one-off tool inventories the legacy `bills/`, `expenses/` and `clients/`
objects and maps them to Firestore records only when an existing
`attachmentPath` or decoded `attachmentUrl` establishes the relationship.
Filename similarity is never treated as proof of ownership.

## Read-only dry run

```powershell
npm.cmd run migration:legacy-storage:dry-run
```

Dry run is the default. It uses GET/list requests only and writes a sanitized,
git-ignored report to `migration-reports/legacy-storage-dry-run.json`. Normal
output never contains bearer tokens. A redacted URL is retained in the report
so the object-to-record mapping can be audited.

## Guarded apply design

Apply is deliberately unavailable without all of `--apply`, an explicitly
provided expected project, a matching confirmation, a matching detected
`.firebaserc` project, a private manifest path outside the repository/Hosting
root and an explicit backup prefix.
The command must not be run until the dry-run report and unresolved objects have
been reviewed.
The first apply run also refuses to start unless its live plan is exactly the
approved 45 total / 26 linked / 19 unassigned state. The manifest stores that
`RUN_PLAN`; retries may only operate on a safe subset of its original paths and
must still find the same 19 unassigned objects.

For every linked item, apply re-fetches the source and Firestore record, writes
the original state to the private manifest, copies and verifies a token-free
backup, copies and verifies the UID-scoped destination, creates a replacement
download token, updates and re-reads Firestore, verifies the replacement URL,
and only then deletes the legacy object. Deleting that verified old object is
the token-revocation mechanism; the old token URL is checked afterward.
Backup metadata without a token and destination metadata with a fresh token are
supplied in their initial atomic rewrite requests, avoiding a copy-then-patch
window in which either new object could inherit the legacy token.

The private manifest is append-only across a resumed run and contains original
token-bearing URLs and metadata. The tool refuses a manifest inside this
repository because the main Hosting public root is `.`. It must be stored in an
access-limited location outside the repository and retained with the backup
until rollback is no longer needed. The repository also ignores
`migration-private/` as defence in depth, but that directory is not an accepted
apply destination.

## Rollback and partial-run recovery

Each manifest event records a stage (`BEFORE`, `BACKUP_VERIFIED`,
`COPY_VERIFIED`, `RECORD_VERIFIED`, or `COMPLETE`) plus the before/after state.
Recovery should be performed with an administrative tool and generation/update
preconditions:

1. Stop further migration for the affected record and inspect its last stage.
2. If the legacy source was removed, copy its verified object from the recorded
   backup path back to the original path.
3. Restore the original custom metadata, including its original Firebase
   download token, from the private manifest.
4. Restore the original Firestore attachment fields from the manifest and
   re-read the record to verify them.
5. Verify the restored attachment before removing the UID-scoped destination.

If a run stops before legacy deletion, both the verified backup and source are
retained. Re-running with the same manifest and backup prefix reuses equivalent
copies and continues safely. Unassigned objects are never changed by apply.

## Post-apply read-only verification

The `--verify` mode reads the private manifest and production state without
writing either. It requires the same explicit, confirmed and detected project
checks as apply. Verification requires all 26 original sources to be absent,
all backups and destinations to match the original content, all backups to be
token-free, all destination tokens to be non-legacy, all Firestore records and
replacement URLs to resolve correctly, and all old token URLs to be inactive.
It also compares the 19 unassigned objects with the manifest's original
generation, metageneration, hashes, timestamps and metadata shape.

## Unassigned-object quarantine

Leave unresolved legacy objects in place during attribution. For a later,
separately approved quarantine, first copy each to an access-restricted backup
namespace without `firebaseStorageDownloadTokens`, verify hashes and sizes, and
record source/backup metadata in a private manifest. Only after retention and
recovery checks should the original be deleted to revoke its bearer token.
