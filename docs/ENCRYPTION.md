# End-to-End Encryption — The Server's Role

The chat is **end-to-end encrypted**, which means the **server never sees
message plaintext and never holds any private key**. All encryption and
decryption happens on the phones. This document covers the *only* things the
backend does for E2EE:

1. Acts as a **public-key directory** (store/serve users' public keys).
2. **Stores and relays opaque ciphertext** without being able to read it.

For the actual cryptography (how keys are made and how messages are
encrypted/decrypted), see
[`client/docs/ENCRYPTION.md`](../../client/docs/ENCRYPTION.md).

## 1. Public-key directory

Each user's **public** key (safe to store — it's not secret) lives on the user
document, and there are two authenticated endpoints to publish and look it up.

**Model** — [`models/UserModel.js`](../models/UserModel.js):
```js
publicKey: { type: String, default: "" }   // base64 Curve25519 public key
```

**Endpoints** — [`routes/index.js`](../routes/index.js) →
[`controllers/UserController/index.js`](../controllers/UserController/index.js):

| Route | Auth | Controller | What it does |
|---|---|---|---|
| `POST /api/keys` | ✅ | `registerPublicKey` | upsert the **caller's** own public key (`{ publicKey }`) onto their user doc |
| `GET /api/keys/:phone` | ✅ | `getPublicKey` | return another user's public key so the caller can encrypt to them |

The client calls `POST /keys` on every app launch (idempotent upsert) and
`GET /keys/:phone` before sending a message. If `GET` returns 404 (that user has
never published a key), the client falls back to sending plaintext.

> The server only ever receives/returns **public** keys. Private keys are
> generated and kept in the device Keychain and are never transmitted.

## 2. Encrypted message storage & relay

The server stores the encrypted fields verbatim and cannot decrypt them.

**Model** — [`models/MessagesModel.js`](../models/MessagesModel.js):
```js
text:       { type: String, default: "" },   // plaintext ONLY for legacy/fallback (encVersion 0)
encVersion: { type: Number, default: 0 },    // 0 = plaintext/legacy, 1 = E2E encrypted
ciphertext: { type: String, default: "" },   // base64 secretbox(text)
nonce:      { type: String, default: "" },   // base64 nonce for the ciphertext
senderPub:  { type: String, default: "" },   // sender's public key (needed to open envelopes)
envelopes:  [ { phone, key, keyNonce } ],    // per-recipient wrapped content key (group-ready)
```

**Send** — `sendMessage` in
[`controllers/MessagesController/index.js`](../controllers/MessagesController/index.js):
- Persists the fields as received. For encrypted messages (`encVersion` set) it
  stores `text: ""` — **plaintext is never written** for an encrypted message.
- Relays the same payload to the recipient over the `receive-message` socket
  event (the client decrypts it).
- Sends a **generic push notification** (`"🔒 New message"`) because the server
  can't read the message to preview it.

**Edit** — `updateMessage`:
- Accepts re-encrypted cipher fields and relays them via the `message-edited`
  socket event so the recipient can decrypt the new text.

## What a stored message looks like

Encrypted (`encVersion: 1`):
```json
{
  "senderNumber": "+92...333",
  "receiverNumber": "+92...444",
  "text": "",
  "encVersion": 1,
  "ciphertext": "u9F2k…==",
  "nonce": "a1B2…==",
  "senderPub": "Qk8…=",
  "envelopes": [
    { "phone": "+92...444", "key": "…", "keyNonce": "…" },
    { "phone": "+92...333", "key": "…", "keyNonce": "…" }
  ]
}
```
A database dump (or a breach of the container / MongoDB / Atlas) yields only
this — **not** the message text.

Plaintext / legacy (`encVersion: 0`) — what you get before both parties have
published keys, or for pre-E2EE messages:
```json
{ "text": "Testing", "encVersion": 0, "ciphertext": "", "envelopes": [] }
```

## What the server can and cannot see

| Can see (metadata) | Cannot see |
|---|---|
| who messaged whom (`senderNumber`/`receiverNumber`) | message **text** (for `encVersion: 1`) |
| timestamps, message type, read/delivery status | any **private key** |
| public keys | the per‑message `contentKey` (it's wrapped to recipients) |

## Operational notes

- The `/keys` endpoints must be present in the **deployed** image. If a deploy
  is stale and `GET/POST /api/keys` return **404**, no device can publish or
  fetch keys, so **every** message silently falls back to plaintext. Verify
  after deploy: `GET /api/keys/<phone>` should return **401** (exists, needs
  auth), not 404.
- Existing plaintext (`encVersion: 0`) messages cannot be retroactively
  encrypted — no keys existed when they were sent.
- Firebase and DB credentials are provided at runtime (env vars), never baked
  into the image — so the public image contains no secrets.
