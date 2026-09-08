# Subscription lifecycle Phase 1: local correction review

Release preparation is blocked. The frozen Hosting safeguard remains unchanged
and fails for the changed overlay. No Stripe/Firebase service, emulator, deployment,
commit, push, environment change, promotion code or checkout enablement occurred.

## Policy implemented locally

Ordinary paid Pro requires canonical subscription UID ownership, expected Stripe
mode, configured Pro price as the only item, and numeric quantity exactly 1.
Subscription/customer linkage must agree and foreign customer UID metadata is
rejected. Existing compatibility permits missing customer UID metadata when the
owned subscription establishes the relationship.

| Canonical state | Stored/effective plan | Account wording/behaviour |
| --- | --- | --- |
| active | Pro | Subscription active; renewal date |
| trialing | Pro | Subscription trial active; no new trial offer |
| past_due | Pro | Payment overdue; Pro remains available for now; manage billing when linked |
| incomplete | Starter | Initial payment incomplete; records and standard exports remain |
| unpaid / paused | Starter | Starter; records/standard exports remain; manage billing when linked |
| incomplete_expired | Starter | Payment setup expired; checkout unavailable |
| canceled | Starter | Subscription cancelled; checkout unavailable |
| unknown / invalid price or quantity | Starter | No paid Pro; wording depends on preserved status |

Scheduled cancellation retains Pro until canonical status becomes terminal.
Valid canonical active recovery restores Pro; an invoice paid flag alone does not.
There is no independent grace deadline. A subscription left in past_due can retain
Pro indefinitely. Neither a fixed grace period nor actual retry activity is promised
in the Account message. Stripe retry exhaustion settings remain unverified.

Intentional stored Pro overrides remain valid. Starter plus billingOverride:true
cannot promote itself: the writer validates the old override before constructing
the candidate and clears an inconsistent override. Demo and deletion exclusions
remain intact.

AI Assistant/scanning retain 500 each for Pro and 10 each for Starter, per UTC
calendar month. Downgrade/recovery does not reset usage. Existing projects remain
editable above five active projects. New On Hold/Completed projects are allowed at
capacity; new Active projects/reactivations are blocked by the existing client save
policy. This is not an atomic server-enforced capacity limit.

Ordinary records, attachments and standard Excel/JSON exports receive no new
billing restriction. The four Pro reports and Accountant Pack remain gated by
existing access helpers. JSON contains records and attachment references, not
Storage binaries or a complete service replica. No broader retention/export
completeness promise is introduced.

## Events and deliberate error handling

Supported: checkout.session.completed; customer.subscription.created, updated and
deleted; invoice.payment_failed, invoice.paid and invoice.payment_succeeded.
All three invoice names exist in the installed Stripe 22.3 SDK's
2026-06-24.dahlia API types. Current parent.subscription_details and legacy invoice
subscription references are accepted. Dedicated customer.subscription.paused /
resumed and invoice_payment.paid events are not added by this phase.

- Unsupported events, one-off/deleted invoices, malformed/missing/conflicting
  invoice references, and initially missing/deleted subscriptions are acknowledged
  without a projection. Invoice fields alone cannot grant Pro.
- A canonical invoice subscription without application UID ownership is ignored.
  Invalid UID metadata, foreign customers/modes, identity mismatch, unavailable
  customers, API timeouts and transaction failures remain errors (HTTP 500).
- Initial discovery acknowledges only a Stripe resource_missing invalid-request
  error as permanent missing data. Disappearance after discovery remains retryable.
- An unrelated-product invoice cannot replace a different stored Pro subscription.
  Invalid price/quantity on the stored subscription revokes ordinary paid Pro.
- Existing raw-body signature verification remains intact. Successful projections
  and event receipts commit atomically. Projection version 2 reprojects legacy
  receipts once; subsequent delivery does not mutate the profile again. Duplicate
  delivery still performs canonical reads before the transactional receipt check.

## Ordering invariant and bounded work

1. Strongly read stripeProjectionRevision, treating an absent field as zero.
   Invalid revisions fail closed.
2. Retrieve and validate canonical subscription/customer state outside Firestore
   transactions. Optional card display reads are also outside transactions.
3. In a transaction, reread the profile and receipt/deletion/Demo guards. Commit the
   projection, revision r+1 and receipt only if the revision is still r.
