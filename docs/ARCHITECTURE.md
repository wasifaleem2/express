# Backend Architecture

Node/Express + Socket.IO + MongoDB (Mongoose) chat backend with Firebase Cloud Messaging (FCM) push notifications. It powers a mobile chat app: phone-number based accounts, JWT auth, 1:1 messaging persisted in MongoDB, real-time delivery over sockets, and FCM device-token management.

- **Runtime:** Node 20, Express 4
- **Realtime:** Socket.IO 4 (polling transport only)
- **Data:** MongoDB via Mongoose 7
- **Auth:** bcrypt (password hashing) + jsonwebtoken (JWT)
- **Push:** firebase-admin (FCM)
- **Default port:** `3002` (hardcoded in `index.js`)

---

## Folder / file map

> Note: `models/LocationModel.js` and `mongoose.txt` were removed (dead code). The `utilis/` folder name is still a typo for `utils` (rename pending).

| Path | Role |
|---|---|
| `index.js` | Entry point: Express app, HTTP server, Socket.IO, CORS, Firebase init, Mongo connect, port from `PORT` |
| `database/index.js` | Mongoose connection using `process.env.DATABASE_URL` |
| `routes/index.js` | Single router mounted at `/api` — every endpoint |
| `controllers/UserController/index.js` | Auth + user CRUD + notification + app-token handlers |
| `controllers/MessagesController/index.js` | Message send/fetch/update/delete handlers (validates + relays `images`/`documents`, deletes their blobs on delete-for-everyone / delete-chat) |
| `controllers/MediaController/index.js` | Attachment endpoints: `GET /media/limits`, `POST /media/upload-urls`, `POST /media/read-urls` |
| `controllers/GroupController/index.js` | Group create/list/get + member & admin management |
| `models/UserModel.js` | `users` collection (phone, name, password, time, socketId) |
| `models/AuthModel.js` | `token` collection (phone → JWT) |
| `models/MessagesModel.js` | `messages` collection |
| `models/TokenModel.js` | Two models: `apptokens` and `userAppTokens` (FCM device tokens) |
| `middlewares/authenticate/index.js` | JWT verification middleware |
| `middlewares/checkUser/index.js` | Verifies a message recipient exists |
| `utilis/Socket.js` | Socket.IO connection handler, `connectedSockets` map, events (note: folder name is a typo for `utils`) |
| `utilis/appTokens.js` | FCM token save/remove/get helpers |
| `utilis/sendNotification.js` | Wraps `firebase-admin` messaging `.send()` |
| `utilis/blobStorage.js` | Azure Blob Storage wrapper (`@azure/storage-blob`): init from env, 10-min write/read SAS links, blob size, delete |
| `utilis/media.js` | Attachment rules: owner-prefixed blob names, `MAX_ATTACHMENTS` (4), `MEDIA_MAX_BYTES`, send-time validation, read access, blob cleanup |
| `dtos/userDto.js`, `dtos/messageDto.js` | Response envelope classes `{status, message, data}` |
| `firebase/…-adminsdk-…json` | FCM service-account key (gitignored) |
| `mongoose.txt` | Dead commented-out old route code (not loaded) |
| `Dockerfile`, `docker-compose.yml` | Container config (`docker-compose.yml` is fully commented out) |

---

## Request lifecycle

```
HTTP request
  → express.json()            (body parsing, no size limit)
  → cors()                    (all origins, "*")
  → /api router               (routes/index.js)
  → authenticate              (per-route; JWT verify → req.user = {phone})
  → checkUser                 (only on POST /message/send)
  → controller handler
  → res.json(new UserDto/MessageDto(status, message, data))
```

`index.js` also creates a raw `http.Server` so Socket.IO can attach to the same port, and stores the IO instance on `global.io` so controllers can emit without importing it.

---

## Data models

Relationships are **weak**: messages and users are linked only by matching phone **strings** (no ObjectId refs). Only the token models use real refs.

### `UserModel` → `users`
| Field | Type | Notes |
|---|---|---|
| `phone` | String | unique, required |
| `name` | String | required |
| `password` | String | required (bcrypt hash) |
| `time` | String | optional |
| `socketId` | String | optional — current live socket |

> Schema drift: `login` writes a `date` field and `saveUser` writes `time` — inconsistent, and `date` isn't in the schema.

### `AuthModel` → `token`
`phone` (unique) + `token` (latest JWT). Currently written on login but **never verified against** on requests (see IMPROVEMENTS).

### `MessagesModel` → `messages`
`senderNumber`, `receiverNumber`, `text`, `dateTime` (all required strings), `messageType` (default `"text"`), `status` (default `"send"` → `"read"`), `editedAt` (Date, set when a message is edited), and soft-delete tracking — `deletedForAll` (bool) + `deletedForAllAt` (Date) for "delete for everyone", `deletedFor` (array of phone numbers) for per-user "delete for me" — plus `createdAt`/`updatedAt` (`timestamps: true`). No user refs (linked by phone string).

