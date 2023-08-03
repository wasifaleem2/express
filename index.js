const http = require("http");
const socketIO = require("socket.io");
const express = require('express')
const app = express();
app.use(express.json());
const databaseConnect = require("./database/index")
const socketConnect = require("./utilis/Socket");

//use cors
var cors = require('cors');
app.use(cors());

// call function to connect database
databaseConnect();

// create server
const server = http.createServer(app);

// creates socketIO server instance use polling for transport
// and allow cross origin request from cors
global.io = socketIO(server, {
  transports: ["polling"],
  //origin * means cross-origin requests from any origin will be allowed.
  cors: {
    origin: "*", // or http://localhost:3001 or other for specific origin
  }
})


// array of all connected users
let connectedUsers = [];

// socket io connection code with client
// io.on("connection", async (socket) => {
//   const userPhone = socket.handshake.query.userPhone;
//   console.log("socket id for new conn ", socket.id)
//   console.log("userPhone on connection ", userPhone)
//   let user = await UserModel.findOneAndUpdate({ phone: userPhone }, { socketId: socket.id })
//   .then((res)=>{
//     // console.log(`socket id update for user phone ${userPhone}`)
//     console.log("user", res)
//   })
//   .catch((err)=>{
//     console.log("error")
//   })
//   console.log("A user is connected", userPhone);
//   connectedUsers.push(socket.id);
//   console.log("user list",connectedUsers);
//   // sending user his socket id
//   socket.emit("socket_id", socket.id);
//   // io.emit("connected_users", { connectedUsers });
//   socket.on("message", async (data) => {
//     console.log(`message from ${socket.id} to ${data.recipient} : ${data.messageText} @date ${data.date} ${data.time}`);
//     let recipient = await UserModel.findOne({ phone: data.recipient });
//     console.log("recipient", recipient)
//     io.to(data.senderSocket).emit('receive-message', data)
//     io.to(recipient.socketId).emit('receive-message', data)
//   });

  
//   // when client disconnects
//   socket.on("disconnect", () => {
//     console.log(`socket ${socket.id} disconnected`);
//     connectedUsers = connectedUsers.filter((user) => user !== socket.id);
//     io.emit("connected_users", { connectedUsers });
//   });
// });

global.io.on('connection', socketConnect)

// api calling from routes
app.use("/api", require("./routes/index.js"));


// port where the server is running 
const port = 3002

// running the server 
server.listen(port, () => {
  console.log(`Server starts at http://localhost:${port}`)
})