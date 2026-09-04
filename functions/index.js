/**
 * Import function triggers from their respective submodules:
 *
 * const {onRequest} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions/v2");
const {onCall, onRequest} = require("firebase-functions/v2/https");
const {onTaskDispatched} = require("firebase-functions/v2/tasks");
const {
  defineBoolean,
  defineSecret,
  defineString,
} = require("firebase-functions/params");
const functionsV1 = require("firebase-functions/v1");
const admin = require("firebase-admin");
const {FieldValue, Timestamp} = require("firebase-admin/firestore");
const Stripe = require("stripe");
const {
  assertConfiguredProPrice,
  assertStripeSecretKeyMode,
  validateStripeBillingConfiguration,
} = require("./lib/stripe-billing-config");
const {
  stripeBillingReturnUrls,
} = require("./lib/stripe-return-urls");
const {
  StripeCheckoutError,
  createStripeCheckoutService,
} = require("./lib/stripe-checkout-service");
const {
  StripePortalError,
  createStripePortalService,
} = require("./lib/stripe-portal-service");
const {
  createStripeWebhookProcessor,
} = require("./lib/stripe-webhook-processor");
const {
  stripeTimestampToFirestore,
} = require("./lib/stripe-firestore-values");
const {readMonthlyUsage} = require("./lib/monthly-usage-reader");
const {createAdminMetricsHandler} = require("./lib/admin-metrics-handler");
const {
  createFounderAnalyticsHandler,
} = require("./lib/founder-analytics-handler");
const {
  createAdminUserDetailsHandler,
} = require("./lib/admin-user-details-handler");
const {
  createAdminUserSearchHandler,
} = require("./lib/admin-user-search-handler");
const {
  createAdminUserTimelineHandler,
  createResetAdminUserUsageHandler,
  createUpdateAdminUserNotesHandler,
} = require("./lib/admin-user-management-handler");
const {
  createActivityLoggerHandler,
  createAdminRecentActivityHandler,
} = require("./lib/admin-activity-handlers");
const {
  normalizePlan,
  trustedActivityIdentity,
  writeActivityEvent,
} = require("./lib/admin-activity");
const {
  createAdminFeatureUsageHandler,
} = require("./lib/admin-feature-usage-handler");
const {
  createAdminDemoSeedHandler,
} = require("./lib/admin-demo-seed-handler");
const {
  createDemoResetHandler,
} = require("./lib/demo-reset-handler");
const {
  createAdminDemoAnalyticsHandler,
} = require("./lib/admin-demo-analytics-handler");
const {
  createAdminCustomerAnalyticsHandler,
} = require("./lib/admin-customer-analytics-handler");
const {
  createSourceWithReferenceService,
} = require("./lib/source-create-service");
const {
  createSourceCreateHandlers,
} = require("./lib/source-create-handlers");
const {
  createSourceEditService,
} = require("./lib/source-edit-service");
const {
  createSourceEditHandlers,
} = require("./lib/source-edit-handlers");
const {
  createSourceDeleteService,
} = require("./lib/source-delete-service");
const {
  createSourceDeleteHandlers,
} = require("./lib/source-delete-handlers");
const {
  createAccountDeletionGuard,
} = require("./lib/account-deletion-guard");
const {
  createRequestAccountDeletionHandler,
} = require("./lib/account-deletion-handler");
const {
  createStripeProfileWriter,
} = require("./lib/stripe-profile-writer");
const {
  createAccountDeletionTaskEnqueuer,
} = require("./lib/account-deletion-task-enqueuer");
const {
  createAccountDeletionWorker,
} = require("./lib/account-deletion-worker");
const {
  createStripeAccountDeletionService,
} = require("./lib/account-deletion-stripe");
const {
  createStorageAccountDeletionService,
} = require("./lib/account-deletion-storage");
const {
  createFirestoreAccountDeletionService,
} = require("./lib/account-deletion-firestore");
const {
  createGetAccountDeletionStatusHandler,
} = require("./lib/account-deletion-status-handler");
const {
  createJsonBackupRestoreService,
} = require("./lib/json-backup-restore-service");
const {
  createJsonBackupRestoreHandler,
} = require("./lib/json-backup-restore-handler");

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
const firestore = admin.firestore();
const accountDeletionGuard = createAccountDeletionGuard(firestore);
const enqueueAccountDeletion = createAccountDeletionTaskEnqueuer();

const createSourceWithReference = createSourceWithReferenceService({
  firestore,
  serverTimestamp: () => FieldValue.serverTimestamp(),
  deletionGuard: accountDeletionGuard,
});
const sourceCreateHandlers = createSourceCreateHandlers(
    createSourceWithReference,
);
const updateSourceWithReference = createSourceEditService({
  firestore,
  serverTimestamp: () => FieldValue.serverTimestamp(),
  deletionGuard: accountDeletionGuard,
});
const sourceEditHandlers = createSourceEditHandlers(updateSourceWithReference);
const deleteSourceWithReference = createSourceDeleteService({
  firestore,
  serverTimestamp: () => FieldValue.serverTimestamp(),
  deletionGuard: accountDeletionGuard,
});
const sourceDeleteHandlers = createSourceDeleteHandlers(
    deleteSourceWithReference,
);
const restoreJsonBackupV2 = createJsonBackupRestoreService({
  firestore,
  timestampFactory: (seconds, nanoseconds) =>
    new Timestamp(seconds, nanoseconds),
  serverTimestamp: () => FieldValue.serverTimestamp(),
});
const restoreJsonBackupV2Handler = createJsonBackupRestoreHandler(
    restoreJsonBackupV2,
);

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const stripeExpectedMode = defineString("STRIPE_EXPECTED_MODE", {
  default: "test",
});
const stripeProPriceId = defineString("STRIPE_PRO_PRICE_ID", {
  default: "price_1TnLTCJmLqrFk5SqusEJiIhu",
});
const stripeCheckoutEnabled = defineBoolean("STRIPE_CHECKOUT_ENABLED", {
  default: false,
});
const adminUidsSecret = defineSecret("SIMPLE_BOOKS_ADMIN_UIDS");
const demoIdentifiersSecret = defineSecret("SIMPLE_BOOKS_DEMO_IDENTIFIERS");
const protectedUidsSecret = defineSecret("SIMPLE_BOOKS_PROTECTED_UIDS");
const stripeBillingUrls = stripeBillingReturnUrls(process.env);
const userProfiles = firestore.collection("userProfiles");
const users = firestore.collection("users");

/** @return {object} Validated runtime Stripe billing configuration. */
function stripeBillingConfiguration() {
  return validateStripeBillingConfiguration({
    expectedMode: stripeExpectedMode.value(),
    proPriceId: stripeProPriceId.value(),
    checkoutEnabled: stripeCheckoutEnabled.value(),
  });
}

