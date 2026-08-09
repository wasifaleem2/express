const http = require("http");
const socketIO = require("socket.io");
const express = require('express')
const app = express();
app.use(express.json({ limit: '1mb' }));
const databaseConnect = require("./database/index")
const {socketConnect} = require("./utilis/Socket");
const UserModel = require("./models/UserModel");
const { initializeApp, cert } = require("firebase-admin/app");


// load env 
require('dotenv').config()

// the /firebase folder is gitignored, so the key is missing on fresh clones.
// warn instead of crashing the whole chat server over notifications.
const serviceAccountPath =
  process.env.FIREBASE_SERVICE_ACCOUNT ||
  './firebase/app-notification-ec741-firebase-adminsdk-fbsvc-b7e9755e5c.json';

try {
  const serviceAccount = require(serviceAccountPath);
  initializeApp({
    credential: cert(serviceAccount),
  });
  console.log('Firebase admin initialized');
} catch (error) {
  console.warn(
    `Firebase admin not initialized (${serviceAccountPath}): ${error.message}. Push notifications are disabled.`
  );
}


//use cors
var cors = require('cors');
app.use(cors());

databaseConnect();

// create server
const server = http.createServer(app);

// creates socketIO server instance use polling for transport
// and allow cross origin request from cors
global.io = socketIO(server, {
  transports: ["polling"],
  cors: {
    origin: "*", // or http://localhost:3001 or other for specific origin
  }
})


global.io.on('connection', (socket) => socketConnect(socket));

// api calling from routes
app.use("/api", require("./routes/index.js"));

// port where the server is running
const port = process.env.PORT || 3002

// running the server 
server.listen(port, () => {
  console.log(`Server starts at http://localhost:${port}`)
})