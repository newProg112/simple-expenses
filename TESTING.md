# Testing

## Admin Dashboard Phase 5A — Recent activity feed

Phase 5A adds the owner-only, read-only `adminActivityEvents/{eventId}` feed. Browser Firestore access remains denied by default; `getAdminRecentActivity` performs all reads after validating the authenticated UID against `SIMPLE_BOOKS_ADMIN_UIDS` and validating `SIMPLE_BOOKS_DEMO_IDENTIFIERS`. Responses omit UIDs and contain only event type, ISO timestamp, normalised display email and plan, a server-owned summary, and an empty approved metadata object.

`logActivityEvent` is the narrow authenticated logger for successful login, invoice creation, scanning and AI Assistant flows. It accepts only `eventType` and an optional constrained `idempotencyKey`; UID, email, plan, summary and metadata are server-derived. Auth user creation and Stripe checkout/webhook flows write authoritative sign-up, checkout, upgrade and cancellation records. Deterministic document IDs suppress retries and 30-second rapid duplicates, while successful invoice, scan and AI actions use a unique action key so separate actions remain visible. Logging failures are caught and never reverse the completed application action.

Run the focused Phase 5A contracts with:

```sh
npm.cmd test -- tests/admin-activity.test.js tests/admin-dashboard.test.js
```

The tests cover authorization failures, missing configuration, event and field allow-lists, server-derived identity, sanitisation, duplicate keys, limits and timestamps, filters, relative time, semantic loading/empty/error states, refresh/retry/show-more controls, reduced motion, Stripe-originated subscription events, and absence of browser Firestore access. Cloud Functions and Hosting must both be deployed for Phase 5A; Firestore rules and indexes do not change.

Install the root test dependency once:

```sh
npm install
```

Run the complete test suite:

```sh
npm test
```

Run tests in watch mode while editing:

```sh
npm run test:watch
```

Automated tests live in `tests/` and cover invoice totals and VAT, due-date and date formatting helpers, chronological month ordering, receivables ageing boundaries, plan entitlements, and subscription feature gates. They run entirely in Node and do not need a browser, Firebase, network services, OpenAI, Stripe, or production data.

## Public Guides

Guide metadata lives in `assets/guides/guide-data.js`. After changing it or the shared page template, regenerate the static index and guide pages:

```sh
npm.cmd run generate:guides
```

The contracts in `tests/guides.test.js` check all 20 guide records, generated crawlable content, SEO metadata, related and sequential navigation, filtering hooks, table-of-contents generation, Firebase clean-URL rewrites, and the guide-aware 404 state.

Run the focused tests with:

```sh
npm.cmd test -- tests/guides.test.js tests/marketing-page.test.js
```

For local browser testing with Firebase Hosting rewrites, run:

```sh
firebase.cmd emulators:start --only hosting:main
```

Open the Hosting emulator URL printed in the terminal, then test `/guides`, several individual clean guide URLs, and an invalid path such as `/guides/not-a-real-guide`.

The same direct-route check can be automated when the Firebase CLI and Java are available:

```sh
npm.cmd run test:guides:hosting
```

The suite deliberately excludes browser automation, Firebase Emulator tests, integration and end-to-end tests, live OpenAI and Stripe calls, invoice scanning, deployment checks, and CI configuration.

## Plan entitlements: Phase 1 foundation

Version 1 has two plans. Starter includes 10 successful AI Assistant uses and 10 successful invoice scans per calendar month, up to 5 active projects, and no Accountant Pack, Trial Balance, General Ledger, Profit & Loss, or Balance Sheet. Pro includes 500 successful uses per calendar month for each AI feature, unlimited active projects, the Accountant Pack, and all four advanced reports.

The browser definition is in `resources/js/plan-entitlements.js`, with a CommonJS equivalent for Cloud Functions in `functions/lib/plan-entitlements.js`. `tests/plan-entitlements.test.js` proves that their constants, definitions, and helper behaviour remain in parity. Unlimited active projects use the explicit JSON-compatible value `null`; unknown allowances are not unlimited.

Monthly usage will be based on UTC calendar months. The shared helper produces stable `YYYY-MM` keys such as `2026-07` and `2027-01`. No usage counters are created or updated in Phase 1.

Only the exact subscription states `active` and `trialing` are currently recognised by the entitlement helper as eligible Pro states. Plan and status must both qualify. Unknown or malformed plans fail safely to Starter, while `past_due`, `cancelled`, `canceled`, missing, and unknown statuses fail closed.

Phase 1 left the existing Stripe webhook unchanged. At that point it collapsed every Stripe subscription status except `canceled` into the stored application status `active`, and stored `canceled` as `cancelled`. Phase 4A corrects that technical debt as described below.

Phase 1 introduces definitions and pure helpers only. It does not restrict, hide, disable, meter, or otherwise change any live feature. Later phases are planned in this order:

1. Account-page usage display.
2. AI Assistant limits.
3. Invoice-scanning limits.
4. Active-project limit.
5. Accountant Pack and advanced-report gates.
6. Homepage pricing comparison.

## AI monthly usage: Phase 4A backend foundation

Phase 4A added backend-controlled, transaction-safe usage infrastructure while leaving both counting and enforcement inactive at that phase. It introduced no UI changes or usage meters.

The eventual authoritative decision reads billing data from `userProfiles/{uid}` and uses only the Phase 1 backend entitlement helper. It does not accept plan names, subscription states, counters, or limits from the browser. The exact Pro plan with `active` or `trialing` status receives the Pro allowance; missing, malformed, unknown, `past_due`, and `canceled` billing states fail safely to Starter. An existing explicit `billingOverride: true` continues to qualify an exact Pro profile. No grace period or `current_period_end` policy has been introduced.

