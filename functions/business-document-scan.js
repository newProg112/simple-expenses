/* eslint-disable max-len, no-control-regex, require-jsdoc */

"use strict";

const OpenAI = require("openai");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {
  USAGE_TYPES,
  createMonthlyUsageManager,
  monthlyAllowanceMessage,
} = require("./lib/ai-usage");
const {createAccountDeletionGuard} = require("./lib/account-deletion-guard");

const REGION = "us-central1";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const OPENAI_TIMEOUT_MS = 45000;
const DEFAULT_DOCUMENT_MODEL = "gpt-5.6-sol";
const INVOICE_SCANNING_USAGE_COUNTING_ENABLED = true;
const INVOICE_SCANNING_USAGE_ENFORCEMENT_ENABLED = true;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_CONTEXTS = new Set(["bill", "expense"]);
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};
const RESULT_FIELDS = [
  "documentType",
  "supplier",
  "merchant",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "currency",
  "netAmount",
  "vatAmount",
  "totalAmount",
  "description",
  "categorySuggestion",
  "confidence",
];
const STRING_RESULT_FIELDS = new Set([
  "documentType",
  "supplier",
  "merchant",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "currency",
  "description",
  "categorySuggestion",
]);
const NUMBER_RESULT_FIELDS = new Set([
  "netAmount",
  "vatAmount",
  "totalAmount",
  "confidence",
]);
const USABLE_RESULT_FIELDS = [
  "supplier",
  "merchant",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "netAmount",
  "vatAmount",
  "totalAmount",
  "description",
];
const DOCUMENT_SCHEMA = {
  type: "object",
  properties: {
    documentType: {type: ["string", "null"]},
    supplier: {type: ["string", "null"]},
    merchant: {type: ["string", "null"]},
    invoiceNumber: {type: ["string", "null"]},
    invoiceDate: {type: ["string", "null"]},
    dueDate: {type: ["string", "null"]},
    currency: {type: ["string", "null"]},
    netAmount: {type: ["number", "null"]},
    vatAmount: {type: ["number", "null"]},
    totalAmount: {type: ["number", "null"]},
    description: {type: ["string", "null"]},
    categorySuggestion: {type: ["string", "null"]},
    confidence: {
      anyOf: [
        {type: "number", minimum: 0, maximum: 1},
        {type: "null"},
      ],
    },
  },
  required: RESULT_FIELDS,
  additionalProperties: false,
};
const EXTRACTION_INSTRUCTIONS = [
  "Extract accounting details from the supplied business document.",
  "The document should be a supplier bill, supplier invoice, receipt or expense document.",
  "Return JSON only through the supplied schema. Do not use markdown or add explanations.",
  "Use null for every field that is missing or cannot be read reliably.",
  "Use ISO YYYY-MM-DD dates where a complete date is visible.",
  "Use ISO 4217 currency codes such as GBP, EUR or USD when identifiable.",
  "Return monetary values as numbers without currency symbols.",
  "Set documentType to unsupported when the file is not a supported business document.",
  "Set confidence between 0 and 1 based on the overall extraction quality.",
].join(" ");
const openAiApiKey = defineSecret("OPENAI_API_KEY");

function configuredDocumentModel(environment = process.env) {
  const value = String(
      environment.OPENAI_DOCUMENT_MODEL || DEFAULT_DOCUMENT_MODEL,
  ).trim();
  return value.slice(0, 80) || DEFAULT_DOCUMENT_MODEL;
}

function fileExtension(fileName) {
  const match = String(fileName || "").toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match ? match[1] : "";
}

function detectedMimeType(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }

  if (buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }

  return "";
}

function decodeBase64File(base64) {
  if (typeof base64 !== "string" || !base64 || base64.length % 4 !== 0 ||
    base64.length > Math.ceil(MAX_FILE_SIZE / 3) * 4 + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new HttpsError("invalid-argument", "The uploaded document data is invalid.");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new HttpsError("invalid-argument", "The uploaded document is empty.");
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw new HttpsError("resource-exhausted", "The document is larger than 10 MB.");
  }
  return buffer;
}

