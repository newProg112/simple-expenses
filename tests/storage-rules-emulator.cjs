const assert = require("node:assert/strict");

const projectId = process.env.GCLOUD_PROJECT || "simple-books-office";
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
const bucket = firebaseConfig.storageBucket || `${projectId}.appspot.com`;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";

async function createUser(label) {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `${label}@example.test`,
        password: "storage-rules-test-password",
        returnSecureToken: true,
      }),
    }
  );
  assert.equal(response.status, 200, `create ${label} auth user`);
  const body = await response.json();
  return { uid: body.localId, token: body.idToken };
}

function authHeaders(token, contentType) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(contentType ? { "content-type": contentType } : {}),
  };
}

function objectUrl(path, query = "") {
  return `http://${storageHost}/v0/b/${bucket}/o/${encodeURIComponent(path)}${query}`;
}

function uploadUrl(path) {
  return `http://${storageHost}/v0/b/${bucket}/o?name=${encodeURIComponent(path)}`;
}

async function upload(path, token, contentType, body = Buffer.from("test file")) {
  const boundary = "storage-rules-test-boundary";
  const metadata = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({ name: path, contentType })}\r\n` +
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
  return fetch(uploadUrl(path), {
    method: "POST",
    headers: {
      ...authHeaders(token, `multipart/related; boundary=${boundary}`),
      "x-goog-upload-protocol": "multipart",
    },
    body: Buffer.concat([metadata, body, closing]),
  });
}

async function read(path, token) {
  return fetch(objectUrl(path, "?alt=media"), {
    headers: authHeaders(token),
  });
}

async function remove(path, token) {
  return fetch(objectUrl(path), {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

async function expectAllowed(response, action) {
  const details = response.ok ? "" : `: ${await response.clone().text()}`;
  assert.ok(response.ok, `${action}: expected success, received ${response.status}${details}`);
}

function expectDenied(response, action) {
  assert.equal(response.status, 403, `${action}: expected 403`);
}

function expectSignedOutDenied(response, action) {
  assert.ok([401, 403].includes(response.status), `${action}: expected 401/403, received ${response.status}`);
}

(async () => {
  const userA = await createUser("storage-user-a");
  const userB = await createUser("storage-user-b");
  const billPath = `users/${userA.uid}/attachments/bills/bill-1/receipt.pdf`;

  await expectAllowed(await upload(billPath, userA.token, "application/pdf"), "User A uploads bill PDF");
  await expectAllowed(await read(billPath, userA.token), "User A reads bill PDF");
  await expectAllowed(await upload(billPath, userA.token, "application/pdf", Buffer.from("replacement")), "User A replaces bill PDF");

  expectDenied(await read(billPath, userB.token), "User B reads User A bill");
  expectDenied(await upload(billPath, userB.token, "application/pdf"), "User B overwrites User A bill");
  expectDenied(await remove(billPath, userB.token), "User B deletes User A bill");
  expectDenied(
    await upload(`users/${userA.uid}/attachments/bills/bill-2/other.pdf`, userB.token, "application/pdf"),
    "User B creates inside User A namespace"
  );
  expectSignedOutDenied(await read(billPath), "Signed-out user reads private bill");
  expectSignedOutDenied(
    await upload(`users/${userA.uid}/attachments/bills/bill-3/signed-out.pdf`, "", "application/pdf"),
    "Signed-out user writes private bill"
  );
  await expectAllowed(await remove(billPath, userA.token), "User A deletes bill PDF");

  const expensePath = `users/${userA.uid}/attachments/expenses/expense-1/receipt.webp`;
  const clientPath = `users/${userA.uid}/attachments/clients/client-1/agreement.pdf`;
  await expectAllowed(await upload(expensePath, userA.token, "image/webp"), "User A uploads scanned expense WEBP");
  await expectAllowed(await read(expensePath, userA.token), "User A reads expense attachment");
  await expectAllowed(await upload(clientPath, userA.token, "application/pdf"), "User A uploads client PDF");
  await expectAllowed(await read(clientPath, userA.token), "User A reads client PDF");

  expectDenied(
    await upload(`users/${userA.uid}/attachments/clients/client-2/photo.png`, userA.token, "image/png"),
    "Client attachment rejects non-PDF"
  );
  expectDenied(
    await upload(
      `users/${userA.uid}/attachments/clients/client-3/too-large.pdf`,
      userA.token,
      "application/pdf",
      Buffer.alloc(10 * 1024 * 1024 + 1)
    ),
    "Client attachment rejects files over 10MB"
  );
  expectDenied(
    await upload(`users/${userA.uid}/attachments/expenses/expense-2/data.txt`, userA.token, "text/plain"),
    "Expense attachment rejects unsupported content type"
  );
  expectDenied(
    await upload(
      `users/${userA.uid}/attachments/bills/bill-4/too-large.pdf`,
      userA.token,
      "application/pdf",
      Buffer.alloc(10 * 1024 * 1024 + 1)
    ),
    "Business attachment rejects files over 10MB"
  );

  const logoPath = `users/${userA.uid}/branding/company-logo`;
  await expectAllowed(await upload(logoPath, userA.token, "image/png"), "User A uploads company logo");
  await expectAllowed(await read(logoPath, userA.token), "User A reads company logo");
  await expectAllowed(await upload(logoPath, userA.token, "image/webp", Buffer.from("replacement logo")), "User A replaces company logo");
  expectDenied(await read(logoPath, userB.token), "User B reads User A logo");
  expectDenied(await upload(logoPath, userB.token, "image/png"), "User B overwrites User A logo");
  expectDenied(await remove(logoPath, userB.token), "User B deletes User A logo");
  expectDenied(await upload(logoPath, userA.token, "application/pdf"), "Company logo rejects non-image content");
  expectDenied(
    await upload(logoPath, userA.token, "image/png", Buffer.alloc(1024 * 1024 + 1)),
    "Company logo rejects files over 1MB"
  );
  await expectAllowed(await remove(logoPath, userA.token), "User A deletes company logo");

  expectDenied(await upload("bills/legacy-id/file.pdf", userA.token, "application/pdf"), "Legacy top-level path is denied");
  expectDenied(await upload(`users/${userA.uid}/private/unmatched.pdf`, userA.token, "application/pdf"), "Unmatched user path is denied");

  await expectAllowed(await remove(expensePath, userA.token), "User A deletes expense attachment");
  await expectAllowed(await remove(clientPath, userA.token), "User A deletes client attachment");

  console.log("Storage rules emulator tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
