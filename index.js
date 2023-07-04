const http = require("http");
const socketIO = require("socket.io");
const express = require('express')
const app = express();
app.use(express.json());
const mongoose = require("mongoose");
const databaseConnect = require("./database/index")
const UserModel = require("./models/UserModel");

//use cors
var cors = require('cors');
app.use(cors());

// call function to connect database
databaseConnect();

// create server
const server = http.createServer(app);

// creates socketIO server instance use polling for transport
// and allow cross origin request from cors
const io = socketIO(server, {
  transports: ["polling"],
  //origin * means cross-origin requests from any origin will be allowed.
  cors: {
    origin: "*", // or http://localhost:3001 or other for specific origin
  }
})


// array of all connected users
let connectedUsers = [];

// socket io connection code with client
io.on("connection", (socket) => {
  const userPhone = socket.handshake.query.userPhone;
  UserModel.findOneAndUpdate({ phone: userPhone }, { socketId: socket.id })
  .then(()=>{
    console.log(`socket id update for user phone ${userPhone}`)
  })
  .catch((err)=>{
    console.log("error")
  })
  console.log("A user is connected", userPhone);
  connectedUsers.push(socket.id);
  // console.log("user list",connectedUsers);
  let userSid = socket.id;
  // sending updated list of clients to all clients use io instead of socket to send to every user
  socket.emit("socket_id", userSid);
  io.emit("connected_users", { connectedUsers });
  socket.on("message", async (data) => {
  console.log(`message from ${socket.id} to ${data.recipient} : ${data.message} @date ${data.date} ${data.time}`);
    // sending message to all users 
    // socket.broadcast.emit('message', data);
    // for sending data specific client using socket id (data.receipent) coming from client
    io.to(data.sender).emit('receive-message', data)
    io.to(data.recipient).emit('receive-message', data)
  });

  // when client disconnects
  socket.on("disconnect", () => {
    console.log(`socket ${socket.id} disconnected`);
    connectedUsers = connectedUsers.filter((user) => user !== socket.id);
    io.emit("connected_users", { connectedUsers });
  });
});

// api calling from routes
app.use("/api", require("./routes/index.js"));


// port where the server is running 
const port = 3002

// running the server 
app.listen(port, () => {
  console.log(`Server starts at http://localhost:${port}`)
})