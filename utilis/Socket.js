const jwt = require("jsonwebtoken");
const UserModel = require("../models/UserModel");
const MessageModel = require("../models/MessagesModel");
const GroupModel = require("../models/GroupModel");
const AuthModel = require("../models/AuthModel");

// Same signing secret as the REST auth middleware (single source of truth).
const secret = process.env.JWT_SECRET || "my_secret_key";

let connectedUsers = [];
let connectedSockets = {};

// Socket.IO handshake auth. The phone a socket acts as is taken from a VERIFIED
// JWT — never from a client-supplied `userPhone` query param — so a client can't
// impersonate another user to receive their messages / group updates or emit
// receipts as them. Mirrors the REST middleware, including revocation: the
// presented token must still match the one stored for the user at login.
const authenticateSocket = async (socket, next) => {
  try {
    const token =
      (socket.handshake.auth && socket.handshake.auth.token) ||
      (socket.handshake.headers.authorization || "").split(" ")[1];
    if (!token) return next(new Error("unauthorized"));

    const decoded = jwt.verify(token, secret);
    const auth = await AuthModel.findOne({ phone: decoded.phone });
    if (!auth || auth.token !== token) return next(new Error("unauthorized"));

    // Pin the identity for the rest of the connection.
    socket.data.phone = decoded.phone;
    next();
  } catch (err) {
    next(new Error("unauthorized"));
  }
};

// Emit an event to every live member of a group (looked up by groupId).
const emitToRoster = async (groupId, event, payload) => {
  try {
    const group = await GroupModel.findOne({ groupId }).select("members");
    if (!group) return;
    group.members.forEach((phone) => {
      const s = connectedSockets[phone];
      if (s) s.emit(event, payload);
    });
  } catch (err) {
    console.error("emitToRoster failed:", err.message);
  }
};
const socketConnect = async (socket) => {
  // Identity comes from the verified JWT (set by authenticateSocket), not the
  // client's query param.
  const userPhone = socket.data.phone;
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
  // Group form: data = { groupId, member } — mark all group messages NOT authored
  // by `member` as delivered to `member`, and tell the roster to upgrade bubbles.
  socket.on("message-delivered", async (data) => {
    try {
      if (data.groupId) {
        await MessageModel.updateMany(
          {
            groupId: data.groupId,
            senderNumber: { $ne: data.member },
            readBy: { $ne: data.member },
          },
          { $addToSet: { deliveredTo: data.member } }
        );
        emitToRoster(data.groupId, "receipt-update", {
          groupId: data.groupId,
          member: data.member,
          type: "delivered",
        });
        return;
      }
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

  // Typing indicator: relay only (no DB write).
  //   1:1   data = { senderNumber, receiverNumber, isTyping }
  //   group data = { senderNumber, groupId, members: [phone], isTyping, senderName }
  socket.on("typing", (data) => {
    if (data.groupId && Array.isArray(data.members)) {
      data.members
        .filter((m) => m !== data.senderNumber)
        .forEach((m) => {
          const s = connectedSockets[m];
          if (s) s.emit("typing", data);
        });
      return;
    }
    const recipientSocket = connectedSockets[data.receiverNumber];
    if (recipientSocket) {
      recipientSocket.emit("typing", data);
    }
  });

  // R opened the chat and read S's messages.
  // Group form: data = { groupId, member } — same fan-out as delivered.
  socket.on("message-read", async (data) => {
    try {
      if (data.groupId) {
        await MessageModel.updateMany(
          { groupId: data.groupId, senderNumber: { $ne: data.member } },
          { $addToSet: { deliveredTo: data.member, readBy: data.member } }
        );
        emitToRoster(data.groupId, "receipt-update", {
          groupId: data.groupId,
          member: data.member,
          type: "read",
        });
        return;
      }
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

module.exports = { socketConnect, connectedSockets, authenticateSocket };
