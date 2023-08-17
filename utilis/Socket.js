const UserModel = require("../models/UserModel");
const MessageModel = require("../models/MessagesModel");

let connectedUsers = [];
let connectedSockets = {};
const socketConnect = async (socket) => {
        const userPhone = socket.handshake.query.userPhone;
        console.log("socket id for new conn ", socket.id)
        console.log("userPhone on connection ", userPhone)
        let user = await UserModel.findOneAndUpdate({ phone: userPhone }, { socketId: socket.id })
        .then((res)=>{
          // console.log(`socket id update for user phone ${userPhone}`)
          console.log("user", res)
        })
        .catch((err)=>{
          console.log("error")
        })
        console.log("A user is connected", userPhone);
        connectedUsers.push(socket.id);
        connectedSockets[userPhone] = socket;
        console.log("user list",connectedUsers);
        // sending user his socket id
        socket.emit("socket_id", socket.id);
        io.emit("connected_users", { connectedUsers });
        // socket.on("message", async (data) => {
        //   let newMessage = new MessageModel({senderNumber: data.senderNumber, receiverNumber: data.receiverNumber, text:data.text, date:data.date,time: data.time, messageType: data.messageType})
        //   await newMessage.save();
        //   // console.log(`message from ${socket.id} to ${data.recipient} : ${data.messageText} @date ${data.date} ${data.time}`);
        //   let recipient = await UserModel.findOne({ phone: data.receiverNumber });
        //   let sender = await UserModel.findOne({ phone: data.senderNumber });
        //   console.log("message", data.text)
        //   io.to(sender.socketId).emit('receive-message', data)
        //   io.to(recipient.socketId).emit('receive-message', data)
        // });
        
      
        
        // when client disconnects
        socket.on("disconnect", () => {
          console.log(`socket ${socket.id} disconnected`);
          connectedUsers = connectedUsers.filter((user) => user !== socket.id);
          io.emit("connected_users", { connectedUsers });
        });
}

module.exports = { socketConnect, connectedSockets };

