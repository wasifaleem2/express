const UserModel = require("../models/UserModel");
const MessageModel = require("../models/MessagesModel");

let connectedUsers = [];
let connectedSockets = {};
const socketConnect = async (socket) => {
  const userPhone = socket.handshake.query.userPhone;
  console.log("socket id for new conn ", socket.id);
  console.log("userPhone on connection ", userPhone);
  let user = await UserModel.findOneAndUpdate(
    { phone: userPhone },
    { socketId: socket.id }
  )
    .then((res) => {
      // console.log(`socket id update for user phone ${userPhone}`)
      console.log("user", res);
    })
    .catch((err) => {
      console.log("error");
    });
  console.log("A user is connected", userPhone);
  connectedUsers.push(socket.id);
  connectedSockets[userPhone] = socket;
  console.log("user list", connectedUsers);
  // sending user his socket id
  socket.emit("socket_id", socket.id);
  io.emit("connected_users", { connectedUsers });
  socket.on("message-read", async (data) => {
    try {
      const result = await MessageModel.updateMany(
        {
          senderNumber: data.senderNumber,
          receiverNumber: data.receiverNumber,
        },
        { status: "read" }
      );
      console.log("Update successful:", result);
    } catch (error) {
      console.error("Error updating messages:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log(`socket ${socket.id} disconnected`);
    connectedUsers = connectedUsers.filter((user) => user !== socket.id);
    io.emit("connected_users", { connectedUsers });
  });
};

module.exports = { socketConnect, connectedSockets };
