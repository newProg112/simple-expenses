/**
 * Import function triggers from their respective submodules:
 *
 * const {onRequest} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions/v2");
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
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
admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const simpleBooksProPriceId = "price_1TnLTCJmLqrFk5SqusEJiIhu";
const successUrl = "https://simple-books.co.uk/account.html?checkout=success";
const cancelUrl = "https://simple-books.co.uk/account.html?checkout=cancelled";

exports.createCheckoutSession = onRequest(
    {
      secrets: [stripeSecretKey],
      cors: [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "https://simple-books.co.uk",
      ],
      invoker: "public",
    },
    async (request, response) => {
      if (request.method !== "POST") {
        response.status(405).json({error: "Method not allowed."});
        return;
      }

      const authorization = request.get("Authorization") || "";
      const match = authorization.match(/^Bearer (.+)$/);

      if (!match) {
        response.status(401).json({
          error: "You must be signed in to start checkout.",
        });
        return;
      }

      try {
        const decodedToken = await admin.auth().verifyIdToken(match[1]);

        const stripe = new Stripe(stripeSecretKey.value());
        console.log("Stripe account:", await stripe.accounts.retrieve());
        console.log(await stripe.prices.retrieve(simpleBooksProPriceId));
        const uid = decodedToken.uid;

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
          response.status(500).json({
            error: "Stripe did not return a Checkout Session URL.",
          });
          return;
        }

        response.json({
          url: session.url,
        });
      } catch (error) {
        const errorCode = error && error.code ? String(error.code) : "";
        const errorMessage = error && error.message ?
          String(error.message) :
          "Unknown checkout error.";
        const errorStack = error && error.stack ? String(error.stack) : "";
        const isAuthError = errorCode.startsWith("auth/");

        console.error(
            `createCheckoutSession failed:
        Code: ${errorCode || "unknown"}
        Message: ${errorMessage}
        Stack:
        ${errorStack}`,
        );

        response.status(isAuthError ? 401 : 500).json({
          error: isAuthError ?
            "You must be signed in to start checkout." :
            "Checkout session could not be created.",
        });
        return;
      }
    },
);
