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
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const simpleBooksProPriceId = "price_1TnLTCJmLqrFk5SqusEJiIhu";
const successUrl = "https://simple-books.co.uk/account.html?checkout=success";
const cancelUrl = "https://simple-books.co.uk/account.html?checkout=cancelled";
const userProfiles = admin.firestore().collection("userProfiles");

/**
 * Returns the first Stripe price ID on a subscription.
 * @param {object} subscription Stripe subscription object.
 * @return {string} Stripe price ID.
 */
function subscriptionPriceId(subscription) {
  const items = subscription.items && subscription.items.data ?
    subscription.items.data :
    [];
  const firstItem = items[0] || {};
  const price = firstItem.price || {};
  return price.id || "";
}

/**
 * Maps Stripe subscription status to Simple Books subscription status.
 * @param {object} subscription Stripe subscription object.
 * @return {string} Simple Books subscription status.
 */
function subscriptionStatus(subscription) {
  return subscription.status === "canceled" ? "cancelled" : "active";
}

/**
 * Finds a Firebase user ID for a Stripe subscription event.
 * @param {object} subscription Stripe subscription object.
 * @return {Promise<string>} Firebase user ID, or an empty string.
 */
async function findUidForSubscription(subscription) {
  const metadata = subscription.metadata || {};

  if (metadata.firebaseUid) {
    return metadata.firebaseUid;
  }

  const subscriptionSnap = await userProfiles
      .where("stripeSubscriptionId", "==", subscription.id)
      .limit(1)
      .get();

  if (!subscriptionSnap.empty) {
    return subscriptionSnap.docs[0].id;
  }

  if (!subscription.customer) {
    return "";
  }

  const customerId = typeof subscription.customer === "string" ?
    subscription.customer :
    subscription.customer.id;
  const customerSnap = await userProfiles
      .where("stripeCustomerId", "==", customerId)
      .limit(1)
      .get();

  return customerSnap.empty ? "" : customerSnap.docs[0].id;
}

/**
 * Writes subscription details to the Simple Books user profile.
 * @param {string} uid Firebase user ID.
 * @param {object} data Subscription profile fields.
 * @return {Promise<void>} Resolves when Firestore has been updated.
 */
async function updateSubscriptionProfile(uid, data) {
  await userProfiles.doc(uid).set({
    currentPlan: "Pro",
    subscriptionStatus: data.subscriptionStatus,
    stripeCustomerId: data.stripeCustomerId,
    stripeSubscriptionId: data.stripeSubscriptionId,
    stripePriceId: data.stripePriceId,
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
}

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

exports.stripeWebhook = onRequest(
    {
      secrets: [stripeSecretKey, stripeWebhookSecret],
      invoker: "public",
    },
    async (request, response) => {
      const stripe = new Stripe(stripeSecretKey.value());
      const signature = request.get("stripe-signature");
      let event;

      try {
        event = stripe.webhooks.constructEvent(
            request.rawBody,
            signature,
            stripeWebhookSecret.value(),
        );
      } catch (error) {
        console.error("stripeWebhook signature verification failed", {
          message: error && error.message ? String(error.message) : "Unknown",
        });
        response.status(400).send("Invalid webhook signature.");
        return;
      }

      try {
        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const metadata = session.metadata || {};
          const uid = metadata.firebaseUid || session.client_reference_id;
          let subscription = null;

          if (!uid) {
            console.error(
                "stripeWebhook checkout session missing Firebase uid",
                {sessionId: session.id},
            );
            response.json({received: true});
            return;
          }

          if (session.subscription) {
            subscription = await stripe.subscriptions.retrieve(
                session.subscription,
            );
          }

          const stripePriceId = subscription ?
            subscriptionPriceId(subscription) :
            "";

          await updateSubscriptionProfile(uid, {
            subscriptionStatus: "active",
            stripeCustomerId: session.customer || "",
            stripeSubscriptionId: session.subscription || "",
            stripePriceId,
          });
        }

        if (event.type === "customer.subscription.updated" ||
          event.type === "customer.subscription.deleted") {
          const subscription = event.data.object;
          const uid = await findUidForSubscription(subscription);

          if (!uid) {
            console.error(
                "stripeWebhook subscription missing Firebase uid",
                {subscriptionId: subscription.id},
            );
            response.json({received: true});
            return;
          }

          await updateSubscriptionProfile(uid, {
            subscriptionStatus: event.type === "customer.subscription.deleted" ?
              "cancelled" :
              subscriptionStatus(subscription),
            stripeCustomerId: subscription.customer || "",
            stripeSubscriptionId: subscription.id,
            stripePriceId: subscriptionPriceId(subscription),
          });
        }

        response.json({received: true});
      } catch (error) {
        console.error("stripeWebhook handler failed", {
          type: event.type,
          message: error && error.message ? String(error.message) : "Unknown",
          stack: error && error.stack ? String(error.stack) : "",
        });
        response.status(500).json({error: "Webhook handling failed."});
      }
    },
);