function validateCallableData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Request data must be an object.");
  }

  const keys = Object.keys(data);
  if (keys.some((key) => !["requestId", "context", "file"].includes(key))) {
    throw new HttpsError("invalid-argument", "Request data contains unsupported fields.");
  }
  if (!UUID_PATTERN.test(String(data.requestId || ""))) {
    throw new HttpsError("invalid-argument", "requestId must be a valid UUID.");
  }
  if (!ALLOWED_CONTEXTS.has(data.context)) {
    throw new HttpsError("invalid-argument", "Document context must be bill or expense.");
  }
  if (!data.file || typeof data.file !== "object" || Array.isArray(data.file)) {
    throw new HttpsError("invalid-argument", "One document file is required.");
  }

  const fileKeys = Object.keys(data.file);
  if (fileKeys.some((key) => !["name", "mimeType", "size", "base64"].includes(key))) {
    throw new HttpsError("invalid-argument", "File data contains unsupported fields.");
  }

  const name = typeof data.file.name === "string" ? data.file.name.trim() : "";
  const mimeType = typeof data.file.mimeType === "string" ? data.file.mimeType.trim().toLowerCase() : "";
  const declaredSize = Number(data.file.size);
  if (!name || name.length > 200 || name.includes("/") ||
    name.includes("\\") || /[\u0000-\u001f]/.test(name)) {
    throw new HttpsError("invalid-argument", "The document filename is invalid.");
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new HttpsError("invalid-argument", "Unsupported file type. Choose a JPG, PNG, WEBP or PDF file.");
  }
  if (!Number.isInteger(declaredSize) || declaredSize <= 0) {
    throw new HttpsError("invalid-argument", "The document size is invalid.");
  }
  if (declaredSize > MAX_FILE_SIZE) {
    throw new HttpsError("resource-exhausted", "The document is larger than 10 MB.");
  }

  const buffer = decodeBase64File(data.file.base64);
  const signatureMimeType = detectedMimeType(buffer);
  const extensionMimeType = MIME_BY_EXTENSION[fileExtension(name)] || "";
  if (!signatureMimeType || signatureMimeType !== mimeType || extensionMimeType !== mimeType) {
    throw new HttpsError("invalid-argument", "The document contents do not match a supported file type.");
  }
  if (declaredSize !== buffer.length) {
    throw new HttpsError("invalid-argument", "The document size does not match the uploaded data.");
  }

  return {
    requestId: data.requestId,
    context: data.context,
    name,
    mimeType,
    buffer,
  };
}

function buildOpenAIRequest(validated, environment) {
  const fileData = `data:${validated.mimeType};base64,${validated.buffer.toString("base64")}`;
  const documentInput = validated.mimeType === "application/pdf" ? {
    type: "input_file",
    filename: validated.name,
    file_data: fileData,
    detail: "high",
  } : {
    type: "input_image",
    image_url: fileData,
    detail: "high",
  };

  return {
    model: configuredDocumentModel(environment),
    instructions: EXTRACTION_INSTRUCTIONS,
    input: [{
      role: "user",
      content: [
        {type: "input_text", text: `Extract this ${validated.context} document.`},
        documentInput,
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "business_document_extraction",
        schema: DOCUMENT_SCHEMA,
        strict: true,
      },
    },
    reasoning: {effort: "low"},
    max_output_tokens: 800,
    store: false,
  };
}

function validateExtraction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== RESULT_FIELDS.length ||
    RESULT_FIELDS.some((field) => !Object.hasOwn(value, field))) {
    throw new HttpsError("data-loss", "The document service returned an incomplete result.");
  }

  for (const field of STRING_RESULT_FIELDS) {
    if (value[field] !== null && typeof value[field] !== "string") {
      throw new HttpsError("data-loss", "The document service returned invalid text data.");
    }
  }
  for (const field of NUMBER_RESULT_FIELDS) {
    if (value[field] !== null &&
      (typeof value[field] !== "number" || !Number.isFinite(value[field]))) {
      throw new HttpsError("data-loss", "The document service returned invalid numeric data.");
    }
  }
  if (value.confidence !== null && (value.confidence < 0 || value.confidence > 1)) {
    throw new HttpsError("data-loss", "The document service returned invalid confidence data.");
  }
  if (String(value.documentType || "").toLowerCase() === "unsupported") {
    throw new HttpsError("failed-precondition", "This does not appear to be a supported bill, invoice or receipt.");
  }
  const hasUsableData = USABLE_RESULT_FIELDS.some((field) => {
    const fieldValue = value[field];
    return typeof fieldValue === "string" ?
      Boolean(fieldValue.trim()) :
      fieldValue !== null;
  });
  if (!hasUsableData) {
    throw new HttpsError(
        "failed-precondition",
        "No usable invoice or receipt details could be extracted.",
    );
  }
  return value;
}

function createOpenAIClient(apiKey) {
  if (!apiKey) throw new Error("OpenAI is not configured.");
  return new OpenAI({apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 1});
}

function providerErrorCode(error) {
  const name = String(error && error.name || "").toLowerCase();
  const code = String(error && error.code || "").toLowerCase();
  if (name.includes("timeout") || code.includes("timeout")) return "deadline-exceeded";
  if (Number(error && error.status) === 429) return "resource-exhausted";
  return "unavailable";
}