/** @return {object} A mode-validated Stripe client and configuration. */
function configuredStripeClient() {
  const configuration = stripeBillingConfiguration();
  const secretKey = stripeSecretKey.value();
  assertStripeSecretKeyMode(secretKey, configuration);
  return {configuration, stripe: new Stripe(secretKey)};
}

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
    createdAt: FieldValue.serverTimestamp(),
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
  const profileReference = userProfiles.doc(uid);
  return firestore.runTransaction(async (transaction) => {
    const profileSnapshot = await transaction.get(profileReference);
    await accountDeletionGuard.assertAccountNotDeletingInTransaction(
        transaction,
        uid,
    );
    if (profileSnapshot.exists) {
      return false;
    }
    transaction.create(profileReference, defaultUserProfile(user));
    return true;
  });
}

exports.createUserProfile = functionsV1.auth.user().onCreate(async (user) => {
  await createUserProfileIfMissing(user.uid, user);
  try {
    await writeActivityEvent({
      firestore: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      identity: {
        uid: user.uid,
        displayEmail: user.email || "",
        plan: "starter",
      },
      eventType: "user_signed_up",
      idempotencyKey: `auth_${user.uid}`,
    });
  } catch (error) {
    console.warn("Account activity could not be recorded", {
      code: error && error.code ? String(error.code) : "unknown",
    });
  }
});

