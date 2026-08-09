# Backend Improvements Backlog

Prioritized: **P0 = security/correctness (do first)**, **P1 = robustness**, **P2 = quality/cleanup**. Each item cites `file:line` where practical, why it matters, and a suggested fix. Line numbers are approximate and may drift as code changes.

> **Status update (2026-08):** all P0 items are **DONE**, plus socket disconnect cleanup, offline push, env-driven port, JSON size limit, message timestamps, and dead-code removal. See [CHANGELOG.md](CHANGELOG.md). Remaining: P1 hardening (helmet/rate-limit/CORS), centralized errors, socket handshake auth, and P2 cleanup (rename `utilis`, dedupe DTOs, tests).

---

## P0 — Security & correctness — ✅ ALL DONE

### 1. Dead auth check — logout/revocation doesn't work
`middlewares/authenticate/index.js:27` — `if (token == token)` is always true. The `AuthModel.findOne({ phone })` result on line 25 is fetched but never used.
- **Why:** server-side revocation is a no-op; a stolen token is valid forever, and `logout` has no real effect.
- **Fix:** either compare the presented token against the stored `AuthModel.token` (and reject on mismatch), or drop the DB lookup entirely and rely on short-lived JWTs + a real blacklist. Remove the always-true branch.

### 2. Hardcoded JWT secret, no expiry
Secret `"my_secret_key"` is duplicated in `middlewares/authenticate/index.js:2` and `controllers/UserController/index.js:92`; `jwt.sign` sets no `expiresIn`.
- **Fix:** move to `process.env.JWT_SECRET` (single source), add `{ expiresIn: '7d' }` (or similar) and pin the algorithm on verify (`{ algorithms: ['HS256'] }`).

### 3. `updateMessage` writes the wrong model
`controllers/MessagesController/index.js:169` — calls `UserModel.findOneAndUpdate({_id}, {text})` instead of `MessageModel`. Message edits silently succeed (200) but change nothing. **Verified.**
- **Fix:** use `MessageModel.findOneAndUpdate(...)`.

### 4. Destructive endpoints open to any user
`deleteAll` wipes the whole `users` collection; the unrouted `deleteChat` wipes all messages. Both are gated only by `authenticate`.
- **Fix:** remove them, or restrict to an admin role; never expose "delete everything" to normal auth.

### 5. Unauthenticated push endpoint
`POST /api/notification/:token` (`pushNotificationTest`) can send an FCM push to any device token with no auth.
- **Fix:** remove it, or put it behind `authenticate` + admin, or restrict to non-production.

### 6. Password hashes leaked in responses
`fetchUsers` and `searchUser` return full user docs including the bcrypt hash.
- **Fix:** add a projection (`.select('-password')`) or map to a safe DTO.

### 7. Regex injection / ReDoS in search
`searchUser` puts raw `req.query.search` into `new RegExp(...)`.
- **Fix:** escape the input before building the regex, or use a text index / `$text` search. Consider anchoring and a length cap.

### 8. Broken registration validation
`controllers/UserController/index.js` — `saveUser` hashes the password **before** the required-field check, and `if (password < 5)` compares a string to a number (always false), so the "min length" rule never fires (and the message says "6 characters").
- **Fix:** validate first (`!password || password.length < 6`), then hash. Add a shared validation layer.

---

## P1 — Robustness

### 9. Socket lifecycle & auth gaps (`utilis/Socket.js`) — partially DONE
- ✅ `disconnect` now deletes the `connectedSockets[userPhone]` entry and clears the DB `socketId`.
- ⏳ The handshake still trusts a client-supplied `userPhone` with no verification.
- ⏳ Transport is `polling` only (no websocket upgrade).
- **Remaining fix:** authenticate the handshake with the JWT (`socket.handshake.auth.token`); allow `['websocket','polling']`.

### 10. ✅ DONE — Push on new message
`sendMessage` now looks up the recipient's active tokens (`getUserTokens`) and sends an FCM push when they have no live socket (best-effort).

### 11. Hardening middleware missing
No `helmet`, no rate limiting, `express.json()` has no size limit, CORS is `*`.
- **Fix:** add `helmet`, `express-rate-limit` (especially on `/login`, `/save`), `express.json({ limit: '1mb' })`, and restrict CORS to known origins.

### 12. Errors leak internals
Many handlers `console.log` the raw Mongo error and return it in the response body.
- **Fix:** log server-side, return a generic message; add a centralized error handler.

### 13. Config not env-driven — mostly DONE
- ✅ Port now `process.env.PORT || 3002`; `express.json({ limit: '1mb' })` added.
- ⏳ DB name inconsistency across code/docker; no config for containerized Mongo (still open).

---

## P2 — Quality & cleanup

- **Rename `utilis/` → `utils/`** (typo) and update imports. *(still open)*
- **Deduplicate DTOs:** `UserDto` and `MessageDto` are identical `{status, message, data}` classes → one shared `ResponseDto`. Use it consistently (some handlers still `res.send(raw)`). *(still open)*
- ✅ **Dead code removed:** deleted `models/LocationModel.js`, `mongoose.txt`, the `phone = "555"` leftover, and the unused `revokedTokens` set. *(the unrouted `deleteChat` handler still exists in the controller.)*
- **Schema consistency:** reconcile `time` vs `date` on `UserModel`. ✅ `timestamps: true` added to messages.
- **Add tests:** `npm test` is the default error stub. Add unit/integration tests for auth, message flow, and the socket layer. *(still open)*
- **Docker:** enable/repair `docker-compose.yml`; tighten `.dockerignore` to exclude `.env` and `firebase/`.
- **Logging:** replace scattered `console.log` with a logger (pino/winston) and levels.

---

## Suggested order

1. P0 #1–#3 (auth + the silent `updateMessage` bug) — highest risk/impact, small diffs.
2. P0 #4–#8 (destructive endpoints, data leaks, validation).
3. P1 #9–#13 (sockets, push, hardening, config).
4. P2 cleanup as capacity allows.
