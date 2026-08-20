# Production reference audit runbook

This procedure is for the Phase 3C.3C read-only Invoice/Bill reference census. The auditor has no Firestore write mode and does not import the Step 1 backfill writer. It must never be treated as authorization to backfill, repair, deploy, or otherwise mutate production.

Approved target:

- Firebase project: `simple-books-office`
- Firestore database: `(default)`
- Production runtime: Node 22.x

These identities come from the repository's `.firebaserc`, its unqualified/default `firebase.json` Firestore configuration, and the application's default-database initialization.

## Before

1. Confirm the working tree is clean with `git status --short`.
2. Record the reviewed commit or immutable tag with `git rev-parse HEAD`. Do not operate from unreviewed changes.
3. Confirm Node 22 is active with `node --version`. Abort unless it reports `v22.x`.
4. Establish ADC/Firebase credentials yourself using the previously approved operator setup. Do not create a service account, download a key, change IAM, or alter ADC as part of this procedure.
5. Independently confirm that the intended production project is `simple-books-office` and database is `(default)`.
6. Clear every Firebase emulator variable, then verify they are absent:

   ```powershell
   Get-ChildItem Env:FIRESTORE_EMULATOR_HOST,Env:FIREBASE_AUTH_EMULATOR_HOST,Env:FIREBASE_STORAGE_EMULATOR_HOST,Env:FIREBASE_DATABASE_EMULATOR_HOST -ErrorAction SilentlyContinue
   ```

7. Choose an existing, writable local directory outside any cloud-synchronised folder. Choose a new `.json` filename; the tool refuses overwrite.
8. Set and record explicit ceilings for documents, pages, discovered UIDs, and elapsed seconds. These require human review against the anticipated census size. There are deliberately no invented production defaults.
9. Ensure the production read-only audit itself has received separate authorization. Step 2B implementation or a successful preflight is not that authorization.

Abort before proceeding if the tree/commit is wrong, Node is not 22.x, credentials are uncertain, any emulator variable is present, the target identity differs, the output path exists, the limits have not been reviewed, or production reads have not been separately authorized.

## Run preflight only

Run this first, substituting a new local path and reviewed numeric limits:

```powershell
node scripts/audit-production-reference-registry.cjs `
  --production-read-only `
  --preflight-only `
  --project simple-books-office `
  --database "(default)" `
  --output "C:\local-audits\reference-audit-YYYYMMDD.json" `
  --page-size <REVIEWED_PAGE_SIZE> `
  --max-documents <REVIEWED_DOCUMENT_LIMIT> `
  --max-pages <REVIEWED_PAGE_LIMIT> `
  --max-uids <REVIEWED_UID_LIMIT> `
  --max-elapsed-seconds <REVIEWED_ELAPSED_LIMIT>
```

`--preflight-only` performs local/configuration checks and resolves the ADC project identity. That identity resolution may use Google authentication/metadata services, but the command returns before Firebase app initialization and performs zero Firestore census or business-data reads. It creates no audit artifact.

Visually confirm the preflight prints all of the following:

- `STRICTLY READ ONLY`
- requested project and credential project both `simple-books-office`
- database `(default)`
- no emulator variables
- Node `v22.x`
- the expected audit/schema versions
- the exact new local output path
- the reviewed page size and all four limits
- `FULL CENSUS`, unless deliberately diagnosing one UID
- production acknowledgement present
- `PREFLIGHT READY`

Abort on any mismatch or error. Do not work around a failed guard.

## Run the future read-only audit

Only after separate approval for the production read, rerun the same reviewed command with `--preflight-only` removed:

```powershell
node scripts/audit-production-reference-registry.cjs `
  --production-read-only `
  --project simple-books-office `
  --database "(default)" `
  --output "C:\local-audits\reference-audit-YYYYMMDD.json" `
  --page-size <REVIEWED_PAGE_SIZE> `
  --max-documents <REVIEWED_DOCUMENT_LIMIT> `
  --max-pages <REVIEWED_PAGE_LIMIT> `
  --max-uids <REVIEWED_UID_LIMIT> `
  --max-elapsed-seconds <REVIEWED_ELAPSED_LIMIT>
```

Flag meanings:

- `--production-read-only`: acknowledges production reads only; it unlocks no writes.
- `--project` and `--database`: must exactly match the approved target.
- `--output`: new local JSON artifact; required and never overwritten.
- `--page-size`: deterministic Firestore query page size, from 1 through 500.
- `--max-documents`, `--max-pages`, `--max-uids`: hard read/census ceilings.
- `--max-elapsed-seconds`: hard wall-clock ceiling checked around page reads.
- `--compare <prior.json>`: optional local comparison with a compatible prior artifact.
- `--uid <uid>`: optional single-UID diagnosis. This is always an incomplete approval scope and can never be approval-ready.

Immediately before Firestore reads the CLI repeats the target, scope, runtime, output, and limits, then requires the exact displayed phrase. Do not type it unless every displayed field is correct. A non-interactive production data run is refused.

Press Ctrl+C or close the terminal if anything is unexpected. Interruption during reads cannot create the requested completed output. Safety-limit or read failures leave the requested path absent and may create a clearly named `.incomplete-...json` diagnostic beside it.

## After

1. Verify the requested report exists only if the scan completed. Confirm `artifact.status` and `scan.status` are both `complete`.
2. Confirm `census.mode` is `complete-census` and `census.approvalScopeComplete` is true before considering the readiness verdict.
3. Inspect `readiness.readyForApprovalScan`, blockers, warnings, expected backfill writes, and operational metrics.
4. Record the stable `hashes.overallAuditHash`. Separately calculate the local file checksum if desired:

   ```powershell
   Get-FileHash -Algorithm SHA256 "C:\local-audits\reference-audit-YYYYMMDD.json"
   ```

   The file checksum includes runtime metadata; `overallAuditHash` is the stable migration-state binding.
5. Preserve the artifact locally according to the approved handling procedure. It contains privacy-safe IDs and hashes but should still be treated as operational data.
6. Review the report with the designated reviewer before requesting any later authorization.

Do not run the Step 1 backfill, deploy, repair, migrate, or mutate anything after this audit. A readiness result is evidence for review, not approval to write.

## Abort conditions

Abort and investigate if any guard fails, credential identity cannot be proved, the displayed target/scope differs, the output path unexpectedly exists, a read limit is reached, a read/page failure occurs, the scan is incomplete, an incomplete artifact appears, or the process exits nonzero. Never increase limits or rerun production without reviewing why the prior ceiling was reached.
