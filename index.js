const http = require("http");
const socketIO = require("socket.io");
const express = require('express')
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();

// Behind Azure Container Apps' ingress proxy, the real client IP arrives in the
// X-Forwarded-For header. Trust exactly one proxy hop so express-rate-limit can
// key on the true client IP (and doesn't throw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR).
// '1' (not 'true') avoids clients spoofing X-Forwarded-For to dodge rate limits.
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// General API rate limit — blunt protection against abuse/scraping.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);
const databaseConnect = require("./database/index")
const {socketConnect, authenticateSocket} = require("./utilis/Socket");
const UserModel = require("./models/UserModel");
const { initializeApp, cert } = require("firebase-admin/app");


// load env 
require('dotenv').config()

// FIREBASE_SERVICE_ACCOUNT accepts EITHER:
//   - the full service-account JSON (starts with "{") — preferred for cloud
//     deploys, so the key file never ships in the image, or
//   - a path to the JSON file (e.g. ./firebase/…adminsdk….json) for local dev.
// If unset, falls back to the bundled key file (warns instead of crashing). FIREBASE_SERVICE_ACCOUNT_JSON
function loadServiceAccount() {
  const val = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (val.startsWith('{')) {
    return JSON.parse(val); // whole JSON provided via env/secret
  }
  const path = require('path');
  const file =
    val ||
    './firebase/app-notification-ec741-firebase-adminsdk-fbsvc-92936dea08.json';
  return require(path.resolve(file)); // treat as a file path
}

try {
  const serviceAccount = loadServiceAccount();
  initializeApp({
    credential: cert(serviceAccount),
  });
  console.log('Firebase admin initialized');
} catch (error) {
  console.warn(
    `Firebase admin not initialized: ${error.message}. Push notifications are disabled.`
  );
}


//use cors
var cors = require('cors');
app.use(cors());

databaseConnect();

// create server
const server = http.createServer(app);

// creates socketIO server instance. Prefer WebSocket (lower latency + battery
// than long-polling); keep polling as a fallback for networks/proxies that
// block WS. Azure Container Apps' ingress supports WebSocket upgrades.
global.io = socketIO(server, {
  transports: ["websocket", "polling"],
  cors: {
    origin: "*", // or http://localhost:3001 or other for specific origin
  }
})


// Verify the JWT on every socket handshake before the connection is accepted.
global.io.use((socket, next) => authenticateSocket(socket, next));

global.io.on('connection', (socket) => socketConnect(socket));

// api calling from routes
app.use("/api", require("./routes/index.js"));

// port where the server is running
const port = process.env.PORT || 3002

// running the server 
server.listen(port, () => {
  console.log(`Server starts at http://localhost:${port}`)
})