4. A changed revision discards the remote result and starts a fresh observation/read.
   Allow at most three outer attempts and three Firestore attempts per transaction.
   Exhaustion throws without a receipt, allowing webhook redelivery.

An old read cannot overwrite a projection committed after its observed revision.
Transaction retries perform no Stripe calls. Event timestamps and lexical IDs are
not subscription versions. The production wrapper requires a canonical reader.
Older different subscriptions remain ignored; equal/missing subscription creation
times cannot prove a replacement and remain retryable.

Every lifecycle Stripe GET has a 3-second timeout and zero SDK retries. There can
be up to four reads per projection attempt, plus one invoice discovery read or two
portal preflight reads. These are request/call limits, not a hard end-to-end latency
guarantee: Auth/Firestore, scheduling and portal session creation also take time.
Optional card display failure does not block projection.

The invariant assumes canonical Stripe reads reflect current state and every
concurrent projection participates in the revision protocol. Old deployed writers
or administrative writes bypassing the revision are outside that guarantee.
A separately authorised rollout must prevent mixed old/new writers. No deployment
or revision migration occurred.

## Portal reconciliation and Account refresh

The authenticated portal endpoint reconciles its linked subscription before portal
eligibility is decided. This can repair missed cancellation/recovery when invoked;
it is not unattended reconciliation. Invalid linkage can prevent portal access.

Account polls only with billing=return plus a one-use same-user session marker
created after a successful portal response with an HTTPS billing.stripe.com URL.
The marker expires after 15 minutes. It is a UX hint, not cryptographic proof of a
visit or entitlement authority. Blocked storage falls back to manual refresh.
Query data alone never starts polling or grants Pro.

At most six server profile reads run 2.5 seconds apart within a 20-second deadline.
The next poll waits for the usage refresh. Navigation/auth changes stop timers;
late profile/usage results are ignored. In-flight network operations cannot all be
aborted. Only billing display fields change, preserving unsaved business fields.
Polling opens no sessions and does not write Firestore. Delayed webhooks beyond
the bound may require another refresh or billing-management request.

## Test evidence and limits

Lifecycle tests compose the real processor, writer and both entitlement paths with
an optimistic Firestore double. They exercise statuses, recovery/usage, scheduled
and final cancellation, invalid evidence, overrides/Demo, receipts, an older read
finishing last, callback retries and contention exhaustion. They assert Stripe reads
execute outside transactions, but do not prove real Firestore lock timing.

The actual HTTP callback executes with real local SDK HMAC signature verification
and fake services. Actual Account rendering/portal/refresh and Project form/save
functions are parsed from HTML and run with DOM/service doubles. Timers, return
markers, late usage responses and unsaved fields are tested. Brittle mapper/Project
source-string assertions were removed.

The preservation fixture rereads records after downgrade and constructs real XLSX
and JSON data. Actual standard download handlers execute against fake readers and
downloads. Report/Accountant Pack access helpers are checked. These tests could
still pass with broken browser imports, Firebase rules or Storage downloads; they
are not end-to-end data-preservation or report-gate proof.

Final validation results are recorded after the correction run.

## Release blocker and deferred checks

The documented npm run prepare:hosting:billing command calls live Firebase Hosting
channel/manifest APIs, reconstructs a frozen baseline and compares current overlay
source with a reviewed Git revision. It does not simply update a checksum.
Running it breaches this task's no-external-services restriction. Changing its
recipe/digest or supplying fake live results would bypass the guard. The recipe,
safeguard test and generated release output therefore remain untouched.

Before release, separately authorise:

1. Emulator transaction contention, retry exhaustion and receipt tests with a local
   Stripe double; verify rollout excludes old writers.
2. Browser/rules checks for ordinary reads/edits, attachments, standard exports,
   four report gates, Accountant Pack and Project capacity behaviour.
3. Browser portal returns across recovery/cancellation, delayed webhooks, storage
   refusal, navigation, sign-out, account switches and unsaved edits.
4. Review the complete frontend cache dependency chain: changed entitlement and
   Project modules still have existing import tokens outside this bounded scope.
5. Verify live webhook payload/API version, delivery selections, retry exhaustion
   and portal recovery/cancellation settings. Retain the four existing events and
   add the three invoice events above if absent. No destination changed.

Adam must decide the retry/terminal policy, whether an independent grace deadline
or unattended reconciliation is needed, persistent ownership/replacement ambiguity
handling, and the authorised release/rollout process. Until then checkout stays
disabled and this change is not declared release-ready.
