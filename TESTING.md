# Testing

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

Phase 1 tests live in `tests/` and cover invoice totals and VAT, due-date and date formatting helpers, chronological month ordering, and receivables ageing boundaries. They run entirely in Node and do not need a browser, Firebase, network services, OpenAI, Stripe, or production data.

This phase deliberately excludes browser automation, Firebase Emulator tests, integration and end-to-end tests, AI and Stripe tests, invoice scanning, deployment checks, and CI configuration.

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
2. Confirm the desktop navigation shows Features, Pricing, Contact, Login, and Sign Up with no Tools item.
3. Open the mobile menu and confirm it shows Features, Pricing, Contact, Login, and Sign Up, updates `aria-expanded`, closes after selecting a link, and retains its existing animation.
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
