import { createRequire } from "node:module";
import { vi } from "vitest";
const require = createRequire(import.meta.url);
const { createStripeProfileWriter } = require("../../functions/lib/stripe-profile-writer.js");
const { createStripeWebhookProcessor } = require("../../functions/lib/stripe-webhook-processor.js");
const {parse} = require("../../functions/node_modules/espree");

// Parse actual inline modules; do not infer function boundaries from indentation.
export function pageFunctions(html, names) {
  const declarations = new Map();
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if(match[1].includes("application/ld+json") || !match[2].trim()) continue;
    const ast = parse(match[2], {ecmaVersion: "latest", sourceType: "module", range: true});
    for(const node of ast.body) {
      if(node.type === "FunctionDeclaration") declarations.set(node.id.name, match[2].slice(...node.range));
    }
  }
  return names.map(name => {
    if(!declarations.has(name)) throw new Error(`Missing page function: ${name}`);
    return declarations.get(name);
  }).join("\n");
}

export function requestHandler(source, name) {
  const ast = parse(source, {ecmaVersion: "latest", sourceType: "script", range: true});
  const assignment = ast.body.find(node => node.type === "ExpressionStatement" &&
    node.expression.type === "AssignmentExpression" &&
    node.expression.left.object?.name === "exports" && node.expression.left.property?.name === name);
  if(!assignment) throw new Error(`Missing request handler: ${name}`);
  const callback = assignment.expression.right.arguments[1];
  return source.slice(...callback.range);
}
export const UID = "lifecycle-user";
export const configuration = {
  expectedMode: "live", proPriceId: "price_1UAwaZQwA8Uui39wNgjE9zNh", checkoutEnabled: false
};
const clone = value => structuredClone(value);

// Optimistic transaction double: conflicting reads force callback re-execution.
// Unlike a serial queue this exercises an old canonical read completing last.
export class MemoryFirestore {
  documents = new Map();
  versions = new Map();
  retries = 0;
  activeTransactions = 0;
  forceWriteRetry = 0;
  writes = [];
  read(path) { return clone(this.documents.get(path)); }
  put(path, value) {
    this.documents.set(path, clone(value));
    this.versions.set(path, (this.versions.get(path) || 0) + 1);
  }
  snapshot(path) {
    const value = this.read(path);
    return { exists: value !== undefined, data: () => clone(value) };
  }
  collection(path) {
    return { doc: id => ({
      path: `${path}/${id}`,
      get: async () => this.snapshot(`${path}/${id}`),
      collection: name => this.collection(`${path}/${id}/${name}`)
    }) };
  }
  async runTransaction(callback, options = {}) {
    for(let attempt = 0; attempt < (options.maxAttempts || 5); attempt++) {
      const reads = new Map();
      const writes = [];
      this.activeTransactions++;
      let result;
      try { result = await callback({
        get: async ref => {
          reads.set(ref.path, this.versions.get(ref.path) || 0);
          return this.snapshot(ref.path);
        },
        set: (ref, data, options) => writes.push({path: ref.path, data: clone(data), options})
      }); } finally { this.activeTransactions--; }
      if(writes.length && this.forceWriteRetry > 0) {
        this.forceWriteRetry--; this.retries++; continue;
      }
      if([...reads].some(([path, version]) => (this.versions.get(path) || 0) !== version)) {
        this.retries++;
        continue;
      }
      for(const {path, data, options} of writes) {
        this.writes.push(path);
        this.put(path, options?.merge ? {...this.read(path), ...data} : data);
      }
      return result;
    }
    throw new Error("transaction retries exhausted");
  }
}

export function fixture(profile = {}) {
  const db = new MemoryFirestore();
  db.put(`users/${UID}`, {businessName: "Preserved business"});
  db.put(`userProfiles/${UID}`, profile);
  let canonical = {
    id: "sub_owned", customer: "cus_owned", created: 100, livemode: true,
    metadata: {firebaseUid: UID}, status: "active", cancel_at_period_end: false,
    items: {data: [{price: {id: configuration.proPriceId}, quantity: 1}]}
  };
  const stripe = {
    subscriptions: {retrieve: vi.fn(async () => clone(canonical))},
    customers: {retrieve: vi.fn(async () => ({id: "cus_owned", livemode: true, metadata: {firebaseUid: UID}}))},
    billingPortal: {sessions: {create: vi.fn(async () => ({url: "https://example.test/portal"}))}}
  };
  const writer = createStripeProfileWriter({
    firestore: db, auth: {getUser: vi.fn(async () => ({uid: UID}))},
    billingConfiguration: configuration, fieldValue: {serverTimestamp: () => "timestamp"},
    logger: {warn: vi.fn()}
  });
  const billingDetails = vi.fn(async (_stripe, sub) => ({
    subscriptionCurrentPeriodEnd: sub.current_period_end || null,
    subscriptionCancelAt: sub.cancel_at || null
  }));
  const process = createStripeWebhookProcessor({stripe, billingConfiguration: configuration, updateProfile: writer, billingDetails});
  let sequence = 0;
  return {
    db, stripe, writer, process, billingDetails,
    profile: () => db.read(`userProfiles/${UID}`),
    canonical: () => clone(canonical),
    change: patch => {canonical = {...canonical, ...patch};},
    event: (type = "customer.subscription.updated", object = canonical, created = 200) => ({
      id: `evt_lifecycle${++sequence}`, type, created, livemode: true, data: {object: clone(object)}
    }),
    invoice: () => ({
      id: "in_owned", livemode: true, customer: "cus_owned", status: "paid",
      parent: {type: "subscription_details", subscription_details: {subscription: "sub_owned"}}
    })
  };
}