exports.ensureUserProfile = onRequest(
    {
      cors: [
        "http://127.0.0.1:5500",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://localhost:8000",
        "https://simple-books.co.uk",
        "https://simple-books-office.web.app",
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

  return {
    subscriptionCurrentPeriodEnd: stripeTimestampToFirestore(
        currentPeriodEndSeconds,
    ),
    subscriptionCancelAt: stripeTimestampToFirestore(subscription.cancel_at),
    ...paymentMethod,
  };
}

/**
 * Writes subscription details to the Simple Books user profile.
 * @param {string} uid Firebase user ID.
 * @param {object} data Subscription profile fields.
 * @param {object} eventContext Stripe webhook event identity.
 * @return {Promise<void>} Resolves when Firestore has been updated.
 */
async function updateSubscriptionProfile(uid, data, eventContext = {}) {
  return createStripeProfileWriter({
    firestore,
    auth: admin.auth(),
    fieldValue: FieldValue,
    deletionGuard: accountDeletionGuard,
    billingConfiguration: stripeBillingConfiguration(),
    logger: console,
  })(uid, data, eventContext);
}

exports.createCheckoutSession = onRequest(
    {
      secrets: [stripeSecretKey],
      cors: [
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "https://simple-books.co.uk",
        "https://simple-books-office.web.app",
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
        await accountDeletionGuard.assertAccountNotDeleting(decodedToken.uid);
        const [accountSnapshot, profileSnapshot] = await Promise.all([
          users.doc(decodedToken.uid).get(),
          userProfiles.doc(decodedToken.uid).get(),
        ]);
        if (accountSnapshot.exists &&
          accountSnapshot.data().demoMode === true) {
          response.status(409).json({
            error: "Subscription changes are unavailable in the shared " +
              "demo account.",
          });
          return;
        }

        const uid = decodedToken.uid;
        const profile = profileSnapshot.exists ?
          profileSnapshot.data() || {} : {};
        const {configuration, stripe} = configuredStripeClient();
        const checkout = createStripeCheckoutService({
          stripe,
          firestore,
          billingConfiguration: configuration,
          fieldValue: FieldValue,
          timestampFactory: Timestamp,
        });
        if (!configuration.checkoutEnabled) {
          throw new StripeCheckoutError(
              "checkout-disabled",
              "Checkout is temporarily unavailable.",
              503,
          );
        }
        const price = await stripe.prices.retrieve(configuration.proPriceId);
        assertConfiguredProPrice(price, configuration);
        const {session} = await checkout({
          uid,
          profile,
          successUrl: stripeBillingUrls.successUrl,
          cancelUrl: stripeBillingUrls.cancelUrl,
        });

        if (!session.url) {
          response.status(500).json({
            error: "Stripe did not return a Checkout Session URL.",
          });
          return;
        }

        try {
          await accountDeletionGuard.assertAccountNotDeleting(uid);
          const identity = await trustedActivityIdentity({
            auth: admin.auth(),
            firestore: admin.firestore(),
            uid,
          });
          await writeActivityEvent({
            firestore: admin.firestore(),
            fieldValue: FieldValue,
            identity,
            eventType: "checkout_started",
            idempotencyKey: session.id,
          });
        } catch (activityError) {
          console.warn("Checkout activity could not be recorded", {
            code: activityError && activityError.code ?
              String(activityError.code) : "unknown",
          });
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
        const isCheckoutError = error instanceof StripeCheckoutError;
        const isDeleting = error && error.details &&
          error.details.reason === "account-deletion-in-progress";

        console.error(
            `createCheckoutSession failed:
        Code: ${errorCode || "unknown"}
        Message: ${errorMessage}
        Stack:
        ${errorStack}`,
        );

        response.status(isAuthError ? 401 : (isDeleting ? 409 :
          (isCheckoutError ? error.httpStatus : 500))).json({
          error: isAuthError ?
            "You must be signed in to start checkout." :
            (isDeleting ?
              "Checkout is unavailable while your account is being deleted." :
              (isCheckoutError ? error.message :
                "Checkout session could not be created.")),
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
        ...(stripeBillingUrls.emulator ?
          [stripeBillingUrls.frontendOrigin] : []),
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
        await accountDeletionGuard.assertAccountNotDeleting(decodedToken.uid);
        const [accountSnap, profileSnap] = await Promise.all([
          users.doc(decodedToken.uid).get(),
          userProfiles.doc(decodedToken.uid).get(),
        ]);
        if (accountSnap.exists && accountSnap.data().demoMode === true) {
          response.status(409).json({
            error: "Subscription management is unavailable in the shared " +
              "demo account.",
          });
          return;
        }
        const profile = profileSnap.exists ? profileSnap.data() : {};
        const {configuration, stripe} = configuredStripeClient();
        const portal = createStripePortalService({
          stripe,
          billingConfiguration: configuration,
        });
        const {session} = await portal({
          uid: decodedToken.uid,
          profile,
          returnUrl: stripeBillingUrls.billingPortalReturnUrl,
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
        const isPortalError = error instanceof StripePortalError;
        const isDeleting = error && error.details &&
          error.details.reason === "account-deletion-in-progress";

        console.error(
            `createBillingPortalSession failed:
        Code: ${errorCode || "unknown"}
        Message: ${errorMessage}
        Stack:
        ${errorStack}`,
        );

        response.status(isAuthError ? 401 : (isDeleting ? 409 :
          (isPortalError ? error.httpStatus : 500))).json({
          error: isAuthError ?
            "You must be signed in to manage your subscription." :
            (isDeleting ?
              "Billing is unavailable while your account is being deleted." :
              (isPortalError ? error.message :
                "Billing Portal session could not be created.")),
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
      if (request.method !== "POST") {
        response.status(405).send("Method not allowed.");
        return;
      }
      let stripe;
      let configuration;
      try {
        ({stripe, configuration} = configuredStripeClient());
      } catch (error) {
        console.error("stripeWebhook configuration rejected", {
          code: error && error.code ? String(error.code) : "unknown",
        });
        response.status(500).send("Webhook configuration is invalid.");
        return;
      }
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
        const processWebhook = createStripeWebhookProcessor({
          stripe,
          billingConfiguration: configuration,
          updateProfile: updateSubscriptionProfile,
          billingDetails: subscriptionBillingDetails,
        });
        const result = await processWebhook(event);
        if (result.handled && result.profileUpdate.updated &&
          result.eventType === "checkout.session.completed" &&
          result.configuredPrice &&
          ["active", "trialing"].includes(result.subscriptionStatus)) {
          try {
            const user = await admin.auth().getUser(result.uid);
            await writeActivityEvent({
              firestore: admin.firestore(),
              fieldValue: FieldValue,
              identity: {
                uid: result.uid,
                displayEmail: user.email || "",
                plan: "pro",
              },
              eventType: "upgraded_to_pro",
              idempotencyKey: event.id,
            });
          } catch (activityError) {
            console.warn("Upgrade activity could not be recorded", {
              code: activityError && activityError.code ?
                String(activityError.code) : "unknown",
            });
          }
        }
        if (result.handled && result.profileUpdate.updated &&
          result.eventType === "customer.subscription.deleted") {
          try {
            const user = await admin.auth().getUser(result.uid);
            await writeActivityEvent({
              firestore: admin.firestore(),
              fieldValue: FieldValue,
              identity: {
                uid: result.uid,
                displayEmail: user.email || "",
                plan: normalizePlan("pro"),
              },
              eventType: "subscription_cancelled",
              idempotencyKey: event.id,
            });
          } catch (activityError) {
            console.warn("Cancellation activity could not be recorded", {
              code: activityError && activityError.code ?
                String(activityError.code) : "unknown",
            });
          }
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
  AI_USAGE_COUNTING_ENABLED,
  AI_USAGE_ENFORCEMENT_ENABLED,
  askBusinessAssistant,
} = require("./ai-assistant");
const {
  scanBusinessDocument,
} = require("./business-document-scan");

exports.askBusinessAssistantPreview = askBusinessAssistantPreview;
exports.askBusinessAssistant = askBusinessAssistant;
exports.scanBusinessDocument = scanBusinessDocument;
exports.processAccountDeletion = onTaskDispatched(
    {
      region: "us-central1",
      maxInstances: 5,
      concurrency: 1,
      timeoutSeconds: 1800,
      memory: "512MiB",
      retryConfig: {
        maxAttempts: 30,
        maxRetrySeconds: 86400,
        minBackoffSeconds: 30,
        maxBackoffSeconds: 300,
        maxDoublings: 4,
      },
      rateLimits: {
        maxConcurrentDispatches: 5,
        maxDispatchesPerSecond: 5,
      },
      secrets: [
        stripeSecretKey,
        adminUidsSecret,
        demoIdentifiersSecret,
        protectedUidsSecret,
      ],
    },
    (request) => createAccountDeletionWorker({
      auth: admin.auth(),
      firestore,
      fieldValue: FieldValue,
      timestampFactory: Timestamp,
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      protectedUidConfiguration: protectedUidsSecret.value(),
      logger: console,
      stripeCleanup: async (uid) => {
        const {stripe, configuration} = configuredStripeClient();
        return createStripeAccountDeletionService({
          stripe,
          firestore,
          billingConfiguration: configuration,
        })(uid);
      },
      storageCleanup: createStorageAccountDeletionService({
        bucket: admin.storage().bucket(),
        firestore,
      }),
      firestoreCleanup: createFirestoreAccountDeletionService({firestore}),
    })(request),
);
exports.requestAccountDeletion = onCall(
    {
      region: "us-central1",
      maxInstances: 5,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [
        adminUidsSecret,
        demoIdentifiersSecret,
        protectedUidsSecret,
      ],
    },
    (request) => createRequestAccountDeletionHandler({
      auth: admin.auth(),
      firestore,
      fieldValue: admin.firestore.FieldValue,
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      protectedUidConfiguration: protectedUidsSecret.value(),
      enqueueDeletionTask: enqueueAccountDeletion,
    })(request),
);
exports.getAccountDeletionStatus = onCall(
    {
      region: "us-central1",
      maxInstances: 10,
      timeoutSeconds: 15,
      memory: "256MiB",
    },
    createGetAccountDeletionStatusHandler({firestore}),
);
exports.createInvoiceWithReference = onCall(
    {
      region: "us-central1", maxInstances: 10,
      timeoutSeconds: 30, memory: "256MiB",
    },
    sourceCreateHandlers.createInvoiceWithReference,
);
exports.restoreJsonBackupV2 = onCall(
    {
      region: "us-central1", maxInstances: 5,
      timeoutSeconds: 540, memory: "512MiB",
    },
    restoreJsonBackupV2Handler,
);
exports.createBillWithReference = onCall(
    {
      region: "us-central1", maxInstances: 10,
      timeoutSeconds: 30, memory: "256MiB",
    },
    sourceCreateHandlers.createBillWithReference,
);
exports.updateInvoiceWithReference = onCall(
    {
      region: "us-central1", maxInstances: 10,
      timeoutSeconds: 30, memory: "256MiB",
    },
    sourceEditHandlers.updateInvoiceWithReference,
);
exports.updateBillWithReference = onCall(
    {
      region: "us-central1", maxInstances: 10,
      timeoutSeconds: 30, memory: "256MiB",
    },
    sourceEditHandlers.updateBillWithReference,
);
exports.deleteInvoiceWithReference = onCall(
    {
      region: "us-central1", maxInstances: 10,
      timeoutSeconds: 30, memory: "256MiB",
    },
    sourceDeleteHandlers.deleteInvoiceWithReference,
);
exports.deleteBillWithReference = onCall(
    {
      region: "us-central1", maxInstances: 10,
      timeoutSeconds: 30, memory: "256MiB",
    },
    sourceDeleteHandlers.deleteBillWithReference,
);
exports.getMonthlyUsage = onRequest(
    {
      cors: [
        "http://127.0.0.1:5500",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://localhost:8000",
        "https://simple-books.co.uk",
        "https://simple-books-office.web.app",
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
          error: "You must be signed in to view monthly usage.",
        });
        return;
      }

      try {
        const decodedToken = await admin.auth().verifyIdToken(match[1]);
        const usage = await readMonthlyUsage(
            admin.firestore(),
            decodedToken.uid,
            new Date(),
            stripeBillingConfiguration(),
        );
        response.json({
          ...usage,
          trackingEnabled: AI_USAGE_COUNTING_ENABLED,
          enforcementEnabled: AI_USAGE_ENFORCEMENT_ENABLED,
        });
      } catch (error) {
        const errorCode = error && error.code ? String(error.code) : "";
        const isAuthError = errorCode.startsWith("auth/");
        console.error("getMonthlyUsage failed", {
          code: errorCode || "unknown",
          message: error && error.message ? String(error.message) : "Unknown",
        });
        response.status(isAuthError ? 401 : 500).json({
          error: isAuthError ?
            "You must be signed in to view monthly usage." :
            "Monthly usage could not be loaded.",
        });
      }
    },
);

exports.getAdminMetrics = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 60,
      memory: "256MiB",
      secrets: [adminUidsSecret, demoIdentifiersSecret],
    },
    (request) => createAdminMetricsHandler({
      auth: admin.auth(),
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      proPriceId: stripeBillingConfiguration().proPriceId,
      expectedMode: stripeBillingConfiguration().expectedMode,
      logger: console,
    })(request),
);

exports.getFounderAnalyticsSnapshot = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 60,
      memory: "256MiB",
      secrets: [adminUidsSecret, demoIdentifiersSecret],
    },
    (request) => createFounderAnalyticsHandler({
      auth: admin.auth(),
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      proPriceId: stripeBillingConfiguration().proPriceId,
      expectedMode: stripeBillingConfiguration().expectedMode,
      timestampFactory: admin.firestore.Timestamp,
      documentIdField: admin.firestore.FieldPath.documentId(),
      logger: console,
    })(request),
);

exports.logActivityEvent = onCall(
    {
      region: "us-central1",
      maxInstances: 10,
      timeoutSeconds: 15,
      memory: "256MiB",
      secrets: [adminUidsSecret, demoIdentifiersSecret],
    },
    (request) => createActivityLoggerHandler({
      auth: admin.auth(),
      firestore: admin.firestore(),
      fieldValue: admin.firestore.FieldValue,
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      deletionGuard: accountDeletionGuard,
    })(request),
);

exports.getAdminRecentActivity = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [adminUidsSecret, demoIdentifiersSecret],
    },
    (request) => createAdminRecentActivityHandler({
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      timestampFactory: admin.firestore.Timestamp,
      documentIdField: admin.firestore.FieldPath.documentId(),
    })(request),
);

exports.getAdminFeatureUsage = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [adminUidsSecret, demoIdentifiersSecret],
    },
    (request) => createAdminFeatureUsageHandler({
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      timestampFactory: admin.firestore.Timestamp,
    })(request),
);

exports.getAdminDemoAnalytics = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [adminUidsSecret],
    },
    (request) => createAdminDemoAnalyticsHandler({
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      timestampFactory: admin.firestore.Timestamp,
      logger: console,
    })(request),
);