Attachments (all opaque to the server — see [ENCRYPTION.md](ENCRYPTION.md)):
- `messageType` — `text`, `image`, `document` or `location` (a location's coordinates are inside the encrypted `text`).
- `images` — blob names of encrypted photos (max 4).
- `documents` — blob names of encrypted files (max 4); a message has images **or** documents.
- `documentMeta` — the documents' names/sizes/types, encrypted by the device.

## Attachments (Azure Blob Storage)

Files never pass through Express. The device encrypts each photo/document with the message's key, asks `POST /media/upload-urls` for 10-minute write-only SAS links, PUTs the ciphertext straight to a **private** container, then sends the normal message with the blob names. Blob names are `u/<sha256(phone) prefix>/<uuid>`, so the server can check a sender only attaches their own uploads (`validateUploadsForSend`: right owner, blob exists, ≤ `MEDIA_MAX_BYTES`). Viewers get 10-minute read-only links from `POST /media/read-urls`, granted only for files on a message they can see. Blobs are deleted when their message is deleted for everyone or the chat is deleted. Uploads that were never sent are not cleaned up yet.

### `TokenModel` → `apptokens` + `userAppTokens`
- `apptokens`: `token` (unique), `platform`, `isActive`, timestamps.
- `userAppTokens`: `userID` (unique ref→users), `tokens` (array of refs→apptokens).

A clean many-device-tokens-per-user model.

---

## Auth flow (end to end)

1. **Register / login** — `POST /api/login` is dual-purpose. Password hashed with `bcrypt.genSalt(10)` and compared with `bcrypt.compare`. On success: `jwt.sign({ phone }, secret, { expiresIn })` and the token is upserted into `AuthModel`.
2. **Client** stores the token and sends `Authorization: Bearer <token>` on protected requests.
3. **`authenticate`** verifies the signature/expiry **and** checks the token against the one stored in `AuthModel` for that user, then sets `req.user = { phone }`. This enforces server-side revocation.
4. **`checkUser`** additionally gates `POST /message/send` on the recipient existing.
5. **`logout`** deletes the stored `AuthModel` token, so the JWT immediately stops authenticating (`403`).

> The signing secret comes from `process.env.JWT_SECRET` (shared by `login` and `authenticate`), with the old literal as a dev fallback. Tokens expire per `JWT_EXPIRES_IN` (default 30d). See [CHANGELOG.md](CHANGELOG.md).

---

## Socket layer (`utilis/Socket.js`)

Module state:
- `connectedUsers` — array of connected socket ids
- `connectedSockets` — map `userPhone → socket` (imported by `MessagesController` to deliver messages)

**On connection** (`socketConnect`): reads `userPhone` from `socket.handshake.query`, writes that user's `socketId` into Mongo, pushes to `connectedUsers`, and stores the socket in `connectedSockets[userPhone]`.

| Direction | Event | Meaning |
|---|---|---|
| server → socket | `socket_id` | the connecting socket's id |
| server → all | `connected_users` | `{ connectedUsers }` broadcast |
| server → socket | `receive-message` | a new message (emitted from `sendMessage`, includes `_id`) |
| server → socket | `message-edited` | a message was edited (to both parties) |
| server → socket | `message-deleted` | a message was deleted for everyone (to both parties) |
| client → server | `message-read` | mark a sender/receiver thread as read |
| client → server | `disconnect` | remove from `connectedUsers` |

**Message send path:** `POST /message/send` persists the message first, then best-effort emits `receive-message` to the sender's socket and the recipient's `socketId`. Socket failures are caught and do **not** fail the HTTP 200 save.

**On disconnect:** the `connectedSockets[userPhone]` entry is deleted and the user's DB `socketId` is cleared (only if it still matches that socket), preventing map growth and delivery to dead sockets.

> Remaining gaps (see IMPROVEMENTS): the handshake still trusts any client-supplied `userPhone` (no auth); transport is polling-only.

---

## Configuration

| What | Where | Value |
|---|---|---|
| Mongo URL | `.env` → `DATABASE_URL` | `mongodb://localhost:27017/mukhar` |
| Firebase key path | env `FIREBASE_SERVICE_ACCOUNT` or hardcoded default | `./firebase/…-adminsdk-…json` |
| Port | `.env` → `PORT` (default 3002) | `3002` |
| CORS | `index.js` | `*` (HTTP and sockets) — still open |
| JWT secret | `.env` → `JWT_SECRET` | (dev fallback: `my_secret_key`) |
| JWT expiry | `.env` → `JWT_EXPIRES_IN` | `30d` |
| Blob storage | `.env` → `AZURE_STORAGE_CONNECTION_STRING` (secret), `AZURE_MEDIA_CONTAINER` | unset ⇒ attachments disabled (503) |
| Attachment size limit | `.env` → `MEDIA_MAX_BYTES` | `10240000` (10,000 KB) — the app reads it from `GET /media/limits` |
| Phone region | `.env` → `DEFAULT_PHONE_REGION` | `PK` |

See [DEVELOPMENT.md](DEVELOPMENT.md) to run it and [API.md](API.md) for the endpoint reference. Known issues and the improvement backlog are in [IMPROVEMENTS.md](IMPROVEMENTS.md).