Usage is stored in one backend-owned monthly document:

```text
userProfiles/{uid}/usage/{YYYY-MM}
  aiAssistantSuccessfulUses: number
  invoiceScanningSuccessfulUses: number
  aiAssistantReservations:
    {requestId}: {reservedAtMillis, expiresAtMillis}
  aiAssistantCompletedRequests:
    {requestId}: completedAtMillis
  updatedAt: server timestamp
```

The month key comes from the shared `calendarMonthKey()` helper and is always a UTC `YYYY-MM` value. The invoice-scanning counter is reserved for a later phase and is not currently changed by any feature.

One Firestore transaction owns each allowance check and reservation. Active reservations count against the available allowance, so simultaneous requests cannot both take the final slot. A usable OpenAI answer finalises the matching request UUID, increments the successful-use counter, and records the UUID in the same transaction. Repeating an in-progress or completed UUID is rejected before another provider call, so it cannot increment again or be reused for free requests. Provider failures, timeouts, and malformed or empty responses release the reservation; abandoned reservations expire after two minutes, safely beyond the Function's 60-second maximum runtime, and are removed opportunistically. The pending and completed maps are naturally bounded by the monthly plan allowance.

A successful use eventually means an authenticated, valid, supported business-data question for which an OpenAI request was made and returned a usable answer. Unauthenticated or invalid calls, unsupported questions, client-side failures, pre-provider failures, provider timeouts or errors, malformed or empty provider responses, deterministic fallbacks, and internal failures do not count.

Usage documents contain operational counters, timestamps, and opaque request UUIDs only. They do not contain questions, answers, business summaries, invoices, customer names, emails, tokens, request bodies, or uploaded documents. Firestore rules are unchanged; only trusted Function code has been added to write this structure.

