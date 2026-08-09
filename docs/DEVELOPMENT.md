# Backend Development Guide

## Prerequisites

- **Node 20** (matches the Dockerfile base image)
- **MongoDB** listening on `localhost:27017`
  - On the current dev machine, `mongod` already runs as a native Windows process — **no Docker is needed**. Verify with a listener on 27017.
- (Optional) A **Firebase service-account key** for push notifications. Without it the server starts fine and just disables push.

## Environment variables (`.env`)

| Var | Required | Default / example |
|---|---|---|
| `LOCAL_DB_URL` | yes | `mongodb://localhost:27017/mukhar` |
| `PORT` | no | `3002` |
| `JWT_SECRET` | recommended | dev fallback `my_secret_key` — **set a long random value in production** |
| `JWT_EXPIRES_IN` | no | `30d` |
| `FIREBASE_SERVICE_ACCOUNT` | no | falls back to `./firebase/app-notification-…-adminsdk-….json` |

The Firebase key lives in the gitignored `firebase/` folder. `index.js` wraps its load in try/catch, so a missing key only logs a warning:

```
Firebase admin not initialized (...): ... Push notifications are disabled.
```

## Run

```bash
cd express
npm install
npm start        # node index.js → http://localhost:3002
```

On a healthy start you'll see: `Firebase admin initialized`, `database connected...`, `Server starts at http://localhost:3002`.

> On Windows, `npm start` output may be buffered behind the npm wrapper. If you see no logs but the port is taken, the server is running — check `netstat` for `:3002`.

## Smoke tests

```bash
curl -s -w "\n%{http_code}\n" http://localhost:3002/api/users
# → Unauthorized  /  401   (auth middleware works)

curl -s -X POST http://localhost:3002/api/login \
  -H "Content-Type: application/json" -d '{}'
# → {"status":404,"message":"User not found","data":null}  (route + DB reachable)
```

`GET /api` alone returns `404 Cannot GET /api` — expected, there is no route at the bare path.

## Docker (currently disabled)

- `docker-compose.yml` is **entirely commented out**. If enabled it would map host `3008 → container 3002` and run `mongo:6.0`.
- `Dockerfile`: `node:20-alpine`, installs `python3 make g++` (needed to build the native `bcrypt` addon), `npm install --production`, `EXPOSE 3002`, `CMD npm start`.
- ⚠️ `.dockerignore` only excludes `node_modules`, so `.env` and the `firebase/` key could be copied into an image. Tighten before publishing images (see IMPROVEMENTS).
- ⚠️ `LOCAL_DB_URL=localhost` won't resolve inside a container — a compose setup needs a service hostname (e.g. `mongodb://mongodb:27017/...`).

## Conventions

- Responses use the `{status, message, data}` DTO envelope (`dtos/userDto.js`, `dtos/messageDto.js`) — though not every handler does yet.
- Controllers emit socket events via the global `global.io` and the `connectedSockets` map from `utilis/Socket.js`.
- Auth is applied **per route** in `routes/index.js` (the global `router.use(authenticate)` is intentionally commented out).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the big picture, [API.md](API.md) for endpoints, and [IMPROVEMENTS.md](IMPROVEMENTS.md) for the backlog.
