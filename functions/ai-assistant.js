/* eslint-disable max-len, require-jsdoc */

"use strict";

const OpenAI = require("openai");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const {buildBusinessSummary} = require("./lib/business-summary");
const {buildOpenAIRequest} = require("./lib/assistant-prompt");
const {
  createPreviewResponse,
  routeQuestion,
  validateCallableData,
} = require("./ai-assistant-preview");

const REGION = "us-central1";
const MAX_AI_ANSWER_LENGTH = 1200;
const OPENAI_TIMEOUT_MS = 20000;
const DISCLAIMER = "Business information only. This is not accounting, tax or legal advice.";
const UNSUPPORTED_ANSWER = [
  "I'm the Simple Books Business Assistant, so I can help explain your invoices, bills, expenses, projects, budgets and cashflow.",
  "",
  "Try asking something like:",
  "",
  "\u2022 Why is my cashflow negative?",
  "\u2022 Which customers owe me the most?",
  "\u2022 Which projects are least profitable?",
  "\u2022 Are any budgets close to being exceeded?",
  "\u2022 What should I focus on today?",
].join("\n");
const openAiApiKey = defineSecret("OPENAI_API_KEY");

function cleanAiAnswer(value) {
  const answer = String(value || "").trim();
  if (answer.length <= MAX_AI_ANSWER_LENGTH) return answer;

  const candidate = answer.slice(0, MAX_AI_ANSWER_LENGTH);
  const sentenceEnds = [...candidate.matchAll(/[.!?](?:["')\]]?)(?=\s|$)/g)];
  const lastSentence = sentenceEnds[sentenceEnds.length - 1];
  if (lastSentence && lastSentence.index + lastSentence[0].length >= MAX_AI_ANSWER_LENGTH * 0.6) {
    return candidate.slice(0, lastSentence.index + lastSentence[0].length).trimEnd();
  }

  const wordBoundary = candidate.search(/\s+\S*$/);
  if (wordBoundary > 0) return `${candidate.slice(0, wordBoundary).trimEnd()}…`;
  return candidate;
}

function providerErrorDetails(error) {
  const name = error && typeof error.name === "string" ? error.name : "Error";
  const details = {errorName: name.trim().slice(0, 80) || "Error"};
  const status = Number(error && error.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) {
    details.providerStatus = status;
  }
  return details;
}

function createOpenAIClient(apiKey) {
  if (!apiKey) throw new Error("OpenAI is not configured.");
  return new OpenAI({
    apiKey,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 1,
  });
}

async function handleAssistantRequest(request, dependencies) {
  if (!request || !request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to use the business assistant.");
  }

  const validated = validateCallableData(request.data);
  const category = routeQuestion(validated.question);
  if (category === "unsupported") {
    return {
      success: true,
      mode: "unsupported",
      requestId: validated.requestId,
      category,
      answer: UNSUPPORTED_ANSWER,
      facts: [],
      insights: [],
      warnings: [],
      sources: [],
      disclaimer: DISCLAIMER,
    };
  }

  const supplied = dependencies || {};
  const log = supplied.logger || logger;
  const summaryBuilder = supplied.buildBusinessSummary || buildBusinessSummary;
  const firestore = supplied.firestore || admin.firestore();
  let summary;

  try {
    summary = await summaryBuilder(
        firestore,
        request.auth.uid,
        validated.scope,
        {now: supplied.now || new Date()},
    );
  } catch (error) {
    log.error("Business assistant summary failed", {
      requestId: validated.requestId.slice(0, 12),
      category,
    });
    throw new HttpsError(
        "unavailable",
        "The secure business-summary service is currently unavailable.",
    );
  }

  const deterministic = createPreviewResponse(summary, category);
  const baseResponse = {
    success: true,
    requestId: validated.requestId,
    ...deterministic,
    disclaimer: DISCLAIMER,
    dataAsOf: summary.meta.generatedAt,
  };

  try {
    const client = supplied.openaiClient || createOpenAIClient(
        supplied.apiKey === undefined ? openAiApiKey.value() : supplied.apiKey,
    );
    const providerResponse = await client.responses.create(
        buildOpenAIRequest(summary, validated.question, category, supplied.environment),
    );
    const answer = cleanAiAnswer(providerResponse && providerResponse.output_text);
    if (!answer) throw new Error("OpenAI returned no answer.");

    log.info("Business assistant AI response completed", {
      requestId: validated.requestId.slice(0, 12),
      category,
    });

    return {
      ...baseResponse,
      mode: "ai",
      answer,
    };
  } catch (error) {
    log.warn(
        "Business assistant used deterministic fallback",
        providerErrorDetails(error),
    );
    return {
      ...baseResponse,
      mode: "deterministic-fallback",
    };
  }
}

const askBusinessAssistant = onCall(
    {
      region: REGION,
      maxInstances: 5,
      timeoutSeconds: 60,
      memory: "256MiB",
      secrets: [openAiApiKey],
    },
    (request) => handleAssistantRequest(request),
);

module.exports = {
  askBusinessAssistant,
  cleanAiAnswer,
  handleAssistantRequest,
  providerErrorDetails,
  UNSUPPORTED_ANSWER,
};
