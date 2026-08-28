# Backend Changelog

Notable changes to the Express backend, newest first.

## 2026-08 — Forward/mention message fields, send-dedupe hardening & chat-list last message

- **`forwarded` (Boolean) and `mentions` (String[]) fields** added to `MessageModel`. `sendMessage` reads both from the request body, persists them, and includes them in the returned payload + the `receive-message` socket broadcast, so forwarded flags and group @mentions travel to recipients.
- **DB-level send dedupe (race fix).** Added a **partial unique index** on `{ senderNumber, clientId }` (partial — enforced only when `clientId` is a string, so the many `clientId: null` rows are exempt). `sendMessage` now catches the **E11000** duplicate-key error from a concurrent retry and returns the already-saved message via `respondExisting`, instead of the previous racy `findOne`-then-insert that could let two simultaneous retries both insert.
- **Last-message metadata on the conversation lists.** `getMessagedUsers` (1:1) and `getMyGroups` (groups) now attach a `lastMessage` per conversation — `senderNumber`, `dateTime`, `messageType`, `deliveredTo`, `readBy`, `deletedForAll` — so the client can render a delivered/read tick on the chat list. Metadata only: the message **text stays encrypted and is never returned**.

## 2026-08 — Contact-based New Chat search + E.164 phone normalization

Backs the client's New Chat rule (find saved contacts by name, anyone by number):
- **New `GET /search-by-number`** (`searchByNumber`) — matches registered users by **phone only**; names are not searchable here. `GET /search` (name + phone) is unchanged and still used by the group member pickers.
- The client resolves saved-contact **names** to numbers locally (device address book) and calls the existing `POST /users/lookup` to turn them into app users — names are never sent to the server for matching.