async function handleBusinessDocumentScan(request, dependencies) {
  if (!request || !request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to scan a document.");
  }

  const validated = validateCallableData(request.data);
  const supplied = dependencies || {};
  const log = supplied.logger || logger;
  const firestore = supplied.firestore || admin.firestore();
  const deletionGuard = supplied.deletionGuard ||
    createAccountDeletionGuard(firestore);
  await deletionGuard.assertAccountNotDeleting(request.auth.uid);
  const usageCountingEnabled =
    supplied.usageCountingEnabled === undefined ?
      INVOICE_SCANNING_USAGE_COUNTING_ENABLED :
      supplied.usageCountingEnabled === true;
  const usageEnforcementEnabled =
    supplied.usageEnforcementEnabled === undefined ?
      INVOICE_SCANNING_USAGE_ENFORCEMENT_ENABLED :
      supplied.usageEnforcementEnabled === true;
  const usageManager = usageCountingEnabled ?
    supplied.usageManager || createMonthlyUsageManager({
      firestore,
      now: () => supplied.now || new Date(),
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
      deletionGuard,
    }) :
    null;
  let usageReservation;

  if (usageManager) {
    usageReservation = await usageManager.reserve({
      uid: request.auth.uid,
      requestId: validated.requestId,
      enforceLimit: usageEnforcementEnabled,
      usageType: USAGE_TYPES.INVOICE_SCANNING,
    });
    if (usageEnforcementEnabled &&
      usageReservation.state === "limit-reached") {
      throw new HttpsError(
          "resource-exhausted",
          monthlyAllowanceMessage(
              USAGE_TYPES.INVOICE_SCANNING,
              usageReservation.effectivePlan,
          ),
      );
    }
    if (usageReservation.state === "in-progress") {
      throw new HttpsError(
          "aborted",
          "This document scan is already in progress.",
      );
    }
    if (usageReservation.state === "completed") {
      throw new HttpsError(
          "already-exists",
          "This document scan has already completed.",
      );
    }
  }

  try {
    const client = supplied.openaiClient || createOpenAIClient(
        supplied.apiKey === undefined ? openAiApiKey.value() : supplied.apiKey,
    );
    const response = await client.responses.create(
        buildOpenAIRequest(validated, supplied.environment),
    );
    const outputText = String(response && response.output_text || "").trim();
    if (!outputText) {
      throw new HttpsError("data-loss", "The document service returned no readable result.");
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch (error) {
      throw new HttpsError("data-loss", "The document service returned malformed data.");
    }

    const extraction = validateExtraction(parsed);
    if (usageManager && usageReservation.state === "reserved") {
      await usageManager.finalize({
        uid: request.auth.uid,
        monthKey: usageReservation.monthKey,
        requestId: validated.requestId,
        usageType: USAGE_TYPES.INVOICE_SCANNING,
      });
    }
    log.info("Business document scan completed", {
      context: validated.context,
      mimeType: validated.mimeType,
    });
    return {success: true, extraction};
  } catch (error) {
    if (usageManager && usageReservation &&
      usageReservation.state === "reserved") {
      try {
        await usageManager.release({
          uid: request.auth.uid,
          monthKey: usageReservation.monthKey,
          requestId: validated.requestId,
          usageType: USAGE_TYPES.INVOICE_SCANNING,
        });
      } catch (releaseError) {
        log.error("Invoice scanning usage reservation release failed", {
          requestId: validated.requestId.slice(0, 12),
        });
      }
    }
    if (error instanceof HttpsError) throw error;
    log.warn("Business document scan provider failed", {
      errorName: String(error && error.name || "Error").slice(0, 80),
      providerStatus: Number(error && error.status) || null,
    });
    const code = providerErrorCode(error);
    const message = code === "deadline-exceeded" ?
      "Document scanning timed out. Please try again." :
      code === "resource-exhausted" ?
        "Document scanning is temporarily busy. Please try again shortly." :
        "The document scanning service is currently unavailable.";
    throw new HttpsError(code, message);
  }
}

const scanBusinessDocument = onCall(
    {
      region: REGION,
      maxInstances: 5,
      timeoutSeconds: 60,
      memory: "512MiB",
      secrets: [openAiApiKey],
    },
    (request) => handleBusinessDocumentScan(request),
);

module.exports = {
  DEFAULT_DOCUMENT_MODEL,
  DOCUMENT_SCHEMA,
  EXTRACTION_INSTRUCTIONS,
  INVOICE_SCANNING_USAGE_COUNTING_ENABLED,
  INVOICE_SCANNING_USAGE_ENFORCEMENT_ENABLED,
  MAX_FILE_SIZE,
  buildOpenAIRequest,
  configuredDocumentModel,
  detectedMimeType,
  handleBusinessDocumentScan,
  providerErrorCode,
  scanBusinessDocument,
  validateCallableData,
  validateExtraction,
};
