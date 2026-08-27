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

## Groups

Group chat. A group has a `groupId` (`grp_<ObjectId>`), `name`, `members` (phone array), `admins` (phone array, ⊆ members), and `createdBy` (owner phone). Identity always comes from the JWT, never the request body. Membership/admin changes **broadcast a `group-updated` socket event** to every member (and any just-removed/left phone) so clients update live — see the socket table below.

> **E2EE note:** the server never reads group message text or keys. Adding a member means the **clients** start sealing future messages' Message Key to the new member (they read the updated roster); past messages are **not** re-keyed, so a new member can't read history and a removed member keeps only what they already received. No forward secrecy / key rotation in v1.

### POST `/group` — auth
Create a group. The creator is added automatically and becomes the sole admin/owner.
- **Body:** `{ name, members: [phone, ...] }` — needs at least one other member.
- **Responses:** `200 { data: { group } }` · `400` missing name / fewer than 2 members · `500`

### GET `/group/getall` — auth
List the groups the caller belongs to, most-recent activity first. Each group carries a `lastMessage` **metadata** block (sender, time, `deliveredTo`/`readBy` arrays) for the home-list receipt tick — never the text.
- **Response:** `200 { data: { groupList } }`

### GET `/group/:groupId` — auth
Fetch one group. Members only.
- **Responses:** `200 { data: { group } }` · `403` not a member · `404` not found

### POST `/group/:groupId/members` — auth, **admin**
Add members (idempotent — phones already in the group are ignored).
- **Body:** `{ members: [phone, ...] }`
- **Responses:** `200 { data: { group } }` · `400` no new members · `403` not an admin · `404` group not found · `500`

### DELETE `/group/:groupId/members/:member` — auth, **admin**
Remove a member (also stripped from `admins`). The **owner can't be removed** (`400`). The removed member is notified via `group-updated` so their client drops the group.
- **Responses:** `200 { data: { group } }` · `400` owner · `403` not an admin · `404` not a member / group not found

### POST `/group/:groupId/admins/:member` — auth, **admin**
Promote an existing member to admin.
- **Responses:** `200 { data: { group } }` · `400` target isn't a member · `403` not an admin · `404` group not found

### DELETE `/group/:groupId/admins/:member` — auth, **admin**
Demote an admin back to a regular member. The **owner stays an admin** (`400`).
- **Responses:** `200 { data: { group } }` · `400` owner · `403` not an admin · `404` group not found

### POST `/group/:groupId/leave` — auth
Leave a group (any member). If the **last admin** leaves a non-empty group, the first remaining member is auto-promoted, so a group is never left adminless.
- **Responses:** `200 { data: { group } }` · `400` not in the group · `404` not found

> The four admin-gated routes share a `loadAsAdmin` guard: `404` if the group doesn't exist, `403` if the caller isn't in `admins`. *(All group management responses verified end-to-end via curl: non-admin add → 403; remove owner → 400; last-admin leave auto-promotes.)*

---

## Socket.IO events

Connect with `io(host, { query: { userPhone }, transports: ['polling'] })`.

**Server → client**
| Event | Payload | When |
|---|---|---|
| `socket_id` | socket id | on connect |
| `connected_users` | `{ connectedUsers: string[] }` | on connect / disconnect (broadcast) |
| `receive-message` | message object (incl. `_id`) | when a message is sent to you (or echoed to sender) |
| `message-edited` | `{ _id, text, editedAt, senderNumber, receiverNumber }` | when a message you're in is edited (both parties) |
| `message-deleted` | `{ _id, deletedForAll, senderNumber, receiverNumber }` | when a message is deleted for everyone (both parties) |
| `group-updated` | `{ group }` | a group's roster/metadata changed (member added/removed, admin promoted/demoted, member left) — sent to every current member plus any just-removed/left phone |

> **Group messages** reuse `receive-message` — the payload carries a `groupId` field, and the sealed per-member key set travels in `encryptedMessageKeys`. The server relays and stores it verbatim; it never reads group text.

**Client → server**
| Event | Payload | Effect |
|---|---|---|
| `message-read` | `{ senderNumber, receiverNumber }` | marks that thread's messages `status:"read"` |
| `disconnect` | — | removes socket from `connectedUsers` |

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the socket layer and delivery path fit together.
