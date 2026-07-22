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
