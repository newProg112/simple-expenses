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
const functionsV1 = require("firebase-functions/v1");
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
const billingPortalReturnUrl = "https://simple-books.co.uk/account.html";
const userProfiles = admin.firestore().collection("userProfiles");

/**
 * Builds the default Simple Books billing profile for a Firebase user.
 * @param {object} user Firebase Auth user record or decoded token.
 * @return {object} Default user profile data.
 */
function defaultUserProfile(user) {
  return {
    currentPlan: "Starter",
    subscriptionStatus: "",
    billingOverride: false,
    billingOverrideReason: "",
    email: user.email || "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    subscriptionUpdatedAt: null,
  };
}

/**
 * Creates a user profile if it does not already exist.
 * @param {string} uid Firebase user ID.
 * @param {object} user Firebase Auth user record or decoded token.
 * @return {Promise<boolean>} True when a profile was created.
 */
async function createUserProfileIfMissing(uid, user) {
  try {
    await userProfiles.doc(uid).create(defaultUserProfile(user));
    return true;
  } catch (error) {
    if (error && (error.code === 6 || error.code === "already-exists")) {
      return false;
    }

    throw error;
  }
}

exports.createUserProfile = functionsV1.auth.user().onCreate(async (user) => {
  await createUserProfileIfMissing(user.uid, user);
});

exports.ensureUserProfile = onRequest(
    {
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
          error: "You must be signed in to create an account profile.",
        });
        return;
      }

      try {
        const decodedToken = await admin.auth().verifyIdToken(match[1]);
        const created = await createUserProfileIfMissing(
            decodedToken.uid,
            decodedToken,
        );

        response.json({created});
      } catch (error) {
        const errorCode = error && error.code ? String(error.code) : "";
        const isAuthError = errorCode.startsWith("auth/");

        console.error("ensureUserProfile failed", {
          code: errorCode || "unknown",
          message: error && error.message ? String(error.message) : "Unknown",
          stack: error && error.stack ? String(error.stack) : "",
        });

        response.status(isAuthError ? 401 : 500).json({
          error: isAuthError ?
            "You must be signed in to create an account profile." :
            "Account profile could not be created.",
        });
      }
    },
);

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
 * Returns a Stripe customer ID from a subscription object.
 * @param {object} subscription Stripe subscription object.
 * @return {string} Stripe customer ID.
 */
function subscriptionCustomerId(subscription) {
  if (!subscription.customer) {
    return "";
  }

  return typeof subscription.customer === "string" ?
    subscription.customer :
    subscription.customer.id || "";
}

/**
 * Converts a Stripe Unix timestamp into a Firestore timestamp.
 * @param {number} seconds Stripe timestamp in seconds.
 * @return {object|null} Firestore timestamp, or null when unavailable.
 */
function stripeTimestampToFirestore(seconds) {
  const numericSeconds = Number(seconds || 0);

  return numericSeconds ?
    admin.firestore.Timestamp.fromMillis(numericSeconds * 1000) :
    null;
}

/**
 * Retrieves a subscription with payment method details expanded.
 * @param {object} stripe Stripe client.
 * @param {string|object} subscription Stripe subscription ID or object.
 * @return {Promise<object|null>} Expanded Stripe subscription object.
 */
async function retrieveExpandedSubscription(stripe, subscription) {
  const subscriptionId = typeof subscription === "string" ?
    subscription :
    subscription && subscription.id;

  if (!subscriptionId) {
    return null;
  }

  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["default_payment_method"],
  });
}

/**
 * Returns current period end values from the subscription and its items.
 * @param {object} subscription Stripe subscription object.
 * @return {object} Stripe timestamp values in seconds.
 */
function subscriptionCurrentPeriodEnds(subscription) {
  const items = subscription.items && subscription.items.data ?
    subscription.items.data :
    [];
  const itemWithPeriodEnd = items.find((item) => item.current_period_end);

  return {
    subscriptionCurrentPeriodEndSeconds:
      subscription.current_period_end || 0,
    itemCurrentPeriodEndSeconds:
      itemWithPeriodEnd ? itemWithPeriodEnd.current_period_end : 0,
  };
}

