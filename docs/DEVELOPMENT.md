# Backend Development Guide

## Prerequisites

- **Node 20** (matches the Dockerfile base image)
- **MongoDB** listening on `localhost:27017`
  - On the current dev machine, `mongod` already runs as a native Windows process — **no Docker is needed**. Verify with a listener on 27017.
- (Optional) A **Firebase service-account key** for push notifications. Without it the server starts fine and just disables push.

## Environment variables (`.env`)

| Var | Required | Default / example |
|---|---|---|
| `DATABASE_URL` | yes | `mongodb://localhost:27017/mukhar` |
| `PORT` | no | `3002` |
| `JWT_SECRET` | recommended | dev fallback `my_secret_key` — **set a long random value in production** |
| `JWT_EXPIRES_IN` | no | `30d` |
| `FIREBASE_SERVICE_ACCOUNT` | no | **either** the whole service-account JSON (starts with `{` — preferred for cloud, set as a secret) **or** a path to the JSON file. Falls back to the bundled `./firebase/…adminsdk….json`. |
| `DEFAULT_PHONE_REGION` | no | `PK` — country assumed for numbers without a country code |
| `AZURE_STORAGE_CONNECTION_STRING` | for images | Azure Storage account connection string (**secret** — Container App secret in prod). Unset ⇒ image messages disabled (media routes return 503). |
| `AZURE_MEDIA_CONTAINER` | no | `media` — **private** blob container for encrypted images |
| `MEDIA_MAX_BYTES` | no | `10240000` (10,000 KB) — largest photo/document that can be attached. **The only place the limit is set:** the app reads it from `GET /api/media/limits`. |

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
- ⚠️ `DATABASE_URL=localhost` won't resolve inside a container — a compose setup needs a service hostname (e.g. `mongodb://mongodb:27017/...`).

## Conventions

- Responses use the `{status, message, data}` DTO envelope (`dtos/userDto.js`, `dtos/messageDto.js`) — though not every handler does yet.
- Controllers emit socket events via the global `global.io` and the `connectedSockets` map from `utilis/Socket.js`.
- Auth is applied **per route** in `routes/index.js` (the global `router.use(authenticate)` is intentionally commented out).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the big picture, [API.md](API.md) for endpoints, and [IMPROVEMENTS.md](IMPROVEMENTS.md) for the backlog.

## Azure Blob Storage (image messages)

1. Storage account: **StorageV2, Standard, LRS, Hot** (what the free tier covers).
2. Create a **private** container (no anonymous access), e.g. `media`. No CORS needed — only the native app talks to it.
3. Storage account → *Security + networking → Access keys* → copy the **connection string**.
4. Local: put it in `express/.env` (see `.env.example`). Production: add a Container App **secret** and map the env var `AZURE_STORAGE_CONNECTION_STRING` to it.

On start the server logs `Azure Blob Storage ready (container "media")`, or a warning that media is disabled.
