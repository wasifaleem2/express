const http = require("http");
const socketIO = require("socket.io");
const express = require('express')
const app = express();
app.use(express.json());
const databaseConnect = require("./database/index")
const {socketConnect} = require("./utilis/Socket");
const UserModel = require("./models/UserModel");

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
const port = 3002

// running the server 
server.listen(port, () => {
  console.log(`Server starts at http://localhost:${port}`)
})