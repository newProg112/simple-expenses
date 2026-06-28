/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions/v2");
const {HttpsError, onCall} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const Stripe = require("stripe");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const simpleBooksProPriceId = "price_1TnHNJjmLqrFk5SqIhT6dtVi";
const successUrl = "https://simple-books.co.uk/account.html?checkout=success";
const cancelUrl = "https://simple-books.co.uk/account.html?checkout=cancelled";

exports.createCheckoutSession = onCall(
    {secrets: [stripeSecretKey]},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "You must be signed in to start checkout.",
        );
      }

      const stripe = new Stripe(stripeSecretKey.value());
      const uid = request.auth.uid;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: simpleBooksProPriceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: uid,
        metadata: {
          firebaseUid: uid,
        },
        subscription_data: {
          metadata: {
            firebaseUid: uid,
          },
        },
      });

      if (!session.url) {
        throw new HttpsError(
            "internal",
            "Stripe did not return a Checkout Session URL.",
        );
      }

      return {
        url: session.url,
      };
    },
);
