/* eslint-disable max-len, require-jsdoc */

"use strict";

const assert = require("node:assert/strict");
const {
  DEFAULT_DOCUMENT_MODEL,
  DOCUMENT_SCHEMA,
  MAX_FILE_SIZE,
  buildOpenAIRequest,
  configuredDocumentModel,
  detectedMimeType,
  handleBusinessDocumentScan,
  providerErrorCode,
  validateCallableData,
  validateExtraction,
} = require("../business-document-scan");

const pdfBuffer = Buffer.from("%PDF-1.7\n% test document");
const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webpBuffer = Buffer.from("RIFF0000WEBP", "ascii");
const extraction = {
  documentType: "supplier_invoice",
  supplier: "ABC Plumbing Ltd",
  merchant: null,
  invoiceNumber: "INV-2048",
  invoiceDate: "2026-07-14",
  dueDate: "2026-08-13",
  currency: "GBP",
  netAmount: 100,
  vatAmount: 20,
  totalAmount: 120,
  description: "Plumbing materials",
  categorySuggestion: "Materials",
  confidence: 0.96,
};

function fileData(name, mimeType, buffer) {
  return {
    context: "bill",
    file: {
      name,
      mimeType,
      size: buffer.length,
      base64: buffer.toString("base64"),
    },
  };
}

assert.equal(configuredDocumentModel({}), DEFAULT_DOCUMENT_MODEL);
assert.equal(
    configuredDocumentModel({OPENAI_DOCUMENT_MODEL: "gpt-document-test"}),
    "gpt-document-test",
);
assert.deepEqual(DOCUMENT_SCHEMA.required, Object.keys(extraction));
assert.equal(DOCUMENT_SCHEMA.additionalProperties, false);
assert.equal(detectedMimeType(pdfBuffer), "application/pdf");
assert.equal(detectedMimeType(jpegBuffer), "image/jpeg");
assert.equal(detectedMimeType(pngBuffer), "image/png");
assert.equal(detectedMimeType(webpBuffer), "image/webp");
assert.equal(detectedMimeType(Buffer.from("not a document")), "");
assert.equal(providerErrorCode({name: "APIConnectionTimeoutError"}), "deadline-exceeded");
assert.equal(providerErrorCode({status: 429}), "resource-exhausted");
assert.equal(providerErrorCode({status: 500}), "unavailable");

const validatedPdf = validateCallableData(fileData("supplier.pdf", "application/pdf", pdfBuffer));
assert.equal(validatedPdf.mimeType, "application/pdf");
const pdfRequest = buildOpenAIRequest(validatedPdf, {});
assert.equal(pdfRequest.model, DEFAULT_DOCUMENT_MODEL);
assert.equal(pdfRequest.store, false);
assert.equal(pdfRequest.input[0].content[1].type, "input_file");
assert.match(pdfRequest.input[0].content[1].file_data, /^data:application\/pdf;base64,/);
assert.equal(pdfRequest.text.format.type, "json_schema");
assert.equal(pdfRequest.text.format.strict, true);

const validatedJpeg = validateCallableData(fileData("receipt.jpg", "image/jpeg", jpegBuffer));
const imageRequest = buildOpenAIRequest(validatedJpeg, {OPENAI_DOCUMENT_MODEL: "gpt-test"});
assert.equal(imageRequest.model, "gpt-test");
assert.equal(imageRequest.input[0].content[1].type, "input_image");
assert.match(imageRequest.input[0].content[1].image_url, /^data:image\/jpeg;base64,/);
assert.equal(
    validateCallableData(fileData("receipt.png", "image/png", pngBuffer)).mimeType,
    "image/png",
);
assert.equal(
    validateCallableData(fileData("receipt.webp", "image/webp", webpBuffer)).mimeType,
    "image/webp",
);
assert.deepEqual(validateExtraction(extraction), extraction);

assert.throws(
    () => validateCallableData(fileData("renamed.pdf", "application/pdf", jpegBuffer)),
    (error) => error.code === "invalid-argument",
);
assert.throws(
    () => validateCallableData(fileData("wrong.exe", "application/pdf", pdfBuffer)),
    (error) => error.code === "invalid-argument",
);
assert.throws(
    () => validateCallableData({
      context: "bill",
      file: {
        name: "too-large.pdf",
        mimeType: "application/pdf",
        size: MAX_FILE_SIZE + 1,
        base64: pdfBuffer.toString("base64"),
      },
    }),
    (error) => error.code === "resource-exhausted",
);
assert.throws(
    () => validateCallableData(fileData("notes.txt", "text/plain", Buffer.from("hello"))),
    (error) => error.code === "invalid-argument",
);
assert.throws(
    () => validateExtraction({...extraction, confidence: 2}),
    (error) => error.code === "data-loss",
);
assert.throws(
    () => validateExtraction({...extraction, documentType: "unsupported"}),
    (error) => error.code === "failed-precondition",
);

async function run() {
  await assert.rejects(
      handleBusinessDocumentScan({data: fileData("supplier.pdf", "application/pdf", pdfBuffer)}, {}),
      (error) => error.code === "unauthenticated",
  );

  let capturedRequest = null;
  const result = await handleBusinessDocumentScan({
    auth: {uid: "authenticated-user"},
    data: fileData("supplier.pdf", "application/pdf", pdfBuffer),
  }, {
    logger: {info() {}, warn() {}},
    openaiClient: {
      responses: {
        create: async (request) => {
          capturedRequest = request;
          return {output_text: JSON.stringify(extraction)};
        },
      },
    },
  });
  assert.deepEqual(result, {success: true, extraction});
  assert.equal(capturedRequest.store, false);
  assert.equal(JSON.stringify(capturedRequest).includes("authenticated-user"), false);

  await assert.rejects(
      handleBusinessDocumentScan({
        auth: {uid: "authenticated-user"},
        data: fileData("supplier.pdf", "application/pdf", pdfBuffer),
      }, {
        logger: {info() {}, warn() {}},
        openaiClient: {responses: {create: async () => ({output_text: "not json"})}},
      }),
      (error) => error.code === "data-loss",
  );

  await assert.rejects(
      handleBusinessDocumentScan({
        auth: {uid: "authenticated-user"},
        data: fileData("supplier.pdf", "application/pdf", pdfBuffer),
      }, {
        logger: {info() {}, warn() {}},
        openaiClient: {responses: {create: async () => {
          const error = new Error("private provider details");
          error.name = "APIConnectionTimeoutError";
          throw error;
        }}},
      }),
      (error) => error.code === "deadline-exceeded" &&
        !String(error.message).includes("private provider details"),
  );

  console.log("Business document scan tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
