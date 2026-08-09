# Backend API Reference

Base URL: `http://<host>:3002/api`

All handlers return (mostly) a JSON envelope:

```json
{ "status": 200, "message": "human readable", "data": null }
```

> Consistency note: some handlers still `res.send(raw)` instead of the DTO envelope. Where that happens it's called out below.

Auth: protected routes require `Authorization: Bearer <jwt>`. The middleware chain is shown per route. Tokens now **expire** (`JWT_EXPIRES_IN`, default 30d) and are **revoked on logout** — a logged-out or superseded token returns `403`. See [CHANGELOG.md](CHANGELOG.md).

---

## Auth & User

### POST `/save`
Create a user (name/phone/password). Hashes the password.
- **Body:** `{ name, phone, password }`
- **Responses:** `200 "saved"` · `406` missing fields · `500` error
- ⚠️ Password min-length validation is currently broken (see IMPROVEMENTS).

### POST `/verify`
Check whether a phone number is already registered (used by the client to branch into login vs register).
- **Body:** `{ phone }`
- **Response:** always HTTP `200`; body carries `status: 200|404` and a `userExist` boolean.

### POST `/login`
Dual-purpose **register + login**.
- **Body (login):** `{ phone, password, appToken?, platform? }`
- **Body (register):** `{ phone, password, name, forRegister: true, appToken?, platform? }`
- **Responses:** `200 { token, phone }` · `400` user already exists (register) · `401` wrong password · `404` no such user (login) · `500` error
- The returned JWT has **no expiry**.

### ~~POST `/notification/:token`~~ — **removed**
Removed (2026-08): was an unauthenticated FCM push to any token.

### GET `/users` — auth
Returns **all** users, **without** the password hash (`.select('-password')`).
- **Response:** `200` array of user docs.

### GET `/search?search=<q>` — auth
Regex search on `phone`/`name`. Input is escaped before building the `RegExp`; an empty query returns `[]`. Password hash omitted.
- **Query:** `search`
- **Response:** `200` array of matches.

### PUT `/update/:phone` — auth
Update a user's `name`.
- **Params:** `:phone` · **Body:** `{ name }`
- **Response:** `200`

### DELETE `/delete/:phone` — auth
Delete one user by phone.
- **Response:** `200`

### ~~DELETE `/deleteAll`~~ — **removed**
Removed (2026-08): let any authenticated user wipe the entire users collection.

### POST `/logout` — auth
Revokes the session by deleting the user's stored token (`AuthModel`) and releasing the FCM device token.
- **Body:** `{ appToken? }`
- **Response:** `200`
- After logout the JWT no longer authenticates (returns `403`).

### POST `/app-token` — auth
Register/refresh an FCM device token for the current user.
- **Body:** `{ appToken, platform }`
- **Responses:** `200` · `400` missing fields

---

## Messages

### GET `/message/no-of-messages?phone=<p>` — auth
Count messages where `phone` is sender or receiver.
- **Response:** `200` DTO with a `counts` value.

### GET `/message/get?senderNumber=<a>&receiverNumber=<b>` — auth
Fetch the 1:1 thread between two numbers.
- **Response:** `200` array of messages.

### GET `/message/getall?phone=<p>` — auth
All messages touching `phone`.
- **Response:** `200` array.

### GET `/message/getusers` — auth
Contact list for the authed user, with per-contact unread counts (messages still in `status:"send"`), joined against `users` (projecting `name phone socketId`).
- **Response:** `200` `recipientsList`.

### POST `/message/send` — auth, checkUser
Persist a message, then best-effort live-deliver over socket. If the recipient has **no live socket**, an FCM push is sent to their active device tokens (best-effort; never fails the save).
- **Body:** `{ senderNumber, receiverNumber, text, dateTime, messageType? }`
- **Response:** `200` saved message. Socket/push failures do not fail the save.

### PUT `/message/update/:id` — auth
Edit a message's text. Stamps `editedAt` and returns the updated document.
- **Params:** `:id` · **Body:** `{ text }`
- **Response:** `200` `{ ..., data: { message: <updated doc with editedAt> } }` · `404` if the id doesn't exist.

### DELETE `/message/delete/:id` — auth
Soft-delete a message.
- **Body:** `{ scope: "me" | "all" }` (default `"me"`).
  - `"me"` — adds the caller to the message's `deletedFor`; hidden for them only.
  - `"all"` — sender only; sets `deletedForAll` + clears `text` (tombstone for both parties).
- **Responses:** `200` · `403` if a non-sender requests `scope: "all"` · `404` if not found.

> `deleteChat` (deletes **all** messages via `deleteMany({})`) exists in the controller but is **not routed**.

---

## Socket.IO events

Connect with `io(host, { query: { userPhone }, transports: ['polling'] })`.

**Server → client**
| Event | Payload | When |
|---|---|---|
| `socket_id` | socket id | on connect |
| `connected_users` | `{ connectedUsers: string[] }` | on connect / disconnect (broadcast) |
| `receive-message` | message object | when a message is sent to you (or echoed to sender) |

**Client → server**
| Event | Payload | Effect |
|---|---|---|
| `message-read` | `{ senderNumber, receiverNumber }` | marks that thread's messages `status:"read"` |
| `disconnect` | — | removes socket from `connectedUsers` |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the socket layer and delivery path fit together.
