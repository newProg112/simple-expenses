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
