# End-to-End Encryption — The Server's Role

Messages are **end-to-end encrypted**: the server **never sees plaintext and
never holds a private key**. All encryption/decryption happens on the phones.
The backend does only two things:

1. Acts as a **public-key directory**.
2. **Stores and relays opaque ciphertext + wrapped keys** it cannot read.

Crypto details (Message Key, AES‑256‑GCM, sealed box) are in
[`client/docs/ENCRYPTION.md`](../../client/docs/ENCRYPTION.md).

## 1. Public-key directory
`UserModel.publicKey` (base64 Curve25519 public key) —
[`models/UserModel.js`](../models/UserModel.js). Endpoints in
[`controllers/UserController/index.js`](../controllers/UserController/index.js):

| Route | Auth | Does |
|---|---|---|
| `POST /api/keys` | ✅ | upsert the caller's own public key `{ publicKey }` |
| `GET /api/keys/:phone` | ✅ | return a user's public key so the caller can wrap a Message Key to them |

Only **public** keys are ever transmitted/stored.

## 2. Encrypted message storage & relay
Model — [`models/MessagesModel.js`](../models/MessagesModel.js):
```js
text:  { type: String, default: "" },   // AES-256-GCM ciphertext (base64); "" = tombstone
nonce: { type: String, default: "" },   // AES-GCM IV (base64)
encryptedMessageKeys: { type: Object, default: {} }, // { phone: <sealed Message Key b64> }
// + senderNumber, receiverNumber, dateTime (server UTC), messageType, replyTo,
//   status, deliveredTo[], readBy[], editedAt, deletedForAll(+At), deletedFor[], timestamps
```
There are **no** `encVersion`, `ciphertext`, `senderPub`, or `envelopes` fields —
removed in the redesign.

Controllers — [`controllers/MessagesController/index.js`](../controllers/MessagesController/index.js):
- **`sendMessage`**: stores `text`/`nonce`/`encryptedMessageKeys` **verbatim** (no
  server-side encryption). `dateTime` is server-stamped UTC. Relays the same cipher
  fields over the `receive-message` socket event. FCM push body is generic
  (`"🔒 New message"`) since the server can't read the text.
- **`updateMessage`**: swaps in the re-encrypted `text`/`nonce`/`encryptedMessageKeys`
  and relays via `message-edited`.
- **`getMessage`/`getAllMessages`**: return ciphertext as-is (client decrypts).
- **`deleteMessage`** (scope `all`): tombstone — clears `text`, `nonce`, and
  `encryptedMessageKeys`.

> The previous at-rest AES-GCM layer (`utilis/encryption.js` + `scripts/reencrypt-messages.js`)
> was **removed** — it's redundant under E2EE (the body is already client ciphertext).

## What a stored message looks like
```json
{
  "senderNumber": "+92...333",
  "receiverNumber": "+92...444",
  "text": "u9F2k…==",
  "nonce": "a1B2…==",
  "encryptedMessageKeys": {
    "+92...444": "<sealed base64>",
    "+92...333": "<sealed base64>"
  }
}
```
A DB dump yields only this — never the message text.

## Images
Image attachments reuse the message's own Message Key: the device encrypts each
image (AES-256-GCM, blob = `iv(12) ‖ ciphertext`) and uploads it straight to a
**private** Azure Blob container using a 10-minute write-only SAS link from
`POST /api/media/upload-urls`. The message stores only the blob names in
`images`. Since the key is already wrapped per member in `encryptedMessageKeys`,
anyone who can read the caption can read the images — and nobody else. Neither the
server nor Azure can view them. Readers get 10-minute read-only links from
`POST /api/media/read-urls` (membership-checked).

Documents work the same way (`documents` = blob names). Their file names,
sizes and types travel in `documentMeta`, also encrypted with the Message Key,
so the server never learns what a file is called.

## Can / cannot see
| Can see (metadata) | Cannot see |
|---|---|
| who ↔ whom, timestamps, type, delivery/read status, public keys | message **text**, **image contents**, any **private key**, the per-message **Message Key** |

## Operational notes
- The `/keys` endpoints **must be present in the deployed image**. If a stale
  deploy returns **404** for `GET /api/keys/:phone`, no device can fetch keys and
  every send **fails** (enforced mode — no plaintext fallback). Verify after deploy:
  `GET /api/keys/<phone>` → **401** (exists), not 404.
- Old messages from the previous scheme are incompatible and were cleared.
- Secrets (DB URL, JWT) come from env vars at runtime, never baked into the image.
