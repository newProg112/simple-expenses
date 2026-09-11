# Controlled Stripe live checkout activation

This runbook applies only to the reviewed `stripe-live-activation` candidate. It must not be used if the preparer reports a changed live Hosting version, file inventory, Hosting configuration, Stripe price/mode, or runtime boundary.

## Preconditions

From the repository root, confirm the worktree contains only the reviewed activation changes, then run:

```powershell
npm.cmd run test:hosting:stripe-live
npm.cmd run prepare:hosting:stripe-live
git diff --check
```

Review `dist\stripe-live-activation-hosting-release\stripe-live-activation-verification.json`. It must identify live baseline `e2fceb0659593bf6`, 168 static files, no additions or deletions, only `account.html` modified, and final digest `a6cf998dad13dca194fec0072b48a5209f07ac912465f95ee5ff64e80c068eff`.

## Deployment order

1. Deploy only the Checkout endpoint from the repository root. This applies the reviewed production checkout flag without redeploying the webhook or unrelated Functions:

   ```powershell
   firebase.cmd deploy --only functions:createCheckoutSession --project simple-books-office
   ```

2. Before exposing the frontend button, confirm the command completed successfully and the function remains listed:

   ```powershell
   firebase.cmd functions:list --project simple-books-office
   ```

   Do not call the authenticated endpoint during this preparation/verification step because that could create a real Checkout Session. If the function deployment is not healthy, execute the Functions rollback below and stop.

3. Deploy only the isolated Hosting target from the prepared activation directory:

   ```powershell
   Set-Location dist\stripe-live-activation-hosting-release
   firebase.cmd deploy --only hosting:main --project simple-books-office
   Set-Location ..\..
   ```

4. In a clean browser session, sign in to the designated blank Starter account, verify the Account page offers `Upgrade to Pro`, and perform the separately authorised controlled purchase. Verify success return, webhook-created Pro entitlement, Account billing state, portal access, analytics choices, and legal links. Stop and roll back on any mismatch.

## Immediate rollback

Disable the backend first so no new Checkout Session can be created, then restore the exact 168-file pre-activation frontend.

From the repository root:

```powershell
npm.cmd run checkout:production:disable
firebase.cmd deploy --only functions:createCheckoutSession --project simple-books-office
Set-Location dist\stripe-live-activation-hosting-release\rollback
firebase.cmd deploy --only hosting:main --project simple-books-office --config firebase.json
Set-Location ..\..\..
```

The rollback Hosting artifact digest is the verified live baseline digest `3c63cb6acb71d00a5333bd693b3e5d7df37c13371b36b207f4cdfeef396097ed`; its `account.html` has checkout disabled. The disable script changes only `STRIPE_CHECKOUT_ENABLED` and does not read, print, or alter secret values. Do not redeploy the webhook or any unrelated Function during activation or rollback.