**Phone normalization (additive, international-ready, non-breaking):**
- New **`phoneKey`** field on `UserModel` — the canonical **E.164** form of `phone` (e.g. `+923001234567`), derived on write via new `utilis/phone.js` (`libphonenumber-js`). `phone` is **unchanged** and stays the source of truth; `phoneKey` is only a formatting-proof match key (indexed, defaults to `""`).
- `searchByNumber` and `lookupUsers` now match `phoneKey` **OR** the raw `phone` (fallback), so the same person resolves regardless of how their number is formatted in a device address book — and users not yet backfilled still work.
- Local numbers (no country code) are interpreted with **`DEFAULT_PHONE_REGION`** (env, default `PK`); numbers with a country code parse on their own.
- **Backfill:** `scripts/backfill-phonekey.js` (idempotent) populates `phoneKey` for existing users — run once after deploy. See [API.md](API.md#auth--user).

## 2026-08 — Socket handshake authentication

- **The Socket.IO handshake now requires a valid JWT.** A new `authenticateSocket` middleware (`utilis/Socket.js`, wired via `io.use` in `index.js`) verifies the token from `socket.handshake.auth.token`, checks it against the stored `AuthModel` token (same revocation rule as the REST middleware), and pins the identity on `socket.data.phone`.
- **`socketConnect` now derives the user from the verified token**, not the client-supplied `userPhone` query param. This closes an impersonation hole: previously anyone could connect *as any phone* and receive that user's live `receive-message` / `group-updated` events and emit receipts as them. The `userPhone` query is retained for logging only.
- Clients must now send the JWT in the handshake `auth` (the RN client does this in `createSocketConnectionInstance`); an unauthenticated/invalid handshake is rejected.

## 2026-08 — Group member & admin management

Added membership/admin controls on top of the existing group chat (`GroupController`, `routes/index.js`). All management routes are **admin-gated** via a shared `loadAsAdmin` guard (`404` no group / `403` not an admin).

- **New routes:** `POST /group/:groupId/members` (add), `DELETE /group/:groupId/members/:member` (remove), `POST /group/:groupId/admins/:member` (promote), `DELETE /group/:groupId/admins/:member` (demote), `POST /group/:groupId/leave`. See [API.md](API.md#groups).
- **Guardrails:** the **owner** (`createdBy`) can't be removed or demoted; `leaveGroup` auto-promotes the first remaining member if the last admin leaves, so a group is never adminless; adds/removes are idempotent (`$addToSet` / `$pull`).
- **Live sync:** a new `broadcastGroupUpdate` helper emits a **`group-updated`** socket event (over `connectedSockets`) to every member — plus any just-removed or departed phone, so their client drops the group in real time.
- **E2EE unchanged:** the server still never reads group keys/text. New members see only messages sent **after** they join (clients seal to the updated roster); history isn't re-keyed. *(All paths verified via curl — non-admin add → 403, remove owner → 400, promote/demote, last-admin leave auto-promote.)*

## 2026-08 — Richer message notifications

- **`sendMessage`** now enriches the offline FCM push: it looks up the sender's **name** (`UserModel`) for the notification **title** and uses the message **text** as the **body** (generic `🔒 New message` for legacy E2EE where the server has no plaintext). Adds `senderName`/`body` to the `data` payload and an `android.notification.channelId: "default_channel"` block. `[push]` diagnostic logging retained.

## 2026-08 — Key rotation (encryption keyring)

- `utilis/encryption.js` now supports a **keyring**: the stored format is
  `enc:<keyId>:…`, and each message is decrypted with the key whose id it carries.
  This lets you **rotate `MESSAGE_ENC_KEY` without making old messages
  unreadable** — add a new key, point `MESSAGE_ENC_KEY_CURRENT` at it; old rows
  keep decrypting with their original key.
- **Backward compatible:** with only `MESSAGE_ENC_KEY` set, it behaves exactly as
  before (key id `v1`), so existing `enc:v1:…` rows still decrypt.
- New env (optional, for rotation): `MESSAGE_ENC_KEYS` (JSON `{id: material}`) +
  `MESSAGE_ENC_KEY_CURRENT`.
- New `scripts/reencrypt-messages.js` — re-encrypts all rows to the current key
  so an old key can be safely retired (idempotent).
- *(Verified: after adding a new current key, an old-key message still decrypts
  and new messages use the new key.)*

## 2026-08 — Security hardening (server-stored model)

Moving to a server-stored model (server can read messages), with defense-in-depth:
- **Encryption at rest** — new `utilis/encryption.js` (AES-256-GCM). Plaintext
  message `text` is encrypted before saving (`enc:v1:` + base64 iv|tag|ct) and
  decrypted on read. Legacy plaintext and E2EE (`text: ""`) pass through
  unchanged. Key from **`MESSAGE_ENC_KEY`** (set a strong random value via a
  secrets manager in prod). *(Verified: DB stores `enc:v1:…`; reads return
  plaintext.)*
- **Authorization / IDOR fix** — `getMessage` now requires the caller to be one
  of the two participants (else `403`); `getAllMessages` and `getNoOfMessage`
  derive the user from the **JWT** (`req.user.phone`) instead of trusting a
  query param. *(Verified: a non-participant gets 403.)*
- **helmet** — security headers (HSTS, nosniff, frameguard, …) on all responses.
- **Rate limiting** — `express-rate-limit`: 300/15min on `/api`, and a stricter
  20/15min on `/save`, `/verify`, `/login` to slow brute force.
- **`app.set('trust proxy', 1)`** — required behind Azure Container Apps' ingress
  proxy; without it every rate-limited request threw
  `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` and login failed in production.

New env var: `MESSAGE_ENC_KEY`.

## 2026-08 — Real-time edit / delete propagation

- **`updateMessage`** now emits a `message-edited` socket event to both the
  sender and receiver (via a new `emitToUsers` helper over `connectedSockets`),
  so an edit updates the other party's open chat instantly instead of only on
  the next fetch.
- **`deleteMessage` (scope `all`)** emits `message-deleted` to both parties for
  a live tombstone.
- **`sendMessage`** now includes the message `_id` in the `receive-message`
  payload, so messages received live (not just fetched) can be edited/deleted
  in real time too.
- *(Verified: a socket client subscribed as the recipient receives
  `message-edited` with the new text and `message-deleted` with
  `deletedForAll:true` right after the sender's API calls.)*

## 2026-08 — Soft delete (delete for me / for everyone)

Replaced the hard delete (`deleteOne`) with a soft-delete model that tracks
**who** a message is deleted for:

- **Model fields** (`MessagesModel`): `deletedForAll` (bool), `deletedForAllAt`
  (Date), `deletedFor` (array of phone numbers).
- **`DELETE /message/delete/:id`** now takes a `scope` (in the request body):
  - `"me"` (default): adds the requester's phone to `deletedFor` — hidden for
    them only, still visible to everyone else.
  - `"all"`: **sender only** (else `403`); sets `deletedForAll`/`deletedForAllAt`
    and clears `text`, so both parties see a "This message was deleted"
    tombstone. Uses `findByIdAndUpdate` so blanking the required `text` doesn't
    trip schema validation.
- **`GET /message/get`** filters out messages where `deletedFor` contains the
  requesting user (`req.user.phone`); tombstones (`deletedForAll`) are still
  returned so the client can render the placeholder.
- *(Verified end-to-end: delete-for-me hides only for that user; delete-for-all
  tombstones for both; a non-sender's delete-for-all is 403.)*

## 2026-08 — Message edit/delete support

- **`editedAt` on messages.** `MessagesModel` has a new `editedAt` (Date, default `null`).
- **`PUT /message/update/:id`** now stamps `editedAt: new Date()`, uses `{ new: true }`, returns the updated document (`data.message`), and 404s if the id doesn't exist. The client uses `editedAt` to show "edited &lt;date&gt;".
- **`DELETE /message/delete/:id`** (already existed) is now exercised by the client's long-press → Delete flow. *(Verified end-to-end via API: edit stamps editedAt; delete removes the message.)*

## 2026-08 — Security & correctness pass

### Auth / security
- **Real token revocation.** `middlewares/authenticate/index.js` now verifies the JWT **and** checks it against the token stored in `AuthModel` for that user. The old `if (token == token)` (always true) is gone. `logout` deletes the stored token, so a logged-out or superseded token is rejected with `403`. *(Verified: register → use token → logout → same token now 403.)*
- **JWT secret from env + expiry.** Signing secret reads `process.env.JWT_SECRET` (falls back to the old literal for dev), in both `authenticate` and `login`. Tokens are now signed with `expiresIn` (`JWT_EXPIRES_IN`, default `30d`) instead of never expiring.
- **Removed dangerous endpoints.** `DELETE /api/deleteAll` (any logged-in user could wipe all users) and `POST /api/notification/:token` (unauthenticated push to any FCM token) are no longer routed.
- **Password hashes no longer leaked.** `GET /users` and `GET /search` use `.select('-password')`.
- **Regex injection fixed.** `searchUser` escapes user input before building the `RegExp`, and returns `[]` for an empty query instead of every user.
- **Signup validation fixed.** `saveUser` now validates required fields and `password.length < 5` **before** hashing (previously it hashed first and compared a string to a number, so the rule never fired). `login`'s register branch also enforces the 5-char minimum.

### Correctness
- **`updateMessage` fixed.** It now updates `MessageModel` instead of `UserModel`, so message edits actually persist.
- **Socket disconnect cleanup.** On `disconnect`, the `connectedSockets` map entry is deleted and the user's DB `socketId` is cleared (only if it still points at that socket). Prevents a growing map and delivery to dead sockets.

### Features
- **Offline push on new message.** `sendMessage` now sends an FCM push to the recipient's active device tokens when they have no live socket (best-effort — never fails the save).

### Config / cleanup
- **Env-driven.** Port reads `process.env.PORT` (default `3002`); `express.json` now has a `1mb` body-size limit. New `.env` keys: `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`.
- **Message timestamps.** `MessagesModel` now uses `{ timestamps: true }`.
- **Dead code removed.** Deleted `mongoose.txt` and the unused `models/LocationModel.js`; removed the `phone = "555"` leftover in `getMessage` and the unused in-memory `revokedTokens` set.

### Still open (see IMPROVEMENTS.md)
`helmet` / rate limiting (needs new deps), restrict CORS, centralized error handler, rename `utilis/` → `utils/`, dedupe DTO classes, socket handshake auth, tests.
