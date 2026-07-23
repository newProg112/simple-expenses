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
