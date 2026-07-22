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
