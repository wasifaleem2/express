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
  // Receipt convention:
  //   data.senderNumber   = author of the messages being acknowledged (S)
  //   data.receiverNumber = the party acknowledging (R)
  // We add R to the messages' deliveredTo / readBy sets, then push a
  // `receipt-update` back to S's live socket so the sender's bubbles upgrade
  // in real time. Using $addToSet keeps this idempotent and group-ready.

  // R's device received S's messages (delivered, not necessarily read).
  socket.on("message-delivered", async (data) => {
    try {
      await MessageModel.updateMany(
        {
          senderNumber: data.senderNumber,
          receiverNumber: data.receiverNumber,
          readBy: { $ne: data.receiverNumber },
        },
        {
          $addToSet: { deliveredTo: data.receiverNumber },
          $set: { status: "delivered" },
        }
      );
      const authorSocket = connectedSockets[data.senderNumber];
      if (authorSocket) {
        authorSocket.emit("receipt-update", {
          senderNumber: data.senderNumber,
          receiverNumber: data.receiverNumber,
          type: "delivered",
        });
      }
    } catch (error) {
      console.error("Error marking delivered:", error);
    }
  });

  // R opened the chat and read S's messages.
  socket.on("message-read", async (data) => {
    try {
      await MessageModel.updateMany(
        {
          senderNumber: data.senderNumber,
          receiverNumber: data.receiverNumber,
        },
        {
          $addToSet: {
            deliveredTo: data.receiverNumber,
            readBy: data.receiverNumber,
          },
          $set: { status: "read" },
        }
      );
      const authorSocket = connectedSockets[data.senderNumber];
      if (authorSocket) {
        authorSocket.emit("receipt-update", {
          senderNumber: data.senderNumber,
          receiverNumber: data.receiverNumber,
          type: "read",
        });
      }
    } catch (error) {
      console.error("Error updating messages:", error);
    }
  });

  socket.on("disconnect", async () => {
    console.log(`socket ${socket.id} disconnected`);
    connectedUsers = connectedUsers.filter((user) => user !== socket.id);

    // Clean up the phone→socket map and the user's stored socketId so the map
    // doesn't grow unbounded and messages aren't relayed to a dead socket.
    if (userPhone) {
      delete connectedSockets[userPhone];
      try {
        // Only clear if this socket is still the current one for the user
        // (a newer connection may have replaced it).
        await UserModel.findOneAndUpdate(
          { phone: userPhone, socketId: socket.id },
          { socketId: "" }
        );
      } catch (err) {
        console.error("disconnect cleanup failed:", err);
      }
    }

    io.emit("connected_users", { connectedUsers });
  });
};

module.exports = { socketConnect, connectedSockets };