exports.getAdminCustomerAnalytics = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 60,
      memory: "256MiB",
      secrets: [adminUidsSecret, demoIdentifiersSecret],
    },
    (request) => createAdminCustomerAnalyticsHandler({
      auth: admin.auth(),
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      timestampFactory: admin.firestore.Timestamp,
      logger: console,
    })(request),
);

exports.getAdminUserDetails = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [adminUidsSecret, demoIdentifiersSecret],
    },
    (request) => createAdminUserDetailsHandler({
      auth: admin.auth(),
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      proPriceId: stripeBillingConfiguration().proPriceId,
      expectedMode: stripeBillingConfiguration().expectedMode,
      logger: console,
    })(request),
);

exports.updateAdminUserNotes = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [adminUidsSecret],
    },
    (request) => createUpdateAdminUserNotesHandler({
      firestore: admin.firestore(), fieldValue: admin.firestore.FieldValue,
      adminUidConfiguration: adminUidsSecret.value(), logger: console,
      deletionGuard: accountDeletionGuard,
    })(request),
);

exports.resetAdminUserUsage = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [adminUidsSecret],
    },
    (request) => createResetAdminUserUsageHandler({
      firestore: admin.firestore(), fieldValue: admin.firestore.FieldValue,
      adminUidConfiguration: adminUidsSecret.value(), logger: console,
      deletionGuard: accountDeletionGuard,
    })(request),
);

