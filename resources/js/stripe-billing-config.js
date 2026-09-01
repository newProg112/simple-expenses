import { isLocalFirebaseHost } from "./firebase-runtime.js";

export const TEST_PRO_PRICE_ID = "price_1TnLTCJmLqrFk5SqusEJiIhu";
export const LIVE_PRO_PRICE_ID = "price_1UAwaZQwA8Uui39wNgjE9zNh";

export function clientStripeBillingConfiguration(runtime = globalThis){
  const testMode = isLocalFirebaseHost(runtime);
  return Object.freeze({
    expectedMode: testMode ? "test" : "live",
    proPriceId: testMode ? TEST_PRO_PRICE_ID : LIVE_PRO_PRICE_ID
  });
}