Stripe subscription writes now preserve the actual supported Stripe value: `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, or `paused`. Unknown or malformed values are stored as an empty status rather than promoted to `active`. The entitlement helper continues to recognise only `active` and `trialing` as Pro-eligible. Existing comped, discounted, and test profiles are not rewritten, and explicit billing overrides remain supported by the authoritative usage resolver. Phase 4A does not add grace-period behaviour.

Phase 4B added a read-only Account-page dashboard and an authenticated backend reader for the current UTC usage document. The dashboard gets allowance values and remaining calculations from the shared entitlement helpers and shows zero for a missing usage document. The reader does not create or update usage data.

Phase 4C enables `AI_USAGE_COUNTING_ENABLED` for supported AI Assistant requests only. The callable reserves transactionally before the provider call, finalises only after a usable provider answer, and releases on provider failure, timeout, or empty output. Request UUIDs make finalisation idempotent. Reservations bypass the allowance boundary while `AI_USAGE_ENFORCEMENT_ENABLED` remains `false`, so Starter and Pro users continue beyond 10 and 500 uses respectively. Invoice-scanning usage remains unchanged. The Account and AI Assistant pages reload the authenticated UTC usage document and state that counting is active while enforcement is not.

Phase 4D enables live Invoice Scanning counting through the same transactional monthly usage manager. Bills and Expenses attach an opaque UUID to each scan request. The callable reserves after authentication and file validation, finalises only after a supported, schema-valid extraction is ready to return, and releases on malformed output, unsupported documents, provider failures, timeouts, or internal errors. Scan completion UUIDs are stored separately from AI Assistant completion UUIDs in the same UTC usage document. `INVOICE_SCANNING_USAGE_ENFORCEMENT_ENABLED` remains `false`, so scans continue beyond the Starter allowance of 10 and Pro allowance of 500.

Before any later enforcement phase, legacy subscription profiles must be verified or reconciled against Stripe so no previously collapsed stored status is trusted. That phase must separately approve the customer-facing allowance behaviour, change the server-owned enforcement switch, and rerun the concurrency, provider-failure, idempotency, AI regression, lint, and full test suites. Phases 4A through 4C do not migrate existing profiles or activate enforcement.

## Frontend error monitoring

Production frontend JavaScript errors are monitored with the Sentry Browser Loader Script on `simple-books.co.uk` and `simple-books-office.web.app`. The bootstrap automatically captures uncaught browser JavaScript exceptions and unhandled promise rejections. It does not add custom `captureException` calls to application code.

Only Error Monitoring is enabled. Logging, Session Replay, tracing, performance monitoring, Application Metrics, profiling, user feedback, backend Firebase Functions monitoring, and release tracking are deliberately disabled. Backend Functions monitoring and deployment-generated releases are later phases.

`assets/sentry-monitoring.js` rejects every hostname except the two approved production hosts, including localhost, `127.0.0.1`, Live Server, Firebase emulators, preview channels, and lookalike domains. It sets `sendDefaultPii` to `false`, removes request bodies, headers, cookies, query strings, URL fragments, user identity, and extra event data, and retains only sanitised navigation breadcrumbs. Console, network, and UI-interaction breadcrumbs are discarded. The application does not add invoices, bills, customers, projects, AI prompts or responses, uploaded documents, Firebase data, authentication tokens, Stripe data, bank details, VAT numbers, or other user-entered content as Sentry context.

Automated monitoring contracts live in `tests/sentry-monitoring.test.js`. Run them with:

```sh
npm.cmd test -- tests/sentry-monitoring.test.js
```

For a local guard check, serve the repository locally and open `/manual-tests/sentry-monitoring.html`. It must report that Sentry did not load. Its button deliberately throws one labelled local error only when selected; because localhost is rejected, that error must appear only in the local browser console and must not reach Sentry. `manual-tests/**` is excluded from Firebase Hosting.

For a one-off end-to-end production verification, open an approved production page, confirm `window.Sentry` is available, and deliberately run this in that browser tab's developer console:

```js
setTimeout(() => {
  throw new Error("Simple Books Sentry manual verification error");
}, 0);
```

Remove nothing from production afterward because this command is not stored in application code. Confirm the labelled issue appears in Sentry with environment `production`, no query string or fragment, no user identity, no request payload, and no sensitive breadcrumbs. Do not paste sensitive information into the test message.

To disable monitoring without removing files, remove the approved hostnames from `assets/sentry-monitoring.js`. To remove it completely, delete that file and remove the marked `Sentry frontend error monitoring` script block from the monitored HTML documents; `firebase.json`, this note, and the focused tests/manual helper may then be removed as well.

## General Ledger Stage 1

`resources/js/ledger-engine.js` contains a pure double-entry engine with a small Chart of Accounts. It creates and validates journals for sales invoices, supplier bills, employee expenses, and mileage claims; reverses journals; detects duplicate source postings; and builds trial balances and account ledgers.

The ledger tests are in `tests/ledger-engine.test.js` and run with the same commands above. They are deterministic and do not read or write Firebase or live transaction data.

Stage 1 deliberately excludes Firestore integration, payment journals, bank reconciliation, opening balances, year-end processing, financial-statement pages, and a General Ledger user interface.

## General Ledger Stage 2A: invoice integration

Successfully created or updated Firestore invoices now create or replace their sales journal through `resources/js/ledger-firestore.js`. Journals are stored in the top-level `journals` collection with their lines embedded in each document. The deterministic document ID is `invoice_<userId>_<invoiceDocumentId>`, which prevents duplicate current journals and avoids collisions between users. The stored `sourceId` is always the actual Firestore invoice document ID.

Creation posts only after the invoice write succeeds. Updating an older invoice creates its missing journal; later updates replace that same document while preserving `createdAt` and refreshing `updatedAt`. Loading, reopening, duplicating for preview, printing, page load, and paid/unpaid status changes do not post journals. Historic invoices are not backfilled automatically.

For local diagnostics, save a test invoice and look for `Ledger journal saved for invoice <number>` in the browser console. While signed in, `await window.getInvoiceJournalFromFirestore("<invoice-document-id>")` returns that invoice's journal for inspection.

Stage 2A deliberately excludes immutable edit reversals, deletion reversals, receipt and payment journals, bank postings, historic backfill, bills, expenses, mileage, General Ledger and Trial Balance interfaces, and financial-statement pages. Replacing a journal on invoice edit is temporary; immutable reversal and repost history belongs in a later stage.

## General Ledger Stage 2B: supplier bill integration

Successfully created or updated Firestore bills now create or replace their supplier-bill journal in the same top-level `journals` collection. Each deterministic document ID is `bill_<userId>_<billDocumentId>`, and the stored `sourceId` is the actual Firestore bill document ID. Older bills remain viewable without journals; editing and saving one creates its current journal without running a historic backfill.

Bill categories map as follows: `Utilities` to 5300, `Professional fees` to 5400, `Software/subscriptions` to 5500, `Travel/mileage` to 5200, and `General`, `Other`, missing, or unknown values to 5000. Category matching in the engine is case-insensitive and trims surrounding whitespace. Bill journals debit the expense and VAT Input where applicable, then credit Trade Payables for the gross value.

Creation posts only after the bill document save succeeds. Updates replace the same journal while preserving `createdAt` and refreshing `updatedAt`. Page load, filtering, editing/reopening, attachment viewing, and paid/unpaid changes do not post journals. Locally, a successful posting logs `Ledger journal saved for bill <number>`; while signed in, use `await window.getBillJournalFromFirestore("<bill-document-id>")` for inspection.

Stage 2B excludes historic bill backfill, immutable edit reversals, deletion reversals, supplier-payment and bank journals, expense and mileage Firestore integration, General Ledger and Trial Balance interfaces, and financial-statement pages. Bill deletion is unchanged and carries a source-level TODO for a future immutable reversal.

## General Ledger Stage 2C: expense integration

Successfully saved ordinary expenses now create or replace a balanced reimbursement journal in the top-level `journals` collection. The deterministic document ID is `expense_<encodedUserId>_<encodedExpenseDocumentId>` and the stored source type is `expenseClaim`. Creation and editing post only after the expense document succeeds; editing an older expense creates its missing journal without a migration, while later saves replace that same journal, preserve `createdAt`, and refresh `updatedAt`.

Stage 2C recognises every explicitly saved ordinary expense, including Draft, Submitted, Approved, and Paid records. The separate Mark paid action remains ledger-neutral: it creates neither a reimbursement-payment journal nor a bank entry. Loading, filtering, reopening/editing without saving, and viewing attachments also do not post.

Production categories map as follows: `Travel` to 5200, `Utilities` to 5300, `Professional fees` to 5400, `Software` to 5500, and `General`, `Meals`, `Office`, `Other`, missing, or unknown categories to 5000. Matching is case-insensitive and whitespace-tolerant. Journals debit the mapped expense account for net, debit VAT Input 1200 when VAT exists, and credit Employee Reimbursements Payable 2200 for gross. Explicit VAT amounts and 0%, 5%, and 20% rates are supported; inconsistent totals are rejected.

Records whose production discriminator is `type: "mileage"` are explicitly skipped before Firestore journal access. Mileage saving, editing, filtering, and attachment behaviour are otherwise unchanged. Locally, a successful ordinary-expense posting logs `Ledger journal saved for expense <expense-document-id>`; while signed in, use `await window.getExpenseJournalFromFirestore("<expense-document-id>")` to inspect it.

Run the complete suite with:

```sh
npm.cmd test
```

Stage 2C excludes historical expense backfill, immutable reversal-and-repost history on edit, deletion reversals, reimbursement-payment journals, bank postings, mileage persistence integration, a General Ledger UI, Trial Balance UI, and P&L or Balance Sheet interfaces. Expense deletion remains unchanged and carries a source-level TODO for a future immutable reversal.

## General Ledger Stage 2D: mileage integration

Explicitly saved mileage claims now create or replace a balanced journal in the top-level `journals` collection. The deterministic document ID is `mileage_<encodedUserId>_<encodedMileageDocumentId>`, the stored source type is `mileageClaim`, and the source ID is the actual expense-collection document ID. Creation and editing post only after the mileage document succeeds. Editing and saving an older claim creates its missing journal without a migration; subsequent saves replace the same journal, preserve `createdAt`, and refresh `updatedAt`.

Mileage journals debit 5200 Travel & Mileage and credit 2200 Employee Reimbursements Payable for the full claim amount. They never create a VAT Input line. The engine uses the stored `amount` where available and validates it against `miles × ratePerMile` when both inputs exist; if the stored amount is absent, it derives and rounds the result using the same production calculation. It does not introduce or hard-code a new mileage rate.

Stage 2D recognises every explicitly saved mileage claim regardless of Draft, Submitted, Approved, or Paid status. The separate Mark paid action remains ledger-neutral and creates neither a reimbursement-payment nor bank journal. Loading, changing claim tabs, filtering, reopening without saving, and viewing attachments do not post.

The two claim flows are explicitly separated by the production `type` discriminator. Only `type: "mileage"` can reach `createMileageJournal()`; ordinary expenses continue through `createExpenseJournal()` and cannot create mileage journals. Locally, successful mileage posting logs `Ledger journal saved for mileage <mileage-document-id>`; while signed in, use `await window.getMileageJournalFromFirestore("<mileage-document-id>")` to inspect it.

Run the complete suite with:

```sh
npm.cmd test
```

Stage 2D excludes historical mileage backfill, immutable reversal-and-repost history on edit, deletion reversals, reimbursement-payment journals, bank postings, a General Ledger UI, Trial Balance UI, and P&L or Balance Sheet interfaces. Mileage deletion remains unchanged and carries a source-level TODO for a future immutable reversal.

## General Ledger Stage 3A.2: Trial Balance data

The authenticated Trial Balance page queries the top-level `journals` collection with an equality constraint on the current user's `userId`. It performs no writes. Firestore journal documents are copied into the existing ledger-engine shape and passed to `buildTrialBalance()`; invalid journals produce an error state rather than repaired or partial totals.

The table presents one closing balance per account, with debit balances shown only in Debit and credit balances shown only in Credit. KPI totals are the summed closing balances, and the status is Balanced only after journal data has loaded and the two-decimal difference is zero. Loading, no-data, and calculation-error states remain distinct.

Pure view and conversion tests live in `tests/trial-balance-view.test.js` and run with:

```sh
npm.cmd test
```

This stage excludes date filters, comparative periods, exports, drill-down account ledgers, P&L and Balance Sheet pages, journal editing, and any change to posting behaviour.

## General Ledger Stage 3B.1: page scaffold

`resources/tools/general-ledger.html` provides the authenticated General Ledger UI scaffold using the same visual system and responsive structure as the Trial Balance page. It contains placeholder KPI cards, account and optional date controls, a disabled Refresh button, and a responsive empty journal-entry table.

This stage is presentation-only. It contains no Firestore access, ledger imports, journal calculations, or data-loading behaviour, and it does not change accounting or posting logic.

Run the existing suite with:

```sh
npm.cmd test
```

## General Ledger Stage 3B.2: account activity

The authenticated General Ledger page now performs a read-only equality query against the top-level `journals` collection using the current user's `userId`. It converts journal documents without mutation or repair, builds active account options from the tested Trial Balance engine, and delegates chronological entries and running-balance accounting to `buildAccountLedger()`.

Accounts with activity are sorted by code and use the engine's chart-of-accounts names. Selecting an account renders only its postings, with source number preferred as the reference. Optional Date From and Date To filters are inclusive calendar-date filters and are applied by the Refresh button; an invalid range shows a clear warning without partial totals.

Positive running balances are presented as debit balances such as `£240.00 Dr`, negative engine balances are presented as positive credit values such as `£200.00 Cr`, and zero is shown as `£0.00`. Trial Balance account codes link to the corresponding preselected General Ledger account.

Pure reporting tests live in `tests/general-ledger-view.test.js`. This stage remains read-only and excludes journal editing, opening-balance calculations outside the selected period, export, P&L, Balance Sheet, and account-ledger pagination.

## General Ledger Stage 4.1: Profit & Loss page scaffold

`resources/tools/profit-loss.html` provides the authenticated Profit & Loss UI scaffold using the established Trial Balance, General Ledger, and Dashboard visual system. It includes four placeholder KPI cards, Date From and Date To controls, a disabled Refresh button, a responsive financial-statement layout for Income, Expenses, and Net Profit / (Loss), and the `No financial data available.` empty state.

Verify at desktop, tablet, and mobile widths that the KPI cards change from four columns to two and then one, the report controls stack on narrow screens, monetary amounts remain right-aligned, and the statement stays legible without horizontal page overflow. Confirm that Profit & Loss appears immediately after General Ledger in every authenticated navigation bar and is marked as the current page on the new report.

This stage is presentation-only. It contains no Firestore access, ledger or journal imports, financial calculations, report loading, or posting behaviour.

Run the complete suite with:

```sh
npm.cmd test
```

## General Ledger Stage 4.2: Profit & Loss journal data

The authenticated Profit & Loss page now performs a read-only equality query against the top-level `journals` collection using the current user's `userId`. Firestore journal documents are copied with the existing Trial Balance normaliser, validated by the ledger engine without repair or mutation, and passed to the pure `resources/js/profit-loss-view.js` reporting helper.

The report classifies accounts from the existing chart of accounts. `Income` accounts use credits less debits, `Expense` accounts use debits less credits, and Net Profit is Total Income less Total Expenses. Balance-sheet accounts are excluded by account type. Active account rows are ordered by account code, normal balances display as positive GBP amounts, abnormal contra balances use accounting parentheses, and a negative result is labelled and displayed as Net Loss.

Optional Date From and Date To filters are applied inclusively when Refresh is selected. Journal dates use their written `YYYY-MM-DD` calendar date without timezone conversion. An invalid range returns the Check dates state without partial totals. Loading, no-data, profit, loss, break-even, invalid-date, and unable-to-calculate states remain distinct.

Automated tests live in `tests/profit-loss-view.test.js` and cover source journals, account exclusion and classification, totals, profit/loss/break-even states, inclusive dates, sorting, contra activity, malformed journals, no-data states, and non-mutating Firestore normalisation. Run the focused tests with:

```sh
npm.cmd test -- tests/profit-loss-view.test.js
```

Run the complete suite with:

```sh
npm.cmd test
```

Manual verification:

1. Sign in with a test user that already has invoice, bill, expense, and mileage journals.
2. Open `/resources/tools/profit-loss.html` and confirm real journal data loads.
3. Confirm Sales Revenue appears under Income and General Expenses and Travel & Mileage appear under Expenses where the user's journals contain those accounts.
4. Confirm VAT Input, VAT Output, Trade Receivables, Trade Payables, and Employee Reimbursements Payable do not appear.
5. Reconcile Total Income, Total Expenses, and Net Profit or Net Loss to the test journals.
6. Apply Date From and Date To boundaries and confirm transactions on both boundary dates remain included.
7. Enter a Date From later than Date To and confirm Check dates appears with no financial totals.
8. Clear both dates, select Refresh, and confirm all journal activity returns.
9. Sign in as another user and confirm the first user's figures are no longer visible.
10. Refresh the browser and confirm that no journal is created, updated, or deleted.

Current limitations: the report uses the current fixed ledger-engine chart of accounts and supports one reporting period at a time. It has no comparative periods, cash/accrual switch, exports, drill-down, report persistence, opening-balance adjustment, year-end closing, or journal editing. The page performs no Firestore writes and requires no Firestore rules change.

## General Ledger Stage 4.3: Balance Sheet

`resources/tools/balance-sheet.html` provides an authenticated, read-only Balance Sheet generated entirely from the current user's top-level `journals` documents. The page uses an owner-scoped equality query, the existing non-mutating Firestore journal normaliser, and the ledger engine's journal validation and Trial Balance aggregation. It performs no Firestore writes.

Assets use debits less credits. Liabilities and equity accounts use credits less debits. The current-year result is derived through the tested Profit & Loss helper, with profit added to equity and loss subtracted from equity. The final equation compares Total Assets with Total Liabilities and Equity and exposes any rounded difference without adding Bank, opening-balance, equity, or suspense entries.

The optional As at filter includes journals on or before the written calendar date without timezone conversion. A blank date includes all valid journals through the latest available journal date. Loading, no-data, balanced, out-of-balance, invalid-date, and unable-to-calculate states remain distinct. Account rows link to their General Ledger account, and Current Year Profit or Loss links to Profit & Loss.

Automated tests live in `tests/balance-sheet-view.test.js` and cover account classification and orientation, current-year profit/loss, equity treatment, inclusive dates, custom valid chart accounts, zero-row suppression, equation states, malformed data, owner isolation, links, rounding, determinism, and source immutability. Run the focused suite with:

```sh
npm.cmd test -- tests/balance-sheet-view.test.js
```

Run the complete suite with:

```sh
npm.cmd test
```

Manual verification:

1. Sign in with the user who already has invoice, bill, expense, and mileage journals.
2. Open `/resources/tools/balance-sheet.html`.
3. Confirm journal data loads without creating or changing any journals.
4. Confirm Trade Receivables, VAT Input where applicable, and Bank only where bank journals exist appear under Assets.
5. Confirm Trade Payables, VAT Output, and Employee Reimbursements Payable appear under Liabilities where applicable.
6. Confirm Sales Revenue and expense accounts do not appear directly in Assets, Liabilities, or Equity.
7. Confirm their net result appears as Current Year Profit or Current Year Loss.
8. Confirm account rows open the correct preselected General Ledger account.
9. Confirm Current Year Profit or Loss opens Profit & Loss.
10. Reconcile Total Assets, Total Liabilities, Total Equity, and Difference to the journals.
11. Confirm Balanced appears only when Total Assets equals Total Liabilities plus Equity after two-decimal rounding.
12. Apply an As at date and confirm later journals are excluded while the boundary date remains included.
13. Clear As at, select Refresh, and confirm all valid journals return.
14. Refresh the browser and confirm no journals are created or altered.
15. Sign in as another user and confirm the first user's balances are not visible.

Current limitations: the Balance Sheet uses accrual journal activity from the ledger engine's chart and has no comparative periods, account group configuration, exports, opening-balance workflow, year-end closing, payment journals, bank reconciliation, migrations, or journal editing. Existing production data may legitimately report Out of balance if the necessary Bank or Owner's Equity/opening-balance journals do not yet exist. The report never invents or repairs those amounts and requires no Firestore rules change.

## Reusable application shell

Authenticated application pages use `assets/app-shell.js` and `assets/app-shell.css` for their shared desktop sidebar and mobile navigation drawer. The shell owns the route list, navigation grouping, active-page matching, project-details alias, responsive layout, drawer accessibility, and print reset. It does not import Firebase or change authentication, Firestore, or business logic.

At 901px and above, the control beside the brand collapses the sidebar to its icon navigation and expands it again. Its `aria-label`, `title`, and `aria-expanded` state describe the available action and current expansion state. The validated preference is stored under the namespaced `simple-books:app-shell:sidebar-state:v1` local-storage key and defaults to expanded when missing, invalid, or unavailable. The desktop navigation scroll position is stored in session storage under `simple-books:app-shell:sidebar-scroll:v1` only for an ordinary same-window internal navigation click. Restoration is validated, clamped, and adjusted only when needed to keep the active link visible.

Automated navigation tests live in `tests/app-navigation.test.js`. They cover route definitions and uniqueness, group order, normalised pathname matching, the Project Details to Projects alias, complete icon coverage, expanded/collapsed state handling, valid and invalid persisted state, scroll parsing and clamping, ordinary navigation, modified clicks, and the desktop/mobile CSS contract. Run the focused tests with:

```sh
npm.cmd test -- tests/app-navigation.test.js
```

Run the complete suite with:

```sh
npm.cmd test
```

Manual verification:

1. Sign in and open every authenticated application route from the sidebar.
2. Confirm the current route has the active treatment and `aria-current="page"`.
3. Open a project details URL with an `id` query and confirm Projects remains active.
4. At 901px and above, operate the collapse button with both pointer and keyboard. Confirm the sidebar and main-content offset transition together between the expanded width and approximately 76px.
5. Confirm the collapse button updates `aria-label`, `title`, and `aria-expanded`, retains a visible keyboard focus indicator, and that the preference survives navigation, refresh, and a new browser session.
6. In collapsed mode, confirm group headings and text labels are visually hidden while every icon, active-page treatment, accessible link name, and native tooltip remains available.
7. Scroll the expanded desktop navigation, follow an ordinary sidebar link, and confirm the position returns without forcing the active item to the top. Repeat near the bottom and confirm restoration is clamped safely.
8. Confirm Ctrl/Cmd-click, Shift-click, Alt-click, middle-click, downloads, external links, and `_blank` links retain their normal behavior and do not replace the saved scroll position.
9. At 900px and below, confirm the hamburger opens the full-width off-canvas drawer regardless of the saved desktop collapsed preference.
10. Resize repeatedly across the 900/901px boundary. Confirm desktop width/state restoration and unchanged mobile drawer sizing.
11. Confirm the mobile close button, backdrop, Escape key, and selecting a link close the drawer.
12. Confirm keyboard focus moves into the drawer, remains contained while open, and returns to the hamburger when closed.
13. Confirm the underlying page cannot scroll or receive focus while the drawer is open.
14. On the invoice page, sign out and confirm its existing login prompt remains available while application navigation is hidden; sign in and confirm the shell appears.
15. Print or preview an invoice, budget, cashflow report, Trial Balance, General Ledger, Profit & Loss, and Balance Sheet. Confirm the sidebar, collapse control, drawer controls, and backdrop are absent and content has no shell offset.
16. Enable reduced motion and confirm neither the drawer nor desktop collapse transition animates.

Before finishing shell changes, also run:

```sh
git diff --check
```

## Marketing landing page

`index.html` presents Simple Books as business management software for freelancers, sole traders and small businesses. Its existing visual system, responsive CSS, mobile-menu behavior, authentication routes, and client-side interactions remain unchanged while the page copy reflects the current dashboard, operational tools, planning features, AI Assistant, financial reports, and Accountant Pack.

Automated contracts live in `tests/marketing-page.test.js`. They verify the desktop and mobile navigation labels, absence of the landing-page Tools link, continued presence of the standalone Tools page, current feature coverage, the two-plan pricing structure, permitted prices, removal of legacy service wording, and mobile-menu accessibility attributes.

Run the focused suite with:

```sh
npm.cmd test -- tests/marketing-page.test.js
```

Manual verification:

1. Open `/` at desktop, tablet, and mobile widths and confirm the existing layout and styling remain intact.
2. Confirm the desktop navigation shows Features, Pricing, Guides, Contact, Login, and Sign Up with no Tools item.
3. Open the mobile menu and confirm it shows Features, Pricing, Guides, Contact, Login, and Sign Up, updates `aria-expanded`, closes after selecting a link, and retains its existing animation.
4. Confirm every landing-page anchor still scrolls to the correct section and Login, Sign Up, Try Demo, dashboard, and email routes remain unchanged.
5. Confirm the hero presents Simple Books as one connected business platform.
6. Confirm the feature grid remains responsive and accurately describes the current application.
7. Confirm pricing contains only Starter at Free and Pro at £15/month, with the documented usage limits and Pro features.
8. Search the rendered page for obsolete service wording and confirm none remains.
9. Confirm keyboard focus remains visible and navigation controls retain accessible names.

Run the complete suite and whitespace validation before finishing:

```sh
npm.cmd test
git diff --check
```

# Admin Dashboard Phase 2A

The callable `getAdminMetrics` requires two backend-only Secret Manager values:

```powershell
firebase functions:secrets:set SIMPLE_BOOKS_ADMIN_UIDS
firebase functions:secrets:set SIMPLE_BOOKS_DEMO_IDENTIFIERS
```

Enter one or more comma-separated Firebase Authentication UIDs for
`SIMPLE_BOOKS_ADMIN_UIDS`. For `SIMPLE_BOOKS_DEMO_IDENTIFIERS`, prefer
`uid:DEMO_FIREBASE_UID`; `email:demo@simple-books.co.uk` is supported as a
temporary fallback. Multiple demo identifiers may be comma-separated. Never
commit production values.

For local Functions emulator testing, create an ignored `functions/.secret.local`
file containing development-only values:

```dotenv
SIMPLE_BOOKS_ADMIN_UIDS=DEVELOPMENT_ADMIN_FIREBASE_UID
SIMPLE_BOOKS_DEMO_IDENTIFIERS=uid:DEVELOPMENT_DEMO_FIREBASE_UID
```

Start Authentication, Firestore, Functions and the main Hosting emulator with:

```powershell
firebase emulators:start --only auth,firestore,functions,hosting:main
```

In the browser console on `http://127.0.0.1:5000`, opt this tab into the local
emulators, then reload:

```js
sessionStorage.setItem("simpleBooksUseFirebaseEmulators", "true");
location.reload();
```

This switch works only on `localhost` or `127.0.0.1` and lasts only for the
current browser tab. Remove it with
`sessionStorage.removeItem("simpleBooksUseFirebaseEmulators")`.

Disabled Firebase Authentication accounts are included in Total Users because
they remain registered accounts. Configured demo accounts are excluded from all
Phase 2A metrics and recent sign-ups.

# Admin Dashboard Phase 3A

The callable `getAdminUserDetails` reuses the backend-only
`SIMPLE_BOOKS_ADMIN_UIDS` secret. It authorises the caller from Firebase
Authentication before accepting an email and never uses browser-supplied admin
flags.

Automated coverage verifies unauthenticated and non-admin rejection, unknown
emails, missing profiles, the successful response projection, local
case-insensitive filtering, and the customer panel's loading and error states:

```powershell
npm.cmd test -- tests/admin-user-details.test.js tests/admin-dashboard.test.js
```

Manual emulator check:

1. Open `/admin` as a configured admin and wait for recent sign-ups to load.
2. Type part of an email, including with different letter casing, and confirm
   the table filters immediately without a Functions request in the Network
   panel.
3. Select a row and confirm the read-only Customer Summary shows a loading
   state followed by only the approved account and current-month usage fields.
4. Confirm Escape, the close button, and the backdrop close the panel and that
   the mobile panel fits the viewport.
5. Repeat with an unknown email through the callable emulator, a non-admin
   account, no signed-in account, and the Functions emulator stopped to verify
   the no-customer, permission-denied, signed-out, and unavailable states.
6. Confirm there are no edit, delete, impersonation, password-reset, plan, or
   account-change controls and no Firestore rules were changed.

# Admin Dashboard Phase 3B

The callable `searchAdminUsers` reuses `SIMPLE_BOOKS_ADMIN_UIDS` and
`SIMPLE_BOOKS_DEMO_IDENTIFIERS`. It pages Firebase Authentication server-side,
excludes configured demo identities, applies a case-insensitive partial email
match, and returns at most 20 minimal support records. Only matching Auth users'
`userProfiles/{uid}` documents and current-month usage documents are read. For a
larger customer base, replace this scan behind the same callable contract with
a purpose-built indexed search; Phase 3B does not add an aggregate collection,
scheduled job, or accounting-data search.

Run the focused automated coverage with:

```powershell
npm.cmd test -- tests/admin-user-search.test.js tests/admin-user-details.test.js tests/admin-dashboard.test.js
```

Manual support-workspace check:

1. Sign in as a configured admin, open `/admin`, and confirm the initial table
   shows Recent sign-ups.
2. Type part of a recent email and confirm the loaded rows filter immediately
   without a `searchAdminUsers` network request.
3. Enter one character and press Enter or choose Search all users. Confirm the
   query-too-short message appears and no callable request is made.
4. Enter two or more characters, press Enter, and confirm one loading state and
   one `searchAdminUsers` request. Repeated activation while loading must not
   start a concurrent request.
5. Verify full-user results, the “No matching users found” state, and Clear
   returning the table to Recent sign-ups.
6. Open a full-search result and verify the Account, Subscription, Usage this
   month, and supported neutral Support diagnostics sections. Confirm no stale
   customer data remains visible during loading or after failure.
7. Choose Refresh details and confirm one `getAdminUserDetails` request, a fresh
   loading state, and removal of any stale panel error.
8. Choose Copy email and Copy summary, verify the clipboard contains only the
   visible approved fields, and confirm the inline “Copied” feedback. Block
   clipboard permission and verify the inline failure message without an alert.
9. Open the panel with the keyboard, close it with Escape and the close button,
   and confirm focus returns to the email button that opened it.
10. Repeat at a narrow mobile viewport and confirm the result cards and panel
    remain usable without horizontal page overflow.
11. Repeat search signed out and as a non-admin; verify redirect/access-denied
    behaviour. Temporarily omit emulator secrets to verify the configuration
    state, then stop Functions to verify the unavailable state.
12. Confirm a failed search clears old results and that no customer-specific
    console deep links, account actions, or Firestore rules changes were added.

# Admin Dashboard Phase 4A

`getAdminMetrics` now returns a backward-compatible `charts` section calculated
from the same Firebase Authentication pagination pass and normalised profile
plans as the existing KPI cards. It returns the current UTC month plus the
preceding 11 months. Months without sign-ups are explicit zeroes. Accounts with
missing or malformed Auth creation dates are not assigned to a sign-up month;
they remain in the cumulative opening baseline so the final cumulative value
continues to agree with Total Users. Demo identities remain excluded.

At a larger user volume, an owner-only aggregate snapshot document written as
part of normal account lifecycle processing would avoid a full Auth scan. Such
snapshots should store month-keyed aggregate counts only, be updated idempotently
on account creation and authoritative subscription events, and never reconstruct
historical revenue from current profile fields. Phase 4A adds no snapshots,
scheduled jobs, accounting reads, or historical revenue figures.

Run focused automated coverage with:

```powershell
npm.cmd test -- tests/admin-metrics.test.js tests/admin-dashboard.test.js
```

Manual growth-chart checks:

1. Sign in as a configured admin, open `/admin`, and confirm Growth overview is
   below the KPI cards and above Recent sign-ups.
2. Confirm New sign-ups shows exactly 12 chronological UTC calendar months,
   includes the current month, and shows zero-sign-up months rather than gaps.
3. Confirm User growth never decreases, includes accounts created before the
   displayed range in its opening value, and ends at the Total Users KPI.
4. Confirm Current plan mix shows Starter and Pro counts equal to their KPI
   cards, totals to Total Users, and describes plan rather than payment status.
5. Configure a demo account and verify it is absent from all chart counts. Test
   an empty Auth emulator and confirm all three cards show clear empty states
   with no invalid percentages.
6. Choose Refresh repeatedly and confirm only one metrics request is active,
   chart instances are replaced without duplicate canvases, and new values are
   shown. Stop the Functions emulator during refresh and confirm all stale KPI,
   table, and chart content is cleared before the unavailable message appears.
7. Temporarily omit backend secrets and verify the configuration error. Repeat
   signed out and as a non-admin to verify redirect and access-denied behaviour.
8. Test wide desktop, laptop, tablet, and narrow mobile widths. Resize the
   browser and collapse or expand the sidebar; confirm charts resize, labels and
   legends remain readable, and the page has no horizontal overflow or clipped
   tooltips.
9. Use keyboard navigation and a screen reader to confirm headings,
   descriptions, canvas labels, and hidden summary lists communicate every
   returned value without requiring canvas interaction or colour recognition.
10. Enable reduced motion and confirm chart and loading animations are disabled.

# Custom Analytics Events Phase 1

The shared browser helper in `assets/analytics-events.js` reuses the Analytics
instance exported by `firebase-config.js`; it does not initialise another
Firebase app. Custom Analytics and Analytics initialisation are disabled on
`localhost`, `127.0.0.1`, IPv6 localhost, and Firebase emulator sessions.
Analytics failures and browser-extension blocking are non-fatal.

Tracked events and exact success boundaries:

| Event | Trigger | Approved parameters |
| --- | --- | --- |
| `sign_up` | Firebase email/password account creation resolves successfully | `method: "email"` |
| `login` | Email/password login resolves successfully, including the demo email login | `method: "email"` |
| `invoice_created` | A new invoice save completes; invoice edits and unsaved previews are excluded | `plan: "starter" \| "pro"`, `has_vat: boolean`, `item_count_bucket: "1" \| "2-3" \| "4+"` |
| `invoice_scanned` | A bill or expense scan callable returns a valid successful extraction after the backend records successful usage | `plan: "starter" \| "pro"`, `file_type: "pdf" \| "jpg" \| "jpeg" \| "png" \| "other"` |
| `ai_question_asked` | The AI Assistant returns `mode: "ai"`; previews, deterministic fallbacks, errors, and duplicate backend requests are excluded | `plan: "starter" \| "pro"` |
| `begin_checkout` | A signed-in Starter user receives a valid Pro Checkout URL, immediately before redirect | `currency: "GBP"`, `value: 15`, `plan: "pro"` |

The event policy rejects unknown event names and strips unknown or invalid
parameters. Payloads never include emails, Firebase UIDs, names, phone numbers,
addresses, invoice or bill numbers, customer or supplier names, filenames,
URLs, Storage paths, Stripe identifiers, document contents, extracted values,
prompts, AI responses, projects, notes, descriptions, or accounting amounts.
The only amount is the fixed public Pro price of GBP 15 for `begin_checkout`.

Focused automated coverage:

```powershell
npm.cmd test -- tests/analytics-events.test.js
```

Realtime verification:

1. Use a production-hosted Simple Books URL with a dedicated test account;
   localhost and emulator traffic is deliberately suppressed.
2. In Google Analytics, open **Reports > Realtime**.
3. Complete one supported success action and confirm its event appears once with
   only the approved parameters above. Repeat a failed action and confirm no
   success event appears.
4. Disable any Analytics-blocking extension if events do not arrive. Do not use
   real customer or accounting information during verification.

DebugView verification:

1. Enable the Google Analytics Debugger browser extension for the production
   test session; no application `debug_mode` parameter is permanently added.
2. Open **Admin > Data display > DebugView** in Google Analytics.
3. Perform each supported success action and inspect its parameters. Confirm
   failures, invoice edits, deterministic AI fallbacks, and invalid Checkout
   responses do not create success events.
4. Disable the debugger extension after testing.

Simple Books deliberately does not emit `purchase` from frontend code. A future
`purchase` event must be emitted only by the trusted Stripe webhook after a
confirmed payment, using server-side idempotency so browser navigation or page
refreshes cannot create false purchases.

Consent and cookie presentation are intentionally unchanged in this phase.
Review the production consent model, privacy notice, regional requirements, and
Google Consent Mode separately before deciding whether a consent banner or
additional controls are required.