exports.getAdminUserTimeline = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [adminUidsSecret],
    },
    (request) => createAdminUserTimelineHandler({
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      timestampFactory: admin.firestore.Timestamp,
      documentIdField: admin.firestore.FieldPath.documentId(), logger: console,
    })(request),
);

exports.searchAdminUsers = onCall(
    {
      region: "us-central1",
      maxInstances: 2,
      timeoutSeconds: 60,
      memory: "256MiB",
      secrets: [adminUidsSecret, demoIdentifiersSecret],
    },
    (request) => createAdminUserSearchHandler({
      auth: admin.auth(),
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      demoConfiguration: demoIdentifiersSecret.value(),
      logger: console,
    })(request),
);

exports.seedAdminDemoEnvironment = onCall(
    {
      region: "us-central1",
      maxInstances: 1,
      timeoutSeconds: 300,
      memory: "512MiB",
      secrets: [adminUidsSecret],
    },
    (request) => createAdminDemoSeedHandler({
      firestore: admin.firestore(),
      adminUidConfiguration: adminUidsSecret.value(),
      logger: console,
    })(request),
);

exports.resetDemoEnvironment = onCall(
    {
      region: "us-central1",
      maxInstances: 1,
      timeoutSeconds: 300,
      memory: "512MiB",
    },
    (request) => createDemoResetHandler({
      firestore: admin.firestore(),
      logger: console,
      deletionGuard: accountDeletionGuard,
    })(request),
);