/**
 * Resolves the best available card summary for a subscription.
 * @param {object} stripe Stripe client.
 * @param {object} subscription Stripe subscription object.
 * @return {Promise<object>} Payment method summary fields.
 */
async function subscriptionPaymentMethodSummary(stripe, subscription) {
  const customerId = subscriptionCustomerId(subscription);
  let paymentMethod = subscription.default_payment_method || null;

  if (!paymentMethod && customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    const invoiceSettings = customer.invoice_settings || {};
    paymentMethod = invoiceSettings.default_payment_method || null;
  }

  if (typeof paymentMethod === "string") {
    paymentMethod = await stripe.paymentMethods.retrieve(paymentMethod);
  }

  if (!paymentMethod && customerId) {
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: 1,
    });
    paymentMethod = paymentMethods.data[0] || null;
  }

  const card = paymentMethod && paymentMethod.card ? paymentMethod.card : {};

  return {
    paymentMethodBrand: card.brand || "",
    paymentMethodLast4: card.last4 || "",
  };
}

/**
 * Builds optional display fields for the Account subscription card.
 * @param {object} stripe Stripe client.
 * @param {object} subscription Stripe subscription object.
 * @return {Promise<object>} Optional billing display fields.
 */
async function subscriptionBillingDetails(stripe, subscription) {
  const periodEnds = subscriptionCurrentPeriodEnds(subscription);
  const currentPeriodEndSeconds =
    periodEnds.subscriptionCurrentPeriodEndSeconds ||
    periodEnds.itemCurrentPeriodEndSeconds;
  let paymentMethod = {
    paymentMethodBrand: "",
    paymentMethodLast4: "",
  };

  try {
    paymentMethod = await subscriptionPaymentMethodSummary(
        stripe,
        subscription,
    );
  } catch (error) {
    console.warn("Subscription payment method summary unavailable", {
      subscriptionId: subscription.id,
      message: error && error.message ? String(error.message) : "Unknown",
    });
  }

  console.log("Stripe subscription period end values", {
    subscriptionId: subscription.id,
    subscriptionCurrentPeriodEndSeconds:
      periodEnds.subscriptionCurrentPeriodEndSeconds || null,
    itemCurrentPeriodEndSeconds:
      periodEnds.itemCurrentPeriodEndSeconds || null,
    currentPeriodEndSeconds: currentPeriodEndSeconds || null,
  });

  return {
    subscriptionCurrentPeriodEnd: stripeTimestampToFirestore(
        currentPeriodEndSeconds,
    ),
    ...paymentMethod,
  };
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

  if (!subscriptionCustomerId(subscription)) {
    return "";
  }

  const customerSnap = await userProfiles
      .where("stripeCustomerId", "==", subscriptionCustomerId(subscription))
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
  console.log("Writing subscription billing fields", {
    uid,
    subscriptionCurrentPeriodEnd: data.subscriptionCurrentPeriodEnd || null,
    paymentMethodBrand: data.paymentMethodBrand || "",
    paymentMethodLast4: data.paymentMethodLast4 || "",
  });

  await userProfiles.doc(uid).set({
    currentPlan: "Pro",
    subscriptionStatus: data.subscriptionStatus,
    stripeCustomerId: data.stripeCustomerId,
    stripeSubscriptionId: data.stripeSubscriptionId,
    stripePriceId: data.stripePriceId,
    subscriptionCurrentPeriodEnd: data.subscriptionCurrentPeriodEnd || null,
    paymentMethodBrand: data.paymentMethodBrand || "",
    paymentMethodLast4: data.paymentMethodLast4 || "",
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

exports.createBillingPortalSession = onRequest(
    {
      secrets: [stripeSecretKey],
      invoker: "public",
    },
    async (request, response) => {
      const allowedOrigins = [
        "https://simple-books-office.web.app",
        "https://simple-books.co.uk",
      ];
      const origin = request.get("Origin") || "";

      response.set("Vary", "Origin");

      if (allowedOrigins.includes(origin)) {
        response.set("Access-Control-Allow-Origin", origin);
        response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        response.set(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type",
        );
        response.set("Access-Control-Max-Age", "3600");
      }

      if (request.method === "OPTIONS") {
        response.status(204).send("");
        return;
      }

      if (request.method !== "POST") {
        response.status(405).json({error: "Method not allowed."});
        return;
      }

      const authorization = request.get("Authorization") || "";
      const match = authorization.match(/^Bearer (.+)$/);

      if (!match) {
        response.status(401).json({
          error: "You must be signed in to manage your subscription.",
        });
        return;
      }

      try {
        const decodedToken = await admin.auth().verifyIdToken(match[1]);
        const profileSnap = await userProfiles.doc(decodedToken.uid).get();
        const profile = profileSnap.exists ? profileSnap.data() : {};
        const customerId = profile.stripeCustomerId || "";
        const hasPortalAccess = profile.currentPlan === "Pro" &&
          profile.subscriptionStatus === "active" &&
          profile.billingOverride !== true &&
          customerId;

        if (!hasPortalAccess) {
          response.status(403).json({
            error: "Billing Portal is only available for active Pro " +
              "subscriptions.",
          });
          return;
        }

        const stripe = new Stripe(stripeSecretKey.value());
        const session = await stripe.billingPortal.sessions.create({
          customer: customerId,
          return_url: billingPortalReturnUrl,
        });

        if (!session.url) {
          response.status(500).json({
            error: "Stripe did not return a Billing Portal URL.",
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
          "Unknown billing portal error.";
        const errorStack = error && error.stack ? String(error.stack) : "";
        const isAuthError = errorCode.startsWith("auth/");

        console.error(
            `createBillingPortalSession failed:
        Code: ${errorCode || "unknown"}
        Message: ${errorMessage}
        Stack:
        ${errorStack}`,
        );

        response.status(isAuthError ? 401 : 500).json({
          error: isAuthError ?
            "You must be signed in to manage your subscription." :
            "Billing Portal session could not be created.",
        });
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
            subscription = await retrieveExpandedSubscription(
                stripe,
                session.subscription,
            );
          }

          const stripePriceId = subscription ?
            subscriptionPriceId(subscription) :
            "";
          const billingDetails = subscription ?
            await subscriptionBillingDetails(stripe, subscription) :
            {};

          await updateSubscriptionProfile(uid, {
            subscriptionStatus: "active",
            stripeCustomerId: session.customer || "",
            stripeSubscriptionId: session.subscription || "",
            stripePriceId,
            ...billingDetails,
          });
        }

        if (event.type === "customer.subscription.created" ||
          event.type === "customer.subscription.updated" ||
          event.type === "customer.subscription.deleted") {
          let subscription = event.data.object;

          if (event.type === "customer.subscription.created" ||
            event.type === "customer.subscription.updated") {
            subscription = await retrieveExpandedSubscription(
                stripe,
                subscription,
            );
          }

          const uid = await findUidForSubscription(subscription);

          if (!uid) {
            console.error(
                "stripeWebhook subscription missing Firebase uid",
                {subscriptionId: subscription.id},
            );
            response.json({received: true});
            return;
          }

          const billingDetails = await subscriptionBillingDetails(
              stripe,
              subscription,
          );

          await updateSubscriptionProfile(uid, {
            subscriptionStatus: event.type === "customer.subscription.deleted" ?
              "cancelled" :
              subscriptionStatus(subscription),
            stripeCustomerId: subscriptionCustomerId(subscription),
            stripeSubscriptionId: subscription.id,
            stripePriceId: subscriptionPriceId(subscription),
            ...billingDetails,
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

const {
  askBusinessAssistantPreview,
} = require("./ai-assistant-preview");
const {
  askBusinessAssistant,
} = require("./ai-assistant");

exports.askBusinessAssistantPreview = askBusinessAssistantPreview;
exports.askBusinessAssistant = askBusinessAssistant;
